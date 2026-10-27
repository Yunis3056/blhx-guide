import { TABLES, relPath } from '../tables.ts'
import { readTable } from '../fetch/fetch.ts'
import { toNamed, type AttrMap } from './attr-map.ts'
import { groupStageRows, isStageRow, readShipRows, stageIndexOf } from './stage-rows.ts'
import { resolveName, type NameCodeMap } from './name-code.ts'
import type { FactionEntry } from '../display/factions.ts'

/**
 * 舰船三层记录。三层各自独立成文件，因为它们的粒度不同：
 *   ship       859   一条 = 一个图鉴条目（主键 group_type）
 *   ship-stage 3,429 一条 = 一个突破阶段（只有阶段行，非阶段行进隔离清单）
 *   ship-skin  2,730 一条 = 一个皮肤（图片 join 键就是它的 id）
 *
 * 船名在 group 表里没有（要两跳），且有 362 条是 {namecode:N} 占位；
 * 稀有度只认阶段行；获取方式是 description 里的结构化三元组，不是自由文本。
 */

export const HANDBOOK_TYPES = [0, 1, 2, 3] as const
export const SKIN_TYPES = [-1, 1, 2, 3, 4, 6] as const
/**
 * 获取方式是 description 里的结构化三元组 [文本, [命令, 参数], 标记]，共 1,432 项 / 859 船。
 * 空命令 = 纯文本（多为限时活动名）；LEVEL 的参数带 chapterid（44 个关卡，117 艘船有），
 * 那要等 chapter_template 入库才能连过去，现在是断的 join。
 */
export const SOURCE_COMMANDS = ['', 'SHOP', 'GETBOAT', 'LEVEL', 'SHIPBLUEPRINT', 'METACHARACTER', 'COLLECTSHIP'] as const
/** voice_actor 的「无 CV」有两个哨兵：-1 与 0（后者只在 900xxx 的 NPC 皮肤段出现） */
export const NO_VOICE_ACTOR = [0, -1] as const

export interface ShipSource {
  text: string
  command: (typeof SOURCE_COMMANDS)[number]
  args: Record<string, unknown> | null
}

export interface ShipRecord {
  groupType: number
  name: string
  englishName: string
  code: string
  indexId: number
  handbookType: number
  nationality: number
  factionSlug: string
  factionName: string
  shipType: number
  typeName: string
  teamType: string
  rarity: number | null
  rarityLabel: string | null
  defaultSkinId: number | null
  skinCount: number
  sources: ShipSource[]
  retrofit: boolean
  fleetTechClassId: number | null
}

export interface ShipStageRecord {
  rowId: number
  skinId: number
  groupType: number
  stage: number
  star: number
  rarity: number
  armorType: number
  attrs: Record<string, number>
  attrsGrowth: Record<string, number>
  attrsGrowthExtra: Record<string, number>
  defaultEquipList: number[]
  fixEquipList: number[]
}

export interface ShipSkinRecord {
  skinId: number
  groupType: number
  name: string
  skinType: number
  painting: string
  voiceActor: string | null
  tag: number[]
}

export interface QuarantineEntry {
  kind: string
  key: string
  detail: string
}

export interface ShipInput {
  attrMap: AttrMap
  rarityLabels: Map<number, string>
  factions: Map<number, FactionEntry>
  factionNames: Map<number, string>
  nameCode: NameCodeMap
  fleetTechClassByGroup: Map<number, number>
  /** 舰级的 nation 与舰船 nationality 是两条独立证据，实测 726/726 相等；分叉即口径变了 */
  fleetTechClassNationByGroup: Map<number, number>
}

function dict(root: string, sha: string, key: keyof typeof TABLES): Record<string, Record<string, unknown>> {
  const raw = readTable(root, sha, relPath(TABLES[key])) as Record<string, unknown>
  const out: Record<string, Record<string, unknown>> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (/^\d+$/.test(k) && v && typeof v === 'object' && !Array.isArray(v)) out[k] = v as Record<string, unknown>
  }
  return out
}

