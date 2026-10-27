import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TABLES, assertSpec, relPath, type TableKey } from './tables.ts'
import { buildDatabase, readJsonl, FILES } from './store/build.ts'
import type { ShipRecord, ShipSkinRecord } from './normalize/ship.ts'
import { buildImages, unitsForShip, type Unit } from './images/pipeline.ts'
import { enRepoId } from './images/en-repo.ts'
import { STAGE1_TABLES, whitelistFor, STUB_PROBES } from './whitelist.ts'
import { resolveSha, downloadTarball, fetchTree, extractWhitelist, readTable, topDir } from './fetch/fetch.ts'
import { buildAttrMap, assertMatchesEnemy, assertArrayLength } from './normalize/attr-map.ts'
import { manualPath } from './paths.ts'
import { buildNameCode, assertAllResolve, placeholderCount } from './normalize/name-code.ts'
import { readShipRows, groupStageRows, rarityBySkin, assertStageShape } from './normalize/stage-rows.ts'
import { readGametip } from './display/gametip.ts'
import { loadFactions, assertNamesAgreeWithGametip, assertCovers, factionMap } from './display/factions.ts'
import { loadRarityDecl, buildShipRarity, assertObservedRarity } from './display/rarity.ts'
import { buildShipRecords } from './normalize/ship.ts'
import { buildRetrofits } from './normalize/retrofit.ts'
import { buildFleetTech } from './normalize/fleet-tech.ts'
import { buildEnumRows } from './normalize/enums.ts'
import { deriveHexagonAxes } from './normalize/hexagon.ts'
import { writeJsonl } from './normalize/jsonl.ts'
import { readManifest, writeManifest, assertSameGeneration, type ManifestFileEntry } from './manifest.ts'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const RAW = join(ROOT, 'data', 'raw')

function log(msg: string): void {
  process.stdout.write(msg + '\n')
}

/** `--k v` 与 `--k=v` 都认：PLAN 里的调用示例写的是 `--limit=1`，只支持一种写法就是自找故障 */
function flagValue(argv: readonly string[], name: string): string | null {
  const eq = argv.find((a) => a.startsWith(`${name}=`))
  if (eq !== undefined) return eq.slice(name.length + 1)
  const i = argv.indexOf(name)
  return i >= 0 ? (argv[i + 1] ?? null) : null
}

const intFlag = (argv: readonly string[], name: string, def: number): number => {
  const raw = flagValue(argv, name)
  if (raw === null) return def
  const n = Number(raw)
  if (!Number.isInteger(n)) throw new Error(`${name} 需要整数，实得 ${raw}`)
  return n
}

async function cmdFetch(): Promise<void> {
  mkdirSync(RAW, { recursive: true })
  const t0 = Date.now()

  log('1/4 commits API 解析分支 SHA …')
  const sha = await resolveSha('main')
  log(`    SHA = ${sha}`)

  const shaDir = join(RAW, sha)
  mkdirSync(shaDir, { recursive: true })
  const tgz = join(shaDir, `${topDir(sha)}.tar.gz`)

  log('2/4 按 SHA 下载 codeload tarball …')
  if (existsSync(tgz)) {
    log(`    已存在，跳过下载：${tgz}`)
  } else {
    const bytes = await downloadTarball(sha, tgz)
    log(`    ${bytes.toLocaleString()} 字节，${((Date.now() - t0) / 1000).toFixed(1)}s`)
  }

  log('3/4 Trees API 取全树 blob OID …')
  const treePath = join(shaDir, 'tree-index.json')
  const tree = existsSync(treePath)
    ? (JSON.parse(readFileSync(treePath, 'utf8')) as Awaited<ReturnType<typeof fetchTree>>)
    : await fetchTree(sha)
  if (!existsSync(treePath)) writeFileSync(treePath, JSON.stringify(tree), { encoding: 'utf8' })
  log(`    ${tree.length} 条 tree 记录`)

  log('4/4 选择性解包白名单 …')
  const wl = whitelistFor(STAGE1_TABLES)
  const oids = extractWhitelist({ tgzPath: tgz, sha, whitelist: wl, tree, outRoot: shaDir })
  log(`    解出 ${Object.keys(oids).length} / ${wl.length} 个白名单文件`)

  // 负向探针：ShareCfg 侧空壳。解出来只为让回归测试证明注册表确实拦得住
  extractWhitelist({ tgzPath: tgz, sha, whitelist: STUB_PROBES, tree, outRoot: shaDir })

  const meta = { sha, fetchedAt: new Date().toISOString(), whitelist: wl, oids }
  writeFileSync(join(shaDir, 'fetch-meta.json'), JSON.stringify(meta, null, 2), { encoding: 'utf8' })
  writeFileSync(join(RAW, 'CURRENT_SHA'), sha, { encoding: 'utf8' })
  log(`完成：${shaDir}`)
}

