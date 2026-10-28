import type { Metadata } from 'next'
import { ShipFilter } from '../../components/ship/filter'
import { openDb, readMeta } from '../../lib/db'
import { assertFacetsSane, facets } from '../../lib/queries/facets'

/**
 * `/ship` 列表页（§5：SSG + CSR 筛选）。
 *
 * 服务端这份 HTML 给的是「有多少、从哪儿进」：条目数、五个维度的分类页链接（名单与
 * 分类页、路由守卫同一批 SQL），以及筛选容器的位置。表格由客户端读
 * `/data/ships.index.json` 后填——所以 URL 上的 query 变体（`?faction=royal-navy` 之类）
 * 不需要各自一页，canonical 统一指回 `/ship/`，避免同一份列表被收录成 N 份。
 */
export const metadata: Metadata = {
  title: '舰船图鉴',
  description: '按阵营、舰种、站位、稀有度与图鉴分类筛选的碧蓝航线 CN 服舰船列表，条件可分享，逐艘链向详情页。',
  alternates: { canonical: '/ship/' },
}

export default function ShipListPage() {
  const db = openDb()
  const meta = readMeta(db)
  const list = facets(db)
  assertFacetsSane(list)

  return (
    <main>
      <h1>舰船图鉴</h1>
      <p className="kv">
        <span>
          条目 <b>{meta.get('count:ship')}</b>
        </span>
        <span>
          皮肤 <b>{meta.get('count:ship_skin')}</b>
        </span>
        <span>
          可改造 <b>{meta.get('count:retrofit')}</b>
        </span>
        <span>
          数据快照 <b>{meta.get('data_sha')?.slice(0, 12)}</b>
        </span>
      </p>

      <p className="note">
        想按整族浏览走下面的静态分类页（每个维度取值一页，共 {list.reduce((n, f) => n + f.values.length, 0)} 张）；
        想组合条件走筛选面板，条件会写进地址栏。
      </p>
      {list.map((f) => (
        <p className="kv" key={f.key}>
          <b>{f.label}</b>
          {f.values.map((v) => (
            <span key={v.slug}>
              <a href={`/category/${f.key}/${encodeURIComponent(v.slug)}/`}>
                {v.label} <b>{v.count}</b>
              </a>
            </span>
          ))}
        </p>
      ))}

      <ShipFilter />
    </main>
  )
}
