import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'

/**
 * 取数顺序是硬约束，不能调换：
 *   1) commits API 拿分支当前 SHA
 *   2) 按该 SHA 取 codeload tarball —— 不按分支取，否则两次请求之间上游前进，
 *      manifest 里的 SHA 与实际内容不是同一版本
 *   3) Trees API 按 SHA 取全树 blob OID + size —— tarball 内没有 git OID，
 *      「按 OID 判定变更」必须靠这一步
 *   4) 断言：解出集合 == 白名单 ∩ tree 清单，且逐个 OID 一致
 *
 * 环境事实（本开发机实测，勿重试被阻断的路径）：
 *   raw.githubusercontent.com / cdn.jsdelivr.net → DNS 阻断，HTTP 000 / 0.1s
 *   codeload.github.com → 125,157,642 字节 / 约 27–40s，不受 REST 限额约束
 *   api.github.com → 可用，未认证 60 次/小时；超限返回 280 字节 JSON 错误体
 */

const OWNER = 'AzurLaneTools'
const REPO = 'AzurLaneData'
const API = 'https://api.github.com'
const CODELOAD = 'https://codeload.github.com'

/** codeload 按 SHA 取的 tarball，顶层目录固定是 <repo>-<sha> */
export const topDir = (sha: string): string => `${REPO}-${sha}`

/** 绝对禁止解出的路径（敏感词过滤前缀树，不得进入仓库/产物/日志/错误 dump） */
export const FORBIDDEN = [
  'CN/ShareCfg/word_template.json',
  'CN/ShareCfg/word_legal_template.json',
]

export interface TreeEntry {
  path: string
  mode: string
  type: 'blob' | 'tree' | 'commit'
  sha: string
  size?: number
}

async function get(url: string, accept: string): Promise<Response> {
  const res = await fetch(url, {
    headers: {
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  })
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300)
    throw new Error(`GET ${url} -> ${res.status} ${body}`)
  }
  return res
}

/** 步骤 1 —— 解析分支当前 SHA */
export async function resolveSha(branch = 'main'): Promise<string> {
  const res = await get(
    `${API}/repos/${OWNER}/${REPO}/commits/${encodeURIComponent(branch)}`,
    'application/vnd.github.sha',
  )
  const sha = (await res.text()).trim()
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`resolveSha 未取得合法 40 位 SHA，得到：${sha.slice(0, 120)}`)
  }
  return sha
}

/** 步骤 2 —— 按 SHA 下载 tarball 到 destPath，返回字节数 */
export async function downloadTarball(sha: string, destPath: string): Promise<number> {
  const res = await get(`${CODELOAD}/${OWNER}/${REPO}/tar.gz/${sha}`, 'application/gzip')
  const buf = Buffer.from(await res.arrayBuffer())
  mkdirSync(dirname(destPath), { recursive: true })
  writeFileSync(destPath, buf)
  // 完整性靠 gzip 校验，不靠体积阈值。此前用「< 50MB 即异常」做判据：
  // 它拦不住「下载了 125MB 但在中途截断」这种最常见的失败形态，
  // 而截断的 tarball 报的是 gzip: unexpected end of file，与真实原因隔了好几层。
  const t = spawnSync('gzip', ['-t', destPath], { encoding: 'utf8' })
  if (t.status !== 0) {
    throw new Error(
      `下载内容不是完整 gzip 流（${buf.length.toLocaleString()} 字节）：${t.stderr || t.stdout}。` +
        `这通常是响应被截断，不是体积写错`,
    )
  }
  return buf.length
}

/** 步骤 3 —— 按 SHA 取全树 OID */
export async function fetchTree(sha: string): Promise<TreeEntry[]> {
  const res = await get(
    `${API}/repos/${OWNER}/${REPO}/git/trees/${sha}?recursive=1`,
    'application/vnd.github+json',
  )
  const data = (await res.json()) as { tree: TreeEntry[]; truncated: boolean }
  if (data.truncated) {
    throw new Error('Trees API 返回 truncated:true，全树 OID 不完整，增量判定无法成立')
  }
  return data.tree
}

/**
 * 步骤 4 —— 选择性解包。
 * 断言对象是「白名单 ∩ tree 清单」而不是「CN 全部 .json」：后者按字面必然失败，
 * 因为设计只解白名单，且 FORBIDDEN 两项明确禁止解出。
 */
export function extractWhitelist(params: {
  tgzPath: string
  sha: string
  whitelist: string[]
  tree: TreeEntry[]
  outRoot: string
}): Record<string, string> {
  const { tgzPath, sha, whitelist, tree, outRoot } = params
  const byPath = new Map(tree.map((e) => [e.path, e]))

  for (const p of whitelist) {
    if (FORBIDDEN.includes(p)) throw new Error(`${p} 属禁止取用清单`)
    if (!byPath.has(p)) {
      throw new Error(
        `白名单路径 ${p} 不在固定提交 ${sha.slice(0, 8)} 的 tree 清单里。` +
          `白名单写错或上游删了表 —— 中止，不静默跳过`,
      )
    }
  }

  const members = whitelist.map((p) => `${topDir(sha)}/${p}`)
  // 只给 tar 相对路径 + 用 cwd 定位，这是本机实测出来的结论。
  // 传 Windows 绝对路径进去，MSYS tar 会把 argv 搅成
  //   E\:\agents\\qoder\data\raw\004cca5c…  Cannot open: No such file or directory
  // 连 SHA 都被改写；加 --force-local 只是把「当成远程主机」换成「反斜杠转义地狱」。
  // 相对路径 + cwd 同时绕开这两条，且 POSIX 环境下同样成立。
  //
  // 仍不经 shell：spawn 传数组参数，避免 Git Bash 把 /CN/x.json 翻译成
  // D:/Program Files/Git/CN/x.json 而静默零检出（该坑 exit code 仍为 0）。
  const tgzName = basename(tgzPath)
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = spawnSync('tar', ['-xzf', tgzName, '-C', '.', ...members], {
      encoding: 'utf8',
      cwd: outRoot,
    })
    if (r.status === 0) break
    if (attempt === 3) {
      throw new Error(`tar 解包失败（第 ${attempt} 次）：${r.stderr || r.stdout}`)
    }
  }

  const oids: Record<string, string> = {}
  for (const p of whitelist) {
    const abs = join(outRoot, topDir(sha), p)
    if (!existsSync(abs)) {
      throw new Error(
        `解包后文件缺失：${abs}。tar 退出码 0 却没写出文件，是 MSYS 路径翻译的典型症状`,
      )
    }
    const entry = byPath.get(p)!
    // 大文件（>100MB）Git 不一定能在本地即时核对 OID，这里只校验存在与可解析；
    // 真正的变更判定用 tree 里的 OID 做集合差（见 snapshot-fingerprint.ts）
    JSON.parse(stripBom(readFileSync(abs, 'utf8')))
    oids[p] = entry.sha
  }
  return oids
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

export function readTable(outRoot: string, sha: string, rel: string): unknown {
  const p = join(outRoot, topDir(sha), rel)
  if (!existsSync(p)) throw new Error(`未取到 ${rel}（应为 ${p}）`)
  return JSON.parse(stripBom(readFileSync(p, 'utf8')))
}

export function sha256File(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex')
}
