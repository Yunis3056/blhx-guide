import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TABLES, assertSpec, relPath, type TableKey } from './tables.ts'
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
import { writeJsonl } from './normalize/jsonl.ts'

const ROOT = join(import.meta.dirname!, '..', '..', '..')
const RAW = join(ROOT, 'data', 'raw')

function log(msg: string): void {
  process.stdout.write(msg + '\n')
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
  let tree = existsSync(treePath)
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
 * 1.7 归一化三层 + 改造 + 舰队科技 → data/normalized/*.jsonl.gz
 *
 * 这一步不写 manifest（1.8），但已经带上全部 join 断言：任何一侧对不上就中止，
 * 产出的文件永远是「完整且自洽」的，不会出现在线页面缺半列的情况。
 */
function cmdNormalize(): void {
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
  const rarityLabels = new Map(buildShipRarity(tip, decl.ship.declaredDomain).map((r) => [r.value, r.label]))
  const nameCode = buildNameCode(root, sha)

  const fleet = buildFleetTech(root, sha)
  const built = buildShipRecords(root, sha, {
    attrMap,
    rarityLabels,
    factions: factionMap(factions),
    factionNames,
    nameCode,
    fleetTechClassByGroup: fleet.classByGroup,
    fleetTechClassNationByGroup: fleet.classNationByGroup,
  })
  const retrofits = buildRetrofits(root, sha)

  const files = [
    { name: 'ships.jsonl.gz', rows: built.ships },
    { name: 'ship-stages.jsonl.gz', rows: built.stages },
    { name: 'ship-skins.jsonl.gz', rows: built.skins },
    { name: 'ship-retrofits.jsonl.gz', rows: retrofits },
    { name: 'fleet-tech.jsonl.gz', rows: fleet.rows },
  ]
  const written: Array<{ file: string; rows: number; bytes: number }> = []
  for (const f of files) written.push({ file: f.name, ...writeJsonl(outDir, f.name, f.rows) })
  const quarantineFile = writeJsonl(reportDir, 'quarantine.jsonl.gz', built.quarantine)

  // 基线：这些数字是实测值，掉了就是上游或我们的 join 变了，必须有人来看
  const baselines: Array<[string, number, number]> = [
    ['ships', built.ships.length, 859],
    ['ship-stages', built.stages.length, 3429],
    ['ship-skins', built.skins.length, 2730],
    ['ship-retrofits', retrofits.length, 106],
    ['fleet-tech-group', fleet.counts.groups, 4],
    ['fleet-tech-node', fleet.counts.nodes, 36],
    ['fleet-tech-ship', fleet.counts.ships, 726],
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
  log(`  隔离清单 ${quarantineFile.rows} 条 → reports/quarantine.jsonl.gz`)
  for (const w of written) log(`  ${w.file.padEnd(26)} ${String(w.rows).padStart(5)} 行  ${(w.bytes / 1024).toFixed(1)} KB gz`)
  if (process.exitCode !== 1) log('PASS：三层 + 改造 + 舰队科技落盘，join 断言全通过')
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
    cmdNormalize()
    break
  default:
    log('用法: pipeline <--selfcheck|fetch|validate|normalize>')
    process.exitCode = 2
}