function currentSha(): string {
  const p = join(RAW, 'CURRENT_SHA')
  if (!existsSync(p)) throw new Error('尚未取数：data/raw/CURRENT_SHA 不存在，先跑 fetch')
  return readFileSync(p, 'utf8').trim()
}

async function cmdValidate(): Promise<void> {
  const sha = currentSha()
  log(`校验固定提交 ${sha.slice(0, 12)} 的白名单表 …`)
  const rows: Array<{ key: TableKey; path: string; entries: number; minRows: number | null }> = []
  const failures: string[] = []

  for (const key of STAGE1_TABLES) {
    const spec = TABLES[key]
    const rel = relPath(spec)
    let raw: unknown
    try {
      raw = readTable(join(RAW, sha), sha, rel)
    } catch (e) {
      failures.push(`${key}: ${(e as Error).message}`)
      continue
    }
    try {
      const keys = assertSpec(raw, spec)
      rows.push({ key, path: rel, entries: keys.length, minRows: spec.minRows ?? null })
    } catch (e) {
      failures.push(`${key}: ${(e as Error).message}`)
    }
  }

  log('')
  log('表条目数（★ = 已实测并有阈值）')
  for (const r of rows) {
    const spec = TABLES[r.key]
    const mark = spec.measured ? '★' : ' '
    log(
      `  ${r.key.padEnd(24)} ${String(r.entries).padStart(6)}  ` +
        `${r.minRows === null ? '(未设阈值)' : `阈值 ${r.minRows}`} ${mark}  ${spec.dir}/${spec.name}`,
    )
  }

  if (failures.length > 0) {
    log('')
    log('FAIL：')
    for (const f of failures) log('  - ' + f)
    process.exitCode = 1
    return
  }
  log('')
  log(`PASS：${rows.length} 张表全部通过目录、顶层类型、键策略与条目数下限断言`)

  // 属性映射：由定义表生成，并与敌方具名字段交叉断言（§1.5）
  const root = join(RAW, sha)
  const map = buildAttrMap(root, sha)
  assertMatchesEnemy(root, sha, map)
  const stats = readTable(root, sha, relPath(TABLES.shipStats))
  assertArrayLength(
    map,
    Object.values(stats as Record<string, Record<string, unknown>>),
  )
  log('')
  log('属性位置映射（生成自 attribute_info_by_type，非硬编码）')
  for (const a of map.attrs) {
    log(`  [${String(a.index).padStart(2)}] ${a.name.padEnd(13)} ${a.label}  (id ${a.id})`)
  }
  log('PASS：与 enemy_data_statistics 具名字段键集一致；三个舰船数组定长 12 校验通过')

  // ── 1.6 阵营与稀有度：人工表只钉「数字 → 身份」这一跳，文本一律回到上游比对 ──
  const tip = readGametip(root, sha)
  const factions = loadFactions(manualPath(ROOT, 'factions'))
  assertNamesAgreeWithGametip(factions, tip)
  const grpRaw = readTable(root, sha, relPath(TABLES.shipGroup)) as Record<string, { nationality: number }>
  const observedNat = Object.values(grpRaw).map((g) => g.nationality)
  assertCovers(factions, observedNat)

  const decl = loadRarityDecl(manualPath(ROOT, 'rarity'))
  const shipRarity = buildShipRarity(tip, decl.ship.declaredDomain)
  const shipRows = readShipRows(root, sha)
  const shape = assertStageShape(shipRows, { stageRows: 3400, others: 0, skins: 850, exactlyFour: 850 })
  const groups = groupStageRows(shipRows)
  const rarBySkin = rarityBySkin(groups)
  const rarObs = new Map<number, number>()
  for (const r of rarBySkin.values()) rarObs.set(r, (rarObs.get(r) ?? 0) + 1)
  assertObservedRarity(rarObs, decl.ship)

  const nameCode = buildNameCode(root, sha)
  const skinRaw = readTable(root, sha, relPath(TABLES.shipSkinTemplate)) as Record<string, { skin_type: number; name: string }>
  const baseNames = Object.values(skinRaw).filter((s) => s.skin_type === -1).map((s) => s.name)
  assertAllResolve(baseNames, nameCode)

  const perNat = new Map<number, number>()
  for (const n of observedNat) perNat.set(n, (perNat.get(n) ?? 0) + 1)
  log('')
  log(`阵营（${factions.length} 条登记 / ship_data_group 实出 ${perNat.size} 个值）`)
  for (const f of factions) {
    const c = perNat.get(f.nationality) ?? 0
    log(`  ${String(f.nationality).padStart(3)} ${f.slug.padEnd(26)} ${f.name.padEnd(12)} ${String(c).padStart(4)} 条  ${f.source}`)
  }
  log('')
  log(
    `舰船稀有度（阶段行 ${shape.stageRows} 行 / ${shape.skins} 个 skin_id，其中 ${shape.exactlyFour} 组正好 4 行；` +
      `非阶段行 ${shape.others} 行不参与）`,
  )
  for (const r of shipRarity) {
    log(`  ${r.value} ${r.label.padEnd(6)} ${rarObs.get(r.value) ?? 0} 艘`)
  }
  for (const k of decl.ship.knownUnmapped) {
    log(`  ${k.value} （无标签，${rarObs.get(k.value) ?? 0} 行）→ ${k.handling}`)
  }
  log(`装备稀有度 ${decl.equip.declaredDomain.join('/')} 档，labelPolicy=${decl.equip.labelPolicy}（CN 数据无文本源）`)
  log('')
  log(`船名解析：规范名 ${baseNames.length} 条，其中占位 ${placeholderCount(baseNames)} 条，name_code ${nameCode.size} 条全命中`)
  log('PASS：阵营覆盖与文本、稀有度取值域两侧对齐、船名占位全解析')
}

