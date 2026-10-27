import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildAttrMap } from '../src/normalize/attr-map.ts'
import { buildNameCode } from '../src/normalize/name-code.ts'
import { buildShipRecords } from '../src/normalize/ship.ts'
import { readTable } from '../src/fetch/fetch.ts'
import { TABLES, relPath } from '../src/tables.ts'
import { buildRetrofits } from '../src/normalize/retrofit.ts'
import { buildFleetTech } from '../src/normalize/fleet-tech.ts'
import { writeJsonl } from '../src/normalize/jsonl.ts'
import { readGametip } from '../src/display/gametip.ts'
import { loadFactions, factionMap } from '../src/display/factions.ts'
import { loadRarityDecl, buildShipRarity, rarityLabels } from '../src/display/rarity.ts'

const RAW = join(import.meta.dirname, '..', '..', '..', 'data', 'raw')
const ROOT = join(import.meta.dirname, '..', '..', '..')
const SHA_FILE = join(RAW, 'CURRENT_SHA')
const sha = existsSync(SHA_FILE) ? readFileSync(SHA_FILE, 'utf8').trim() : null
const dir = sha ? join(RAW, sha) : null
const skip = sha ? false : '未取数（先跑 pipeline run fetch），跳过真实数据断言'

function build() {
  const shaNow = sha as string
  const attrMap = buildAttrMap(dir!, shaNow)
  const tip = readGametip(dir!, shaNow)
  const factions = loadFactions(join(ROOT, 'data', 'manual', 'factions.json'))
  const decl = loadRarityDecl(join(ROOT, 'data', 'manual', 'rarity.json'))
  const labels = rarityLabels(buildShipRarity(tip, decl.ship.declaredDomain))
  const factionNames = new Map<number, string>()
  for (const f of factions) factionNames.set(f.nationality, tip[`word_shipNation_${f.wordKey}`]?.tip ?? '')
  const fleet = buildFleetTech(dir!, shaNow)
  const equipRaw = readTable(dir!, shaNow, relPath(TABLES.equipByType)) as Record<string, unknown>
  const built = buildShipRecords(dir!, shaNow, {
    attrMap,
    rarityLabels: labels,
    factions: factionMap(factions),
    factionNames,
    nameCode: buildNameCode(dir!, shaNow),
    fleetTechClassByGroup: fleet.classByGroup,
    fleetTechClassNationByGroup: fleet.classNationByGroup,
    equipKindIds: new Set(Object.keys(equipRaw).filter((k) => /^\d+$/.test(k)).map(Number)),
  })
  return { built, fleet, retrofits: buildRetrofits(dir!, shaNow) }
}

test('三层粒度：859 条目 / 3,429 阶段行 / 2,730 皮肤，且每条船都能渲染', { skip }, () => {
  const { built } = build()
  assert.equal(built.ships.length, 859)
  assert.equal(built.stages.length, 3427)
  assert.equal(built.skins.length, 2730)
  assert.equal(built.ships.filter((s) => s.rarity === null).length, 0, '有船取不到稀有度')
  assert.equal(built.ships.filter((s) => s.rarityLabel === null).length, 0, '有船取不到稀有度文本')
  assert.equal(built.ships.filter((s) => s.defaultSkinId === null).length, 0)
  assert.equal(built.ships.filter((s) => !s.factionName).length, 0)
  // 图鉴分类是游戏自己的四档，计数即 §3.5 的基线
  const byKind = new Map<number, number>()
  for (const s of built.ships) byKind.set(s.handbookType, (byKind.get(s.handbookType) ?? 0) + 1)
  assert.deepEqual([...byKind.entries()].sort(), [[0, 667], [1, 91], [2, 42], [3, 59]])
})

test('船名不留花括号，重樱与铁血走 name_code 两跳', { skip }, () => {
  const { built } = build()
  assert.equal(built.ships.filter((s) => s.name.includes('{')).length, 0)
  assert.equal(built.skins.filter((s) => s.name.includes('{')).length, 0)
  const wz = built.ships.find((s) => s.groupType === 20502)
  assert.ok(wz)
  assert.equal(wz.name, '厌战')
  assert.equal(wz.factionSlug, 'royal-navy')
  assert.equal(wz.rarityLabel, '超稀有')
  // 361 条占位规范名里挑一条重樱的：吹雪（namecode 2）
  const fubuki = built.ships.find((s) => s.name === '吹雪')
  assert.ok(fubuki, '重樱船名应由 name_code 解出，实得空')
  assert.equal(fubuki.factionSlug, 'sakura-empire')
})

test('阶段行：12 项具名属性，耐久随突破递增，star 与阶段号同源', { skip }, () => {
  const { built } = build()
  const stages = built.stages.filter((s) => s.groupType === 20502).sort((a, b) => a.stage - b.stage)
  assert.equal(stages.length, 4)
  assert.deepEqual(stages.map((s) => s.stage), [1, 2, 3, 4])
  assert.deepEqual(stages.map((s) => s.star), [3, 4, 5, 6])
  for (const s of stages) {
    assert.equal(Object.keys(s.attrs).length, 12)
    assert.ok((s.attrs.durability ?? 0) > 0)
  }
  const dur = stages.map((s) => s.attrs.durability ?? 0)
  assert.ok(dur.every((v, i) => i === 0 || v >= (dur[i - 1] ?? 0)), `耐久未随突破递增：${dur.join('/')}`)
  assert.deepEqual(dur, [1298, 1615, 2248, 3197])
})

