'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * `/ship` 的客户端筛选（§5：SSG + CSR）。
 *
 * 数据来自 `data/ships.index.json`——由 pipeline 在建库之后导出的静态文件，
 * 里面只有筛选与列表要用的字段（船名、图鉴编号、五个维度的 slug、皮肤数、可改造），
 * 技能描述与语音文本不在其中：那些只在详情页出现。
 *
 * 三条约束：
 * - **URL 是唯一状态来源**：筛选条件写进 query（可分享、可回退），首次载入时从
 *   `location.search` 读回。服务端渲染的那份 HTML 不含任何条件，所以不会有水合不一致。
 * - **选项名单来自索引自带的 facets**，不是这里写死的：静态分类页与面板选项因此同源。
 * - 索引没到位就明说，不装作列表是空的。
 */

type Option = { s: string; l: string }
type IndexShip = {
  g: number
  n: string
  e: string
  x: number
  f: string
  t: string
  p: string
  r: string | null
  h: string
  k: number
  rt: number
}
type Index = {
  schemaVersion: string
  dataSha: string
  ships: number
  facets: Record<string, Option[]>
  list: IndexShip[]
}

const DIMENSIONS: Array<{ key: string; param: string; label: string }> = [
  { key: 'faction', param: 'faction', label: '阵营' },
  { key: 'ship-type', param: 'type', label: '舰种' },
  { key: 'position', param: 'position', label: '站位' },
  { key: 'rarity', param: 'rarity', label: '稀有度' },
  { key: 'handbook', param: 'handbook', label: '图鉴分类' },
]

/** 命中数超过这个值就只渲染前 400 行：859 行的表格在低端机上首帧会明显卡，而列表页的价值在筛不在铺 */
const RENDER_CAP = 400

const SORTS: Array<{ value: string; label: string; cmp: (a: IndexShip, b: IndexShip) => number }> = [
  { value: 'index', label: '图鉴编号', cmp: (a, b) => a.x - b.x },
  { value: 'group', label: 'group_type', cmp: (a, b) => a.g - b.g },
  { value: 'name', label: '船名', cmp: (a, b) => a.n.localeCompare(b.n, 'zh-Hans-CN') },
  { value: 'skins', label: '皮肤数（多在前）', cmp: (a, b) => b.k - a.k },
]

export function ShipFilter() {
  const [index, setIndex] = useState<Index | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [retrofit, setRetrofit] = useState(false)
  const [sort, setSort] = useState('index')
  const first = useRef(true)

  useEffect(() => {
    let alive = true
    const params = new URLSearchParams(window.location.search)
    const seeded: Record<string, string> = {}
    for (const d of DIMENSIONS) {
      const v = params.get(d.param)
      if (v !== null && v !== '') seeded[d.key] = v
    }
    setQ(params.get('q') ?? '')
    setRetrofit(params.get('retrofit') === '1')
    setSort(SORTS.some((s) => s.value === params.get('sort')) ? (params.get('sort') as string) : 'index')
    setPicked(seeded)
    fetch('/data/ships.index.json')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((j: Index) => {
        if (alive) setIndex(j)
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [])

  // 条件写回 URL：用 replaceState，筛一次就多一条历史记录会淹掉「后退」
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const params = new URLSearchParams()
    for (const d of DIMENSIONS) {
      const v = picked[d.key]
      if (v !== undefined && v !== '') params.set(d.param, v)
    }
    if (q !== '') params.set('q', q)
    if (retrofit) params.set('retrofit', '1')
    if (sort !== 'index') params.set('sort', sort)
    const url = params.toString()
    window.history.replaceState(null, '', url === '' ? '/ship/' : `/ship/?${url}`)
  }, [picked, q, retrofit, sort])

  const labelOf = (key: string, slug: string): string =>
    index?.facets[key]?.find((o) => o.s === slug)?.l ?? slug

  const rows = useMemo(() => {
    if (index === null) return null
    const needle = q.trim().toLowerCase()
    const cmp = SORTS.find((s) => s.value === sort)?.cmp ?? SORTS[0]?.cmp
    return index.list
      .filter((s) => {
        for (const d of DIMENSIONS) {
          const want = picked[d.key]
          if (want === undefined || want === '') continue
          const field = d.key === 'faction' ? s.f : d.key === 'ship-type' ? s.t : d.key === 'position' ? s.p : d.key === 'rarity' ? s.r : s.h
          if (field !== want) return false
        }
        if (retrofit && s.rt !== 1) return false
        if (needle !== '') {
          const hay = `${s.n} ${s.e}`.toLowerCase()
          if (!hay.includes(needle)) return false
        }
        return true
      })
      .sort(cmp)
  }, [index, picked, q, retrofit, sort])

  if (error !== null) {
    return (
      <p className="warn">
        筛选索引 <code>data/ships.index.json</code> 载入失败（{error}）。它由
        <code>pipeline#client-index</code> 在 <code>next build</code> 之前生成；
        索引没到位时这个列表页应当报错，而不是显示「0 艘船」。
      </p>
    )
  }
  if (index === null) return <p className="note">载入筛选索引…</p>

  const active = rows ?? []
  const shown = active.slice(0, RENDER_CAP)
  const conditionCount = Object.values(picked).filter((v) => v !== '').length + (retrofit ? 1 : 0) + (q.trim() !== '' ? 1 : 0)

  return (
    <section>
      <p className="kv">
        <label>
          船名 <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="中文或英文名包含" />
        </label>
        {DIMENSIONS.map((d) => (
          <label key={d.key}>
            {d.label}
            <select
              value={picked[d.key] ?? ''}
              onChange={(e) => {
                const v = e.target.value
                setPicked((p) => {
                  const next = { ...p }
                  if (v === '') delete next[d.key]
                  else next[d.key] = v
                  return next
                })
              }}
            >
              <option value="">全部</option>
              {(index.facets[d.key] ?? []).map((o) => (
                <option key={o.s} value={o.s}>
                  {o.l}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          排序
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={retrofit} onChange={(e) => setRetrofit(e.target.checked)} /> 只看可改造
        </label>
      </p>

      <p className="note">
        命中 <b>{active.length}</b> / {index.ships} 艘（{conditionCount === 0 ? '未加条件' : `${conditionCount} 个条件`}）
        {active.length > shown.length && <>，下面只列前 {RENDER_CAP} 行——把条件收窄或去分类页看整族</>}。
        条件已写进地址栏，复制链接就能分享这一组筛选。索引代次 <code>{index.dataSha.slice(0, 12)}</code>（schema{' '}
        {index.schemaVersion}）。
      </p>

      <table>
        <thead>
          <tr>
            <th>船名</th>
            <th>图鉴编号</th>
            <th>阵营</th>
            <th>舰种</th>
            <th>站位</th>
            <th>稀有度</th>
            <th>图鉴分类</th>
            <th>皮肤</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((s) => (
            <tr key={s.g}>
              <td>
                <a href={`/ship/${s.g}/`}>
                  {s.n}
                  <span className="note"> {s.e}</span>
                </a>
                {s.rt === 1 && <span className="note"> · 可改造</span>}
              </td>
              <td>{s.x}</td>
              <td>{labelOf('faction', s.f)}</td>
              <td>{labelOf('ship-type', s.t)}</td>
              <td>{labelOf('position', s.p)}</td>
              <td>{s.r === null ? '未标注' : labelOf('rarity', s.r)}</td>
              <td>{labelOf('handbook', s.h)}</td>
              <td>{s.k}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
