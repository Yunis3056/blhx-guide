import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * 客户端筛选索引：`data/al.sqlite` → `apps/web/public/data/ships.index.json`。
 *
 * 这是 §6.2 顺序里的第 3 步，必须在 `next build` 之前跑——它是 `next export` 的
 * 静态资源，构建期不生成就会出现「页面在、筛选是空的」这种产物，而守卫只看 HTML 查不出来。
 *
 * 三条口径写死在这里：
 * - **只放筛选与列表要用的字段**：阵营/舰种/站位/稀有度/图鉴分类用 slug 指回枚举表，
 *   文本类内容（技能描述、语音台词、改造节点）一概不进这个文件——它们只在详情页出现，
 *   进索引就是让每个访问者先下载一遍全站文本。
 * - **取值名单与分类页同一条规则**（`HAVING n > 0`），且每个维度都要把船分完（分区断言），
 *   否则筛选面板上会多出静态页没有的选项，或缺掉一类船。
 * - **字节级可复现**：行按 group_type 排序、选项按名单顺序输出、不写任何墙上时间；
 *   掺进时间戳就等于数据没变也整站重建（§6.5）。
 */

type Row = Record<string, string | number | null>

/** 索引里的短键名。键映射直接写进文件，读 JSON 的人不必再来翻这段代码 */
const KEYS = {
  g: 'group_type',
  n: 'name',
  e: 'english_name',
  x: 'index_id',
  f: 'faction',
  t: 'ship_type',
  p: 'position',
  r: 'rarity',
  h: 'handbook',
  k: 'skin_count',
  rt: 'has_retrofit',
} as const

const FACETS: Array<{ key: string; sql: string }> = [
  {
    key: 'faction',
    sql: `SELECT f.slug AS s, f.name AS l, COUNT(x.group_type) AS n FROM faction f
          LEFT JOIN ship x ON x.nationality = f.nationality GROUP BY f.nationality HAVING n > 0
          ORDER BY n DESC, f.slug`,
  },
  {
    key: 'ship-type',
    sql: `SELECT CAST(h.type_id AS TEXT) AS s, h.label AS l, COUNT(x.group_type) AS n FROM hull_type h
          JOIN ship x ON x.ship_type = h.type_id GROUP BY h.type_id HAVING n > 0 ORDER BY n DESC, h.type_id`,
  },
  {
    key: 'position',
    sql: `SELECT p.slug AS s, p.name AS l, COUNT(x.group_type) AS n FROM team_position p
          JOIN hull_type h ON h.team_type = p.team_type JOIN ship x ON x.ship_type = h.type_id
          GROUP BY p.team_type HAVING n > 0 ORDER BY n DESC, p.team_type`,
  },
  {
    key: 'rarity',
    sql: `SELECT CAST(r.value AS TEXT) AS s, r.label AS l, COUNT(x.group_type) AS n FROM rarity r
          JOIN ship x ON x.rarity = r.value GROUP BY r.value HAVING n > 0 ORDER BY r.value`,
  },
  {
    key: 'handbook',
    sql: `SELECT k.slug AS s, k.name AS l, COUNT(x.group_type) AS n FROM handbook_kind k
          JOIN ship x ON x.handbook_type = k.handbook_type GROUP BY k.handbook_type HAVING n > 0
          ORDER BY n DESC, k.handbook_type`,
  },
]

export interface ClientIndexResult {
  file: string
  ships: number
  bytes: number
  facets: Record<string, number>
}

export function buildClientIndex(dbPath: string, outFile: string): ClientIndexResult {
  const db = new DatabaseSync(dbPath, { readOnly: true, enableForeignKeyConstraints: false })
  const meta = new Map(
    (db.prepare('SELECT key, value FROM meta').all() as Row[]).map((r) => [String(r.key), String(r.value)]),
  )
  const schemaVersion = meta.get('schema_version') ?? '—'
  const dataSha = meta.get('data_sha') ?? '—'

  const facets: Record<string, Array<{ s: string; l: string }>> = {}
  const facetCounts: Record<string, number> = {}
  const totalShips = Number(meta.get('count:ship') ?? '0')
  for (const f of FACETS) {
    const rows = db.prepare(f.sql).all() as Row[]
    const sum = rows.reduce((n, r) => n + Number(r.n), 0)
    // 分区断言：这一维没把船分完就是筛选面板与静态分类页不一致
    if (sum !== totalShips) {
      throw new Error(`客户端索引维度 ${f.key} 成员合计 ${sum} ≠ 图鉴 ${totalShips}，有船落在筛选面板之外`)
    }
    facets[f.key] = rows.map((r) => ({ s: String(r.s), l: String(r.l) }))
    facetCounts[f.key] = rows.length
  }

  const shipRows = db
    .prepare(
      `SELECT s.group_type, s.name, s.english_name, s.index_id, f.slug AS faction,
              CAST(s.ship_type AS TEXT) AS ship_type, p.slug AS position,
              CAST(s.rarity AS TEXT) AS rarity, hk.slug AS handbook, s.skin_count, s.has_retrofit
       FROM ship s
       JOIN faction f ON f.nationality = s.nationality
       JOIN hull_type ht ON ht.type_id = s.ship_type
       JOIN team_position p ON p.team_type = ht.team_type
       JOIN handbook_kind hk ON hk.handbook_type = s.handbook_type
       LEFT JOIN rarity r ON r.value = s.rarity
       ORDER BY s.group_type`,
    )
    .all() as Row[]

  const allowed = new Map<string, Set<string>>(
    Object.entries(facets).map(([k, v]) => [k, new Set(v.map((x) => x.s))]),
  )
  const ships = shipRows.map((r) => {
    const row = {
      g: Number(r.group_type),
      n: String(r.name),
      e: String(r.english_name),
      x: Number(r.index_id),
      f: String(r.faction),
      t: String(r.ship_type),
      p: String(r.position),
      r: r.rarity === null ? null : String(r.rarity),
      h: String(r.handbook),
      k: Number(r.skin_count),
      rt: Number(r.has_retrofit),
    }
    // 每艘船的每个取值都必须能在选项名单里找到，否则筛不出它、页面却写着「共 859 艘」
    for (const [key, slug] of [
      ['faction', row.f],
      ['ship-type', row.t],
      ['position', row.p],
      ['handbook', row.h],
      ...(row.r === null ? [] : [['rarity', row.r]]),
    ] as Array<[string, string]>) {
      if (!allowed.get(key)?.has(slug)) {
        throw new Error(`船 ${row.g} 的 ${key} 取值 '${slug}' 不在选项名单里（索引与枚举表不同代）`)
      }
    }
    return row
  })

  const json = JSON.stringify({ schemaVersion, dataSha, ships: ships.length, keys: KEYS, facets, list: ships })
  mkdirSync(join(outFile, '..'), { recursive: true })
  writeFileSync(outFile, json, 'utf8')
  db.close()
  return { file: outFile, ships: ships.length, bytes: Buffer.byteLength(json), facets: facetCounts }
}
