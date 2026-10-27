import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256Buf } from '../hash.ts'
import { getBlob, listSkinDir, resolveEnSha, type SkinDir } from './en-repo.ts'
import { encode, placeholder, variantsFor, type SourceFile, type Variant } from './encode.ts'
import { isCurrent, LocalAdapter, readImagesManifest, type ImageEntry, type ImagesManifest } from './store.ts'

/**
 * §3.8 三级回退 + 编码 + 落盘的编排。放在一个模块里是因为这三步的顺序不能分开确认：
 * 「join 上了没有」要看目录清单，「编码对不对」要看字节，
 * 分开跑就会出现「清单说命中但产物是占位图」这类自相矛盾的状态。
 */

export interface Unit {
  /** 页面引用的稳定逻辑名，见 §3.8 的 R2 key 规范 */
  logical: string
  /** join 键：CN 的 ship_skin_template.id，与 EN images/skin/{id}/ 同一命名空间 */
  skinId: number
  file: SourceFile
  /** 占位图上要显示的那个字 */
  label: string
}

/**
 * 阶段 1 的验收口径：1 艘船的 icon + 默认立绘 + 1 张换装立绘。
 * 船级 icon 取 skin_type = -1 的规范皮肤，换装取编号最小的非规范皮肤。
 */
export function unitsForShip(params: {
  groupType: number
  defaultSkinId: number
  altSkinId: number | null
  name: string
}): Unit[] {
  const { groupType, defaultSkinId, altSkinId, name } = params
  const units: Unit[] = [
    { logical: `ship/${groupType}/icon`, skinId: defaultSkinId, file: 'icon', label: name },
    { logical: `skin/${defaultSkinId}/portrait`, skinId: defaultSkinId, file: 'painting', label: name },
  ]
  if (altSkinId !== null) {
    units.push({ logical: `skin/${altSkinId}/portrait`, skinId: altSkinId, file: 'painting', label: name })
  }
  return units
}

export interface ImagesResult {
  enSha: string
  entries: ImageEntry[]
  /** 每个逻辑名 + 变体最终用了哪一级 */
  used: Array<{ logical: string; kind: Variant['kind']; source: ImageEntry['source'] }>
  /** EN 侧没有对应目录或文件，降级到占位图的条目 */
  misses: Array<{ logical: string; skinId: number; reason: string }>
  fetched: number
  skipped: number
  /** 本次没碰、原样留在清单里的条目数 */
  carried: number
}

/** override 层没有 git OID，用内容哈希顶上同一个「代次标识」位，前缀区分来源 */
const overrideOid = (buf: Buffer): string => `sha256:${sha256Buf(buf).slice(0, 40)}`

export async function buildImages(
  root: string,
  units: readonly Unit[],
  opts: { enSha?: string } = {},
): Promise<ImagesResult> {
  const enSha = opts.enSha ?? (await resolveEnSha())
  const adapter = new LocalAdapter(root)
  const prev = readImagesManifest(root)

  const dirs = new Map<number, SkinDir | null>()
  const entries: ImageEntry[] = []
  const used: ImagesResult['used'] = []
  const misses: ImagesResult['misses'] = []
  let fetched = 0
  let skipped = 0

  for (const u of units) {
    // 第 1 级：人工提供的 CN 立绘。有覆盖层就不必问 EN，一次 API 调用都不发
    const overridePath = join(root, 'data', 'manual', 'image-overrides', 'cn', `${u.skinId}.png`)
    const overrideBuf = existsSync(overridePath) ? readFileSync(overridePath) : null

    let dir: SkinDir | null = null
    if (overrideBuf === null) {
      if (!dirs.has(u.skinId)) dirs.set(u.skinId, await listSkinDir(enSha, u.skinId))
      dir = dirs.get(u.skinId) ?? null
    }
    const ref = dir?.files[u.file]
    const srcOid = overrideBuf !== null ? overrideOid(overrideBuf) : (ref?.oid ?? null)

    const variants = variantsFor(u.file)
    const cached = variants.map((v) => {
      const hit = isCurrent(prev, u.logical, v.kind, srcOid)
      return hit !== undefined && existsSync(join(root, 'data', 'images', hit.key)) ? hit : null
    })

    // 源图每个 unit 只取一次：立绘要出 600w WebP + 1200w AVIF + LQIP 三档，
    // 按变体各取一次等于把 2.1MB 的 painting.png 下载三遍。
    // 全部变体都已缓存且源 OID 没变时一张都不下载，这是 §3.8「按 OID 跳过」的落地。
    const allCached = cached.every((c) => c !== null)
    let raw: Buffer | null = null
    if (!allCached) {
      raw = overrideBuf
      if (raw === null && ref !== undefined) {
        raw = await getBlob(ref.oid)
        fetched++
      }
    }

    for (const [i, v] of variants.entries()) {
      const hit = cached[i] ?? null
      if (hit !== null) {
        entries.push(hit)
        used.push({ logical: u.logical, kind: v.kind, source: hit.source })
        skipped++
        continue
      }
      let entry: ImageEntry
      if (raw !== null) {
        entry = adapter.put(u.logical, await encode(raw, v), overrideBuf !== null ? 'override' : 'en', srcOid)
      } else {
        const reason = dir === null ? `EN 没有 images/skin/${u.skinId} 目录` : `EN 目录里没有 ${u.file}.png`
        if (!misses.some((x) => x.logical === u.logical)) misses.push({ logical: u.logical, skinId: u.skinId, reason })
        entry = adapter.put(u.logical, await placeholder(u.label, v), 'placeholder', null)
      }
      entries.push(entry)
      used.push({ logical: u.logical, kind: v.kind, source: entry.source })
    }
  }

  // 清单是全量台账：本次没碰到的逻辑名要原样留着，否则跑一次 --limit=1
  // 就把整份清单擦掉，下次同步会把几百张图重下一遍
  const touched = new Set(units.map((u) => u.logical))
  const carried = (prev?.entries ?? []).filter((e) => !touched.has(e.logical))
  const manifest: ImagesManifest = { enSha, entries: [...carried, ...entries] }
  adapter.writeManifest(manifest)
  return { enSha, entries, used, misses, fetched, skipped, carried: carried.length }
}
