import { readFileSync, existsSync, rmSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DDL, SCHEMA_VERSION } from './schema.ts'
import type { ShipRecord, ShipStageRecord, ShipSkinRecord, ShipSlotRecord, ShipSkillRecord } from '../normalize/ship.ts'
import type { RetrofitRecord } from '../normalize/retrofit.ts'
import type { VoiceRecord } from '../normalize/voice.ts'
import type { FleetTechRow } from '../normalize/fleet-tech.ts'
import type { EnumRow } from '../normalize/enums.ts'

/**
 * data/normalized/*.jsonl.gz → data/al.sqlite。
 *
 * 只读已提交的 normalized，绝不碰 data/raw：raw 不入库，Pages 构建机上没有它，
 * 而「构建阶段不访问业务数据源」是核心原则。所以这一步能独立跑通，本身就证明
 * 站点数据自洽可重建。
 *
 * 建库不带任何时间：meta 里只有 schema_version / data_sha / 逐表行数。一旦 meta 或
 * 上游 manifest 里出现 syncedAt，同数据两次建库必然不同字节，§6.2 的确定性重建与
 * §3.12 的哈希校验就只能在比对逻辑上放宽 —— 那正是「可重放」变成口号的地方。
 */

export const FILES = {
  ships: 'ships.jsonl.gz',
  stages: 'ship-stages.jsonl.gz',
  skins: 'ship-skins.jsonl.gz',
  voice: 'ship-voice.jsonl.gz',
  slots: 'ship-slots.jsonl.gz',
  skills: 'ship-skills.jsonl.gz',
  retrofits: 'ship-retrofits.jsonl.gz',
  fleetTech: 'fleet-tech.jsonl.gz',
  enums: 'enums.jsonl.gz',
} as const