/**
 * 1.8 emit：manifest.json + data/al.sqlite
 *
 * 建库只读已提交的 data/normalized/，不碰 data/raw —— raw 不入库，Pages 构建机上
 * 没有它。所以这条命令能在干净检出后单独跑通，本身就是「站点数据自洽可重建」的证明。
 */
function cmdEmit(): void {
  const normDir = join(ROOT, 'data', 'normalized')
  const dbPath = join(ROOT, 'data', 'al.sqlite')
  const manifest = readManifest(normDir)
  // manifest 与 jsonl 都是入库文件；这一步保证二者同代，否则旧 jsonl 配新表会静默出错页
  const files = assertSameGeneration(manifest, normDir)

  const built = buildDatabase(normDir, dbPath, manifest.dataSha)

  log(`emit → ${dbPath}`)
  for (const [t, n] of Object.entries(built.counts)) log(`  ${t.padEnd(20)} ${String(n).padStart(6)} 行`)
  log(
    `  快照：seq ${manifest.snapshotSeq} · dataSha ${manifest.dataSha.slice(0, 12)} · ${files.length} 个 jsonl（sha256 已核对）`,
  )
}

/**
 * 1.9 图片本地链路：skinId 精确 join EN 源 → 三级回退 → sharp 编码 → LocalAdapter。
 *
 * 只在本地与 en-images-sync 作业里跑，绝不进构建链（核心原则 2）。
 * 授权门槛（§8.5）未过之前产物只落在 data/images/（不入库），清单落 data/images.manifest.json。
 */
