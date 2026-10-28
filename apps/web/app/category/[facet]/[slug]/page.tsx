import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { openDb } from '../../../../lib/db'
import { assertFacetsSane, FACET_KEYS, facetDimensionLabel, facetValue, facets, facetShips } from '../../../../lib/queries/facets'

/**
 * 分类页：一个维度取值一页（阵营 / 舰种 / 站位 / 稀有度 / 图鉴分类）。
 *
 * 名单的唯一来源是 `lib/queries/facets.ts` 里的取值查询，页面渲染与
 * `generateStaticParams` 走同一条 SQL，CI 的路由守卫第三条查的也是它——
 * 「库里这个值有船」与「线上有这一页」因此是同一件事。
 *
 * 路由目录不能叫 `index`：实测 `output:'export'` + `trailingSlash:true` 会把
 * `/index/faction/x` 落成 `out/index/index/faction/x/index.html`，多出来的一层使页面里
 * 写的链接与 Pages 实际可访问的 URL 不一致（点了就 404，而且构建照样全绿）。
 * 换成 `category` 后落盘是 `out/category/faction/x/index.html`，与被链接的 URL 一致。
 *
 * 只为**实测有成员**的取值建页：鸢尾教国在阵营表里登记着但 0 艘船，
 * 给它出空页是负资产（§4.3 的零成员断言把这条钉住）。
 */
export const dynamicParams = false

type Params = { facet: string; slug: string }

export function generateStaticParams(): Array<{ facet: string; slug: string }> {
  const db = openDb()
  const list = facets(db)
  assertFacetsSane(list)
  return list.flatMap((f) => f.values.map((v) => ({ facet: f.key, slug: v.slug })))
}

const decodeSlug = (raw: string): string => {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { facet, slug } = await params
  const db = openDb()
  const key = facets(db).find((f) => f.key === facet)
  const value = key === undefined ? null : facetValue(db, facet, decodeSlug(slug))
  if (key === undefined || value === null) return { title: '未找到该分类' }
  return {
    title: `${value.label}·${key.label}舰船`,
    description: `按${key.label}分类的碧蓝航线 CN 服舰船：${value.label}，共 ${value.count} 艘，逐艘链向属性、突破、技能与获取方式详情页。`,
  }
}

export default async function FacetPage({ params }: { params: Promise<Params> }) {
  const { facet, slug } = await params
  const db = openDb()
  if (!FACET_KEYS.includes(facet)) notFound()
  const dimension = facetDimensionLabel(facet)
  const value = facetValue(db, facet, decodeSlug(slug))
  if (value === null) notFound()

  const ships = facetShips(db, facet, decodeSlug(slug))
  // 名单与成员是同一条 WHERE，数不上就是库或查询改坏了，不能让页面挂着错数出厂
  if (ships.length !== value.count) {
    throw new Error(`分类页 ${facet}/${slug} 的取值查询说 ${value.count} 艘，成员查询给出 ${ships.length} 条`)
  }

  return (
    <main>
      <p className="note">
        <a href="/">碧蓝航线攻略站</a> › {dimension}
      </p>
      <h1>{value.label}</h1>
      <p className="kv">
        <span>
          分类维度 <b>{dimension}</b>
        </span>
        <span>
          取值标识 <b>{value.slug}</b>
        </span>
        <span>
          舰船数 <b>{value.count}</b>
        </span>
      </p>
      {value.evidence !== null && (
        <p className="note">
          这一维度的显示名不是从上游文本逐条读回的，判定依据：{value.evidence}
        </p>
      )}

      <table>
        <thead>
          <tr>
            <th>舰船</th>
            <th>阵营</th>
            <th>舰种</th>
            <th>站位</th>
            <th>稀有度</th>
            <th>图鉴分类</th>
          </tr>
        </thead>
        <tbody>
          {ships.map((s) => (
            <tr key={s.groupType}>
              <td>
                <a href={`/ship/${s.groupType}/`}>{s.name}</a>
              </td>
              <td>{s.factionName}</td>
              <td>{s.typeName}</td>
              <td>{s.positionName}</td>
              <td>{s.rarityLabel ?? '未标注'}</td>
              <td>{s.handbookName}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        同一艘船会出现在它所属的每个维度页上；共 {facets(db).length} 个维度，取值名单与本页成员都由{' '}
        <code>data/al.sqlite</code> 现算，运行时不查库。
      </p>
    </main>
  )
}
