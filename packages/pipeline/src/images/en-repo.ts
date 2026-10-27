const API = 'https://api.github.com'
const OWNER = 'Fernando2603'
const REPO = 'AzurLane'

/**
 * EN 策展仓库的只读客户端，图片的唯一自动来源（§3.8 第 2 级）。
 *
 * 两条来自实测的约束：
 * - `raw.githubusercontent.com` 在本机 DNS 阻断，只能走 REST；`api.github.com` 通
 * - 未认证 60 次/小时，所以每个入口都带 `GITHUB_TOKEN` 透传，且调用次数要能预算
 *
 * 取图顺序固定为「先锁 commit SHA，再按 SHA 列目录、按 blob OID 取内容」：
 * 直接按分支名取，两次请求之间上游前进，清单与内容就不是同一代。
 * 目录遍历用 `git/trees/{sha}:{path}`，一次请求只返回一个皮肤目录，
 * 不用拉 9.91GB 的全树清单。
 */

export interface BlobRef {
  /** git blob OID：增量判定的唯一依据，不用内容哈希（§3.8） */
  oid: string
  size: number
}

export interface SkinDir {
  skinId: number
  /** 文件名（不含扩展名）→ blob 引用 */
  files: Record<string, BlobRef>
}

/** 已知用途的文件名，写死在这里是刻意的：目录里多出别的文件不算命中 */
export const SKIN_FILES = ['painting', 'shipyard', 'icon', 'qicon', 'chibi', 'banner'] as const
export type SkinFile = (typeof SKIN_FILES)[number]

async function get(url: string, accept: string): Promise<Response> {
  const res = await fetch(url, {
    headers: {
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  })
  if (res.status === 404) return res
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200)
    throw new Error(`GET ${url} -> ${res.status} ${body}`)
  }
  return res
}

async function getJson<T>(url: string): Promise<T> {
  const res = await get(url, 'application/json')
  return (await res.json()) as T
}

export async function resolveEnSha(branch = 'main'): Promise<string> {
  const res = await get(
    `${API}/repos/${OWNER}/${REPO}/commits/${encodeURIComponent(branch)}`,
    'application/vnd.github.sha',
  )
  const sha = (await res.text()).trim()
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`EN 仓库分支 SHA 不合法：${sha.slice(0, 120)}`)
  return sha
}

interface TreeApi {
  tree?: Array<{ path: string; type: string; sha: string; size?: number }>
  message?: string
}

/**
 * 列一个皮肤目录。404（该 skinId 在 EN 侧不存在）返回 null，不抛错：
 * 缺图是 §3.8 三级回退要正常处理的状态，不是故障。
 */
export async function listSkinDir(enSha: string, skinId: number): Promise<SkinDir | null> {
  const url = `${API}/repos/${OWNER}/${REPO}/git/trees/${enSha}:images/skin/${skinId}`
  const body = await getJson<TreeApi>(url)
  if (!body.tree) {
    if (body.message && /not found/i.test(body.message)) return null
    throw new Error(`列目录失败 skinId=${skinId}：${body.message ?? '响应没有 tree'}`)
  }
  const files: Record<string, BlobRef> = {}
  for (const entry of body.tree) {
    if (entry.type !== 'blob') continue
    const m = /^([a-z]+)\.png$/.exec(entry.path)
    const name = m?.[1]
    if (!name || !SKIN_FILES.includes(name as SkinFile)) continue
    files[name] = { oid: entry.sha, size: entry.size ?? 0 }
  }
  return { skinId, files }
}

/** 只取目录清单不下载内容，用于「这次同步有哪些图是新的」 */
export async function hasSkin(enSha: string, skinId: number): Promise<boolean> {
  return (await listSkinDir(enSha, skinId)) !== null
}

/**
 * 按 blob OID 取原始字节。用 `application/vnd.github.raw` 而不是 base64 JSON：
 * painting.png 实测 2.1MB，base64 会多花 33% 流量与一次解码。
 */
export async function getBlob(oid: string): Promise<Buffer> {
  const res = await get(`${API}/repos/${OWNER}/${REPO}/git/blobs/${oid}`, 'application/vnd.github.raw')
  return Buffer.from(await res.arrayBuffer())
}

export const enRepoId = `${OWNER}/${REPO}`
