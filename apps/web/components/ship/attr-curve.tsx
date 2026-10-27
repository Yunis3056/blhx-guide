import { MAX_LEVEL, curveEndpoints } from '../../lib/growth'
import type { Stage, StageAttr } from '../../lib/queries/ship'

/**
 * 一条属性 1–100 级的成长线，四个突破阶段各一条。
 *
 * 每条线只画两个端点（公式对等级是线性的，见 lib/growth.ts）；
 * 用内联 SVG 而不是图表库：静态导出的首屏不该为 12 张小图背一个运行时。
 */
const W = 260
const H = 96
const PAD = 6
const COLORS = ['#5fa8ff', '#63d19a', '#f2b544', '#e2686f']

interface Props {
  attr: string
  label: string
  stages: Stage[]
}

interface Segment {
  stage: number
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
}

export function AttrCurve({ attr, label, stages }: Props) {
  const found = stages
    .map((s) => ({ stage: s.stage, attr: s.attrs.find((a) => a.attr === attr) }))
    .filter((l): l is { stage: number; attr: StageAttr } => l.attr !== undefined)
  if (found.length === 0) return null

  const pairs = found.map((l) => ({ stage: l.stage, ends: curveEndpoints(l.attr) }))
  const values = pairs.flatMap((p) => [p.ends[0][1], p.ends[1][1]])
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || 1

  const x = (level: number): number => PAD + ((level - 1) / (MAX_LEVEL - 1)) * (W - 2 * PAD)
  const y = (value: number): number => H - PAD - ((value - lo) / span) * (H - 2 * PAD)

  const segments: Segment[] = pairs.map((p, i) => ({
    stage: p.stage,
    x1: x(p.ends[0][0]),
    y1: y(p.ends[0][1]),
    x2: x(p.ends[1][0]),
    y2: y(p.ends[1][1]),
    color: COLORS[i % COLORS.length] as string,
  }))

  return (
    <div className="card">
      <h3>{label}</h3>
      <svg width={W} height={H} role="img" aria-label={`${label} 1 到 100 级成长曲线`}>
        {segments.map((s) => (
          <line key={s.stage} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth={1.5} />
        ))}
      </svg>
      <p className="note">
        {lo.toLocaleString('zh-CN')} – {hi.toLocaleString('zh-CN')}
        {' · '}
        {segments.map((s) => (
          <span key={s.stage} style={{ color: s.color }}>
            突破{s.stage}{' '}
          </span>
        ))}
      </p>
    </div>
  )
}
