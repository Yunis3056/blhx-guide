import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { keysUnder, type Gametip } from './gametip.ts'

/**
 * 稀有度。舰船侧标签来自 gametip 的 index_rare{value}，装备侧在 CN 数据里没有文本源。
 *
 * 两条铁律：
 *   1. 不许用 star 推 rarity —— star 是突破阶段，同一艘船突破后会变。
 *   2. 取值域两侧对齐：人工表声明的域与 gametip 实际键集必须相等。
 *      任何一侧漂了都中止，不按下标猜顺序，也不按观测值补一个没依据的标签。
 */

export interface ShipRarity {
  value: number
  label: string
}

const Decl = z.object({
  ship: z.object({
    field: z.string(),
    labelKeyPattern: z.string(),
    labelSource: z.string(),
    declaredDomain: z.array(z.number().int()).min(1),
    domainEvidence: z.string().min(20),
    unmappedPolicy: z.enum(['fail', 'quarantine']),
    knownUnmapped: z
      .array(z.object({ value: z.number().int(), rows: z.number().int().nonnegative(), detail: z.string(), handling: z.string() }))
      .default([]),
    forbidStarAsRarity: z.literal(true),
    forbidStarEvidence: z.string().min(20),
  }),
  equip: z.object({
    field: z.string(),
    labelKeyPattern: z.null(),
    declaredDomain: z.array(z.number().int()).min(1),
    domainEvidence: z.string().min(20),
    labels: z.null(),
    labelPolicy: z.literal('numeric'),
    detail: z.string().min(20),
  }),
})

export type RarityDecl = z.infer<typeof Decl>

export function loadRarityDecl(path: string): RarityDecl {
  const parsed = Decl.safeParse(JSON.parse(readFileSync(path, 'utf8')))
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`data/rarity.json 结构不合法：\n${issues}`)
  }
  return parsed.data
}

/** 由 gametip 生成，不硬编码「4 = 精锐」 */
export function buildShipRarity(tip: Gametip, declaredDomain: readonly number[]): ShipRarity[] {
  const words = keysUnder(tip, 'index_rare')
  const numeric = [...words.keys()].filter((k) => /^\d+$/.test(k))
  const nonNumeric = [...words.keys()].filter((k) => !/^\d+$/.test(k))
  if (nonNumeric.length > 0) {
    throw new Error(`gametip index_rare* 出现非数字后缀 ${nonNumeric.join(', ')}，取值域口径变了`)
  }
  const got = numeric.map(Number).sort((a, b) => a - b)
  const want = [...declaredDomain].sort((a, b) => a - b)
  if (got.join(',') !== want.join(',')) {
    throw new Error(
      `舰船稀有度取值域两侧不一致：gametip 的 index_rare* 给 ${got.join(',')}（${got.length} 个），` +
        `data/rarity.json 声明 ${want.join(',')}（${want.length} 个）。` +
        `要么上游加了档没同步人工表，要么人工表写了没依据的档`,
    )
  }
  return got.map((value) => ({ value, label: words.get(String(value)) as string }))
}

/** 观测值必须落在声明域 ∪ 已知例外里，否则是上游新增了没依据的档 */
export function assertObservedRarity(
  observed: ReadonlyMap<number, number>,
  decl: RarityDecl['ship'],
): void {
  const allowed = new Set([...decl.declaredDomain, ...decl.knownUnmapped.map((k) => k.value)])
  const unexpected = [...observed.keys()].filter((v) => !allowed.has(v)).sort((a, b) => a - b)
  if (unexpected.length > 0) {
    const sample = unexpected.map((v) => `${v}(${observed.get(v)} 行)`).join(', ')
    throw new Error(
      `ship_data_statistics.rarity 出现没依据的档 ${sample}。` +
        `已声明域 ${decl.declaredDomain.join(',')}，已知例外 ${decl.knownUnmapped.map((k) => k.value).join(',') || '无'}。` +
        `新档的显示名没有文本源，禁止按观测值补标签`,
    )
  }
}

export function rarityLabels(map: readonly ShipRarity[]): Map<number, string> {
  return new Map(map.map((r) => [r.value, r.label]))
}
