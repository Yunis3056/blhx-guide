import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * 路由覆盖守卫：图鉴里的每一条船都必须有一个已渲染的静态页。
 *
 * 唯一名单来自 `data/al.sqlite` 的 `ship` 表——`generateStaticParams` 读的就是它，
 * 所以「库里有这条船」与「线上有这一页」在这里被强制成同一件事。
 * 只比对总数不够：漏一页、多一页时总数可能不变，所以逐个 group_type 验文件存在，
 * 再反向查产物里有没有库中不存在的页面（残留的旧代产物同样是要抓的故障）。
 */

const DB = 'data/al.sqlite'
const OUT = 'apps/web/out/ship'

if (!existsSync(DB)) throw new Error(`缺 ${DB}：先跑 pnpm build（emit 会生成它）`)
if (!existsSync(OUT)) throw new Error(`缺 ${OUT}/：先跑 pnpm build（next export）`)

const db = new DatabaseSync(DB, { readOnly: true, enableForeignKeyConstraints: false })
const expected = db.prepare('SELECT group_type FROM ship ORDER BY group_type').all().map((r) => r.group_type)

// 按目录名字符串比对，不转数字：产物里出现非数字目录时，报错要能看见它本来的名字
const rendered = new Set(
  readdirSync(OUT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .filter((d) => existsSync(join(OUT, d.name, 'index.html')))
    .map((d) => d.name),
)
const expectedNames = new Set(expected.map(String))

const missing = expected.filter((g) => !rendered.has(String(g)))
const extra = [...rendered].filter((n) => !expectedNames.has(n)).sort()

if (!existsSync('apps/web/out/index.html')) throw new Error('缺首页 apps/web/out/index.html')

if (missing.length > 0) {
  console.error(`缺 ${missing.length} 个预渲染页面，前 20 个：${missing.slice(0, 20).join(', ')}`)
  process.exitCode = 1
}
if (extra.length > 0) {
  console.error(`产物里有 ${extra.length} 个库里不存在的页面（旧代残留？）：${extra.slice(0, 20).join(', ')}`)
  process.exitCode = 1
}
if (!process.exitCode) {
  console.log(`路由覆盖一致：图鉴 ${expected.length} 条 / 已渲染 ${rendered.size} 页 / 首页在位`)
}
