import type { DatabaseSync } from 'node:sqlite'
import { num, optStr, str, type Row } from '../db'

/**
 * 舰船页的全部 SQL（§4.3：页面不写 SQL）。
 *
 * 属性一律按 `attr_def.name` 取，页面组件永远不需要知道它在位置数组的第几格——
 * 这是 §3.7 交叉断言在展示层的延续。
 */

export interface AttrDef {
  name: string
  label: string
}

export interface StageAttr {
  attr: string
  label: string
  base: number
  growth: number
  growthExtra: number
}

export interface Stage {
  stage: number
  star: number
  attrs: StageAttr[]
}

export interface Skin {
  skinId: number
  name: string
  skinType: number
  voiceActor: string | null
}

export interface Source {
  text: string
  command: string
  args: string | null
}

export interface RetrofitNode {
  branch: number
  /** 组内序号 */
  seq: number
  name: string
  /** 面向玩家的中文效果，如「耐久+70」；实测 1,217 个节点里 9 条为空 */
  descrip: string
  useGold: number
  levelLimit: number
  starLimit: number
}

export interface ShipPage {
  groupType: number
  name: string
  englishName: string
  code: string
  indexId: number
  factionName: string
  factionSlug: string
  rarityLabel: string | null
  typeName: string
  teamType: string
  stages: Stage[]
  skins: Skin[]
  sources: Source[]
  retrofitSkinId: number | null
  retrofitSkill: string | null
  retrofitNodes: RetrofitNode[]
  fleetTechClass: string | null
  fleetTechPt: number | null
  /** attrs_growth_extra 非零：1–100 外推曲线在这类船上不完整（§3.7 未闭合项） */
  growthExtraUsed: boolean
}

const attrDefs = (db: DatabaseSync): AttrDef[] =>
  (db.prepare('SELECT name, label FROM attr_def ORDER BY idx').all() as Row[]).map((r) => ({
    name: str(r, 'name'),
    label: str(r, 'label'),
  }))

const needNum = (v: number | undefined, what: string): number => {
  if (v === undefined) throw new Error(`${what} 缺失`)
  return v
}

const needStr = (v: string | undefined, what: string): string => {
  if (v === undefined) throw new Error(`${what} 缺失`)
  return v
}

export function getShipPage(db: DatabaseSync, groupType: number): ShipPage | null {
  const head = db
    .prepare(
      `SELECT s.group_type, s.name, s.english_name, s.code, s.index_id, s.rarity, s.has_retrofit,
              f.name AS faction_name, f.slug AS faction_slug,
              r.label AS rarity_label,
              h.type_name, h.team_type
       FROM ship s
       JOIN faction f ON f.nationality = s.nationality
       JOIN hull_type h ON h.type_id = s.ship_type
       LEFT JOIN rarity r ON r.value = s.rarity
       WHERE s.group_type = ?`,
    )
    .get(groupType) as Row | undefined
  if (head === undefined) return null

  const defs = attrDefs(db)
  const labelOf = new Map(defs.map((d) => [d.name, d.label]))
  const stageRows = db
    .prepare(
      `SELECT st.stage, st.star, sa.attr, sa.base, sa.growth, sa.growth_extra
       FROM ship_stage st
       JOIN ship_stage_attr sa ON sa.group_type = st.group_type AND sa.stage = st.stage
       WHERE st.group_type = ?
       ORDER BY st.stage, sa.attr`,
    )
    .all(groupType) as Row[]

  const byStage = new Map<number, Map<string, StageAttr>>()
  const starByStage = new Map<number, number>()
  for (const r of stageRows) {
    const stage = num(r, 'stage')
    // star 与 stage 同源：同一阶段的四行里它是同一个值
    starByStage.set(stage, num(r, 'star'))
    const attr = str(r, 'attr')
    const attrs = byStage.get(stage) ?? new Map<string, StageAttr>()
    attrs.set(attr, {
      attr,
      label: needStr(labelOf.get(attr), `attr_def 里的 ${attr}`),
      base: num(r, 'base'),
      growth: num(r, 'growth'),
      growthExtra: num(r, 'growth_extra'),
    })
    byStage.set(stage, attrs)
  }

  const stages: Stage[] = [...byStage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([stage, attrs]) => ({
      stage,
      star: needNum(starByStage.get(stage), `阶段 ${stage} 的 star`),
      // 定义表顺序输出，缺项即数据问题，不做补零
      attrs: defs.map((d) => attrs.get(d.name)).filter((a): a is StageAttr => a !== undefined),
    }))

  const skins = (
    db
      .prepare('SELECT skin_id, name, skin_type, voice_actor FROM ship_skin WHERE group_type = ? ORDER BY skin_id')
      .all(groupType) as Row[]
  ).map((r) => ({
    skinId: num(r, 'skin_id'),
    name: str(r, 'name'),
    skinType: num(r, 'skin_type'),
    voiceActor: optStr(r, 'voice_actor'),
  }))

  const sources = (
    db.prepare('SELECT text, command, args FROM ship_source WHERE group_type = ? ORDER BY seq').all(groupType) as Row[]
  ).map((r) => ({ text: str(r, 'text'), command: str(r, 'command'), args: optStr(r, 'args') }))

  const retrofit = db
    .prepare('SELECT trans_skill, result_skin_id FROM retrofit WHERE group_type = ?')
    .get(groupType) as Row | undefined
  const retrofitNodes: RetrofitNode[] = (
    db
      .prepare(
        // effect 列是机器格式（[{"durability":70}]），页面只用人读的 descrip
        `SELECT branch, seq, name, descrip, use_gold, level_limit, star_limit
         FROM retrofit_node WHERE group_type = ? ORDER BY branch, seq`,
      )
      .all(groupType) as Row[]
  ).map((r) => ({
    branch: num(r, 'branch'),
    seq: num(r, 'seq'),
    name: str(r, 'name'),
    descrip: str(r, 'descrip'),
    useGold: num(r, 'use_gold'),
    levelLimit: num(r, 'level_limit'),
    starLimit: num(r, 'star_limit'),
  }))

  const tech = db
    .prepare('SELECT class_name, pt_get FROM fleet_tech_ship WHERE group_type = ?')
    .get(groupType) as Row | undefined

  return {
    groupType: num(head, 'group_type'),
    name: str(head, 'name'),
    englishName: str(head, 'english_name'),
    code: str(head, 'code'),
    indexId: num(head, 'index_id'),
    factionName: str(head, 'faction_name'),
    factionSlug: str(head, 'faction_slug'),
    rarityLabel: optStr(head, 'rarity_label'),
    typeName: str(head, 'type_name'),
    teamType: str(head, 'team_type'),
    stages,
    skins,
    sources,
    retrofitSkinId: retrofit === undefined ? null : num(retrofit, 'result_skin_id'),
    retrofitSkill: retrofit === undefined ? null : str(retrofit, 'trans_skill'),
    retrofitNodes,
    fleetTechClass: tech === undefined ? null : str(tech, 'class_name'),
    fleetTechPt: tech === undefined ? null : num(tech, 'pt_get'),
    growthExtraUsed: stages.some((s) => s.attrs.some((a) => a.growthExtra !== 0)),
  }
}

/** 首页与 generateStaticParams 用的轻量列表 */
export function listShips(db: DatabaseSync): Array<{ groupType: number; name: string }> {
  return (db.prepare('SELECT group_type, name FROM ship ORDER BY group_type').all() as Row[]).map((r) => ({
    groupType: num(r, 'group_type'),
    name: str(r, 'name'),
  }))
}
