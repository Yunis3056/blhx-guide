import { TABLES, relPath, type TableKey } from './tables.ts'

/** A 档 + 交叉断言所需的少量 B 档表 */
export const STAGE1_TABLES: TableKey[] = [
  'shipGroup',
  'shipSkinTemplate',
  'shipStats',
  'shipTemplate',
  'shipBreakout',
  'attrInfo',
  'shipByType',
  'gametip',
  'voiceActorCN',
  'skillTemplate',
  'enemyStats',
  'transformNode',
  'shipTrans',
  'researchProject',
  'equipStats',
  'equipTemplate',
  'equipByType',
  'nameCode',
  'memoryStoryline',
  'equipByQuality',
  'fleetTechGroup',
  'fleetTechTemplate',
  'fleetTechShipClass',
  'fleetTechShipTemplate',
  // 语音文本：阶段 2.2b 起详情页要用。注册表里一直是 B 档，之前只是没进取数白名单
  'shipSkinWords',
]

export function whitelistFor(keys: TableKey[]): string[] {
  const paths = keys.map((k) => relPath(TABLES[k]))
  // 同一张表名可能出现在两个目录，去重后仍需各自独立解出
  return [...new Set(paths)]
}

/**
 * 负向探针：故意解出 24 组同名互补表里 ShareCfg 侧的空壳。
 * 平时不参与业务，只给回归测试当证据 —— 证明「读错目录」确实会被注册表拦住，
 * 而不是一个纸面推论。
 */
export const STUB_PROBES = [
  'CN/ShareCfg/gametip.json',
  'CN/ShareCfg/ship_data_statistics.json',
  'CN/ShareCfg/equip_data_statistics.json',
  'CN/ShareCfg/chapter_template.json',
]

