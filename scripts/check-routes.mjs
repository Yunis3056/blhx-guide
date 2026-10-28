import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * 路由名单与路由覆盖守卫。
 *
 * 名单唯一来自 `data/al.sqlite`——`generateStaticParams` 读的是同一批表，所以
 * 「库里有这条船 / 这个分类值真有船」与「线上有这一页」在这里是同一件事。
 * 只比对总数不够：漏一页、多一页时总数可能不变，所以逐个验文件存在，
 * 再反向查产物里有没有库中不存在的页面（残留的旧代产物同样是要抓的故障）。
 *
 * 分类页这五条 SQL 是 `apps/web/lib/queries/facets.ts` 取值查询的镜像：守卫要在
 * 仓库根跑，而那个模块按 `apps/web` 的相对位置找库，两边没法共用一份代码。
 * 镜像漂移同时被两处抓住：这里报「缺页 / 多页」，页面自己报取值数与成员数不等。
 *
 * `--urls` 只把名单打到 stdout（每行一个站点内 URL），CI 的线上抽样按它取样，
 * 于是「该有什么页」和「线上验了什么页」也不会分成两套。
 */

const DB = 'data/al.sqlite'
const OUT = 'apps/web/out'

const FACETS = [
  {
    key: 'faction',
    sql: `SELECT f.slug AS slug, COUNT(s.group_type) AS n FROM faction f
          LEFT JOIN ship s ON s.nationality = f.nationality GROUP BY f.nationality HAVING n > 0`,
  },
  {
    key: 'ship-type',
    sql: `SELECT CAST(h.type_id AS TEXT) AS slug, COUNT(s.group_type) AS n FROM hull_type h
          JOIN ship s ON s.ship_type = h.type_id GROUP BY h.type_id HAVING n > 0`,
  },
  {
    key: 'position',
    sql: `SELECT p.slug AS slug, COUNT(s.group_type) AS n FROM team_position p
          JOIN hull_type h ON h.team_type = p.team_type
          JOIN ship s ON s.ship_type = h.type_id GROUP BY p.team_type HAVING n > 0`,
  },
  {
    key: 'rarity',
    sql: `SELECT CAST(r.value AS TEXT) AS slug, COUNT(s.group_type) AS n FROM rarity r
          JOIN ship s ON s.rarity = r.value GROUP BY r.value HAVING n > 0`,
  },
  {
    key: 'handbook',
    sql: `SELECT k.slug AS slug, COUNT(s.group_type) AS n FROM handbook_kind k
          JOIN ship s ON s.handbook_type = k.handbook_type GROUP BY k.handbook_type HAVING n > 0`,
  },
]

if (!existsSync(DB)) throw new Error(`缺 ${DB}：先跑 pnpm build（emit 会生成它）`)
const db = new DatabaseSync(DB, { readOnly: true, enableForeignKeyConstraints: false })

/** URL 一律带尾斜杠：`trailingSlash: true`，产物路径就是 URL 去掉首斜杠加 index.html */
const shipUrls = db
  .prepare('SELECT group_type FROM ship ORDER BY group_type')
  .all()
  .map((r) => `/ship/${r.group_type}/`)

const categoryUrls = []
const perFacet = {}
const partition = []
for (const f of FACETS) {
  const rows = db.prepare(f.sql).all()
  perFacet[f.key] = rows.length
  for (const r of rows) categoryUrls.push(`/category/${f.key}/${encodeURIComponent(String(r.slug))}/`)
  // 分区断言：这五个维度各自要把全部船分完，落在导航之外就是「有船没有任何分类页能到」
  const sum = rows.reduce((n, r) => n + Number(r.n), 0)
  if (sum !== shipUrls.length) partition.push(`维度 ${f.key} 成员合计 ${sum} ≠ 图鉴 ${shipUrls.length}，有船落在这一维的导航之外`)
}
const allUrls = ['/', ...shipUrls, ...categoryUrls]

if (process.argv[2] === '--urls') {
  console.log(allUrls.join('\n'))
  process.exit(0)
}

// CI 的线上抽样名单：舰船页与分类页是两个独立的路由族，按比例从各自名单里取，
// 否则 917 条里抽 5 条几乎全是舰船页，分类页整片没落上新代也照样绿。
if (process.argv[2] === '--sample') {
  const pick = (list) => [0, 0.5, 1].map((f) => list[Math.round(f * (list.length - 1))])
  console.log(['/', ...pick(shipUrls), ...pick(categoryUrls)].join('\n'))
  process.exit(0)
}

if (!existsSync(join(OUT, 'ship'))) throw new Error(`缺 ${OUT}/ship/：先跑 pnpm build（next export）`)

const problems = [...partition]
for (const url of allUrls) {
  const file = join(OUT, url.slice(1), 'index.html')
  if (!existsSync(file)) problems.push(`缺页 ${url}`)
}

// 反向：产物里真实存在的页面目录，必须在名单里（按目录名字符串比，报错才看得见它本来的名字）
const rendered = new Set()
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    // 404 与打包产物不是「库里的一条」，不参与反向比对；404 页存在与否单独断言
    if (e.name === '_next' || e.name === '404') continue
    const child = join(dir, e.name)
    if (existsSync(join(child, 'index.html'))) rendered.add('/' + relative(OUT, child).replaceAll('\\', '/') + '/')
    walk(child)
  }
}
walk(OUT)
if (!existsSync(join(OUT, '404.html'))) problems.push('缺 404 页 apps/web/out/404.html')
const want = new Set(allUrls)
for (const url of [...rendered].filter((u) => !want.has(u)).sort()) {
  problems.push(`多页 ${url}（库里没有这个条目，疑似旧代残留）`)
}

/**
 * 死链守卫：产物里每条站内 `<a href="/">` 都必须指向一个真存在的页面。
 * 上面的存在性检查只看「名单里的 URL 有没有对应文件」，看不见页面自己写错的链接
 * ——路由目录名一错（`index` 那次的多一层落盘），名单检查照样全绿而用户点进去是 404。
 */
const dead = new Set()
function scanHtml(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '_next') continue
      scanHtml(child)
      continue
    }
    if (!e.name.endsWith('.html')) continue
    const html = readFileSync(child, 'utf8')
    for (const m of html.matchAll(/<a [^>]*href="(\/[^"#?]*)"/g)) {
      const href = m[1]
      const rel = join(OUT, href.replace(/^\/+/, ''))
      const hit =
        existsSync(join(rel, 'index.html')) || existsSync(rel + '.html') || existsSync(rel) || href === '/'
      if (!hit) dead.add(`${relative(OUT, child).replaceAll('\\', '/')} → ${href}`)
    }
  }
}
scanHtml(OUT)
for (const d of [...dead].sort()) problems.push(`死链 ${d}`)

if (!process.exitCode) {
  if (problems.length > 0) {
    for (const p of problems.slice(0, 40)) console.error(p)
    if (problems.length > 40) console.error(`……共 ${problems.length} 条`)
    process.exitCode = 1
  } else {
    const detail = FACETS.map((f) => `${f.key} ${perFacet[f.key]}`).join(' · ')
    console.log(
      `路由覆盖一致：舰船页 ${shipUrls.length} / 分类页 ${detail}（合计 ${
        Object.values(perFacet).reduce((a, b) => a + b, 0)
      }）/ 首页在位 / 产物里共 ${rendered.size} 页，无多余`,
    )
  }
}
