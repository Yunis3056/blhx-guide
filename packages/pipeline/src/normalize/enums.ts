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
  | { kind: 'hull'; typeId: number; typeName: string; teamType: string }
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
  const hull: EnumRow[] = [...hulls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([typeId, v]) => ({ kind: 'hull', typeId, typeName: v.typeName, teamType: v.teamType }))
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
