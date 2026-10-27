import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

/**
 * normalized/*.jsonl.gz 的唯一写入口。
 *
 * 三个约束是为后面两步服务的：1.8 要证明「同数据两次建库逐字节相同」，
 * 阶段 5 要靠 manifest 里的 sha256 做版本 diff。所以这里把不确定性一次钉死：
 * 记录顺序由调用方排好、level 固定、换行只用 \n、时间戳绝不写进 gz 本体。
 */

export interface WrittenFile {
  rows: number
  bytes: number
  sha256: string
}

export function writeJsonl(dir: string, file: string, rows: readonly unknown[]): WrittenFile {
  mkdirSync(dir, { recursive: true })
  const body = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length > 0 ? '\n' : '')
  const gz = gzipSync(Buffer.from(body, 'utf8'), { level: 9 })
  writeFileSync(join(dir, file), gz)
  return { rows: rows.length, bytes: gz.length, sha256: createHash('sha256').update(gz).digest('hex') }
}
