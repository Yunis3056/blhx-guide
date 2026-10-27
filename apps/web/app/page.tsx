import { openDb, readMeta } from '../lib/db'
import { listShips } from '../lib/queries/ship'

/**
 * 首页只做一件事：公开「库里有多少」与「数据来自哪一代快照」。
 *
 * 这里不放任何指向未渲染路由的链接（列表页与分类页在 §7 阶段 2 的后续切片里接上）——
 * 静态站上的死链不会报错，只会在用户点下去时变成 404。
 */
export default function HomePage() {
  const db = openDb()
  const meta = readMeta(db)
  const ships = listShips(db)
  const count = (key: string): string => meta.get(key) ?? '—'

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

      <h2>图鉴规模</h2>
      <table>
        <tbody>
          <tr>
            <td>舰船条目</td>
            <td>{count('count:ship')}</td>
          </tr>
          <tr>
            <td>突破阶段行</td>
            <td>{count('count:ship_stage')}</td>
          </tr>
          <tr>
            <td>皮肤</td>
            <td>{count('count:ship_skin')}</td>
          </tr>
          <tr>
            <td>改造分支节点</td>
            <td>{count('count:retrofit_node')}</td>
          </tr>
          <tr>
            <td>获取方式条目</td>
            <td>{count('count:ship_source')}</td>
          </tr>
        </tbody>
      </table>
      <p className="note">
        以上每一行都有对应的静态页：{ships.length} 个 <code>/ship/&lt;group_type&gt;/</code>。
        页面由构建期的 <code>data/al.sqlite</code> 生成，运行时不查库。
      </p>

      <h2>数据边界</h2>
      <ul>
        <li>不托管游戏美术资源：立绘再分发授权未取得（PLAN §8.5），页面不出任何图片链接</li>
        <li>1–100 级成长曲线按 ×1000 定点线性外推，取整规则待游戏内抽检校准（PLAN §3.7）</li>
        <li>皮肤只标 CV，不标画师：解包数据里没有画师姓名字段（PLAN §8.2）</li>
      </ul>
    </main>
  )
}
