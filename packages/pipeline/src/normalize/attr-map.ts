import { TABLES } from '../tables.ts'
import { readTable } from '../fetch/fetch.ts'

/**
 * 属性位置映射。
 *
 * 舰船侧 `ship_data_statistics.attrs` 是**位置数组**（下标 0–11），
 * 而敌方侧同样的属性是**具名字段**（cannon / durability / …）。
 * 两侧互为独立证据：位置含义若被上游改了，两份数据的键集会分叉。
 *
 * 因此这张映射**只能从 `attribute_info_by_type` 生成**，不允许在任何业务代码里
 * 硬编码「下标 1 = 炮击」之类的顺序。历史上这里最容易犯的错是把位 2 读成「火力」，
 * 而权威定义写的是「炮击」（cannon）。
 */

export interface AttrDef {
  /** 数组下标 = id - 1 */
  index: number
  /** 权威 id，从 1 起 */
  id: number
  /** 英文键，与 enemy_data_statistics 的具名字段同名 */
  name: string
  /** 中文显示名，直接来自游戏定义 */
  label: string
}

export interface AttrMap {
  attrs: AttrDef[]
  /** 用于与敌方表交叉比对的键集 */
  names: string[]
}

type Raw = Record<string, { id?: number; name?: string; condition?: string }>

export function buildAttrMap(root: string, sha: string): AttrMap {
  const def = readTable(root, sha, `CN/${TABLES.attrInfo.dir}/${TABLES.attrInfo.name}.json`) as Raw

  const ids = Object.keys(def)
    .filter((k) => /^\d+$/.test(k))
    .map(Number)
    .sort((a, b) => a - b)

  if (ids.length !== 12) {
    throw new Error(`attribute_info_by_type: 期望 12 项属性，实得 ${ids.length}`)
  }

  const attrs: AttrDef[] = ids.map((id) => {
    const e = def[String(id)]
    if (!e || typeof e.name !== 'string' || typeof e.condition !== 'string') {
      throw new Error(`attribute_info_by_type: id ${id} 缺少 name 或 condition`)
    }
    if (e.id !== id) {
      throw new Error(`attribute_info_by_type: id ${id} 的记录里 id 字段是 ${e.id}，两代数据混了`)
    }
    return { index: id - 1, id, name: e.name, label: e.condition }
  })

  // 表里的 all 哨兵应与数字键集合一致；不一致说明上游改了枚举却没同步哨兵
  const sentinel = def['all'] as unknown
  if (Array.isArray(sentinel)) {
    const s = sentinel.map(Number).sort((a, b) => a - b)
    if (s.join(',') !== ids.join(',')) {
      throw new Error(
        `attribute_info_by_type: all 哨兵 [${s.join(',')}] 与数字键 [${ids.join(',')}] 不一致`,
      )
    }
  }

  return { attrs, names: attrs.map((a) => a.name) }
}

/**
 * 与敌方表交叉断言。这是独立于舰船侧的第二份证据：
 * 键集分叉即映射漂移，必须中止而不是猜一个顺序继续跑。
 */
export function assertMatchesEnemy(root: string, sha: string, map: AttrMap): void {
  const enemyFile = `${TABLES.enemyStats.dir}/${TABLES.enemyStats.name}.json`
  const raw = readTable(root, sha, `CN/${enemyFile}`)
  const sample = Object.values(raw as Record<string, unknown>).find(
    (v): v is Record<string, unknown> => !!v && typeof v === 'object',
  )
  if (!sample) throw new Error('enemy_data_statistics 没有可检查的记录')

  const missing = map.names.filter((n) => !(n in sample))
  if (missing.length > 0) {
    throw new Error(
      `属性映射漂移：enemy_data_statistics 缺具名字段 ${missing.join(', ')}。` +
        `舰船侧位置数组的含义可能已被上游改动，中止而不是猜顺序`,
    )
  }
  const missingGrowth = map.names.filter((n) => `${n}_growth` in sample && !(n in sample))
  if (missingGrowth.length > 0) {
    throw new Error(`enemy 表具名字段异常：${missingGrowth.join(', ')}`)
  }
}

/** 位置数组 → 具名对象。业务代码只通过这个函数读属性，杜绝下标硬编码。 */
export function toNamed(
  map: AttrMap,
  arr: readonly number[] | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {}
  if (!Array.isArray(arr)) return out
  for (const a of map.attrs) {
    const v = arr[a.index]
    if (typeof v === 'number') out[a.name] = v
  }
  return out
}

/** 校验舰船侧三个数组都定长 12，与定义表条目数一致 */
export function assertArrayLength(map: AttrMap, rows: Array<Record<string, unknown>>): void {
  for (const field of ['attrs', 'attrs_growth', 'attrs_growth_extra'] as const) {
    let bad = 0
    for (const r of rows) {
      const v = r[field]
      if (!Array.isArray(v) || v.length !== map.attrs.length) bad++
    }
    if (bad > 0) {
      throw new Error(
        `ship_data_statistics.${field}: ${bad} 行长度不等于定义表条目数 ${map.attrs.length}`,
      )
    }
  }
}
