import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sha256Buf } from '../src/hash.ts'
import {
  manifestPath,
  readManifest,
  writeManifest,
  assertSameGeneration,
  type Manifest,
} from '../src/manifest.ts'

/** manifest 与 jsonl 都是入库文件，构造「只改其一」的两代状态 */
function fixture(): { dir: string; manifest: Manifest; close: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'blhx-manifest-'))
  const a = Buffer.from('{"groupType":1}\n', 'utf8')
  const b = Buffer.from('{"groupType":2}\n', 'utf8')
  writeFileSync(join(dir, 'ships.jsonl.gz'), a)
  writeFileSync(join(dir, 'enums.jsonl.gz'), b)
  const manifest: Manifest = {
    dataSha: '0'.repeat(40),
    snapshotSeq: 7,
    server: 'CN',
    tier: ['A'],
    files: {
      'ships.jsonl.gz': { rows: 1, bytes: a.length, sha256: sha256Buf(a) },
      'enums.jsonl.gz': { rows: 1, bytes: b.length, sha256: sha256Buf(b) },
    },
    tableDirs: { shipGroup: 'sharecfgdata' },
  }
  writeManifest(dir, manifest)
  return { dir, manifest, close: () => rmSync(dir, { recursive: true, force: true }) }
}

test('manifest 与 jsonl 同代时逐文件核对通过', () => {
  const f = fixture()
  try {
    const m = readManifest(f.dir)
    assert.deepEqual(assertSameGeneration(m, f.dir), ['enums.jsonl.gz', 'ships.jsonl.gz'])
    assert.equal(m.snapshotSeq, 7)
    assert.equal(m.server, 'CN')
    // normalized/** 是构建指纹；掺进墙上时间就等于「数据没变也要整站重建」
    assert.doesNotMatch(readFileSync(manifestPath(f.dir), 'utf8'), /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/)
  } finally {
    f.close()
  }
})

test('只动 jsonl 不动 manifest：构建期硬错误，不会静默用旧数据', () => {
  const f = fixture()
  try {
    writeFileSync(join(f.dir, 'ships.jsonl.gz'), Buffer.from('{"groupType":999}\n', 'utf8'))
    assert.throws(() => assertSameGeneration(readManifest(f.dir), f.dir), /与 manifest 的 sha256 不符/)
  } finally {
    f.close()
  }
})

test('多一个或少一个 jsonl 都要拦：文件集合必须与登记一致', () => {
  const f = fixture()
  try {
    writeFileSync(join(f.dir, 'extra.jsonl.gz'), Buffer.from('{}\n', 'utf8'))
    assert.throws(() => assertSameGeneration(readManifest(f.dir), f.dir), /文件集合与 manifest 登记不一致/)
    rmSync(join(f.dir, 'extra.jsonl.gz'))
    rmSync(join(f.dir, 'enums.jsonl.gz'))
    assert.throws(() => assertSameGeneration(readManifest(f.dir), f.dir), /文件集合与 manifest 登记不一致/)
  } finally {
    f.close()
  }
})

test('dataSha 与 snapshotSeq 写坏就中止（时间戳之外的字段不允许人工改）', () => {
  const f = fixture()
  try {
    assert.throws(() => writeManifest(f.dir, { ...f.manifest, dataSha: 'not-a-sha' }), /40 位十六进制/)
    assert.throws(() => writeManifest(f.dir, { ...f.manifest, snapshotSeq: 1.5 }), /非负整数/)
    assert.throws(() => writeManifest(f.dir, { ...f.manifest, files: {} }), /files 是空的/)
  } finally {
    f.close()
  }
})