function parseSources(groupType: number, raw: unknown): ShipSource[] {
  if (!Array.isArray(raw)) throw new Error(`group ${groupType}: description 不是数组，获取方式的解析前提没了`)
  const out: ShipSource[] = []
  for (const item of raw) {
    if (!Array.isArray(item) || item.length !== 3 || typeof item[0] !== 'string' || !Array.isArray(item[1])) {
      throw new Error(`group ${groupType}: description 项形态不是 [文本, 命令数组, 标记]，实测 1,432 项全是该形态：${JSON.stringify(item).slice(0, 80)}`)
    }
    const command = (item[1][0] ?? '') as string
    if (!(SOURCE_COMMANDS as readonly string[]).includes(command)) {
      throw new Error(
        `group ${groupType}: 出现未登记的获取方式命令 '${command}'。` +
          `已枚举 ${SOURCE_COMMANDS.join(' / ')}；新命令的跳转语义要在页面上写清楚才能上线，不猜`,
      )
    }
    const arg = item[1][1]
    const args = arg && typeof arg === 'object' ? (arg as Record<string, unknown>) : null
    // 科研与收藏两条命令的参数里带船自己 id，自指必须成立（实测 46 条全等，0 例外）。
    // 不成立就是上游把 source 挂错了船，宁可中止也不要在页面上指错活动。
    if (args && (command === 'SHIPBLUEPRINT' || command === 'COLLECTSHIP')) {
      if (args.shipGroupId !== groupType) {
        throw new Error(
          `group ${groupType}: 获取方式 ${command} 指向 shipGroupId ${String(args.shipGroupId)}，不是自己。` +
            `实测这两类命令共 46 条、全部自指`,
        )
      }
    }
    out.push({ text: item[0], command: command as ShipSource['command'], args })
  }
  return out
}

