import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { sha256Buf } from '../hash.ts'
import type { Encoded, Variant } from './encode.ts'

/**
 * 产物的落盘与清单。LocalAdapter 是 §8.5 无图模式下的唯一适配器：
 * 只写 `data/images/`（不入库），清单 `data/images.manifest.json` 入库。
 *
 * 清单里不写墙上时间——理由与 manifest.json 一样：它进 `web#build` 的输入指纹，
 * 掺时间戳等于「图没变也整站重建」。可复现性靠 `enSha` + 每个条目的源 blob OID。
 */

export type ImageSource = 'en' | 'override' | 'placeholder'

export interface ImageEntry {
  /** 逻辑名，页面代码引用它，跨版本稳定 */
  logical: string
  kind: Variant['kind']
  ext: Variant['ext']
  source: ImageSource
  /** EN 侧 git blob OID；占位图没有源，记 null */
  srcOid: string | null
  /** 编码后内容的 8 位哈希，进文件名做 immutable 缓存 */
  hash8: string
  /** 完整 key，例如 skin/205020/portrait.ab12cd34.webp */
  key: string
  bytes: number
  width: number
  height: number
}

export interface ImagesManifest {
  /** 取图用的 EN 仓库 commit SHA —— 整份清单的来源代次 */
  enSha: string
  entries: ImageEntry[]
}

export const hash8Of = (buf: Buffer): string => sha256Buf(buf).slice(0, 8)

/** §3.8 的 R2 key 规范：目录段来自逻辑名，文件名带内容哈希 */
export function keyFor(logical: string, v: Variant, hash8: string): string {
  const m = /^(.*)\/([^/]+)$/.exec(logical)
  if (!m) throw new Error(`逻辑名必须形如 目录/名字，实得 ${logical}`)
  return `${m[1]}/${m[2]}.${hash8}.${v.ext}`
}

export function manifestPathFor(root: string): string {
  return join(root, 'data', 'images.manifest.json')
}

export function readImagesManifest(root: string): ImagesManifest | null {
  const p = manifestPathFor(root)
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf8')) as ImagesManifest
}

/**
 * 增量判定：同一逻辑名 + 同一个源 OID 且哈希没变，就跳过大图下载。
 * 这是 §3.8「用 OID 而不是内容哈希做增量」的落地——不下载就没法算内容哈希，
 * 但比对 OID 只需要目录清单。
 */
export const isCurrent = (
  prev: ImagesManifest | null,
  logical: string,
  kind: Variant['kind'],
  srcOid: string | null,
): ImageEntry | undefined =>
  prev?.entries.find((e) => e.logical === logical && e.kind === kind && e.srcOid === srcOid)

export class LocalAdapter {
  readonly root: string

  constructor(root: string) {
    this.root = root
  }

  /** 返回写入后的条目；同 key 已存在则不重复写（幂等） */
  put(logical: string, enc: Encoded, source: ImageSource, srcOid: string | null): ImageEntry {
    const hash8 = hash8Of(enc.bytes)
    const key = keyFor(logical, enc.variant, hash8)
    const abs = join(this.root, 'data', 'images', key)
    if (!existsSync(abs)) {
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, enc.bytes)
    }
    return {
      logical,
      kind: enc.variant.kind,
      ext: enc.variant.ext,
      source,
      srcOid,
      hash8,
      key,
      bytes: enc.bytes.length,
      width: enc.width,
      height: enc.height,
    }
  }

  /** 上云时换成 R2Adapter（PUT + 按 OID 跳过），调用方不需要知道目的端 */
  urlOf(key: string): string {
    return `/images/${key}`
  }

  writeManifest(m: ImagesManifest): string {
    const entries = [...m.entries].sort((a, b) => (a.logical < b.logical ? -1 : a.logical > b.logical ? 1 : a.kind.localeCompare(b.kind)))
    const p = manifestPathFor(this.root)
    writeFileSync(p, JSON.stringify({ enSha: m.enSha, entries }, null, 2) + '\n', { encoding: 'utf8' })
    return p
  }
}
