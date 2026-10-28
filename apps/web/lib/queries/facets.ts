import type { DatabaseSync } from 'node:sqlite'
import { num, str, type Row } from '../db'

/**
 * 分类页的唯一口径来源（§4.3：页面不写 SQL）。
 *
 * 一个 facet = (键, 站内导航名, 取值查询, 成员查询)。取值名单与成员名单来自同一条
 * WHERE，所以「这一页存在」与「库里真有这批船」是同一件事——`generateStaticParams`
 * 与页面渲染读的都是这里，路由守卫 `scripts/check-routes.mjs` 第三条查的也是这里。
 *
 * 维度名（阵营 / 舰种 / 站位 / 稀有度 / 图鉴分类）是本站的导航结构，
 * 不是游戏枚举，所以写在这里；维度**取值**的显示名一律从库里读回，一个都不硬编码。
 *
 * 三条实测出来的坑，写死在这里而不是等页面出错：
 * - **舰种名不唯一**：21 个舰种只有 18 个不同显示名（导驱 20/21、风帆 22/23/24 同名），
 *   站位才把它们分开，所以 slug 用 `type_id`，同名时标签里补站位名。
 * - **阵营有零成员的值**：鸢尾教国（nationality 10）在 `faction` 表里登记着，实测 0 艘船。
 *   给空页建静态页是负资产，所以取值查询带 `HAVING n > 0`；这条由 `assertFacetsSane` 钉住，
 *   免得上游哪天给了名字却给了 0 成员时静默少一页。
 * - **获取方式不做静态分类页**：`ship_source.command` 只有 6 个取值（GETBOAT / SHOP / LEVEL /
 *   METACHARACTER / SHIPBLUEPRINT / COLLECTSHIP），在 gametip 与 name_code 里都搜不到任何中文词条，
 *   而 `text` 是一船一句的自由文本（LEVEL 下实测 45 种）。没有文本源就不发明名字——
 *   这一维度留给 §7 的客户端筛选，那里显示的是船自己带的 `text`，不需要分类名。
 */

export interface FacetValue {
  slug: string
  label: string
  count: number
  /** 名字不是从文本源逐条读回时（图鉴分类、潜艇站位），页面要能把证据显示出来 */
  evidence: string | null
}

export interface Facet {
  key: string
  label: string
  values: FacetValue[]
}

export interface FacetShip {
  groupType: number
  name: string
  factionName: string
  typeName: string
  positionName: string
  handbookName: string
  rarityLabel: string | null
}

/** 站内导航名：描述的是「这一维度按什么分组」，不是游戏里的枚举值 */
const DIMENSION: Array<{ key: string; label: string }> = [
  { key: 'faction', label: '阵营' },
  { key: 'ship-type', label: '舰种' },
  { key: 'position', label: '站位' },
  { key: 'rarity', label: '稀有度' },
  { key: 'handbook', label: '图鉴分类' },
]

export const FACET_KEYS = DIMENSION.map((d) => d.key)

export function facetDimensionLabel(key: string): string {
  const d = DIMENSION.find((x) => x.key === key)
  if (d === undefined) throw new Error(`未知分类维度 ${key}`)
  return d.label
}

/** 21 个舰种 × 各自站位，同名判定要看到整表，不能只看有船的那 17 个 */
function hullRowsWithPosition(db: DatabaseSync): Array<{ type_id: number; type_name: string; position: string }> {
  return (
    db
      .prepare(
        `SELECT h.type_id, h.type_name, p.name AS position
         FROM hull_type h JOIN team_position p ON p.team_type = h.team_type
         ORDER BY h.type_id`,
      )
      .all() as Row[]
  ).map((r) => ({ type_id: num(r, 'type_id'), type_name: str(r, 'type_name'), position: str(r, 'position') }))
}

/** 舰种同名时补站位名；判定用整表的重名情况，所以任何一代数据里同一舰种的标签都一致 */
function disambiguate(rows: Array<{ type_id: number; type_name: string; position: string }>): string[] {
  const byName = new Map<string, number>()
  for (const r of rows) byName.set(r.type_name, (byName.get(r.type_name) ?? 0) + 1)
  return rows.map((r) => ((byName.get(r.type_name) ?? 1) > 1 ? `${r.type_name}·${r.position}` : r.type_name))
}

