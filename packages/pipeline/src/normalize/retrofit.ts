import { TABLES, relPath } from '../tables.ts'
import { readTable } from '../fetch/fetch.ts'

/**
 * 改造。它**不是** handbook_type 维度（与科研船交集实测为 0），而是 ship_data_group
 * 上的一组字段 + 一张节点表：
 *
 *   trans_type         int   78 条非零
 *   trans_skin         int   106 条（改造后皮肤 id）
 *   trans_skill        int[]  96 条
 *   trans_radar_chart  str[] 106 条（六格雷达字母，如 ["B","C","E","B","C","C"]）
 *   ship_data_trans    106 行 {group_id, skin_id, skill_id, transform_list}
 *
 * transform_list 实测每条船 6 个分支、共 1,217 个 [槽类型, 节点 id] 二元组，
 * 与 transform_data_template 的 1,217 行**一一对应且互逆**（每个节点被引用恰好一次）。
 * 槽类型只有 {2,3,4}，其语义在数据里没有任何文本说明 —— 原样带出并标注未证，不编名目。
 */

export const TRANSFORM_SLOT_TYPES = [2, 3, 4] as const

export interface RetrofitNode {
  nodeId: number
  slotType: number
  name: string
  descrip: string
  effect: Record<string, unknown>[]
  useGold: number
  useItem: unknown[]
  useShip: unknown[]
  levelLimit: number
  starLimit: number
}

export interface RetrofitRecord {
  groupType: number
  transType: number
  transSkin: number
  transSkill: number[]
  transRadarChart: string[]
  resultSkinId: number
  resultSkillId: number
  branches: RetrofitNode[][]
}

function dict(root: string, sha: string, key: keyof typeof TABLES): Record<string, Record<string, unknown>> {
  const raw = readTable(root, sha, relPath(TABLES[key])) as Record<string, unknown>
  const out: Record<string, Record<string, unknown>> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (/^\d+$/.test(k) && v && typeof v === 'object' && !Array.isArray(v)) out[k] = v as Record<string, unknown>
  }
  return out
}

const arr = (v: unknown): number[] => (Array.isArray(v) ? (v as number[]) : [])
const looseArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const strs = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : [])

export function buildRetrofits(root: string, sha: string): RetrofitRecord[] {
  const groups = dict(root, sha, 'shipGroup')
  const trans = dict(root, sha, 'shipTrans')
  const nodes = dict(root, sha, 'transformNode')

  const problems: string[] = []
  const usedNodes = new Set<number>()
  const groupTypeByTrans = new Map<number, number>()
  const out: RetrofitRecord[] = []

  for (const g of Object.values(groups)) {
    const groupType = g.group_type as number
    const transSkin = g.trans_skin as number
    if (!transSkin) continue
    const row = trans[String(groupType)]
    if (!row) {
      problems.push(`group ${groupType}: 有 trans_skin ${transSkin} 但 ship_data_trans 没有对应行`)
      continue
    }
    groupTypeByTrans.set(groupType, groupType)
    const branchesRaw = row.transform_list as unknown[][]
    if (branchesRaw.length !== 6) {
      problems.push(`group ${groupType}: transform_list 分支数 ${branchesRaw.length}，实测 106 条全是 6`)
      continue
    }
    const branches: RetrofitNode[][] = branchesRaw.map((branch) =>
      (branch as Array<[number, number]>).map(([slotType, nodeId]) => {
        if (!(TRANSFORM_SLOT_TYPES as readonly number[]).includes(slotType)) {
          problems.push(`group ${groupType}: 改造槽类型 ${slotType} 不在实测枚举 ${TRANSFORM_SLOT_TYPES.join('/')} 内`)
          return { nodeId, slotType, name: '', descrip: '', effect: [], useGold: 0, useItem: [], useShip: [], levelLimit: 0, starLimit: 0 }
        }
        const node = nodes[String(nodeId)]
        if (!node) {
          problems.push(`group ${groupType}: 改造节点 ${nodeId} 不在 transform_data_template 里`)
          return { nodeId, slotType, name: '', descrip: '', effect: [], useGold: 0, useItem: [], useShip: [], levelLimit: 0, starLimit: 0 }
        }
        usedNodes.add(nodeId)
        return {
          nodeId,
          slotType,
          name: String(node.name ?? ''),
          descrip: String(node.descrip ?? ''),
          effect: Array.isArray(node.effect) ? (node.effect as Record<string, unknown>[]) : [],
          useGold: (node.use_gold as number) ?? 0,
          useItem: looseArr(node.use_item),
          useShip: looseArr(node.use_ship),
          levelLimit: (node.level_limit as number) ?? 0,
          starLimit: (node.star_limit as number) ?? 0,
        }
      }),
    )
    out.push({
      groupType,
      transType: (g.trans_type as number) ?? 0,
      transSkin,
      transSkill: arr(g.trans_skill),
      transRadarChart: strs(g.trans_radar_chart),
      resultSkinId: row.skin_id as number,
      resultSkillId: row.skill_id as number,
      branches,
    })
  }

  // 反向闭合：ship_data_trans 里不能有指向无 trans_skin 船的行
  for (const r of Object.values(trans)) {
    const gid = r.group_id as number
    if (!groupTypeByTrans.has(gid)) {
      problems.push(`ship_data_trans 行 group_id ${gid} 在 group 表里没有 trans_skin`)
    }
  }
  const unused = Object.keys(nodes).length - usedNodes.size
  if (unused !== 0) {
    problems.push(`transform_data_template 有 ${unused} 个节点没被任何船引用（实测 1,217 节点与 106 船的引用集是双射）`)
  }
  // 改造与科研是两个维度，交集必须为 0（§3.5）
  for (const rec of out) {
    const g = groups[String(rec.groupType)]
    if (g && g.handbook_type === 2) problems.push(`group ${rec.groupType} 同时是科研船与改造船，两个维度的边界破了`)
  }

  if (problems.length > 0) {
    throw new Error(`改造建模断言失败（${problems.length} 条，前 20）：\n  ${problems.slice(0, 20).join('\n  ')}`)
  }
  out.sort((a, b) => a.groupType - b.groupType)
  return out
}
