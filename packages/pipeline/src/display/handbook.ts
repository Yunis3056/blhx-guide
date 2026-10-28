import { readFileSync } from 'node:fs'
import { z } from 'zod'

/**
 * 图鉴分类人工表：数字 `handbook_type` → 分类身份。
 *
 * 与阵营表的区别要在代码里说明白，否则后来人会以为这里也做了文本回读：
 * 阵营的显示名构建期从 gametip 的 `word_shipNation_*` 读回逐条比对，
 * 而 handbook_type 在上游**没有任何中文名源**（gametip 里搜不到 handbook 词条），
 * 所以名字只有这一份，改了不会报警。能机器化的是另一头：取值域与实测分布对账
 * （`assertCovers`），出现枚举外的值或登记缺项都直接中止构建。
 */

const Entry = z.object({
  handbookType: z.number().int().nonnegative(),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  evidence: z.string().min(20),
})

const File = z.object({
  note: z.string().min(1),
  kinds: z.array(Entry).min(1),
})

export type HandbookEntry = z.infer<typeof Entry>

export function loadHandbook(path: string): HandbookEntry[] {
  const parsed = File.safeParse(JSON.parse(readFileSync(path, 'utf8')))
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`data/manual/handbook.json 结构不合法：\n${issues}`)
  }
  const seenType = new Map<number, HandbookEntry>()
  const seenSlug = new Map<string, HandbookEntry>()
  for (const k of parsed.data.kinds) {
    const dupType = seenType.get(k.handbookType)
    if (dupType !== undefined) throw new Error(`handbook_type ${k.handbookType} 登记了两次：${dupType.slug} 与 ${k.slug}`)
    const dupSlug = seenSlug.get(k.slug)
    if (dupSlug !== undefined) throw new Error(`slug '${k.slug}' 被两个 handbook_type 占用`)
    seenType.set(k.handbookType, k)
    seenSlug.set(k.slug, k)
  }
  return parsed.data.kinds
}

/** 库里出现的每个值都必须登记，登记的每个值都必须真在库里出现 */
export function assertHandbookCovers(kinds: readonly HandbookEntry[], observed: Iterable<number>): void {
  const set = new Set(observed)
  const missing = [...set].filter((v) => !kinds.some((k) => k.handbookType === v))
  if (missing.length > 0) {
    throw new Error(
      `ship_data_group 出现未登记的 handbook_type ${missing.join(' / ')}。` +
        `已登记 ${kinds.map((k) => k.handbookType).join(' / ')}；新分类的名字与口径要先定才能上页，不猜`,
    )
  }
  const stale = kinds.filter((k) => !set.has(k.handbookType))
  if (stale.length > 0) throw new Error(`人工表登记的 handbook_type 在库里没有成员：${stale.map((k) => k.handbookType).join(' / ')}`)
}
