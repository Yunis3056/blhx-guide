import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { keysUnder, type Gametip } from './gametip.ts'

/**
 * 阵营人工表。数字 nationality → 阵营身份这条链在 CN 数据里不存在：
 * lover_nation 与 memory_storyline 带数字但不带名字，gametip 带名字但不带数字。
 * 所以人工表只负责这一跳，并且每条必须写清是怎么钉上的。
 *
 * 显示名一律从 gametip 的 word_shipNation_* 读出并与 name 逐条比对：
 * 抄写文本会随上游改名而分叉，比对不会。
 */

export const FACTION_SOURCES = ['data-text', 'ship-identity', 'inferred', 'structural'] as const

const Entry = z.object({
  nationality: z.number().int().nonnegative(),
  wordKey: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  source: z.enum(FACTION_SOURCES),
  evidence: z.string().min(20),
})

const File = z.object({
  note: z.string().min(1),
  factions: z.array(Entry).min(1),
})

export type FactionEntry = z.infer<typeof Entry>

export function loadFactions(path: string): FactionEntry[] {
  const parsed = File.safeParse(JSON.parse(readFileSync(path, 'utf8')))
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`data/factions.json 结构不合法：\n${issues}`)
  }
  const seenNum = new Map<number, FactionEntry>()
  const seenSlug = new Map<string, FactionEntry>()
  for (const f of parsed.data.factions) {
    const dupNum = seenNum.get(f.nationality)
    if (dupNum) throw new Error(`nationality ${f.nationality} 重复登记：${dupNum.slug} 与 ${f.slug}`)
    const dupSlug = seenSlug.get(f.slug)
    if (dupSlug) throw new Error(`slug '${f.slug}' 重复登记：nationality ${dupSlug.nationality} 与 ${f.nationality}`)
    seenNum.set(f.nationality, f)
    seenSlug.set(f.slug, f)
  }
  return parsed.data.factions
}

/** 人工表声明的中文与 gametip 实际文本必须逐条相等，否则说明词键接错了阵营 */
export function assertNamesAgreeWithGametip(factions: FactionEntry[], tip: Gametip): void {
  const words = keysUnder(tip, 'word_shipNation_')
  const bad: string[] = []
  for (const f of factions) {
    const actual = words.get(f.wordKey)
    if (actual === undefined) {
      bad.push(`  ${f.nationality} ${f.slug}: gametip 没有 word_shipNation_${f.wordKey}（gametip 共 ${words.size} 个阵营词键）`)
    } else if (actual !== f.name) {
      bad.push(`  ${f.nationality} ${f.slug}: 表里写「${f.name}」，gametip 是「${actual}」`)
    }
  }
  if (bad.length > 0) {
    throw new Error(`阵营文本与 gametip 不一致，中止（改名或词键接错都会让整站阵营标签错位）：\n${bad.join('\n')}`)
  }
}

/**
 * 覆盖断言。ship_data_group 出现表里没有的数字即中止 —— 静默显示「未知阵营」
 * 等于把一个未登记的枚举值放进站点。
 *
 * 反向不强制：表里可以保留游戏内只存在于剧情侧、当前无船的阵营（如 10 鸢尾教国）。
 */
export function assertCovers(factions: FactionEntry[], observed: readonly number[]): void {
  const declared = new Set(factions.map((f) => f.nationality))
  const missing = [...new Set(observed)].filter((n) => !declared.has(n)).sort((a, b) => a - b)
  if (missing.length > 0) {
    throw new Error(
      `ship_data_group 出现未登记 nationality ${missing.join(', ')}。` +
        `data/factions.json 需要新增条目并写明钉定方式，不允许静默归类`,
    )
  }
}

export function factionMap(factions: FactionEntry[]): Map<number, FactionEntry> {
  return new Map(factions.map((f) => [f.nationality, f]))
}
