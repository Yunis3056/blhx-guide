/**
 * 六维雷达（property_hexagon）的轴名定位。
 *
 * 这个数组是 6 个字母，实测字母表恰为 {S,A,B,C,D,E}、长度恒 6，但它**不按
 * attribute_info_by_type 的 id 顺序排**：第 1 位是炮击、第 3 位是航空、第 6 位才是耐久。
 * 按 id 顺序贴标签会把雷达六个轴里错四个，所以轴名不写死、由数据自己说：
 * 取每条船最高阶段行的 12 项属性与该船的 6 位字母，逐位算 |Spearman|，
 * 最大项即该位属性。六位最大项必须互不相同，且都过阈值，否则中止构建。
 *
 * 实测 856 条船的六位最大项依次是 cannon .86 / torpedo .95 / air 1.00 /
 * dodge .87 / antiaircraft .72 / durability .82；第 4 位在 dodge .87 与
 * speed .81 之间贴近，控住 speed 后的偏相关是 dodge .514 对 speed .210，
 * 所以取 dodge——这条判断留给构建期的断言复核，不靠注释里的数字。
 */

export const HEXAGON_LETTERS = ['S', 'A', 'B', 'C', 'D', 'E'] as const
const SCORE: Record<string, number> = { S: 5, A: 4, B: 3, C: 2, D: 1, E: 0 }

/** 单条船的证据：六个位置的字母 + 该船 12 项属性（按属性英文名键） */
export interface HexagonSample {
  groupType: number
  letters: string[]
  attrs: Record<string, number>
}

export interface HexagonAxis {
  pos: number
  attr: string
  label: string
}

/** 解析字母数组；形态不对返回 null，由调用方决定是隔离还是中止 */
export function parseHexagon(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length !== 6) return null
  const out: string[] = []
  for (const c of raw) {
    if (typeof c !== 'string' || !(HEXAGON_LETTERS as readonly string[]).includes(c)) return null
    out.push(c)
  }
  return out
}

function ranks(values: readonly number[]): number[] {
  const idx = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0])
  const out = new Array<number>(values.length).fill(0)
  let i = 0
  while (i < idx.length) {
    const head = idx[i]
    if (head === undefined) break
    let j = i
    for (;;) {
      const nxt = idx[j + 1]
      if (nxt === undefined || nxt[0] !== head[0]) break
      j++
    }
    const r = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) {
      const e = idx[k]
      if (e !== undefined) out[e[1]] = r
    }
    i = j + 1
  }
  return out
}

function spearman(a: readonly number[], b: readonly number[]): number {
  const x = ranks(a)
  const y = ranks(b)
  const n = x.length
  if (n === 0) return 0
  const mx = x.reduce((s, v) => s + v, 0) / n
  const my = y.reduce((s, v) => s + v, 0) / n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    const dx = (x[i] ?? 0) - mx
    const dy = (y[i] ?? 0) - my
    num += dx * dy
    da += dx * dx
    db += dy * dy
  }
  const den = Math.sqrt(da * db)
  return den === 0 ? 0 : num / den
}

export const MIN_SAMPLES = 500
export const MIN_CORR = 0.6

/**
 * 逐位取 |Spearman| 最大项当轴名。三种失败都要响：
 * 样本不够（数据代次变了但没几条船能比）、某位相关太弱（轴不是这项属性）、
 * 两位抢同一项属性（说明其中一位的判断不可信）。
 */
export function deriveHexagonAxes(
  samples: readonly HexagonSample[],
  attrNames: readonly string[],
  labels: ReadonlyMap<string, string>,
): HexagonAxis[] {
  const usable = samples.filter((s) => s.letters.length === 6 && attrNames.every((n) => typeof s.attrs[n] === 'number'))
  if (usable.length < MIN_SAMPLES) {
    throw new Error(
      `六维轴定位样本只有 ${usable.length} 条（阈值 ${MIN_SAMPLES}）：` +
        `property_hexagon 与阶段属性的可比对不上，轴名不能定`,
    )
  }
  const axes: HexagonAxis[] = []
  const taken = new Map<string, number>()
  for (let pos = 0; pos < 6; pos++) {
    const letters = usable.map((s) => SCORE[s.letters[pos] ?? ''] ?? 0)
    if (new Set(letters).size < 2) throw new Error(`六维第 ${pos + 1} 位全是同一字母，无法与任何属性建立相关`)
    let best: { attr: string; corr: number } | null = null
    for (const name of attrNames) {
      const corr = Math.abs(spearman(usable.map((s) => s.attrs[name] as number), letters))
      if (best === null || corr > Math.abs(best.corr)) best = { attr: name, corr }
    }
    if (best === null) throw new Error(`六维第 ${pos + 1} 位没有可比的属性`)
    if (best.corr < MIN_CORR) {
      throw new Error(`六维第 ${pos + 1} 位最强相关只有 ${best.attr} ${best.corr.toFixed(2)}，低于 ${MIN_CORR}：轴名不可判定`)
    }
    const clash = taken.get(best.attr)
    if (clash !== undefined) {
      throw new Error(
        `六维第 ${clash + 1} 位与第 ${pos + 1} 位都指向 ${best.attr}（${best.corr.toFixed(2)}）：` +
          `六个轴不能是同一项属性，定位口径失效`,
      )
    }
    taken.set(best.attr, pos)
    axes.push({ pos: pos + 1, attr: best.attr, label: labels.get(best.attr) ?? best.attr })
  }
  return axes
}
