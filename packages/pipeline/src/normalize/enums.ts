import type { AttrMap } from './attr-map.ts'
import type { ShipRarity } from '../display/rarity.ts'
import type { FactionEntry } from '../display/factions.ts'

/**
 * 枚举层入 normalized/。
 *
 * 必须落文件，不能等建库时再去读 `data/raw`：`data/raw/` 不入库，Pages 构建
 * 只有已提交的 `data/normalized/`（§6.2 顺序第 1–2 步，且「构建阶段不访问业务
 * 数据源」是核心原则）。属性英文名→中文标签、稀有度标签、舰种名与阵营名都
 * 来自上游，不落盘就得在构建期重新解析 gametip。
 */

export type EnumRow =
  | { kind: 'attr'; idx: number; attrId: number; name: string; label: string }
  | { kind: 'rarity'; value: number; label: string }
  | { kind: 'hull'; typeId: number; typeName: string; teamType: string }
  | { kind: 'faction'; nationality: number; slug: string; name: string; source: string }

export function buildEnumRows(
  attrMap: AttrMap,
  rarities: readonly ShipRarity[],
  hulls: ReadonlyMap<number, { typeName: string; teamType: string }>,
  factions: readonly FactionEntry[],
  factionNames: ReadonlyMap<number, string>,
): { rows: EnumRow[]; counts: Record<EnumRow['kind'], number> } {
  const attrs: EnumRow[] = attrMap.attrs.map((a) => ({
    kind: 'attr',
    idx: a.index,
    attrId: a.id,
    name: a.name,
    label: a.label,
  }))
  const rarity: EnumRow[] = rarities.map((r) => ({ kind: 'rarity', value: r.value, label: r.label }))
  const hull: EnumRow[] = [...hulls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([typeId, v]) => ({ kind: 'hull', typeId, typeName: v.typeName, teamType: v.teamType }))
  const faction: EnumRow[] = factions
    .slice()
    .sort((a, b) => a.nationality - b.nationality)
    .map((f) => ({
      kind: 'faction',
      nationality: f.nationality,
      slug: f.slug,
      name: factionNames.get(f.nationality) ?? f.name,
      source: f.source,
    }))
  const rows = [...attrs, ...rarity, ...hull, ...faction]
  return {
    rows,
    counts: { attr: attrs.length, rarity: rarity.length, hull: hull.length, faction: faction.length },
  }
}