const valueLoaders: Record<string, (db: DatabaseSync) => FacetValue[]> = {
  faction: (db) =>
    (
      db
        .prepare(
          `SELECT f.slug, f.name AS label, COUNT(s.group_type) AS n
           FROM faction f LEFT JOIN ship s ON s.nationality = f.nationality
           GROUP BY f.nationality HAVING n > 0 ORDER BY n DESC, f.slug`,
        )
        .all() as Row[]
    ).map((r) => ({ slug: str(r, 'slug'), label: str(r, 'label'), count: num(r, 'n'), evidence: null })),
  'ship-type': (db) => {
    const rows = db
      .prepare(
        `SELECT h.type_id, COUNT(s.group_type) AS n
         FROM hull_type h JOIN ship s ON s.ship_type = h.type_id
         GROUP BY h.type_id ORDER BY n DESC, h.type_id`,
      )
      .all() as Row[]
    const all = hullRowsWithPosition(db)
    const labels = disambiguate(all)
    return rows.map((r) => {
      const typeId = num(r, 'type_id')
      const i = all.findIndex((x) => x.type_id === typeId)
      const head = all[i]
      return {
        slug: String(typeId),
        label: (labels[i] ?? head?.type_name ?? String(typeId)),
        count: num(r, 'n'),
        evidence: null,
      }
    })
  },
  position: (db) =>
    (
      db
        .prepare(
          `SELECT p.slug, p.name AS label, p.evidence, COUNT(s.group_type) AS n
           FROM team_position p JOIN hull_type h ON h.team_type = p.team_type
           JOIN ship s ON s.ship_type = h.type_id
           GROUP BY p.team_type ORDER BY n DESC, p.team_type`,
        )
        .all() as Row[]
    ).map((r) => ({ slug: str(r, 'slug'), label: str(r, 'label'), count: num(r, 'n'), evidence: str(r, 'evidence') })),
  rarity: (db) =>
    (
      db
        .prepare(
          `SELECT r.value, r.label, COUNT(s.group_type) AS n FROM rarity r
           JOIN ship s ON s.rarity = r.value GROUP BY r.value ORDER BY r.value`,
        )
        .all() as Row[]
    ).map((r) => ({ slug: String(num(r, 'value')), label: str(r, 'label'), count: num(r, 'n'), evidence: null })),
  handbook: (db) =>
    (
      db
        .prepare(
          `SELECT k.slug, k.name AS label, k.evidence, COUNT(s.group_type) AS n
           FROM handbook_kind k JOIN ship s ON s.handbook_type = k.handbook_type
           GROUP BY k.handbook_type ORDER BY n DESC, k.handbook_type`,
        )
        .all() as Row[]
    ).map((r) => ({ slug: str(r, 'slug'), label: str(r, 'label'), count: num(r, 'n'), evidence: str(r, 'evidence') })),
}

const memberWhere: Record<string, { sql: string; arg: (slug: string) => string | number }> = {
  faction: { sql: 'f.slug = ?', arg: (s) => s },
  'ship-type': { sql: 'h.type_id = ?', arg: (s) => Number(s) },
  position: { sql: 'p.slug = ?', arg: (s) => s },
  rarity: { sql: 's.rarity = ?', arg: (s) => Number(s) },
  handbook: { sql: 'k.slug = ?', arg: (s) => s },
}

const MEMBER_BASE = `SELECT s.group_type, s.name, f.name AS faction_name, h.type_name,
       p.name AS position_name, k.name AS handbook_name, r.label AS rarity_label
  FROM ship s
  JOIN faction f ON f.nationality = s.nationality
  JOIN hull_type h ON h.type_id = s.ship_type
  JOIN team_position p ON p.team_type = h.team_type
  JOIN handbook_kind k ON k.handbook_type = s.handbook_type
  LEFT JOIN rarity r ON r.value = s.rarity`

export function facets(db: DatabaseSync): Facet[] {
  return DIMENSION.map((d) => ({ key: d.key, label: d.label, values: valueLoaders[d.key]?.(db) ?? [] }))
}

export function facetValue(db: DatabaseSync, key: string, slug: string): FacetValue | null {
  return facets(db)
    .find((f) => f.key === key)
    ?.values.find((v) => v.slug === slug) ?? null
}