export function buildShipRecords(root: string, sha: string, input: ShipInput): {
  ships: ShipRecord[]
  stages: ShipStageRecord[]
  skins: ShipSkinRecord[]
  quarantine: QuarantineEntry[]
} {
  const groups = dict(root, sha, 'shipGroup')
  const skinRows = dict(root, sha, 'shipSkinTemplate')
  const hullTypes = dict(root, sha, 'shipByType')
  const voiceActors = dict(root, sha, 'voiceActorCN')
  const transRows = dict(root, sha, 'shipTrans')

  const problems: string[] = []
  const quarantine: QuarantineEntry[] = []

  // group → 默认皮肤（skin_type = -1）。实测 1,213 条默认皮肤 / 1,211 个 group，
  // 多出来的那一组是同键不同船的脏数据，进隔离清单不静默合并。
  const defaultSkin = new Map<number, Record<string, unknown>[]>()
  const skins: ShipSkinRecord[] = []
  for (const r of Object.values(skinRows)) {
    const skinType = r.skin_type as number
    if (!(SKIN_TYPES as readonly number[]).includes(skinType)) {
      problems.push(`skin ${String(r.id)}: 未登记的 skin_type ${String(skinType)}（实测枚举 ${SKIN_TYPES.join('/')}）`)
      continue
    }
    const groupType = r.ship_group as number
    if (skinType === -1) {
      const list = defaultSkin.get(groupType)
      if (list) list.push(r)
      else defaultSkin.set(groupType, [r])
    }
    const raw = String(r.name ?? '')
    const resolved = resolveName(raw, input.nameCode)
    if (resolved.misses.length > 0) {
      problems.push(`skin ${String(r.id)}: 船名占位 ${resolved.misses.join(',')} 在 name_code 里查不到`)
    }
    const va = r.voice_actor
    const hasVoiceActor = typeof va === 'number' && !(NO_VOICE_ACTOR as readonly number[]).includes(va)
    const vaName = hasVoiceActor ? (voiceActors[String(va)]?.actor_name as string | undefined) : null
    if (hasVoiceActor && vaName === undefined) {
      quarantine.push({ kind: 'voice_actor_missing', key: String(va), detail: `skin ${String(r.id)} 的 CV id ${va} 不在 voice_actor_CN` })
    }
    skins.push({
      skinId: r.id as number,
      groupType,
      name: resolved.text,
      skinType,
      painting: String(r.painting ?? ''),
      voiceActor: typeof vaName === 'string' && vaName.length > 0 ? vaName : null,
      tag: Array.isArray(r.tag) ? (r.tag as number[]) : [],
    })
  }

  // 阶段行：判据是 id - skin_id ∈ 1..4（§11 A）
  const shipRows = readShipRows(root, sha)
  const stageGroups = groupStageRows(shipRows)
  const skinToGroup = new Map<number, number>()
  for (const s of skins) skinToGroup.set(s.skinId, s.groupType)

  const stages: ShipStageRecord[] = []
  const rarityByGroup = new Map<number, number>()
  const englishByGroup = new Map<number, string>()
  // 图鉴白名单：阶段行按表切是 3,429 行 / 860 个 skin_id，但其中 skin 900424 的
  // 2 行属于 352 个孤儿 group 之一（§11 B 不为孤儿建页），归一化层要先剔掉，
  // 否则 ship_stage 的外键指向一组不存在的页面。
  const whitelist = new Set(Object.values(groups).map((g) => g.group_type as number))
  for (const [skinId, rows] of stageGroups) {
    const seen = new Set<number>()
    for (const r of rows) if (typeof r.rarity === 'number') seen.add(r.rarity)
    if (seen.size > 1) {
      problems.push(`skin ${skinId}: 阶段行内 rarity 不唯一 ${[...seen].join('/')}`)
      continue
    }
    const rarity = [...seen][0] as number | undefined
    const groupType = skinToGroup.get(skinId)
    if (groupType === undefined) {
      quarantine.push({ kind: 'stage_row_without_group', key: String(skinId), detail: `${rows.length} 行阶段行的 skin_id 不在任何 group 的皮肤里` })
      continue
    }
    if (rarity !== undefined) rarityByGroup.set(groupType, rarity)
    if (!whitelist.has(groupType)) {
      quarantine.push({
        kind: 'stage_row_orphan_group',
        key: String(skinId),
        detail: `${rows.length} 行阶段行属于 group ${groupType}，不在 ship_data_group 的 859 条里`,
      })
      continue
    }
    for (const r of rows) {
      if (r.english_name && !englishByGroup.has(groupType)) englishByGroup.set(groupType, r.english_name)
      const named = (a: readonly number[] | undefined): Record<string, number> => toNamed(input.attrMap, a)
      stages.push({
        rowId: r.id,
        skinId,
        groupType,
        stage: stageIndexOf(r),
        star: r.star,
        rarity: rarity as number,
        armorType: r.armor_type,
        attrs: named(r.attrs),
        attrsGrowth: named(r.attrs_growth),
        attrsGrowthExtra: named(r.attrs_growth_extra),
        defaultEquipList: r.default_equip_list ?? [],
        fixEquipList: r.fix_equip_list ?? [],
      })
    }
  }
  for (const r of shipRows) {
    if (!isStageRow(r)) quarantine.push({ kind: 'non_stage_ship_row', key: String(r.id), detail: `skin ${r.skin_id} / rarity ${r.rarity}：不是阶段行，只登记不渲染` })
  }

  const ships: ShipRecord[] = []
  for (const g of Object.values(groups)) {
    const groupType = g.group_type as number
    const handbookType = g.handbook_type as number
    if (!(HANDBOOK_TYPES as readonly number[]).includes(handbookType)) {
      problems.push(`group ${groupType}: handbook_type ${handbookType} 不在图鉴分类枚举 ${HANDBOOK_TYPES.join('/')}`)
      continue
    }
    const shipType = g.type as number
    const hull = hullTypes[String(shipType)]
    if (!hull) {
      problems.push(`group ${groupType}: type ${shipType} 不在 ship_data_by_type 枚举里（正向依据被破坏）`)
      continue
    }
    const faction = input.factions.get(g.nationality as number)
    if (!faction) {
      problems.push(`group ${groupType}: nationality ${String(g.nationality)} 未登记在 data/manual/factions.json`)
      continue
    }
    const classNation = input.fleetTechClassNationByGroup.get(groupType)
    if (classNation !== undefined && classNation !== g.nationality) {
      problems.push(
        `group ${groupType}: 舰级的 nation ${classNation} 与舰船 nationality ${String(g.nationality)} 分叉` +
          `（实测 726/726 相等，这条是两张独立表的交叉证据）`,
      )
    }
    const defaults = defaultSkin.get(groupType) ?? []
    const def = defaults[0]
    if (!def) {
      problems.push(`group ${groupType}: 没有 skin_type=-1 的默认皮肤，页面标题无从取得`)
      continue
    }
    if (defaults.length > 1) {
      quarantine.push({
        kind: 'multiple_default_skins',
        key: String(groupType),
        detail: defaults.map((d) => `${d.id}:${String(d.name)}`).join(' | '),
      })
    }
    const title = resolveName(String(def.name ?? ''), input.nameCode).text
    const rarity = rarityByGroup.get(groupType) ?? null
    ships.push({
      groupType,
      name: title,
      englishName: englishByGroup.get(groupType) ?? '',
      code: String(g.code ?? ''),
      indexId: g.index_id as number,
      handbookType,
      nationality: faction.nationality,
      factionSlug: faction.slug,
      factionName: input.factionNames.get(faction.nationality) ?? faction.name,
      shipType,
      typeName: String(hull.type_name),
      teamType: String(hull.team_type),
      rarity,
      rarityLabel: rarity === null ? null : (input.rarityLabels.get(rarity) ?? null),
      defaultSkinId: def.id as number,
      skinCount: skins.filter((s) => s.groupType === groupType).length,
      sources: parseSources(groupType, g.description),
      retrofit: transRows[String(groupType)] !== undefined,
      fleetTechClassId: input.fleetTechClassByGroup.get(groupType) ?? null,
    })
  }

  if (problems.length > 0) {
    throw new Error(`舰船归一化断言失败（${problems.length} 条，前 20）：\n  ${problems.slice(0, 20).join('\n  ')}`)
  }
  ships.sort((a, b) => a.groupType - b.groupType)
  stages.sort((a, b) => a.rowId - b.rowId)
  skins.sort((a, b) => a.skinId - b.skinId)
  quarantine.sort((a, b) => (a.kind + a.key).localeCompare(b.kind + b.key))
  return { ships, stages, skins, quarantine }
}