async function cmdImages(argv: string[]): Promise<void> {
  const limit = intFlag(argv, '--limit', 1)
  if (limit < 1) throw new Error(`--limit 必须是正整数，实得 ${limit}`)
  const onlyGroup = intFlag(argv, '--group', -1)

  const normDir = join(ROOT, 'data', 'normalized')
  const ships = readJsonl<ShipRecord>(normDir, FILES.ships).sort((a, b) => a.groupType - b.groupType)
  const skins = readJsonl<ShipSkinRecord>(normDir, FILES.skins)
  const skinsByGroup = new Map<number, ShipSkinRecord[]>()
  for (const s of skins) {
    const list = skinsByGroup.get(s.groupType)
    if (list) list.push(s)
    else skinsByGroup.set(s.groupType, [s])
  }

  const targets =
    onlyGroup < 0 ? ships.slice(0, limit) : ships.filter((s) => s.groupType === onlyGroup)
  if (targets.length === 0) {
    throw new Error(onlyGroup < 0 ? 'normalized 里没有舰船记录' : `group_type ${onlyGroup} 不在图鉴里`)
  }

  const units: Unit[] = []
  for (const t of targets) {
    if (t.defaultSkinId === null) throw new Error(`group ${t.groupType}（${t.name}）没有 skin_type=-1 的规范皮肤`)
    const alt = (skinsByGroup.get(t.groupType) ?? [])
      .filter((s) => s.skinId !== t.defaultSkinId)
      .sort((a, b) => a.skinId - b.skinId)[0]
    units.push(
      ...unitsForShip({
        groupType: t.groupType,
        defaultSkinId: t.defaultSkinId,
        altSkinId: alt?.skinId ?? null,
        name: t.name,
      }),
    )
  }

  const res = await buildImages(ROOT, units)
  log(`图片源：${enRepoId} @ ${res.enSha.slice(0, 12)}（先锁 SHA 再按 OID 取内容）`)
  for (const e of res.entries) {
    const dims = `${e.width}×${e.height}`
    const kb = (e.bytes / 1024).toFixed(1)
    log(`  ${e.logical.padEnd(26)} ${e.kind.padEnd(11)} ${dims.padEnd(11)} ${kb.padStart(7)} KB  ${e.source.padEnd(11)} ${e.key}`)
  }
  log(
    `  下载 ${res.fetched} 张，跳过（OID 未变）${res.skipped} 项，降级占位 ${res.misses.length} 项，清单沿用 ${res.carried} 条`,
  )
  for (const m of res.misses) log(`  MISS ${m.logical}（skinId ${m.skinId}）：${m.reason}`)
  log(`  清单 → data/images.manifest.json（台账共 ${res.entries.length + res.carried} 条，无时间戳）`)
}

/**
 * 1.7 归一化三层 + 改造 + 舰队科技 → data/normalized/*.jsonl.gz + manifest.json
 *
 * 这一步带上全部 join 断言：任何一侧对不上就中止，产出的文件永远是「完整且自洽」的，
 * 不会出现在线页面缺半列的情况。人工表（data/manual）只在这里被消费。
 */
