import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256File } from './hash.ts'

/**
 * `data/normalized/manifest.json` 的契约。
 *
 * 这个文件是「已提交数据」与「构建期」之间唯一的接线点：normalize 写它，
 * emit 读它。因此 emit 不必（也不能）碰 `data/raw/`——raw 不入库，
 * CI 与 Pages 的检出里根本没有它。
 *
 * 字段全部由数据内容决定，不放任何墙上时间：`data/normalized/**` 是 turbo 的
 * 输入指纹，掺时间戳就等于「每天重建一次站点，即使一个字节都没变」。
 * 同步时刻记在 `data/snapshots/index.json` 台账里，那里没人拿它当指纹。
 */

export interface ManifestFileEntry {
  rows: number
  bytes: number
  sha256: string
}

export interface Manifest {
  /** 本次快照的上游 commit SHA；emit 用它交叉核对每个 jsonl 的 sha256 */
  dataSha: string
  snapshotSeq: number
  server: 'CN'
  tier: string[]
  files: Record<string, ManifestFileEntry>
  /** 表名 → 上游目录，用于事后追溯某列数据来自哪张表 */
  tableDirs: Record<string, string>
}

export const manifestPath = (normDir: string): string => join(normDir, 'manifest.json')

/** 两侧共用：写侧不让坏 manifest 落盘，读侧不让被人改过的 manifest 溜进构建 */
function assertShape(m: Manifest, side: string): void {
  if (!/^[0-9a-f]{40}$/.test(String(m.dataSha))) {
    throw new Error(`manifest.dataSha 不是 40 位十六进制（${side}）：${String(m.dataSha)}`)
  }
  if (!Number.isInteger(m.snapshotSeq) || m.snapshotSeq < 0) {
    throw new Error(`manifest.snapshotSeq 必须是非负整数（${side}），实得 ${String(m.snapshotSeq)}`)
  }
  if (Object.keys(m.files).length === 0) {
    throw new Error(`manifest.files 是空的（${side}）：没有 jsonl 就没有可构建的数据`)
  }
}

export function writeManifest(normDir: string, m: Manifest): void {
  assertShape(m, '写入')
  writeFileSync(manifestPath(normDir), JSON.stringify(m, null, 2) + '\n', { encoding: 'utf8' })
}

/**
 * 读侧断言。入库文件可能被人工改过，缺字段或文件集合对不上时必须中止：
 * 症状是「构建成功但页面用的是旧数据」，报错反而最好认。
 */
export function readManifest(normDir: string): Manifest {
  const p = manifestPath(normDir)
  if (!existsSync(p)) {
    throw new Error(`缺 ${p}。manifest.json 由 pipeline#normalize 生成并入库，构建期只读不写`)
  }
  const m = JSON.parse(readFileSync(p, 'utf8')) as Manifest
  assertShape(m, '读回')
  return m
}

/**
 * manifest 与磁盘上的 jsonl 必须同代。两者都是入库文件，只改其一
 * 「页面用的是旧数据」就毫无征兆，所以把它变成构建期硬错误。
 * 返回核对通过的文件名（排序后）。
 */
export function assertSameGeneration(m: Manifest, normDir: string): string[] {
  const onDisk = readdirSync(normDir).filter((n) => n.endsWith('.jsonl.gz')).sort()
  const declared = Object.keys(m.files).sort()
  if (onDisk.join(',') !== declared.join(',')) {
    throw new Error(
      `normalized 文件集合与 manifest 登记不一致\n  磁盘: ${onDisk.join(', ')}\n  登记: ${declared.join(', ')}`,
    )
  }
  const stale = declared.filter((n) => sha256File(join(normDir, n)) !== m.files[n]?.sha256)
  if (stale.length > 0) {
    throw new Error(`这 ${stale.length} 个 jsonl 与 manifest 的 sha256 不符，请先重跑 normalize：${stale.join(', ')}`)
  }
  return declared
}
