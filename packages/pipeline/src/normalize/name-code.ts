import { TABLES, relPath } from '../tables.ts'
import { readTable } from '../fetch/fetch.ts'

/**
 * 船名占位符。重樱、铁血与 META 的船名在 ship_skin_template 里不是文本，
 * 而是 `{namecode:2}` 这种引用——1,213 条规范名里 361 条是占位。
 * 不解这一层，图鉴近一半页面标题会是字面量 `{namecode:2}`。
 *
 * 占位符可以带后缀（`{namecode:197}(μ兵装)`、`{namecode:93}·META`），
 * 所以必须逐处替换，不能拿整个字符串去查表。
 */

export const NAMECODE_RE = /\{namecode:(\d+)\}/g
/** 与 NAMECODE_RE 同形的无 g 版本：global 正则的 test() 会推进 lastIndex，循环里复用必错 */
const NAMECODE_TEST = /\{namecode:(\d+)\}/

export type NameCodeMap = Map<number, string>

export function buildNameCode(root: string, sha: string): NameCodeMap {
  const raw = readTable(root, sha, relPath(TABLES.nameCode)) as Record<string, unknown>
  const out: NameCodeMap = new Map()
  for (const [k, v] of Object.entries(raw)) {
    if (!/^\d+$/.test(k)) {
      throw new Error(`name_code 出现非数字键 '${k}'，本表没有 all 哨兵，多出键即口径变了`)
    }
    const rec = v as { id?: number; name?: unknown }
    if (rec.id !== Number(k)) {
      throw new Error(`name_code 键 ${k} 的记录里 id 是 ${String(rec.id)}，两代数据混了`)
    }
    if (typeof rec.name !== 'string' || rec.name.length === 0) {
      throw new Error(`name_code ${k} 没有 name`)
    }
    out.set(Number(k), rec.name)
  }
  if (out.size < 400) throw new Error(`name_code 只有 ${out.size} 条，实测 439 条`)
  return out
}

export function resolveName(name: string, map: NameCodeMap): { text: string; misses: number[] } {
  const misses: number[] = []
  const text = name.replace(NAMECODE_RE, (whole, digits: string) => {
    const id = Number(digits)
    const v = map.get(id)
    if (v === undefined) {
      misses.push(id)
      return whole
    }
    return v
  })
  return { text, misses }
}

/** 全量解析一次，任何引用落空都中止 —— 落空即页面上留花括号 */
export function assertAllResolve(names: Iterable<string>, map: NameCodeMap): void {
  const misses = new Map<number, number>()
  for (const n of names) {
    for (const m of n.matchAll(NAMECODE_RE)) {
      const id = Number(m[1])
      if (!map.has(id)) misses.set(id, (misses.get(id) ?? 0) + 1)
    }
  }
  if (misses.size > 0) {
    const list = [...misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    throw new Error(
      `name_code 覆盖不全：${misses.size} 个引用解析不出来，样例 ${list.map(([i, c]) => `${i}×${c}`).join(' ')}。` +
        `未处理的船名会带着花括号上线`,
    )
  }
}

export function placeholderCount(names: Iterable<string>): number {
  let n = 0
  for (const name of names) if (NAMECODE_TEST.test(name)) n++
  return n
}