/** 某一分类值下的船，按图鉴编号排；名单与取值查询用的 WHERE 是同一条，所以数得上 */
export function facetShips(db: DatabaseSync, key: string, slug: string): FacetShip[] {
  const plan = memberWhere[key]
  if (plan === undefined) throw new Error(`未知分类维度 ${key}`)
  return (db.prepare(`${MEMBER_BASE} WHERE ${plan.sql} ORDER BY s.index_id`).all(plan.arg(slug)) as Row[]).map(
    (r) => ({
      groupType: num(r, 'group_type'),
      name: str(r, 'name'),
      factionName: str(r, 'faction_name'),
      typeName: str(r, 'type_name'),
      positionName: str(r, 'position_name'),
      handbookName: str(r, 'handbook_name'),
      rarityLabel: typeof r.rarity_label === 'string' ? r.rarity_label : null,
    }),
  )
}

/**
 * 一船多页：舰船详情页要链到它所属的每一张分类页。
 * 阵营 / 舰种 / 站位 / 稀有度 / 图鉴分类各一个，获取方式可能有多个（实测每艘 1–3 条命令）。
 */
export interface ShipFacetLink {
  key: string
  label: string
  valueLabel: string
  slug: string
}

export function shipFacetLinks(db: DatabaseSync, groupType: number): ShipFacetLink[] {
  const head = db
    .prepare(
      `SELECT s.nationality, s.ship_type, s.rarity, s.handbook_type, p.slug AS position_slug, p.name AS position_name
       FROM ship s JOIN hull_type h ON h.type_id = s.ship_type
       JOIN team_position p ON p.team_type = h.team_type
       WHERE s.group_type = ?`,
    )
    .get(groupType) as Row | undefined
  if (head === undefined) throw new Error(`库里没有 group_type ${groupType}`)
  const out: ShipFacetLink[] = []
  /** 标签读不到就不链：宁缺一条链接，也不链到一页不存在的分类 */
  const push = (key: string, slug: string, label: string | null | undefined): void => {
    if (typeof label !== 'string') return
    out.push({ key, label: facetDimensionLabel(key), slug, valueLabel: label })
  }
  const one = (sql: string, arg: string | number): Row | undefined => db.prepare(sql).get(arg) as Row | undefined
  const fac = one('SELECT slug, name FROM faction WHERE nationality = ?', num(head, 'nationality'))
  if (fac !== undefined) push('faction', str(fac, 'slug'), str(fac, 'name'))
  const typeId = num(head, 'ship_type')
  push('ship-type', String(typeId), labelForShipType(db, typeId))
  push('position', str(head, 'position_slug'), str(head, 'position_name'))
  if (typeof head.rarity === 'number') {
    const r = one('SELECT label FROM rarity WHERE value = ?', head.rarity)
    if (r !== undefined) push('rarity', String(head.rarity), str(r, 'label'))
  }
  const hb = one('SELECT slug, name FROM handbook_kind WHERE handbook_type = ?', num(head, 'handbook_type'))
  if (hb !== undefined) push('handbook', str(hb, 'slug'), str(hb, 'name'))
  return out
}

/** 舰种标签与分类页取值走同一个消解函数，两边不会写出两种名字 */
export function labelForShipType(db: DatabaseSync, typeId: number): string | null {
  const withPos = hullRowsWithPosition(db)
  const labels = disambiguate(withPos)
  const i = withPos.findIndex((r) => r.type_id === typeId)
  return i < 0 ? null : (labels[i] ?? null)
}

/**
 * 建页前的体检：任何维度取值为空，说明库里这一维度和人工表对不上，
 * 那不该静默变成「导航里少一块」。（同名消解后的标签必须仍然唯一，否则两张页撞同一个 slug 之外的坑。）
 */
export function assertFacetsSane(list: Facet[]): void {
  const problems: string[] = []
  for (const f of list) {
    if (f.values.length === 0) problems.push(`维度 ${f.label}(${f.key}) 一个取值都没有`)
    const seen = new Set<string>()
    for (const v of f.values) {
      if (seen.has(v.slug)) problems.push(`维度 ${f.key} 的 slug '${v.slug}' 出现两次`)
      seen.add(v.slug)
      if (v.count <= 0) problems.push(`维度 ${f.key}/${v.slug} 成员数为 0，不该建页`)
    }
  }
  if (problems.length > 0) throw new Error(`分类页数据体检失败：\n  ${problems.join('\n  ')}`)
}
