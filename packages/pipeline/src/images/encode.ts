import sharp from 'sharp'

/**
 * §3.8 的处理规格。每个产物同时是「尺寸 + 编码 + 体积上限」三件事，
 * 上限不是提示而是断言：超预算意味着上游给了张原图或规格写错了，
 * 让它在编码这一步就失败，而不是变成 R2 账单和 Pages 首屏。
 */

export interface Variant {
  /** 逻辑用途，进 images.manifest.json 与 R2 key */
  kind: 'icon' | 'portrait' | 'portraitHi' | 'shipyard' | 'lqip'
  ext: 'webp' | 'avif'
  maxWidth?: number
  quality: number
  /** 字节上限（§3.8 体积预算表的单张值） */
  maxBytes: number
}

export const VARIANTS: Record<Variant['kind'], Variant> = {
  icon: { kind: 'icon', ext: 'webp', maxWidth: 96, quality: 80, maxBytes: 20_000 },
  portrait: { kind: 'portrait', ext: 'webp', maxWidth: 600, quality: 82, maxBytes: 300_000 },
  portraitHi: { kind: 'portraitHi', ext: 'avif', maxWidth: 1200, quality: 70, maxBytes: 350_000 },
  shipyard: { kind: 'shipyard', ext: 'webp', maxWidth: 600, quality: 82, maxBytes: 80_000 },
  lqip: { kind: 'lqip', ext: 'webp', maxWidth: 24, quality: 30, maxBytes: 2_000 },
}

export interface Encoded {
  variant: Variant
  bytes: Buffer
  width: number
  height: number
}

/** EN 皮肤目录里我们认的源文件名（不含扩展名） */
export type SourceFile = 'icon' | 'painting' | 'shipyard'

/** 源文件名 → 需要的变体；立绘出三档，头像与船坞图各一档 */
export const PLAN: Record<SourceFile, Variant[]> = {
  painting: [VARIANTS.portrait, VARIANTS.portraitHi, VARIANTS.lqip],
  icon: [VARIANTS.icon],
  shipyard: [VARIANTS.shipyard],
}

export async function encode(src: Buffer, v: Variant): Promise<Encoded> {
  const img = sharp(src)
  const meta = await img.metadata()
  if (!meta.width || !meta.height) throw new Error(`${v.kind} 源图没有可读尺寸信息`)

  const resized = img.resize({
    width: v.maxWidth,
    // 源图比目标窄时不插值放大
    withoutEnlargement: true,
    fit: 'inside',
  })
  const codec = v.ext === 'avif' ? resized.avif({ quality: v.quality }) : resized.webp({ quality: v.quality })
  const bytes = await codec.toBuffer()
  const after = await sharp(bytes).metadata()

  if (bytes.length > v.maxBytes) {
    throw new Error(
      `${v.kind} 编码后 ${bytes.length} 字节，超预算 ${v.maxBytes}（源图 ${meta.width}×${meta.height}）` +
        `——规格或上游文件不对，不是「再压一下」能糊过去的`,
    )
  }
  return { variant: v, bytes, width: after.width ?? meta.width, height: after.height ?? meta.height }
}

/** 需要跑哪些变体；目录里多出来的文件名不在表内，返回空数组 */
export const variantsFor = (file: string): Variant[] =>
  (PLAN as Partial<Record<SourceFile, Variant[]>>)[file as SourceFile] ?? []

/**
 * §3.8 第 3 级兜底：内置占位图。阶段 1 只要「有合法图，绝不图裂」，
 * 舰种剪影 + 阵营配色属于阶段 3A 的占位规范。
 */
export async function placeholder(label: string, v: Variant): Promise<Encoded> {
  const w = v.maxWidth ?? 96
  // icon 是方形，其余按立绘的竖版比例
  const h = v.kind === 'icon' ? w : Math.round((w * 4) / 3)
  const text = label.slice(0, 1)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`
    + `<rect width="100%" height="100%" fill="#2b2f36"/>`
    + `<text x="50%" y="52%" fill="#8b93a1" font-size="${Math.round(w / 3)}"`
    + ` font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">${text}</text></svg>`
  return encode(Buffer.from(svg, 'utf8'), v)
}