function cmdNormalize(argv: string[]): void {
  const seq = intFlag(argv, '--seq', 0)
  if (seq < 0) throw new Error(`--seq 必须是非负整数，实得 ${seq}`)

  const sha = currentSha()
  const root = join(RAW, sha)
  const outDir = join(ROOT, 'data', 'normalized')
  const reportDir = join(ROOT, 'reports')

  const attrMap = buildAttrMap(root, sha)
  const tip = readGametip(root, sha)
  const factions = loadFactions(manualPath(ROOT, 'factions'))
  assertNamesAgreeWithGametip(factions, tip)
  assertCovers(
    factions,
    Object.values(readTable(root, sha, relPath(TABLES.shipGroup)) as Record<string, { nationality: number }>).map(
      (g) => g.nationality,
    ),
  )
  const factionNames = new Map<number, string>()
  for (const f of factions) {
    const t = tip[`word_shipNation_${f.wordKey}`]?.tip
    if (t === undefined) throw new Error(`阵营 ${f.nationality} 的词键 word_shipNation_${f.wordKey} 在 gametip 里不存在`)
    factionNames.set(f.nationality, t)
  }
  const decl = loadRarityDecl(manualPath(ROOT, 'rarity'))
  const shipRarity = buildShipRarity(tip, decl.ship.declaredDomain)
  const rarityLabels = new Map(shipRarity.map((r) => [r.value, r.label]))
  const nameCode = buildNameCode(root, sha)

  const hullRaw = readTable(root, sha, relPath(TABLES.shipByType)) as Record<string, { type_name: string; team_type: string }>
  const hulls = new Map<number, { typeName: string; teamType: string }>()
  for (const [k, v] of Object.entries(hullRaw)) {
    if (!/^\d+$/.test(k)) continue
    hulls.set(Number(k), { typeName: String(v.type_name), teamType: String(v.team_type) })
  }
  const equipRaw = readTable(root, sha, relPath(TABLES.equipByType)) as Record<string, { type_name?: string; type_name2?: string }>
  const equipKinds = new Map<number, { typeName: string; typeName2: string }>()
  for (const [k, v] of Object.entries(equipRaw)) {
    if (!/^\d+$/.test(k)) continue // 'all' 这类汇总键
    equipKinds.set(Number(k), { typeName: String(v.type_name ?? ''), typeName2: String(v.type_name2 ?? '') })
  }

  const fleet = buildFleetTech(root, sha)
  const built = buildShipRecords(root, sha, {
    attrMap,
    rarityLabels,
    factions: factionMap(factions),
    factionNames,
    nameCode,
    fleetTechClassByGroup: fleet.classByGroup,
    fleetTechClassNationByGroup: fleet.classNationByGroup,
    equipKindIds: new Set(equipKinds.keys()),
  })

  // 六维轴名不写死：拿每条船最高阶段行的 12 项属性与它的六个字母做相关，逐位取最大项
  const bestAttrs = new Map<number, { stage: number; attrs: Record<string, number> }>()
  for (const s of built.stages) {
    const cur = bestAttrs.get(s.groupType)
    if (cur === undefined || s.stage > cur.stage) bestAttrs.set(s.groupType, { stage: s.stage, attrs: s.attrs })
  }
  const hexagonSamples = built.ships
    .map((ship) => ({ groupType: ship.groupType, letters: ship.hexagon, attrs: bestAttrs.get(ship.groupType)?.attrs ?? {} }))
    .filter((s) => Object.keys(s.attrs).length > 0)
  const hexagonAxes = deriveHexagonAxes(
    hexagonSamples,
    attrMap.attrs.map((a) => a.name),
    new Map(attrMap.attrs.map((a) => [a.name, a.label])),
  )

  const enums = buildEnumRows(attrMap, shipRarity, hulls, factions, factionNames, equipKinds, hexagonAxes)

  const retrofits = buildRetrofits(root, sha)

  const files = [
    { name: 'ships.jsonl.gz', rows: built.ships },
    { name: 'ship-stages.jsonl.gz', rows: built.stages },
    { name: 'ship-skins.jsonl.gz', rows: built.skins },
    { name: 'ship-slots.jsonl.gz', rows: built.slots },
    { name: 'ship-skills.jsonl.gz', rows: built.skills },
    { name: 'ship-retrofits.jsonl.gz', rows: retrofits },
    { name: 'fleet-tech.jsonl.gz', rows: fleet.rows },
    { name: 'enums.jsonl.gz', rows: enums.rows },
  ]
  const written: Array<ManifestFileEntry & { file: string }> = []
  for (const f of files) written.push({ file: f.name, ...writeJsonl(outDir, f.name, f.rows) })
  const quarantineFile = writeJsonl(reportDir, 'quarantine.jsonl.gz', built.quarantine)

  // manifest 只在这一步生成，且字段全由数据内容决定：时间戳不进 normalized，
  // 否则它作为构建指纹会让「数据没变」也触发整站重建
  const tableDirs: Record<string, string> = {}
  for (const key of STAGE1_TABLES) tableDirs[TABLES[key].name] = TABLES[key].dir
  writeManifest(outDir, {
    dataSha: sha,
    snapshotSeq: seq,
    server: 'CN',
    tier: ['A'],
    files: Object.fromEntries(written.map((w) => [w.file, { rows: w.rows, bytes: w.bytes, sha256: w.sha256 }])),
    tableDirs,
  })

  // 基线：这些数字是实测值，掉了就是上游或我们的 join 变了，必须有人来看
  const baselines: Array<[string, number, number]> = [
    ['ships', built.ships.length, 859],
    ['ship-stages', built.stages.length, 3427],
    ['ship-skins', built.skins.length, 2730],
    ['ship-retrofits', retrofits.length, 106],
    ['fleet-tech-group', fleet.counts.groups, 4],
    ['fleet-tech-node', fleet.counts.nodes, 36],
    ['fleet-tech-ship', fleet.counts.ships, 726],
    ['enum-attr', enums.counts.attr, 12],
    ['enum-rarity', enums.counts.rarity, 5],
    ['enum-hull', enums.counts.hull, 21],
    ['enum-faction', enums.counts.faction, 29],
    ['enum-equip-kind', enums.counts.equipKind, 19],
    ['enum-hexagon-axis', enums.counts.hexagonAxis, 6],
    ['ship-slots', built.slots.length, 17135],
    ['ship-skills', built.skills.length, 9239],
  ]
  log(`归一化 ${sha.slice(0, 12)} → data/normalized/`)
  for (const b of baselines) {
    const mark = b[1] === b[2] ? 'ok' : `≠ 基线 ${b[2]}`
    log(`  ${b[0].padEnd(18)} ${String(b[1]).padStart(5)}  ${mark}`)
    if (b[1] !== b[2]) process.exitCode = 1
  }
  const noRarity = built.ships.filter((s) => s.rarity === null).length
  const noFaction = built.ships.filter((s) => !s.factionName).length
  const groups = new Set(built.ships.map((s) => s.groupType))
  const orphanSkins = built.skins.filter((s) => !groups.has(s.groupType)).length
  log(`  舰船无稀有度 ${noRarity} · 无阵营名 ${noFaction} · 孤儿皮肤 ${orphanSkins}（孤儿只登记不建页）`)
  log(`  六维轴定位（相关取最大项，非属性 id 顺序）：${hexagonAxes.map((a) => `${a.pos}=${a.label}`).join(' ')}`)
  log(`  隔离清单 ${quarantineFile.rows} 条 → reports/quarantine.jsonl.gz`)
  for (const w of written) log(`  ${w.file.padEnd(26)} ${String(w.rows).padStart(5)} 行  ${(w.bytes / 1024).toFixed(1)} KB gz`)
  log(`  manifest.json：seq ${seq} · ${written.length} 个 jsonl 的 sha256 已登记`)
  if (process.exitCode !== 1) log('PASS：三层 + 技能 + 装备位 + 改造 + 舰队科技落盘，join 断言全通过')
}

