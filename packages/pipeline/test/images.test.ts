import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { buildImages, type Unit } from '../src/images/pipeline.ts'
import { encode, placeholder, variantsFor, VARIANTS } from '../src/images/encode.ts'
import { hash8Of, isCurrent, keyFor, LocalAdapter, readImagesManifest, type ImageEntry } from '../src/images/store.ts'

async function samplePng(width: number, height: number): Promise<Buffer> {
  // 噪声图：接近真实立绘的压缩难度，预算断言才有意义（纯色图压出来几百字节，任何预算都过）
  const noise = Buffer.alloc(width * height * 3)
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) & 0xff
  return sharp(noise, { raw: { width, height, channels: 3 } }).png().toBuffer()
}

test('R2 key 规范：目录/名字.哈希8位.扩展名', () => {
  const hash = hash8Of(Buffer.from('abc', 'utf8'))
  assert.equal(hash.length, 8)
  assert.equal(keyFor('skin/205020/portrait', VARIANTS.portrait, hash), `skin/205020/portrait.${hash}.webp`)
  assert.equal(keyFor('ship/20502/icon', VARIANTS.icon, hash), `ship/20502/icon.${hash}.webp`)
  assert.throws(() => keyFor('portrait', VARIANTS.portrait, hash), /逻辑名必须形如/)
})

test('一份立绘源图出三档，目录里的其他文件不多产产物', () => {
  const kinds = variantsFor('painting').map((v) => v.kind)
  assert.deepEqual(kinds, ['portrait', 'portraitHi', 'lqip'])
  assert.deepEqual(variantsFor('qicon'), [])
  assert.deepEqual(variantsFor('banner'), [])
})

test('体积预算是硬失败，不是警告', async () => {
  const src = await samplePng(800, 1200)
  const tight = { kind: 'portrait' as const, ext: 'webp' as const, maxWidth: 600, quality: 82, maxBytes: 200 }
  await assert.rejects(() => encode(src, tight), /超预算/)
  const ok = await encode(src, VARIANTS.portrait)
  assert.ok(ok.bytes.length <= VARIANTS.portrait.maxBytes)
  assert.equal(ok.width, 600)
})

test('源图窄于目标时不插值放大', async () => {
  const small = await samplePng(120, 160)
  const enc = await encode(small, VARIANTS.portraitHi)
  assert.equal(enc.width, 120)
})

test('占位图按用途给比例，且在预算内', async () => {
  const icon = await placeholder('厌', VARIANTS.icon)
  assert.equal(icon.width, 96)
  assert.equal(icon.height, 96)
  const portrait = await placeholder('厌', VARIANTS.portrait)
  assert.equal(portrait.height, 800)
})

test('同 OID 且产物在盘上就跳过下载；OID 变了必须重来', () => {  const entry: ImageEntry = {
    logical: 'skin/205020/portrait',
    kind: 'portrait',
    ext: 'webp',
    source: 'en',
    srcOid: 'oid-1',
    hash8: 'aaaaaaaa',
    key: 'skin/205020/portrait.aaaaaaaa.webp',
    bytes: 1,
    width: 600,
    height: 800,
  }
  const manifest = { enSha: 'e'.repeat(40), entries: [entry] }
  assert.equal(isCurrent(manifest, entry.logical, 'portrait', 'oid-1')?.hash8, 'aaaaaaaa')
  assert.equal(isCurrent(manifest, entry.logical, 'portrait', 'oid-2'), undefined)
  assert.equal(isCurrent(manifest, 'skin/205021/portrait', 'portrait', 'oid-1'), undefined)
  assert.equal(isCurrent(null, entry.logical, 'portrait', 'oid-1'), undefined)
})

test('LocalAdapter 幂等落盘，清单按逻辑名排序且不含时间', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blhx-img-'))
  try {
    const adapter = new LocalAdapter(dir)
    const src = Buffer.from('x', 'utf8')
    const icon = adapter.put('ship/20502/icon', { variant: VARIANTS.icon, bytes: src, width: 96, height: 96 }, 'en', 'oid-1')
    const again = adapter.put('ship/20502/icon', { variant: VARIANTS.icon, bytes: src, width: 96, height: 96 }, 'en', 'oid-1')
    assert.deepEqual(again, icon)
    const portrait = adapter.put(
      'skin/205020/portrait',
      { variant: VARIANTS.portrait, bytes: src, width: 600, height: 800 },
      'placeholder',
      null,
    )

    adapter.writeManifest({ enSha: 'f'.repeat(40), entries: [portrait, again] })
    const text = readFileSync(join(dir, 'data', 'images.manifest.json'), 'utf8')
    assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/, '清单里出现时间戳：它会进 web#build 的指纹')

    const back = readImagesManifest(dir)
    assert.ok(back)
    assert.deepEqual(
      back.entries.map((e) => `${e.logical}/${e.kind}/${e.source}`),
      ['ship/20502/icon/icon/en', 'skin/205020/portrait/portrait/placeholder'],
    )

    // 同一份字节重复 put 只落一个文件；目录按逻辑名分片，与 R2 key 同构。
    // key 本身永远是 POSIX 分隔符（清单与页面引用它），Windows 下列表要归一化
    const files = readdirSync(join(dir, 'data', 'images'), { recursive: true, encoding: 'utf8' })
      .filter((f): f is string => typeof f === 'string')
      .map((f) => f.replace(/\\/g, '/'))
      .filter((f) => f.endsWith('.webp'))
      .sort()
    assert.deepEqual(files, ['ship/20502/icon.2d711642.webp', 'skin/205020/portrait.2d711642.webp'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('覆盖层优先且全程不打 API：第二次跑零下载，清单只增不减', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'blhx-img-flow-'))
  try {
    const overrideDir = join(dir, 'data', 'manual', 'image-overrides', 'cn')
    mkdirSync(overrideDir, { recursive: true })
    const src = await samplePng(400, 500)
    writeFileSync(join(overrideDir, '999999.png'), src)

    const units: Unit[] = [{ logical: 'skin/999999/portrait', skinId: 999999, file: 'painting', label: '测' }]
    const enSha = 'a'.repeat(40)

    const r1 = await buildImages(dir, units, { enSha })
    assert.equal(r1.entries.length, 3)
    assert.deepEqual(r1.entries.map((e) => e.source), ['override', 'override', 'override'])
    assert.equal(r1.fetched, 0, '覆盖层命中时不该下载 EN 源')
    assert.equal(r1.misses.length, 0)
    assert.ok(r1.entries.every((e) => e.srcOid?.startsWith('sha256:')))

    const r2 = await buildImages(dir, units, { enSha })
    assert.equal(r2.fetched, 0)
    assert.equal(r2.skipped, 3, 'OID 未变还重新下载，等于每天同步都把大图下一遍')

    // 只跑新的那个逻辑名：老条目必须原样留在台账里，否则一次局部重跑就擦掉整份清单
    writeFileSync(join(overrideDir, '999998.png'), src)
    const r3 = await buildImages(
      dir,
      [{ logical: 'skin/999998/portrait', skinId: 999998, file: 'painting', label: '试' }],
      { enSha },
    )
    assert.equal(r3.entries.length, 3)
    assert.equal(r3.carried, 3)
    const back = readImagesManifest(dir)
    assert.ok(back)
    assert.equal(back.entries.length, 6)
    assert.equal(back.enSha, enSha)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
