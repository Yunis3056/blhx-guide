import { readFileSync } from 'node:fs'
import { z } from 'zod'

/**
 * 站位人工表：英文枚举 `team_type` → 分类身份。
 *
 * 前排/后排各有一条 1:1 的 gametip 词条（`index_fleetfront` / `index_fleetrear`），
 * 潜艇没有——只有 `ship_formationUI_fleetName_*_ss` 这一族带「潜艇编队」后缀的词条。
 * 三者强度不齐，所以名字统一落人工表，evidence 逐条写清出处；能机器化的仍是取值域对账：
 * 舰种表出现未登记的 team_type、或登记的站位旗下没有任何舰种，都中止构建。
 *
 * 这份表还有一个非装饰作用：舰种名不唯一（导驱 20/21、风帆 22/23/24），
 * 舰种页的标签要靠站位把同名的分开，所以站位中文名必须在库里可读，不能只在页面里硬编码。
 */

const Entry = z.object({
  teamType: z.string().regex(/^[a-z_]+$/),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  evidence: z.string().min(20),
})

const File = z.object({
  note: z.string().min(1),
  positions: z.array(Entry).min(1),
})

export type PositionEntry = z.infer<typeof Entry>

export function loadPositions(path: string): PositionEntry[] {
  const parsed = File.safeParse(JSON.parse(readFileSync(path, 'utf8')))
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`data/manual/positions.json 结构不合法：\n${issues}`)
  }
  const seenTeam = new Map<string, PositionEntry>()
  const seenSlug = new Map<string, PositionEntry>()
  for (const p of parsed.data.positions) {
    const dup = seenTeam.get(p.teamType)
    if (dup !== undefined) throw new Error(`team_type '${p.teamType}' 登记了两次：${dup.slug} 与 ${p.slug}`)
    const dupSlug = seenSlug.get(p.slug)
    if (dupSlug !== undefined) throw new Error(`slug '${p.slug}' 被两个 team_type 占用`)
    seenTeam.set(p.teamType, p)
    seenSlug.set(p.slug, p)
  }
  return parsed.data.positions
}

/** 舰种表里出现的每个 team_type 都必须登记，登记的每个站位都必须真有舰种 */
export function assertPositionsCovers(positions: readonly PositionEntry[], observed: Iterable<string>): void {
  const set = new Set(observed)
  const missing = [...set].filter((t) => !positions.some((p) => p.teamType === t))
  if (missing.length > 0) {
    throw new Error(
      `ship_data_by_type 出现未登记的 team_type ${missing.join(' / ')}。` +
        `已登记 ${positions.map((p) => p.teamType).join(' / ')}；新站位的中文名要先找到文本源才能上页，不猜`,
    )
  }
  const stale = positions.filter((p) => !set.has(p.teamType))
  if (stale.length > 0) throw new Error(`人工表登记的站位在舰种表里没有成员：${stale.map((p) => p.teamType).join(' / ')}`)
}
