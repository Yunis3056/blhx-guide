import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { TABLES, relPath } from '../src/tables.ts'
import { readTable } from '../src/fetch/fetch.ts'
import { readGametip, keysUnder } from '../src/display/gametip.ts'
import { loadFactions, assertNamesAgreeWithGametip, assertCovers } from '../src/display/factions.ts'
import { loadRarityDecl, buildShipRarity, assertObservedRarity } from '../src/display/rarity.ts'
import { buildNameCode, resolveName, assertAllResolve } from '../src/normalize/name-code.ts'
import { manualPath } from '../src/paths.ts'
import {
  readShipRows,
  groupStageRows,
  rarityBySkin,
  assertStageShape,
  isStageRow,
} from '../src/normalize/stage-rows.ts'

const RAW = join(import.meta.dirname!, '..', '..', '..', 'data', 'raw')
const ROOT = join(import.meta.dirname!, '..', '..', '..')
const SHA_FILE = join(RAW, 'CURRENT_SHA')
const sha = existsSync(SHA_FILE) ? readFileSync(SHA_FILE, 'utf8').trim() : null
const dir = sha ? join(RAW, sha) : null
const skip = sha ? false : '未取数（先跑 pipeline run fetch），跳过真实数据断言'

function dict(key: keyof typeof TABLES): Record<string, Record<string, unknown>> {
  const raw = readTable(dir!, sha!, relPath(TABLES[key]))
  const out: Record<string, Record<string, unknown>> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (/^\d+$/.test(k) && v && typeof v === 'object') out[k] = v as Record<string, unknown>
  }
  return out
}

test('阵营表覆盖 ship_data_group 实出的每一个 nationality', { skip }, () => {
  const factions = loadFactions(manualPath(ROOT, 'factions'))
  const observed = [...new Set(Object.values(dict('shipGroup')).map((g) => g.nationality as number))]
  assert.equal(observed.length, 28, `实出阵营数应为 28，实得 ${observed.length}`)
  assertCovers(factions, observed)
  // 10 只存在于 lover_nation 与剧情表，图鉴里没有一条船，属于刻意保留
  assert.ok(!observed.includes(10), '鸢尾教国不应出现在舰船数据里')
  assert.equal(
    factions.filter((f) => f.source === 'inferred' || f.source === 'structural').length,
    4,
    '未钉死的阵营必须恰好 4 条（8/9/10/98），多了说明又开始猜了',
  )
})

test('阵营名不是抄的：与 gametip 逐条相等，改一个字就中止', { skip }, () => {
  const factions = loadFactions(manualPath(ROOT, 'factions'))
  const tip = readGametip(dir!, sha!)
  assertNamesAgreeWithGametip(factions, tip)

  const words = keysUnder(tip, 'word_shipNation_')
  assert.equal(words.size, 32, `word_shipNation_* 应 32 个词键，实得 ${words.size}`)

  const tampered = factions.map((f, i) => (i === 0 ? { ...f, name: '白鹰联邦' } : f))
  assert.throws(() => assertNamesAgreeWithGametip(tampered, tip), /表里写「白鹰联邦」，gametip 是「白鹰」/)

  // 97 用的是 meta_index，不是 meta —— 后者在游戏里显示 ???
  assert.equal(words.get('meta'), '???')
  assert.equal(words.get('meta_index'), 'META')
})

test('漏登记一个 nationality 时构建必须中止，不能静默归到未知阵营', { skip }, () => {
  const factions = loadFactions(manualPath(ROOT, 'factions'))
  const withoutNine = factions.filter((f) => f.nationality !== 9)
  assert.throws(() => assertCovers(withoutNine, [9]), /出现未登记 nationality 9/)
})

test('舰船稀有度标签由 gametip 生成，且与人工表声明域两侧对齐', { skip }, () => {
  const tip = readGametip(dir!, sha!)
  const decl = loadRarityDecl(manualPath(ROOT, 'rarity'))
  const map = buildShipRarity(tip, decl.ship.declaredDomain)
  assert.deepEqual(
    map.map((r) => `${r.value}:${r.label}`),
    ['2:普通', '3:稀有', '4:精锐', '5:超稀有', '6:海上传奇'],
  )
  assert.throws(
    () => buildShipRarity(tip, [...decl.ship.declaredDomain, 7]),
    /两侧不一致/,
    '人工表多写一个没文本源的档必须失败',
  )
  assert.throws(() => buildShipRarity(tip, [2, 3, 4, 5]), /两侧不一致/)
})

