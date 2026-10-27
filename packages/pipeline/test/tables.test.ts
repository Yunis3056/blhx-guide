import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { TABLES, assertSpec, relPath } from '../src/tables.ts'

const RAW = join(import.meta.dirname!, '..', '..', '..', 'data', 'raw')
const SHA_FILE = join(RAW, 'CURRENT_SHA')

const sha = existsSync(SHA_FILE) ? readFileSync(SHA_FILE, 'utf8').trim() : null
const dir = sha ? join(RAW, sha) : null

function load(spec: { dir: string; name: string }): unknown {
  const p = join(dir!, 'AzurLaneData-' + sha, 'CN', spec.dir, spec.name + '.json')
  let s = readFileSync(p, 'utf8')
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  return JSON.parse(s)
}

const skip = sha ? false : '未取数（先跑 pipeline fetch），跳过真实数据断言'

test('gametip 用 string 策略取到全部键；换成 numeric 策略就是 0 条', { skip }, () => {
  const g = TABLES.gametip
  const raw = load(g) as Record<string, unknown>
  const keys = assertSpec(raw, g)
  assert.ok(keys.length >= 6000, `string 策略应取到全部键，实得 ${keys.length}`)

  const numeric = Object.keys(raw).filter((k) => /^\d+$/.test(k))
  assert.equal(numeric.length, 0, 'gametip 不应有任何数字键')
  // 这正是上一版计划的失效模式：全局 /^\\d+$/ 过滤会把整表取成空集
})

test('24 组同名表：ShareCfg 侧的 gametip 是空壳，断言必须拦住它', { skip }, () => {
  const stubPath = join(dir!, 'AzurLaneData-' + sha, 'CN', 'ShareCfg', 'gametip.json')
  assert.ok(existsSync(stubPath), 'ShareCfg/gametip.json 应由 STUB_PROBES 解出，未找到')
  let s = readFileSync(stubPath, 'utf8')
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  const stub = JSON.parse(s)
  assert.ok(
    (Array.isArray(stub) && stub.length === 0) ||
      (typeof stub === 'object' && stub !== null && Object.keys(stub).length === 0),
    `ShareCfg 侧本应是空壳，实得 ${Object.keys(stub as object).length} 条`,
  )
  assert.throws(
    () => assertSpec(stub, TABLES.gametip),
    /空数组 —— 高度怀疑读到了同名空壳表/,
    '读到 ShareCfg 空壳却没被拦住，或诊断信息没指向「读错目录」',
  )
})

test('shipBreakout 条数必须小于 shipStats，两者不是一一对应', { skip }, () => {
  const b = assertSpec(load(TABLES.shipBreakout), TABLES.shipBreakout).length
  const s = assertSpec(load(TABLES.shipStats), TABLES.shipStats).length
  assert.ok(b < s, `breakout ${b} 应少于 stats ${s}`)
})

test('三个属性数组全部定长 12（不是 6）', { skip }, () => {
  const rows = Object.values(load(TABLES.shipStats) as Record<string, never>)
  const bad: string[] = []
  for (const r of rows) {
    for (const f of ['attrs', 'attrs_growth', 'attrs_growth_extra']) {
      const v = (r as Record<string, unknown>)[f]
      if (!Array.isArray(v) || v.length !== 12) bad.push(f)
    }
  }
  assert.deepEqual(bad, [], `存在长度非 12 的数组字段：${[...new Set(bad)].join(',')}`)
})

test('ship_data_template.max_level 全部 = 100，故曲线只承诺 1-100', { skip }, () => {
  const rows = Object.values(load(TABLES.shipTemplate) as Record<string, { max_level?: number }>)
  const vals = new Set(rows.map((r) => r.max_level))
  assert.deepEqual([...vals], [100], `max_level 出现非 100 值：${[...vals].join(',')}`)
})

test('装备 base 继承：多数行无自有 name，不展开就是空名字页', { skip }, () => {
  const rows = Object.values(load(TABLES.equipStats) as Record<string, Record<string, unknown>>)
  const withBase = rows.filter((r) => r.base)
  const inheritNeeded = withBase.filter((r) => !r.name)
  assert.ok(inheritNeeded.length > 5000, `应看到大量需继承的行，实得 ${inheritNeeded.length}`)
  // 实证锚点：501 继承自 500「小海狸中队队徽」
  const byId = new Map(rows.map((r) => [r.id as number, r]))
  assert.equal(byId.get(500)?.name, '小海狸中队队徽')
  assert.equal(byId.get(501)?.base, 500)
  assert.equal(byId.get(501)?.name, undefined, '501 不该有自有 name')
})

test('装备条目判定 = 909，且不含任何 id 数值截断', { skip }, () => {
  const stats = Object.values(load(TABLES.equipStats) as Record<string, Record<string, unknown>>)
  const validType = new Set(
    Object.keys(load(TABLES.equipByType) as Record<string, unknown>).filter((k) => /^\d+$/.test(k)).map(Number),
  )
  const templ = new Set(
    Object.keys(load(TABLES.equipTemplate) as Record<string, unknown>).filter((k) => /^\d+$/.test(k)).map(Number),
  )
  const entries = stats.filter(
    (r) => r.name && !r.base && validType.has(r.type as number) && templ.has(r.id as number),
  )
  assert.equal(entries.length, 909, `装备条目应为 909，实得 ${entries.length}`)
  assert.ok(entries.some((e) => e.id === 500), '小海狸中队队徽(500) 必须在条目集内')
  assert.ok(entries.every((e) => e.icon && e.icon !== 1), '每条都应带 icon')
})

test('科技树不是 technology_data_template：项目 1 是 C-153-MI', { skip }, () => {
  const t = load(TABLES.researchProject) as Record<string, Record<string, unknown>>
  assert.equal(t['1']?.name, 'C-153-MI')
  assert.equal(t['1']?.time, 21600)
})

test('改造节点条件与成本只在 transform_data_template', { skip }, () => {
  const n = load(TABLES.transformNode) as Record<string, Record<string, unknown>>
  assert.ok(Object.keys(n).length > 1000, '应有 1,217 个节点')
  const v = n['501']
  assert.equal(v?.name, '舰体改良I')
  assert.equal(v?.use_gold, 200)
})