/**
 * 构建期自检：不联网、不读原始数据，只验证注册表自身的一致性。
 * turbo 的 pipeline#build 跑这个，让「注册表写错」在 emit 之前就暴露。
 */
function cmdSelfcheck(): void {
  const seenPath = new Map<string, TableKey>()
  const problems: string[] = []
  for (const entry of Object.entries(TABLES) as Array<[TableKey, (typeof TABLES)[TableKey]]>) {
    const [key, spec] = entry
    const p = relPath(spec)
    const prev = seenPath.get(p)
    if (prev) problems.push(`${key} 与 ${prev} 指向同一路径 ${p}`)
    seenPath.set(p, key)
    if (spec.measured && spec.minRows === undefined) {
      problems.push(`${key}: measured:true 缺 minRows`)
    }
    if (!spec.measured && spec.minRows !== undefined) {
      problems.push(`${key}: 未实测却设了 minRows`)
    }
    if (!spec.semantic || !spec.evidence) {
      problems.push(`${key}: semantic / evidence 必须都非空`)
    }
  }
  if (problems.length > 0) {
    for (const p of problems) log('FAIL ' + p)
    process.exitCode = 1
    return
  }
  log(`PASS：${Object.keys(TABLES).length} 条表注册，路径无重复，阈值与实测状态一致`)
}

const cmd = process.argv[2]
switch (cmd) {
  case 'fetch':
    await cmdFetch()
    break
  case '--selfcheck':
    cmdSelfcheck()
    break
  case 'validate':
    await cmdValidate()
    break
  case 'normalize':
    cmdNormalize(process.argv.slice(2))
    break
  case 'emit':
    cmdEmit()
    break
  case 'images':
    await cmdImages(process.argv.slice(2))
    break
  default:
    log('用法: pipeline <--selfcheck|fetch|validate|normalize [--seq N]|emit|images [--limit N|--group G]>')
    process.exitCode = 2
}