test('改造：106 条 × 6 分支，节点集合与 transform_data_template 双射', { skip }, () => {
  const { retrofits } = build()
  assert.equal(retrofits.length, 106)
  const nodes = retrofits.flatMap((r) => r.branches.flat())
  assert.equal(nodes.length, 1217, '改造节点引用数应等于模板表行数')
  assert.equal(new Set(nodes.map((n) => n.nodeId)).size, 1217, '有节点被引用两次')
  assert.equal(nodes.filter((n) => n.name === '').length, 0)
  for (const r of retrofits) {
    assert.equal(r.branches.length, 6)
    assert.ok(r.transSkin !== 0)
  }
  // 改造与科研是两个维度，交集为 0
  const { built } = build()
  const research = new Set(built.ships.filter((s) => s.handbookType === 2).map((s) => s.groupType))
  assert.equal(retrofits.filter((r) => research.has(r.groupType)).length, 0)
})

test('舰队科技：四表 join 闭合，且舰级 nation 与舰船 nationality 全等', { skip }, () => {
  const { built, fleet } = build()
  assert.equal(fleet.counts.groups, 4)
  assert.equal(fleet.counts.nodes, 36)
  assert.equal(fleet.counts.ships, 726)
  assert.deepEqual(fleet.rows.filter((r) => r.kind === 'group').map((r) => (r as { name: string }).name), [
    '作战技术-白鹰',
    '作战技术-皇家',
    '作战技术-重樱',
    '作战技术-铁血',
  ])
  const byGroup = new Map(built.ships.map((s) => [s.groupType, s]))
  const ships = fleet.rows.filter((r) => r.kind === 'ship') as Array<{
    groupType: number
    classId: number
    classNation: number
    className: string
  }>
  assert.equal(ships.filter((r) => byGroup.get(r.groupType)?.nationality === r.classNation).length, 726)
  assert.ok(ships.every((r) => r.className.length > 0), '舰级名不应为空')
  // 舰级名是数据里的权威中文（计划原先没有这条）。注意 class 指向的是舰级头，
  // 组内成员挂到第一个船的那一级上：10102（马汉级同名船）挂在 10101 法拉格特级下
  const faragut = ships.find((r) => r.groupType === 10102)
  assert.ok(faragut)
  assert.equal(faragut.classId, 10101)
  assert.equal(faragut.className, '法拉格特级')
})

test('非阶段行只进隔离清单，不混进三层数据', { skip }, () => {
  const { built } = build()
  assert.equal(built.stages.filter((s) => s.rowId - s.skinId < 1 || s.rowId - s.skinId > 4).length, 0)
  assert.equal(built.quarantine.filter((q) => q.kind === 'non_stage_ship_row').length, 528)
  // 表里 3,429 行阶段行，剔掉属于 352 个孤儿 group 的 skin 900424 那 2 行才是页面的数据；
  // 隔离清单按 skin_id 聚合成 1 条，detail 里记着行数
  const orphanStage = built.quarantine.filter((q) => q.kind === 'stage_row_orphan_group')
  assert.equal(orphanStage.length, 1)
  assert.equal(orphanStage[0]?.key, '900424')
  assert.match(orphanStage[0]?.detail ?? '', /^2 行阶段行/)
  assert.equal(3429 - built.stages.length, 2)
  assert.equal(built.quarantine.filter((q) => q.kind === 'voice_actor_missing').length, 0, 'CV 哨兵 0 / -1 不该被当缺失')
  assert.ok(built.skins.every((s) => s.voiceActor === null || s.voiceActor.length > 0))
})

test('获取方式是结构化三元组：命令枚举闭合、科研与收藏自指', { skip }, () => {
  const { built } = build()
  const total = built.ships.reduce((n, s) => n + s.sources.length, 0)
  assert.equal(total, 1432)
  const byCmd = new Map<string, number>()
  for (const s of built.ships) for (const e of s.sources) byCmd.set(e.command, (byCmd.get(e.command) ?? 0) + 1)
  assert.deepEqual(
    [...byCmd.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    [['', 569], ['COLLECTSHIP', 4], ['GETBOAT', 447], ['LEVEL', 119], ['METACHARACTER', 50], ['SHIPBLUEPRINT', 42], ['SHOP', 201]],
  )
  // 科研命令的条数恰好等于 handbook_type=2 的船数
  assert.equal(byCmd.get('SHIPBLUEPRINT'), 42)
  assert.equal(built.ships.filter((s) => s.sources.length === 0).length, 17, '无来源的船要显示「未知」而不是猜')
  for (const s of built.ships) {
    for (const e of s.sources) {
      if (e.command === 'SHIPBLUEPRINT' || e.command === 'COLLECTSHIP') assert.equal(e.args?.shipGroupId, s.groupType)
    }
  }
})

test('写盘字节级可重放：同数据两次产出 sha256 相同', { skip }, () => {
  const tmp = mkdtempSync(join(tmpdir(), 'blhx-jsonl-'))
  try {
    const rows = [{ a: 1, b: 'x' }, { a: 2, b: 'y' }]
    const one = writeJsonl(tmp, 'x.jsonl.gz', rows)
    const two = writeJsonl(tmp, 'x.jsonl.gz', rows)
    assert.equal(one.sha256, two.sha256, 'gzip 输出不稳定，1.8 的建库字节一致性前提就不成立')
    assert.equal(one.rows, 2)
    const buf = readFileSync(join(tmp, 'x.jsonl.gz'))
    assert.equal(buf.length, one.bytes)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
