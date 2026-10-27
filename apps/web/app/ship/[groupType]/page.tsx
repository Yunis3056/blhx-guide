import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { AttrCurve } from '../../../components/ship/attr-curve'
import { openDb, readMeta } from '../../../lib/db'
import { getShipPage } from '../../../lib/queries/ship'
import { STAGE1_SHIPS } from '../../../lib/slice'

/**
 * 阶段 1 的垂直切片页面。
 *
 * `generateStaticParams` 是产物文件数的唯一来源，`dynamicParams = false` 保证访问
 * 未预渲染的路径直接 404，绝不在运行时现生成。切片名单见 lib/slice.ts。
 */
export const dynamicParams = false

export function generateStaticParams(): Array<{ groupType: string }> {
  return STAGE1_SHIPS.map((g) => ({ groupType: String(g) }))
}

type Params = { groupType: string }

const parseGroup = (raw: string): number => {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : Number.NaN
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { groupType: raw } = await params
  const group = parseGroup(raw)
  const ship = Number.isNaN(group) ? null : getShipPage(openDb(), group)
  if (ship === null) return { title: '未找到该舰船' }
  return {
    title: `${ship.name}（${ship.englishName}）`,
    description: `${ship.factionName} ${ship.typeName} ${ship.rarityLabel ?? ''}——属性、突破、皮肤、改造与获取方式。`.trim(),
  }
}

export default async function ShipPage({ params }: { params: Promise<Params> }) {
  const { groupType: raw } = await params
  const group = parseGroup(raw)
  if (Number.isNaN(group)) notFound()

  const db = openDb()
  const ship = getShipPage(db, group)
  if (ship === null) notFound()

  const meta = readMeta(db)
  const attrNames = ship.stages[0]?.attrs ?? []

  return (
    <main>
      <h1>
        {ship.name}
        <span className="note"> {ship.englishName}</span>
      </h1>
      <p className="kv">
        <span>
          阵营 <b>{ship.factionName}</b>
        </span>
        <span>
          舰种 <b>{ship.typeName}</b>
        </span>
        <span>
          稀有度 <b>{ship.rarityLabel ?? '未标注'}</b>
        </span>
        <span>
          图鉴编号 <b>{ship.indexId}</b>
        </span>
        <span>
          group_type <b>{ship.groupType}</b>
        </span>
      </p>

      {ship.growthExtraUsed && (
        <p className="warn">
          该船含 <b>attrs_growth_extra</b> 非零项。1–100 曲线按 ×1000 定点线性外推，
          取整规则尚未对照游戏内数值校准（PLAN §3.7 待闭合项），数值仅供量级参考。
        </p>
      )}

      <h2>突破属性（各阶段 1 级基值）</h2>
      <table>
        <thead>
          <tr>
            <th>属性</th>
            {ship.stages.map((s) => (
              <th key={s.stage}>突破 {s.stage}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {attrNames.map((a) => (
            <tr key={a.attr}>
              <td>{a.label}</td>
              {ship.stages.map((s) => (
                <td key={s.stage}>{s.attrs.find((x) => x.attr === a.attr)?.base.toLocaleString('zh-CN')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        列名来自 <code>attr_def.name</code>，显示名来自 <code>attribute_info_by_type</code>（{attrNames.length} 项）。
      </p>

      <h2>1–100 级成长曲线</h2>
      <div className="grid">
        {attrNames.map((a) => (
          <AttrCurve key={a.attr} attr={a.attr} label={a.label} stages={ship.stages} />
        ))}
      </div>

      <h2>皮肤（{ship.skins.length}）</h2>
      <table>
        <thead>
          <tr>
            <th>皮肤</th>
            <th>skinId</th>
            <th>类型</th>
            <th>CV</th>
          </tr>
        </thead>
        <tbody>
          {ship.skins.map((s) => (
            <tr key={s.skinId}>
              <td>{s.name}</td>
              <td>{s.skinId}</td>
              <td>
                {s.skinId === ship.retrofitSkinId
                  ? '改造'
                  : s.skinType === -1
                    ? '默认'
                    : `type ${s.skinType}`}
              </td>
              <td>{s.voiceActor ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">画师在解包数据里没有姓名字段，本页不展示（PLAN §8.2）。</p>

      {ship.retrofitNodes.length > 0 && (
        <>
          <h2>改造分支</h2>
          <p className="kv">
            <span>
              改造后皮肤 skinId <b>{ship.retrofitSkinId}</b>
            </span>
            <span>
              改造后技能 <b>{ship.retrofitSkill || '—'}</b>
            </span>
          </p>
          <table>
            <thead>
              <tr>
                <th>分支</th>
                <th>序号</th>
                <th>节点</th>
                <th>效果</th>
                <th>金币</th>
                <th>前置</th>
              </tr>
            </thead>
            <tbody>
              {ship.retrofitNodes.map((n) => (
                <tr key={`${n.branch}-${n.seq}`}>
                  <td>{n.branch}</td>
                  <td>{n.seq}</td>
                  <td>{n.name}</td>
                  <td>{n.descrip || '—'}</td>
                  <td>{n.useGold.toLocaleString('zh-CN')}</td>
                  <td>
                    Lv{n.levelLimit} / ★{n.starLimit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {ship.fleetTechClass !== null && (
        <>
          <h2>舰队科技</h2>
          <p className="kv">
            <span>
              舰级 <b>{ship.fleetTechClass}</b>
            </span>
            <span>
              满星科技点 <b>{ship.fleetTechPt}</b>
            </span>
          </p>
        </>
      )}

      <h2>获取方式（{ship.sources.length}）</h2>
      <ul>
        {ship.sources.map((s, i) => (
          <li key={i}>
            {s.text}
            <span className="note"> · {s.command}</span>
          </li>
        ))}
      </ul>

      <footer>
        本页由 <code>data/al.sqlite</code> 在构建期生成 · 数据快照 commit{' '}
        <code>{meta.get('data_sha')?.slice(0, 12)}</code> · schema v{meta.get('schema_version')} ·
        图鉴 {meta.get('count:ship')} 艘 / 阶段行 {meta.get('count:ship_stage')} 行 / 皮肤{' '}
        {meta.get('count:ship_skin')} 张
      </footer>
    </main>
  )
}
