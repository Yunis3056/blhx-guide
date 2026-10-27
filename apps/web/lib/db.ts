import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * 构建期只读 SQLite（§4.3）。这份代码只在 `next build` 的 Node 进程里跑，
 * 产物是纯静态 HTML，运行时不再访问数据库。
 *
 * 路径按 `apps/web` 的相对位置算：turbo 以包目录为 cwd 跑 `next build`，
 * 而 Pages 的 Root directory 必须是仓库根（§4.6），所以 data/al.sqlite
 * 永远在 ../../data 下。找不到就是前置任务没跑，直接报错而不是渲染空页。
 */

const DB_PATH = join(process.cwd(), '..', '..', 'data', 'al.sqlite')

let cached: DatabaseSync | null = null

export function openDb(): DatabaseSync {
  if (cached !== null) return cached
  if (!existsSync(DB_PATH)) {
    throw new Error(
      `找不到 ${DB_PATH}。它由 pipeline#emit 在建库步骤生成；` +
        `Pages 侧 Root directory 必须是仓库根，否则 emit 不会执行（见 PLAN §4.6）`,
    )
  }
  cached = new DatabaseSync(DB_PATH, { readOnly: true, enableForeignKeyConstraints: false })
  return cached
}

export const dbPath = DB_PATH

export type Row = Record<string, string | number | null>

/** node:sqlite 的取值是宽类型，查询层在这里统一收窄，页面组件不碰 unknown */
export const num = (row: Row, key: string): number => {
  const v = row[key]
  if (typeof v !== 'number') throw new Error(`字段 ${key} 期望数字，实得 ${String(v)}`)
  return v
}
export const str = (row: Row, key: string): string => {
  const v = row[key]
  if (typeof v !== 'string') throw new Error(`字段 ${key} 期望字符串，实得 ${String(v)}`)
  return v
}
export const optStr = (row: Row, key: string): string | null => {
  const v = row[key]
  if (v === null || typeof v === 'string') return v
  throw new Error(`字段 ${key} 期望字符串或 NULL，实得 ${String(v)}`)
}

/** meta 表里是建库时写入的来源标识，页面页脚与 /data-quality 都要引用它 */
export function readMeta(db: DatabaseSync): Map<string, string> {
  const rows = db.prepare('SELECT key, value FROM meta ORDER BY key').all() as Row[]
  return new Map(rows.map((r) => [str(r, 'key'), str(r, 'value')]))
}
