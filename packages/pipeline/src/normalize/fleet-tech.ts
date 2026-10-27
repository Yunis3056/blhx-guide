import { TABLES, relPath } from '../tables.ts'
import { readTable } from '../fetch/fetch.ts'

/**
 * 舰队科技。四张表拼成一条链，join 全部实测过（726/726、36/36）：
 *
 *   fleet_tech_group        4 条   {id, name「作战技术-白鹰」, nation[], techs[9]}
 *     ↑ groupid                        ↓ techs = 节点 id
 *   fleet_tech_template    36 条   {id, groupid, cost, pt, time, add[[[舰种…] × 1..12, 数值]]}
 *   fleet_tech_ship_class 385 条   {id, name「法拉格特级」, nation, ships[], shiptype, t_level}
 *     ↑ class                        ↑ ships = group_type
 *   fleet_tech_ship_template 726 条 {id=group_type, class, max_star, pt_get, pt_level, pt_upgrage, …}
 *
 * 顺带拿到一份计划里没有的东西：**舰级中文名**（「法拉格特级」）。这是数据里的
 * 权威文本，可以直接进舰船页与搜索别名。
 *
 * 只有 726/859 条船有科技行；缺的 133 条是联动与布里（class 表的 nation 恰好
 * 不含 98 与 101–115），这是数据本身的覆盖范围，不是取数漏了。
 */

export interface FleetTechGroup {
  groupId: number
  name: string
  nation: number[]
  techs: number[]
}

export interface FleetTechNode {
  nodeId: number
  groupId: number
  cost: number
  pt: number
  time: number
  add: Array<{ shiptypes: number[]; level: number; value: number }>
  awards: number[][]
}

export interface FleetTechShip {
  groupType: number
  classId: number
  className: string
  classNation: number
  classShipType: number
  maxStar: number
  ptGet: number
  ptLevel: number
  ptUpgrade: number
  addGet: { attr: number; shiptypes: number[]; value: number }
  addLevel: { attr: number; shiptypes: number[]; value: number }
}

export type FleetTechRow =
  | ({ kind: 'group' } & FleetTechGroup)
  | ({ kind: 'node' } & FleetTechNode)
  | ({ kind: 'ship' } & FleetTechShip)

function dict(root: string, sha: string, key: keyof typeof TABLES): Record<string, Record<string, unknown>> {
  const raw = readTable(root, sha, relPath(TABLES[key])) as Record<string, unknown>
  const out: Record<string, Record<string, unknown>> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (/^\d+$/.test(k) && v && typeof v === 'object' && !Array.isArray(v)) out[k] = v as Record<string, unknown>
  }
  return out
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v))

export function buildFleetTech(root: string, sha: string) {
  const groupsRaw = dict(root, sha, 'fleetTechGroup')
  const nodesRaw = dict(root, sha, 'fleetTechTemplate')
  const classRaw = dict(root, sha, 'fleetTechShipClass')
  const shipRaw = dict(root, sha, 'fleetTechShipTemplate')

  const problems: string[] = []
  const groups: FleetTechGroup[] = []
  const nodes: FleetTechNode[] = []
  const ships: FleetTechShip[] = []
  const classByGroup = new Map<number, number>()
  const classNationByGroup = new Map<number, number>()

  for (const r of Object.values(groupsRaw)) {
    const techs = (r.techs as number[]) ?? []
    for (const t of techs) {
      if (nodesRaw[String(t)] === undefined) problems.push(`fleet_tech_group ${String(r.id)} 引用了不存在的科技节点 ${t}`)
    }
    groups.push({ groupId: num(r.id), name: String(r.name), nation: (r.nation as number[]) ?? [], techs })
  }
  // 每个节点都必须被某个组引用，否则站点上永远到不了
  const referenced = new Set<number>(groups.flatMap((g) => g.techs))
  for (const r of Object.values(nodesRaw)) {
    const id = num(r.id)
    if (!referenced.has(id)) problems.push(`科技节点 ${id} 不属于任何 group，页面上到不了`)
    const add: FleetTechNode['add'] = []
    for (const item of (r.add as unknown[]) ?? []) {
      const [shiptypes, level, value] = item as [number[], number, number]
      if (!Array.isArray(shiptypes)) {
        problems.push(`科技节点 ${id} 的 add 首元素不是舰种数组：${JSON.stringify(item).slice(0, 60)}`)
        continue
      }
      add.push({ shiptypes, level: num(level), value: num(value) })
    }
    nodes.push({ nodeId: id, groupId: num(r.groupid), cost: num(r.cost), pt: num(r.pt), time: num(r.time), add, awards: ((r.level_award_display as number[][]) ?? []) })
  }

  for (const r of Object.values(shipRaw)) {
    const groupType = num(r.id)
    const classId = num(r.class)
    const cls = classRaw[String(classId)]
    if (!cls) {
      problems.push(`fleet_tech_ship_template ${groupType} 的 class ${classId} 不在 fleet_tech_ship_class 里`)
      continue
    }
    classByGroup.set(groupType, classId)
    classNationByGroup.set(groupType, num(cls.nation))
    ships.push({
      groupType,
      classId,
      className: String(cls.name),
      classNation: num(cls.nation),
      classShipType: num(cls.shiptype),
      maxStar: num(r.max_star),
      ptGet: num(r.pt_get),
      ptLevel: num(r.pt_level),
      ptUpgrade: num(r.pt_upgrage),
      addGet: { attr: num(r.add_get_attr), shiptypes: (r.add_get_shiptype as number[]) ?? [], value: num(r.add_get_value) },
      addLevel: { attr: num(r.add_level_attr), shiptypes: (r.add_level_shiptype as number[]) ?? [], value: num(r.add_level_value) },
    })
    // class.ships 反向也要闭合，否则同一舰级的成员名单是编的
    for (const s of (cls.ships as number[]) ?? []) {
      if (s === groupType) continue
      if (shipRaw[String(s)] === undefined) problems.push(`舰级 ${classId}(${String(cls.name)}) 列出的船 ${s} 没有科技行`)
    }
  }

  if (problems.length > 0) {
    throw new Error(`舰队科技 join 断言失败（${problems.length} 条，前 20）：\n  ${problems.slice(0, 20).join('\n  ')}`)
  }
  groups.sort((a, b) => a.groupId - b.groupId)
  nodes.sort((a, b) => a.nodeId - b.nodeId)
  ships.sort((a, b) => a.groupType - b.groupType)
  const rows: FleetTechRow[] = [
    ...groups.map((g) => ({ kind: 'group' as const, ...g })),
    ...nodes.map((n) => ({ kind: 'node' as const, ...n })),
    ...ships.map((s) => ({ kind: 'ship' as const, ...s })),
  ]
  return { rows, classByGroup, classNationByGroup, counts: { groups: groups.length, nodes: nodes.length, ships: ships.length } }
}