export function readJsonl<T>(dir: string, file: string): T[] {
  const p = join(dir, file)
  if (!existsSync(p)) throw new Error(`缺少 ${p}：先跑 pipeline normalize`)
  return gunzipSync(readFileSync(p))
    .toString('utf8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as T)
}

const json = (v: unknown): string => JSON.stringify(v ?? null)

export interface BuildResult {
  path: string
  counts: Record<string, number>
}

interface Dataset {
  ships: ShipRecord[]
  stages: ShipStageRecord[]
  skins: ShipSkinRecord[]
  voice: VoiceRecord[]
  slots: ShipSlotRecord[]
  skills: ShipSkillRecord[]
  retrofits: RetrofitRecord[]
  fleet: FleetTechRow[]
  attrs: Array<Extract<EnumRow, { kind: 'attr' }>>
  rarities: Array<Extract<EnumRow, { kind: 'rarity' }>>
  hulls: Array<Extract<EnumRow, { kind: 'hull' }>>
  factions: Array<Extract<EnumRow, { kind: 'faction' }>>
  equipKinds: Array<Extract<EnumRow, { kind: 'equipKind' }>>
  hexagonAxes: Array<Extract<EnumRow, { kind: 'hexagonAxis' }>>
}

/** 插入顺序 = 外键依赖顺序：先枚举与 ship，再一切引用它们的表 */
function insertAll(db: DatabaseSync, d: Dataset): number {
  const insFaction = db.prepare('INSERT INTO faction (nationality, slug, name, source) VALUES (?,?,?,?)')
  for (const f of d.factions) insFaction.run(f.nationality, f.slug, f.name, f.source)

  const insAttr = db.prepare('INSERT INTO attr_def (idx, attr_id, name, label) VALUES (?,?,?,?)')
  for (const a of d.attrs) insAttr.run(a.idx, a.attrId, a.name, a.label)

  const insHexAxis = db.prepare('INSERT INTO hexagon_axis (pos, attr, label) VALUES (?,?,?)')
  for (const x of d.hexagonAxes) insHexAxis.run(x.pos, x.attr, x.label)

  const insEquipKind = db.prepare('INSERT INTO equip_kind (type_id, type_name, type_name2) VALUES (?,?,?)')
  for (const e of d.equipKinds) insEquipKind.run(e.typeId, e.typeName, e.typeName2)

  const insRarity = db.prepare('INSERT INTO rarity (value, label) VALUES (?,?)')
  for (const r of d.rarities) insRarity.run(r.value, r.label)

  const insHull = db.prepare('INSERT INTO hull_type (type_id, type_name, team_type) VALUES (?,?,?)')
  for (const h of d.hulls) insHull.run(h.typeId, h.typeName, h.teamType)

  const retrofitSet = new Set(d.retrofits.map((r) => r.groupType))
  const classByGroup = new Map(
    d.fleet.filter((f) => f.kind === 'ship').map((f) => [f.groupType, f.classId] as [number, number]),
  )
  const insShip = db.prepare(
    `INSERT INTO ship (group_type, name, english_name, code, index_id, handbook_type, nationality,
                       ship_type, rarity, default_skin_id, skin_count, has_retrofit, fleet_class_id, hexagon)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  for (const s of d.ships) {
    insShip.run(
      s.groupType, s.name, s.englishName, s.code, s.indexId, s.handbookType, s.nationality, s.shipType,
      s.rarity, s.defaultSkinId, s.skinCount, retrofitSet.has(s.groupType) ? 1 : 0,
      classByGroup.get(s.groupType) ?? null, s.hexagon.join(','),
    )
  }

  const insStage = db.prepare(
    `INSERT INTO ship_stage (row_id, group_type, skin_id, stage, star, rarity, armor_type,
                             default_equip_list, fix_equip_list) VALUES (?,?,?,?,?,?,?,?,?)`,
  )
  const insStageAttr = db.prepare(
    'INSERT INTO ship_stage_attr (group_type, stage, attr, base, growth, growth_extra) VALUES (?,?,?,?,?,?)',
  )
  for (const st of d.stages) {
    insStage.run(
      st.rowId, st.groupType, st.skinId, st.stage, st.star, st.rarity, st.armorType,
      json(st.defaultEquipList), json(st.fixEquipList),
    )
    for (const a of d.attrs) {
      const base = st.attrs[a.name]
      const growth = st.attrsGrowth[a.name]
      const extra = st.attrsGrowthExtra[a.name]
      if (typeof base !== 'number' || typeof growth !== 'number' || typeof extra !== 'number') {
        throw new Error(`阶段行 ${st.rowId} 缺属性 ${a.name}：映射 12 项必须逐项齐`)
      }
      insStageAttr.run(st.groupType, st.stage, a.name, base, growth, extra)
    }
  }

  const shipSet = new Set(d.ships.map((s) => s.groupType))
  const insSlot = db.prepare('INSERT INTO ship_stage_slot (group_type, stage, slot, kinds) VALUES (?,?,?,?)')
  for (const sl of d.slots) insSlot.run(sl.groupType, sl.stage, sl.slot, json(sl.kinds))

  const insSkill = db.prepare('INSERT INTO ship_skill (group_type, stage, seq, skill_id, name, descr, skill_type) VALUES (?,?,?,?,?,?,?)')
  for (const sk of d.skills) insSkill.run(sk.groupType, sk.stage, sk.seq, sk.skillId, sk.name, sk.descr, sk.skillType)

  const insSkin = db.prepare('INSERT INTO ship_skin (skin_id, group_type, name, skin_type, painting, voice_actor) VALUES (?,?,?,?,?,?)')
  const insOrphan = db.prepare('INSERT INTO orphan_skin (skin_id, group_type, name, reason) VALUES (?,?,?,?)')
  let orphans = 0
  for (const sk of d.skins) {
    insSkin.run(sk.skinId, sk.groupType, sk.name, sk.skinType, sk.painting, sk.voiceActor)
    if (!shipSet.has(sk.groupType)) {
      orphans++
      insOrphan.run(sk.skinId, sk.groupType, sk.name, 'group_type 不在 ship_data_group 的 859 条里')
    }
  }

  const insVoice = db.prepare('INSERT INTO ship_voice (skin_id, scene, seq, text) VALUES (?,?,?,?)')
  for (const v of d.voice) insVoice.run(v.skinId, v.scene, v.seq, v.text)

  const insSource = db.prepare('INSERT INTO ship_source (group_type, seq, text, command, args) VALUES (?,?,?,?,?)')
  for (const s of d.ships) {
    s.sources.forEach((e, i) => insSource.run(s.groupType, i, e.text, e.command, e.args ? json(e.args) : null))
  }

  const insRetro = db.prepare(
    'INSERT INTO retrofit (group_type, trans_type, trans_skin, trans_skill, trans_radar, result_skin_id, result_skill_id) VALUES (?,?,?,?,?,?,?)',
  )
  const insRetroNode = db.prepare(
    `INSERT INTO retrofit_node (node_id, group_type, branch, seq, slot_type, name, descrip, effect,
                                use_gold, use_item, use_ship, level_limit, star_limit) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  for (const r of d.retrofits) {
    insRetro.run(r.groupType, r.transType, r.transSkin, json(r.transSkill), json(r.transRadarChart), r.resultSkinId, r.resultSkillId)
    r.branches.forEach((branch, bi) => {
      branch.forEach((n, si) => {
        insRetroNode.run(
          n.nodeId, r.groupType, bi, si, n.slotType, n.name, n.descrip, json(n.effect),
          n.useGold, json(n.useItem), json(n.useShip), n.levelLimit, n.starLimit,
        )
      })
    })
  }

  const insFtGroup = db.prepare('INSERT INTO fleet_tech_group (group_id, name, nation, techs) VALUES (?,?,?,?)')
  const insFtNode = db.prepare('INSERT INTO fleet_tech_node (node_id, group_id, cost, pt, time, awards) VALUES (?,?,?,?,?,?)')
  const insFtAdd = db.prepare('INSERT INTO fleet_tech_node_add (node_id, seq, shiptypes, level, value) VALUES (?,?,?,?,?)')
  const insFtShip = db.prepare(
    `INSERT INTO fleet_tech_ship (group_type, class_id, class_name, class_nation, class_type, max_star,
                                  pt_get, pt_level, pt_upgrade, add_get, add_level) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  )
  for (const f of d.fleet) {
    if (f.kind === 'group') insFtGroup.run(f.groupId, f.name, json(f.nation), json(f.techs))
    if (f.kind === 'node') {
      insFtNode.run(f.nodeId, f.groupId, f.cost, f.pt, f.time, json(f.awards))
      f.add.forEach((a, i) => insFtAdd.run(f.nodeId, i, json(a.shiptypes), a.level, a.value))
    }
    if (f.kind === 'ship') {
      insFtShip.run(
        f.groupType, f.classId, f.className, f.classNation, f.classShipType, f.maxStar,
        f.ptGet, f.ptLevel, f.ptUpgrade,
        json({ attr: f.addGet.attr, shiptypes: f.addGet.shiptypes, value: f.addGet.value }),
        json({ attr: f.addLevel.attr, shiptypes: f.addLevel.shiptypes, value: f.addLevel.value }),
      )
    }
  }
  return orphans
}

const TABLES = [
  'faction', 'attr_def', 'hexagon_axis', 'rarity', 'hull_type', 'equip_kind', 'ship', 'ship_stage',
  'ship_stage_attr', 'ship_stage_slot', 'ship_skill', 'ship_skin',
  'orphan_skin', 'ship_voice', 'ship_source', 'retrofit', 'retrofit_node', 'fleet_tech_group', 'fleet_tech_node',
  'fleet_tech_node_add', 'fleet_tech_ship',
] as const

export function buildDatabase(normalizedDir: string, outPath: string, dataSha: string): BuildResult {
  const ships = readJsonl<ShipRecord>(normalizedDir, FILES.ships)
  const stages = readJsonl<ShipStageRecord>(normalizedDir, FILES.stages)
  const skins = readJsonl<ShipSkinRecord>(normalizedDir, FILES.skins)
  const voice = readJsonl<VoiceRecord>(normalizedDir, FILES.voice)
  const slots = readJsonl<ShipSlotRecord>(normalizedDir, FILES.slots)
  const skills = readJsonl<ShipSkillRecord>(normalizedDir, FILES.skills)
  const retrofits = readJsonl<RetrofitRecord>(normalizedDir, FILES.retrofits)
  const fleet = readJsonl<FleetTechRow>(normalizedDir, FILES.fleetTech)
  const enums = readJsonl<EnumRow>(normalizedDir, FILES.enums)

  rmSync(outPath, { force: true })
  const db = new DatabaseSync(outPath, { enableForeignKeyConstraints: true })
  db.exec(DDL)

  const dataset: Dataset = {
    ships,
    stages,
    skins,
    voice,
    slots,
    skills,
    retrofits,
    fleet,
    attrs: enums.filter((e) => e.kind === 'attr'),
    rarities: enums.filter((e) => e.kind === 'rarity'),
    hulls: enums.filter((e) => e.kind === 'hull'),
    factions: enums.filter((e) => e.kind === 'faction'),
    equipKinds: enums.filter((e) => e.kind === 'equipKind'),
    hexagonAxes: enums.filter((e) => e.kind === 'hexagonAxis'),
  }

  // 一个事务包全部插入：逐条自动提交时 4 万行属性写要跑几分钟（每条一次落盘同步），
  // 实测压回亚秒级。出错必须回滚，否则留下半截库。
  db.exec('BEGIN')
  let orphans = 0
  try {
    orphans = insertAll(db, dataset)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    db.close()
    throw e
  }

  const counts: Record<string, number> = {}
  for (const t of TABLES) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number } | undefined
    if (!row) throw new Error(`${t} 行数查询失败`)
    counts[t] = Number(row.n)
  }

  const insMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?,?)')
  insMeta.run('schema_version', String(SCHEMA_VERSION))
  insMeta.run('data_sha', dataSha)
  for (const [t, n] of Object.entries(counts)) insMeta.run(`count:${t}`, String(n))
  const check = db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined
  if (String(check?.integrity_check) !== 'ok') throw new Error(`integrity_check 未通过：${String(check?.integrity_check)}`)
  db.close()

  // 行数与来源必须对得上：不一致就是插入漏了或重了
  const expected: Array<[string, number]> = [
    ['ship', ships.length],
    ['ship_stage', stages.length],
    ['ship_skin', skins.length],
    ['retrofit', retrofits.length],
    ['orphan_skin', orphans],
    ['ship_stage_attr', stages.length * dataset.attrs.length],
    ['retrofit_node', retrofits.reduce((n, r) => n + r.branches.flat().length, 0)],
    ['ship_source', ships.reduce((n, s) => n + s.sources.length, 0)],
  ]
  for (const [table, want] of expected) {
    if (counts[table] !== want) throw new Error(`${table} 建库后 ${counts[table]} 行，来源有 ${want} 行`)
  }
  return { path: outPath, counts }
}
