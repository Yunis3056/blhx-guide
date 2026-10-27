import { TABLES, relPath } from '../tables.ts'
import { readTable } from '../fetch/fetch.ts'

/**
 * ship_data_statistics 不是一个体系。
 *
 * 3,957 行里 **3,429 行是舰船突破阶段行**，判据是 `id - skin_id ∈ 1..4`
 * （阶段 n 的行 id 就是 skin_id + n）。按这个判据切完：
 *   · 覆盖 860 个 skin_id，其中 856 个正好 4 行，其余 4 个是缺行的边缘船；
 *   · 每个 skin_id 的 rarity 唯一（0 例冲突），取值域 {2,3,4,5,6}；
 *   · 剩下 528 行是另一套东西：attrs 全 1 的展示单位、id 自指的 NPC 行，
 *     rarity=18 那三行全在这一侧。它们不是舰船阶段行，稀有度枚举不必为它们扩容。
 *
 * 不用 `id >= 900000` 这类阈值切：阈值是观测出来的巧合，字段关系才是定义。
 */

export interface ShipRow {
  id: number
  skin_id: number
  star: number
  rarity: number
  attrs: number[]
  attrs_growth: number[]
  attrs_growth_extra: number[]
  english_name: string
  armor_type: number
  default_equip_list: number[]
  fix_equip_list: number[]
}

export const stageIndexOf = (row: { id: number; skin_id: number }): number => row.id - row.skin_id

export function isStageRow(row: { id: number; skin_id: number }): boolean {
  const idx = stageIndexOf(row)
  return idx >= 1 && idx <= 4
}

export function readShipRows(root: string, sha: string): ShipRow[] {
  const raw = readTable(root, sha, relPath(TABLES.shipStats)) as Record<string, Partial<ShipRow>>
  const out: ShipRow[] = []
  for (const [k, v] of Object.entries(raw)) {
    if (!/^\d+$/.test(k)) continue
    if (typeof v.id !== 'number' || typeof v.skin_id !== 'number') {
      throw new Error(`ship_data_statistics 键 ${k} 缺 id 或 skin_id，阶段行判据失效`)
    }
    out.push(v as ShipRow)
  }
  return out
}

/** skin_id → 阶段行，按阶段号升序 */
export function groupStageRows(rows: readonly ShipRow[]): Map<number, ShipRow[]> {
  const by = new Map<number, ShipRow[]>()
  for (const r of rows) {
    if (!isStageRow(r)) continue
    const list = by.get(r.skin_id)
    if (list) list.push(r)
    else by.set(r.skin_id, [r])
  }
  for (const list of by.values()) list.sort((a, b) => stageIndexOf(a) - stageIndexOf(b))
  return by
}

/**
 * 稀有度只从阶段行取。同一 skin_id 出现两个 rarity 即中止 ——
 * 这不是理论风险：全表 3,957 行里有 11 个 skin_id 的 rarity 不自洽，
 * 全部只因为把非阶段行混了进来。
 */
export function rarityBySkin(groups: ReadonlyMap<number, readonly ShipRow[]>): Map<number, number> {
  const out = new Map<number, number>()
  const conflict: string[] = []
  for (const [skinId, list] of groups) {
    const seen = new Set<number>()
    for (const r of list) if (typeof r.rarity === 'number') seen.add(r.rarity)
    if (seen.size > 1) {
      conflict.push(`  skin_id ${skinId}: ${[...seen].sort((a, b) => a - b).join(' / ')}`)
      continue
    }
    if (seen.size === 1) out.set(skinId, [...seen][0] as number)
  }
  if (conflict.length > 0) {
    throw new Error(`阶段行内 rarity 不自洽（${conflict.length} 艘）：\n${conflict.join('\n')}`)
  }
  return out
}

export interface StageShape {
  stageRows: number
  others: number
  skins: number
  exactlyFour: number
}

/** 阶段行的形状断言：上游把行结构改了，这里先炸，别到 emit 才发现 */
export function assertStageShape(rows: readonly ShipRow[], shape: StageShape): StageShape {
  const stage = rows.filter(isStageRow)
  const groups = groupStageRows(rows)
  const measured: StageShape = {
    stageRows: stage.length,
    others: rows.length - stage.length,
    skins: groups.size,
    exactlyFour: [...groups.values()].filter((g) => g.length === 4).length,
  }
  const problems: string[] = []
  if (measured.stageRows < shape.stageRows) {
    problems.push(`阶段行数 ${measured.stageRows} 低于基线 ${shape.stageRows}`)
  }
  if (measured.skins < shape.skins) {
    problems.push(`阶段行覆盖 skin_id ${measured.skins} 低于基线 ${shape.skins}`)
  }
  if (measured.exactlyFour / Math.max(measured.skins, 1) < 0.9) {
    problems.push(`4 行/船的比例 ${(measured.exactlyFour / measured.skins).toFixed(3)} 掉到 0.9 以下，阶段号语义可能变了`)
  }
  for (const g of groups.values()) {
    const idx = g.map(stageIndexOf)
    const dup = idx.filter((v, i) => idx.indexOf(v) !== i)
    if (dup.length > 0) {
      problems.push(`skin_id 组内阶段号重复：${dup.join(',')}`)
      break
    }
  }
  if (problems.length > 0) {
    throw new Error(`ship_data_statistics 阶段行形状异常：\n  ${problems.join('\n  ')}`)
  }
  return measured
}
