import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { AttrCurve } from '../../../components/ship/attr-curve'
import { openDb, readMeta } from '../../../lib/db'
import { getShipPage, getHexagon, getShipSkills, getShipSlots, getShipVoice, listShips } from '../../../lib/queries/ship'

/**
 * 舰船详情页。
 *
 * `generateStaticParams` 是产物文件数的唯一来源，`dynamicParams = false` 保证访问
 * 未预渲染的路径直接 404，绝不在运行时现生成。两者读同一份 `ship` 表，
 * 所以「图鉴里有这条船」与「线上有这一页」是同一件事——CI 的路由覆盖守卫
 * 就是拿库里的 count:ship 去比对 out/ 下的 HTML 数。
 */
export const dynamicParams = false

export function generateStaticParams(): Array<{ groupType: string }> {
  return listShips(openDb()).map((s) => ({ groupType: String(s.groupType) }))
}

type Params = { groupType: string }

const parseGroup = (raw: string): number => {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : Number.NaN
}

/** 四个阶段是否给同一份技能：是就只写一遍（实测 286/859 艘一致，其余在突破后升级技能） */
const skillKey = (list: Array<{ skillId: number }>): string => list.map((s) => s.skillId).join(',')

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { groupType: raw } = await params
  const group = parseGroup(raw)
  const ship = Number.isNaN(group) ? null : getShipPage(openDb(), group)
  if (ship === null) return { title: '未找到该舰船' }
  return {
    title: `${ship.name}（${ship.englishName}）`,
    description: `${ship.factionName} ${ship.typeName} ${ship.rarityLabel ?? ''}——属性、突破、六维、装备位、技能、皮肤、改造与获取方式。`.trim(),
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
  const hex = getHexagon(db, group)
  const skillRows = getShipSkills(db, group)
  const slotRows = getShipSlots(db, group)
  const firstSkills = skillRows[0]
  const skillsSame = firstSkills !== undefined && skillRows.every((r) => skillKey(r.skills) === skillKey(firstSkills.skills))
  const voiceRows = getShipVoice(db, group)

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

      {hex !== null && (
        <>
          <h2>六维评级</h2>
          <p className="kv">
            {hex.axes.map((label, i) => (
              <span key={label}>
                {label} <b>{hex.grades[i]}</b>
              </span>
            ))}
          </p>
          <p className="note">
            评级字母取自上游 <code>property_hexagon</code>；六个位置的属性名由构建期对 856 条船做相关性定位写进{' '}
            <code>hexagon_axis</code>，与属性表顺序不同（实测第 1 位是{hex.axes[0]}，耐久排在最后一位）。
          </p>
        </>
      )}

      <h2>装备位</h2>
      <table>
        <thead>
          <tr>
            <th>槽位</th>
            {slotRows.map((r) => (
              <th key={r.stage}>突破 {r.stage}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[1, 2, 3, 4, 5].map((slot) => (
            <tr key={slot}>
              <td>{slot}</td>
              {slotRows.map((r) => (
                <td key={r.stage}>{r.slots.find((s) => s.slot === slot)?.labels.join('、') || '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        槽位号只是位置，能装什么随舰种不同，所以这里只列可装类型；同名不同类型（如 6 与 21 都叫防空炮）合并显示。
        实测 859 艘里 835 艘四个阶段一致，其余 24 艘在突破后多放出一种类型。
      </p>

      <h2>技能</h2>
      {skillsSame && firstSkills !== undefined ? (
        <ul>
          {firstSkills.skills.map((s) => (
            <li key={s.skillId}>
              <b>{s.name}</b>：{s.descr}
            </li>
          ))}
        </ul>
      ) : (
        skillRows.map((r) => (
          <div key={r.stage}>
            <h3>突破 {r.stage}</h3>
            <ul>
              {r.skills.map((s) => (
                <li key={s.skillId}>
                  <b>{s.name}</b>：{s.descr}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      <p className="note">
        描述里的 <code>$1</code> / <code>$2</code> 是随技能等级变化的数值占位，机制与触发数值不在本站范围（PLAN §8.2）。
        {skillsSame ? '四个突破阶段的技能一致。' : '技能列表按突破阶段存：卡辛突破 4 起「全弹发射I」升级为「全弹发射II」。'}
      </p>

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

      {voiceRows.length > 0 && (
        <>
          <h2>语音文本（{voiceRows.length} 个皮肤）</h2>
          {voiceRows.map((v) => (
            <details key={v.skinId}>
              <summary>
                {v.skinName}
                <span className="note"> {v.scenes.reduce((n, s) => n + s.lines.length, 0)} 条</span>
              </summary>
              <ul>
                {v.scenes.map((s) => (
                  <li key={s.scene}>
                    <code>{s.scene}</code>
                    {s.lines.map((line, i) => (
                      <p key={i}>{line}</p>
                    ))}
                  </li>
                ))}
              </ul>
            </details>
          ))}
          <p className="note">
            场景名沿用解包字段键名（<code>ship_skin_words</code> 的场景共 79 个），CN 数据里没有这些场景的中文词条源，
            自己贴标签就成了抄文本。<code>couple_encourage</code> 是不等长嵌套数组、触发条件语义未盘清，暂不显示。
          </p>
        </>
      )}

      {ship.retrofitNodes.length > 0 && (
        <>
          <h2>改造分支</h2>
          <p className="kv">
            <span>
              改造后皮肤 skinId <b>{ship.retrofitSkinId}</b>
            </span>
          </p>
          <p className="note">
            改造带来的技能与雷达变化字段（<code>trans_skill</code> / <code>trans_radar</code>）语义没有文本源可判定——
            厌战的 <code>trans_skill</code> 指向 11880「皇家传奇」，而它突破 1 阶段就已持有这条技能，所以它不是「改造后新技能」。
            判不清就不写，等口径盘清再上页（PLAN §3.5）。
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
