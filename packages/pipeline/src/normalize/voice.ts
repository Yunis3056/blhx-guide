import { TABLES, relPath } from '../tables.ts'
import { readTable } from '../fetch/fetch.ts'
import type { QuarantineEntry } from './ship.ts'

/**
 * 语音文本（`ship_skin_words`）。
 *
 * 一行 = 一条台词，粒度是 (skin_id, 场景, 序号)：这张表按皮肤给文本，一个皮肤一行，
 * 所以 join 键是 `ship_skin_template.id`（实测 2,485 行的顶层键 100% 命中皮肤表）。
 *
 * 三条实测出来的取舍，都不靠猜：
 * - **`voice_key` 不能当舰船链接用**。它等于该皮肤所属 group 的只有 852 行，1,516 行是 0，
 *   另有 117 行既不是 0 也不等于自己的 group——它像「这套语音被哪艘船复用」，但数据没把
 *   这个语义说清楚，所以这里完全不消费它，链接只走皮肤表。
 * - **`gift_prefer` / `gift_dislike` 在 2,485 行里全为空**（收藏偏好另有
 *   `ship_data_statistics.gift_dislike` 的道具 id 数组）。上游哪天填了内容，说明口径变了，
 *   在这里响，而不是页面上凭空少一块。
 * - **`couple_encourage` 是不等长嵌套数组**（1,478 条里 1,467 条是 [数组,数,字符串,数]，
 *   11 条不是），第一个元素的含义没有文本源，所以这一列不进产物，页面也不显示；
 *   要恢复得先把形态盘清楚（PLAN §7 阶段 2 待办）。
 *
 * 场景字段共 79 个（34 个基础场景 + asmr_/atelier_/dal_/ryza_ 等联动扩展 + `*_replace`
 * 换装变体），且**没有任何 CN 文本源给场景起名**（gametip 里没有 voice 场景词条），
 * 所以页面直接显示字段键名，并在数据边界里记这一条。
 */

export interface VoiceRecord {
  skinId: number
  scene: string
  seq: number
  text: string
}

/** 结构字段与非文本字段：不当事务文本处理 */
const SKIP_FIELDS = new Set(['id', 'voice_key', 'voice_key_2', 'couple_encourage'])
/** 实测全空的两列：出现内容即口径变化 */
const MUST_BE_EMPTY = ['gift_prefer', 'gift_dislike'] as const

export function buildVoice(root: string, sha: string): { rows: VoiceRecord[]; quarantine: QuarantineEntry[] } {
  const raw = readTable(root, sha, relPath(TABLES.shipSkinWords)) as Record<string, Record<string, unknown>>
  const rows: VoiceRecord[] = []
  const quarantine: QuarantineEntry[] = []
  for (const [key, r] of Object.entries(raw)) {
    if (!/^\d+$/.test(key)) continue
    const skinId = Number(key)
    if (r.id !== skinId) {
      throw new Error(`ship_skin_words 键 ${key} 的行内 id 是 ${String(r.id)}，两者必须相等，否则 join 键不可信`)
    }
    for (const field of MUST_BE_EMPTY) {
      const v = r[field]
      if (typeof v === 'string' && v.length > 0) {
        quarantine.push({ kind: 'voice_field_newly_filled', key: `${skinId}`, detail: `${field} 原本 2,485 行全空，现在有内容：口径变了，要先盘它是什么再上页` })
      }
    }
    for (const [field, value] of Object.entries(r)) {
      if (SKIP_FIELDS.has(field) || (MUST_BE_EMPTY as readonly string[]).includes(field)) continue
      if (typeof value !== 'string' || value.length === 0) continue
      // main 这类字段一格塞多条台词，实测 2,428 个非空 main 值 100% 含竖线
      const parts = value.split('|').map((s) => s.trim()).filter((s) => s.length > 0)
      parts.forEach((text, i) => rows.push({ skinId, scene: field, seq: i + 1, text }))
    }
  }
  rows.sort((a, b) => a.skinId - b.skinId || a.scene.localeCompare(b.scene) || a.seq - b.seq)
  return { rows, quarantine }
}
