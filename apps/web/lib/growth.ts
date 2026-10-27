import type { StageAttr } from './queries/ship'

/**
 * 1–100 级属性外推。
 *
 * `attrs` 是 1 级基值，`attrs_growth` 与 `attrs_growth_extra` 是 ×1000 定点成长，
 * 所以每级增量 = (growth + growth_extra) / 1000。上限钉在 100：
 * `ship_data_template.max_level` 实测全部为 100，125 级的加成规则不在解包数据里。
 *
 * **取整规则还没被游戏内数值校准**（PLAN §3.7 待闭合项）。页面因此把曲线标成
 * 「按定点线性外推」，不写成「游戏内面板值」；校准靠阶段 2 的 5 艘人工抽检。
 */
export const MAX_LEVEL = 100

export function attrAtLevel(a: StageAttr, level: number): number {
  if (level < 1 || level > MAX_LEVEL) throw new Error(`等级越界：${level}`)
  return Math.floor(a.base + ((a.growth + a.growthExtra) * (level - 1)) / 1000)
}

/**
 * 曲线只需要两个端点：公式对 level 是线性的，取整只会让端点间的斜率有
 * 不超过 1 单位的抖动。实测过一版按 1..100 逐点画线的页面，单页 HTML 298KB，
 * 859 页就是 250MB+，Pages 的文件数与体积预算当场爆。
 */
export const curveEndpoints = (a: StageAttr): [[number, number], [number, number]] => [
  [1, attrAtLevel(a, 1)],
  [MAX_LEVEL, attrAtLevel(a, MAX_LEVEL)],
]
