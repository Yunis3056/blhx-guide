import type { AttrMap } from './attr-map.ts'
import type { HexagonAxis } from './hexagon.ts'
import type { HandbookEntry } from '../display/handbook.ts'
import type { PositionEntry } from '../display/positions.ts'
import type { ShipRarity } from '../display/rarity.ts'
import type { FactionEntry } from '../display/factions.ts'

/**
 * 枚举层入 normalized/。
 *
 * 必须落文件，不能等建库时再去读 `data/raw`：`data/raw/` 不入库，Pages 构建
 * 只有已提交的 `data/normalized/`（§6.2 顺序第 1–2 步，且「构建阶段不访问业务
 * 数据源」是核心原则）。属性英文名→中文标签、稀有度标签、舰种名与阵营名都
 * 来自上游，不落盘就得在构建期重新解析 gametip。
 */

export type EnumRow =
  | { kind: 'attr'; idx: number; attrId: number; name: string; label: string }
  | { kind: 'rarity'; value: number; label: string }
  | { kind: 'hull'; typeId: number; typeName: string; teamType: string; label: string }
  | { kind: 'faction'; nationality: number; slug: string; name: string; source: string }
  | { kind: 'equipKind'; typeId: number; typeName: string; typeName2: string }
  | { kind: 'handbook'; handbookType: number; slug: string; name: string; evidence: string }
  | { kind: 'position'; teamType: string; slug: string; name: string; evidence: string }
  | { kind: 'hexagonAxis'; pos: number; attr: string; label: string }

export function buildEnumRows(
  attrMap: AttrMap,
  rarities: readonly ShipRarity[],
  hulls: ReadonlyMap<number, { typeName: string; teamType: string }>,
  factions: readonly FactionEntry[],
  factionNames: ReadonlyMap<number, string>,
  equipKinds: ReadonlyMap<number, { typeName: string; typeName2: string }>,
  hexagonAxes: readonly HexagonAxis[],
  handbooks: readonly HandbookEntry[],
  positions: readonly PositionEntry[],
): { rows: EnumRow[]; counts: Record<EnumRow['kind'], number> } {
  const attrs: EnumRow[] = attrMap.attrs.map((a) => ({
    kind: 'attr',
    idx: a.index,
    attrId: a.id,
    name: a.name,
    label: a.label,
  }))
  const rarity: EnumRow[] = rarities.map((r) => ({ kind: 'rarity', value: r.value, label: r.label }))
  // 舰种显示名消解：21 个舰种只有 18 个不同 type_name（导驱 20/21、风帆 22/23/24 同名），
  // 重名的补上站位名。规则放在构建期而不是页面里，是因为分类页、舰船详情页与客户端筛选
  // 索引都要用同一个标签——写在页面里就是三份实现，早晚写出两种名字。
  const hullSrc = [...hulls.entries()].sort((a, b) => a[0] - b[0]).map(([typeId, v]) => ({ typeId, ...v }))
  const nameCount = new Map<string, number>()
  for (const h of hullSrc) nameCount.set(h.typeName, (nameCount.get(h.typeName) ?? 0) + 1)
  const positionName = new Map(positions.map((p) => [p.teamType, p.name]))
  const hullLabel = new Map<number, string>()
  const labelSeen = new Map<string, number>()
  for (const h of hullSrc) {
    const dupName = (nameCount.get(h.typeName) ?? 0) > 1
    const position = positionName.get(h.teamType)
    if (dupName && position === undefined) {
      throw new Error(`舰种 ${h.typeId}（${h.typeName}）重名但站位 '${h.teamType}' 没有中文名，无法消解`)
    }
    const label = dupName ? `${h.typeName}·${position as string}` : h.typeName
    const clash = labelSeen.get(label)
    if (clash !== undefined) throw new Error(`舰种标签 '${label}' 被 ${clash} 与 ${h.typeId} 同时占用，分类页会撞名`)
    labelSeen.set(label, h.typeId)
    hullLabel.set(h.typeId, label)
  }
  const hull: EnumRow[] = hullSrc.map((h) => ({
    kind: 'hull',
    typeId: h.typeId,
    typeName: h.typeName,
    teamType: h.teamType,
    label: hullLabel.get(h.typeId) as string,
  }))
  const faction: EnumRow[] = factions
    .slice()
    .sort((a, b) => a.nationality - b.nationality)
    .map((f) => ({
      kind: 'faction',
      nationality: f.nationality,
      slug: f.slug,
      name: factionNames.get(f.nationality) ?? f.name,
      source: f.source,
    }))
  const equip: EnumRow[] = [...equipKinds.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([typeId, v]) => ({ kind: 'equipKind', typeId, typeName: v.typeName, typeName2: v.typeName2 }))
  // 六维轴只有 6 条，但它是「雷达六个位置各是什么属性」的唯一口径来源：
  // 页面不许自己按 attr id 顺序摆，那个顺序实测是错的
  const hexagon: EnumRow[] = hexagonAxes
    .slice()
    .sort((a, b) => a.pos - b.pos)
    .map((a) => ({ kind: 'hexagonAxis', pos: a.pos, attr: a.attr, label: a.label }))
  const handbook: EnumRow[] = handbooks
    .slice()
    .sort((a, b) => a.handbookType - b.handbookType)
    .map((k) => ({ kind: 'handbook', handbookType: k.handbookType, slug: k.slug, name: k.name, evidence: k.evidence }))
  const position: EnumRow[] = positions
    .slice()
    .sort((a, b) => a.teamType.localeCompare(b.teamType))
    .map((p) => ({ kind: 'position', teamType: p.teamType, slug: p.slug, name: p.name, evidence: p.evidence }))
  const rows = [...attrs, ...rarity, ...hull, ...faction, ...equip, ...hexagon, ...handbook, ...position]
  return {
    rows,
    counts: {
      attr: attrs.length,
      rarity: rarity.length,
      hull: hull.length,
      faction: faction.length,
      equipKind: equip.length,
      hexagonAxis: hexagon.length,
      handbook: handbook.length,
      position: position.length,
    },
  }
}