test('稀有度只在阶段行上成立：切对之后取值域恰好 2..6，18 不在其中', { skip }, () => {
  const decl = loadRarityDecl(manualPath(ROOT, 'rarity'))
  const rows = readShipRows(dir!, sha!)
  assert.equal(rows.length, 3957)
  const shape = assertStageShape(rows, { stageRows: 3429, others: 528, skins: 860, exactlyFour: 856 })
  assert.equal(shape.stageRows, 3429)
  assert.equal(shape.skins, 860)

  const groups = groupStageRows(rows)
  const rarBySkin = rarityBySkin(groups)
  const obs = new Map<number, number>()
  for (const r of rarBySkin.values()) obs.set(r, (obs.get(r) ?? 0) + 1)
  assert.deepEqual([...obs.keys()].sort((a, b) => a - b), [2, 3, 4, 5, 6])
  assertObservedRarity(obs, decl.ship)

  // 18 确实存在于这张表里，但只出现在非阶段行 —— 所以它是另一套行，不是新稀有度档
  const eighteen = rows.filter((r) => r.rarity === 18)
  assert.equal(eighteen.length, 3)
  assert.ok(eighteen.every((r) => !isStageRow(r)), 'rarity=18 的行必须全在阶段行之外')

  obs.set(9, 1)
  assert.throws(() => assertObservedRarity(obs, decl.ship), /没依据的档 9\(1 行\)/)
})

test('rarity 与 star 是两个独立字段：一艘船 4 个阶段行 star 递增、rarity 不变', { skip }, () => {
  const groups = groupStageRows(readShipRows(dir!, sha!))
  const four = [...groups.values()].filter((g) => g.length === 4)
  assert.equal(four.length, 856)
  let varyingStar = 0
  let constantRarity = 0
  for (const g of four) {
    if (new Set(g.map((r) => r.star)).size === 4) varyingStar++
    if (new Set(g.map((r) => r.rarity)).size === 1) constantRarity++
  }
  assert.equal(constantRarity, 856, '每艘船 4 行的 rarity 必须一致')
  assert.ok(varyingStar >= 800, `${varyingStar}/856 艘的 4 行 star 互不相同`)
})

test('重樱 / 铁血 / META 的船名是占位符，name_code 解析后不留花括号', { skip }, () => {
  const code = buildNameCode(dir!, sha!)
  assert.equal(code.size, 439)
  const names = Object.values(dict('shipSkinTemplate'))
    .filter((s) => s.skin_type === -1)
    .map((s) => s.name as string)
  const placeholders = names.filter((n) => /\{namecode:(\d+)\}/.test(n))
  assert.equal(placeholders.length, 362, `占位规范名应为 362 条，实得 ${placeholders.length}`)
  assertAllResolve(names, code)

  // 后缀形态：整串查表会落空，必须逐处替换
  const one = resolveName('{namecode:197}(μ兵装)', code)
  assert.equal(one.misses.length, 0)
  assert.ok(!one.text.includes('{'), one.text)
  assert.ok(one.text.endsWith('(μ兵装)'), one.text)
  assert.equal(resolveName('{namecode:2}·改', code).text, '吹雪·改')
})

test('每个阵营的舰船数是回归基线，上游批量改名会先在这里露出来', { skip }, () => {
  const counts = new Map<number, number>()
  for (const g of Object.values(dict('shipGroup'))) {
    counts.set(g.nationality as number, (counts.get(g.nationality as number) ?? 0) + 1)
  }
  assert.equal(counts.get(1), 159)
  assert.equal(counts.get(3), 165)
  assert.equal(counts.get(97), 59, 'META 全部落 97')
  assert.equal(counts.get(96), 16, '飓风 16 条风帆船')
  assert.equal(counts.get(11), 3, '郁金王国 3 条')
  assert.equal(counts.get(98), 3, '布里 3 条')
  assert.ok(!counts.has(10), '鸢尾教国没有船')
})

test('ship_data_by_type 的 type_name 有重名，舰种页 slug 只能用数字键', { skip }, () => {
  const bt = dict('shipByType')
  const names = Object.values(bt).map((t) => t.type_name as string)
  const dup = names.filter((n, i) => names.indexOf(n) !== i)
  assert.deepEqual([...new Set(dup)].sort(), ['导驱', '风帆'], `重名舰种变了：${dup.join(',')}`)
  assert.equal(names.length, 21)
  assert.equal(new Set(names).size, 18, '21 个舰种只有 18 个不同显示名')
  // 数字键不连续：14/15/16 是敌方专用
  assert.deepEqual(Object.keys(bt).map(Number).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 17, 18, 19, 20, 21, 22, 23, 24])
})
