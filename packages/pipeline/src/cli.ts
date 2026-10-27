import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TABLES, assertSpec, relPath, type TableKey } from './tables.ts'
import { STAGE1_TABLES, whitelistFor, STUB_PROBES } from './whitelist.ts'
import { resolveSha, downloadTarball, fetchTree, extractWhitelist, readTable, topDir } from './fetch/fetch.ts'
import { buildAttrMap, assertMatchesEnemy, assertArrayLength } from './normalize/attr-map.ts'

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
  default:
    log('用法: pipeline <--selfcheck|fetch|validate>')
    process.exitCode = 2
}
