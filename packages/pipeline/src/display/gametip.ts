import { TABLES, relPath } from '../tables.ts'
import { readTable } from '../fetch/fetch.ts'

/**
 * gametip 是所有 word_* 显示文本的落点。这里只暴露两件事：
 * 按精确键取 tip，以及按前缀取整族键。稀有度与阵营都靠它读文本，
 * 人工表里不抄一遍中文，抄了就会和上游分叉。
 */

export type Gametip = Record<string, { tip?: string }>

export function readGametip(root: string, sha: string): Gametip {
  const raw = readTable(root, sha, relPath(TABLES.gametip))
  const out: Gametip = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const tip = (v as { tip?: unknown }).tip
      if (typeof tip === 'string') out[k] = { tip }
    }
  }
  return out
}

export function tipOf(tip: Gametip, key: string): string | undefined {
  return tip[key]?.tip
}

/** 返回前缀命中的全部键，键名已去掉前缀 */
export function keysUnder(tip: Gametip, prefix: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const [k, v] of Object.entries(tip)) {
    if (k.startsWith(prefix) && k.length > prefix.length) out.set(k.slice(prefix.length), v.tip as string)
  }
  return out
}
