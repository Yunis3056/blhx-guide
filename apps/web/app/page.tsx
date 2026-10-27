import Link from 'next/link'
import { openDb, readMeta } from '../lib/db'
import { listShips } from '../lib/queries/ship'
import { STAGE1_SHIPS } from '../lib/slice'

/**
 * 阶段 1 的首页只做一件事：把已预渲染的路由列出来，并公开数据来源快照。
 * 筛选、搜索、分类页在阶段 2 接入；这里不放任何未渲染的链接。
 */
export default function HomePage() {
  const db = openDb()
  const meta = readMeta(db)
  const all = listShips(db)
  const rendered = all.filter((s) => STAGE1_SHIPS.includes(s.groupType))

  return (
    <main>
      <h1>碧蓝航线攻略站</h1>
      <p className="kv">
        <span>
          服务器 <b>CN 国服</b>
        </span>
        <span>
          数据快照 <b>{meta.get('data_sha')?.slice(0, 12)}</b>
        </span>
        <span>
          schema <b>v{meta.get('schema_version')}</b>
        </span>
      </p>
      <p className="note">
        图鉴共 {meta.get('count:ship')} 艘船、{meta.get('count:ship_stage')} 条突破阶段行、
        {meta.get('count:ship_skin')} 个皮肤。垂直切片阶段先渲染下面 {rendered.length} 艘的详情页，
        其余路由在阶段 2 接上。
      </p>

      <h2>已渲染页面</h2>
      <ul>
        {rendered.map((s) => (
          <li key={s.groupType}>
            <Link href={`/ship/${s.groupType}/`}>{s.name}</Link>{' '}
            <span className="note">group_type {s.groupType}</span>
          </li>
        ))}
      </ul>

      <p className="warn">
        本站不托管游戏美术资源：立绘再分发授权未取得（PLAN §8.5），图片位一律渲染占位块，
        不产生任何指向图片的链接。
      </p>
    </main>
  )
}
