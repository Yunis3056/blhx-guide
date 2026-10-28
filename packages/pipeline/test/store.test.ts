import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { sha256File } from '../src/hash.ts'
import { buildDatabase } from '../src/store/build.ts'

const NORM = join(import.meta.dirname, '..', '..', '..', 'data', 'normalized')
const MANIFEST = join(NORM, 'manifest.json')
// 建库只认 manifest，不认 data/raw —— 后者不入库，CI 与 Pages 的检出里没有它
const sha = existsSync(MANIFEST) ? (JSON.parse(readFileSync(MANIFEST, 'utf8')).dataSha as string) : null
const hasData = sha !== null && existsSync(join(NORM, 'ships.jsonl.gz'))
const skip = hasData ? false : '还没 normalize（缺 manifest.json / jsonl），跳过建库断言'

function inTemp(fn: (file: string) => void): void {
  const tmp = mkdtempSync(join(tmpdir(), 'blhx-db-'))
  try {
    fn(join(tmp, 'al.sqlite'))
  } finally {
    // Windows 上断言中途抛错会留下未关闭的 sqlite 句柄，此时 rmSync 必然 EPERM。
    // 清理失败必须吞掉：抛出它会盖掉 fn 里真正的断言失败原因，留下一个临时目录是可接受代价。
    try {
      rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* 句柄还没释放，交给系统清理临时目录 */
    }
  }
}

/** 一行必须有结果——查不到就是断言写错了，不能静默变成 undefined 比较 */
function get<T extends Record<string, unknown>>(db: DatabaseSync, sql: string, ...args: unknown[]): T {
  const row = db.prepare(sql).get(...(args as never[])) as T | undefined
  if (row === undefined) throw new Error(`查询没有结果行：${sql}`)
  return row
}
const count = (db: DatabaseSync, sql: string, ...args: unknown[]): number =>
  get<{ n: number }>(db, sql, ...args).n

test('同数据两次建库逐字节相同（真实 859 船数据，不是十几 KB 的试验库）', { skip }, () => {
  inTemp((a) => {
    inTemp((b) => {
      buildDatabase(NORM, a, sha as string)
      buildDatabase(NORM, b, sha as string)
      assert.ok(statSync(a).size > 1_000_000, '库太小，说明没真写进去')
      assert.equal(sha256File(a), sha256File(b), '两次建库字节不同：确定性重建的前提不成立')
    })
  })
})

test('建库带外键约束，且约束真的在挡（不是声明了没用）', { skip }, () => {
  inTemp((file) => {
    buildDatabase(NORM, file, sha as string)
    const db = new DatabaseSync(file, { enableForeignKeyConstraints: true })
    assert.throws(
      () => db.prepare('INSERT INTO ship_stage (row_id, group_type, skin_id, stage, star, rarity, armor_type, default_equip_list, fix_equip_list) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(99999999, 99999999, 1, 1, 1, 5, 1, '[]', '[]'),
      /FOREIGN KEY constraint failed/,
    )
    db.close()
  })
})

test('§4.3 的读路径逐条可查', { skip }, () => {
  inTemp((file) => {
    buildDatabase(NORM, file, sha as string)
    const db = new DatabaseSync(file, { readOnly: true, enableForeignKeyConstraints: false })

    const ship = get<{ name: string; faction: string; rarity: string; type_name: string; team_type: string }>(
      db,
      `SELECT s.name, f.name AS faction, r.label AS rarity, h.type_name, h.team_type
         FROM ship s
         JOIN faction f ON f.nationality = s.nationality
         JOIN rarity r ON r.value = s.rarity
         JOIN hull_type h ON h.type_id = s.ship_type
         WHERE s.group_type = ?`,
      20502,
    )
    assert.equal(ship.name, '厌战')
    assert.equal(ship.faction, '皇家')
    assert.equal(ship.rarity, '超稀有')
    assert.equal(ship.type_name, '战列')
    assert.equal(ship.team_type, 'main')

    // 12 项属性曲线，按 attr_def 的名字取
    const curve = db
      .prepare(
        `SELECT a.attr, a.base FROM ship_stage_attr a
         JOIN attr_def d ON d.name = a.attr
         WHERE a.group_type = ? AND d.name = 'durability' ORDER BY a.stage`,
      )
      .all(20502) as Array<{ attr: string; base: number }>
    assert.deepEqual(curve.map((c) => c.base), [1298, 1615, 2248, 3197])
    assert.equal(
      count(db, 'SELECT COUNT(DISTINCT attr) AS n FROM ship_stage_attr WHERE group_type = 20502'),
      12,
    )

    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM ship_skin WHERE group_type = ?', 20502), 5)
    // 规范名取 skin_type = -1 的那一行；厌战的第 5 行是改造皮肤「厌战.改」（skin_type 2）
    assert.equal(
      get<{ name: string }>(db, 'SELECT name FROM ship_skin WHERE group_type = 20502 AND skin_type = -1').name,
      '厌战',
    )

    // 技能：阶段行的 buff_list_display 解析到 skill_data_template 的名字与描述
    assert.deepEqual(
      db.prepare('SELECT name FROM ship_skill WHERE group_type = 20502 AND stage = 1 ORDER BY seq').all().map((r) => r.name),
      ['神射手', '皇家传奇'],
    )
    // 技能确实按突破阶段存：卡辛 1–3 阶段是「全弹发射I」，突破 4 换成「全弹发射II」，
    // 写成按船一条就会把 573 艘船的升级丢掉（实测 859 船里 573 船的阶段间列表不同）
    assert.deepEqual(
      db
        .prepare('SELECT stage, name FROM ship_skill WHERE group_type = 10103 AND seq = 3 ORDER BY stage')
        .all()
        .map((r) => `${r.stage}:${r.name}`),
      ['1:全弹发射I', '2:全弹发射I', '3:全弹发射I', '4:全弹发射II'],
    )

    // 装备位：槽位号 + 可装类型，类型名从 equip_kind 回读（type_name2 才分舰种）
    assert.deepEqual(
      db
        .prepare(
          `SELECT s.slot, k.type_name2 FROM ship_stage_slot s
           JOIN json_each(s.kinds) j ON 1=1
           JOIN equip_kind k ON k.type_id = j.value
           WHERE s.group_type = 20502 AND s.stage = 4 ORDER BY s.slot, k.type_id`,
        )
        .all()
        .map((r) => `${r.slot}:${r.type_name2}`),
      ['1:舰炮(战列)', '2:舰炮(驱逐)', '2:舰炮(轻巡)', '3:防空炮', '3:防空炮', '4:设备', '5:设备'],
    )

    // 六维：轴名由构建期相关性定位，实测第 1 位是炮击而不是属性 id 顺序里的耐久；
    // 厌战作为战列炮击 S / 耐久 A、雷击航空 E，与游戏内表现一致
    assert.deepEqual(
      db.prepare('SELECT label FROM hexagon_axis ORDER BY pos').all().map((r) => r.label),
      ['炮击', '雷击', '航空', '机动', '防空', '耐久'],
    )
    assert.equal(get<{ hexagon: string }>(db, 'SELECT hexagon FROM ship WHERE group_type = 20502').hexagon, 'S,E,E,D,D,A')

    // 语音：按皮肤给（厌战 5 个皮肤都有台词，默认皮肤 25 个场景 27 条）；
    // main 一格塞多条台词，拆行后实测单场景最多 7 条；场景键名保留字段原名，
    // 因为 CN 数据里没有场景的中文词条源，自己贴标签就成了抄文本
    assert.deepEqual(
      db
        .prepare(
          `SELECT sk.skin_id sid, COUNT(v.text) n FROM ship_skin sk JOIN ship_voice v ON v.skin_id = sk.skin_id
           WHERE sk.group_type = 20502 GROUP BY sk.skin_id ORDER BY sk.skin_id`,
        )
        .all()
        .map((r) => `${r.sid}:${r.n}`),
      ['205020:27', '205021:11', '205022:14', '205023:12', '205029:8'],
    )
    assert.equal(count(db, 'SELECT COUNT(DISTINCT scene) AS n FROM ship_voice WHERE skin_id = 205020'), 25)
    assert.equal(count(db, 'SELECT COUNT(DISTINCT scene) AS n FROM ship_voice'), 79)
    assert.equal(get<{ m: number }>(db, "SELECT MAX(seq) AS m FROM ship_voice WHERE scene = 'main'").m, 7)
    // 859 条船全都有语音；voice_key 不参与 join（852 行等于本组、1,516 行为 0、117 行指向别处）
    assert.equal(
      count(
        db,
        `SELECT COUNT(*) AS n FROM ship s WHERE NOT EXISTS
         (SELECT 1 FROM ship_voice v JOIN ship_skin sk ON sk.skin_id = v.skin_id WHERE sk.group_type = s.group_type)`,
      ),
      0,
    )
    assert.ok(get<{ name: string }>(db, 'SELECT name FROM retrofit_node WHERE group_type = 10103 LIMIT 1').name.length > 0)
    assert.equal(
      get<{ class_name: string }>(db, 'SELECT class_name FROM fleet_tech_ship WHERE group_type = 10102').class_name,
      '法拉格特级',
    )
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM ship_source WHERE command = 'SHIPBLUEPRINT'"), 42)
    // 筛选面板的基数：META 全部落 nationality 97，布里落 98
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM ship WHERE nationality = 97'), 59)
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM ship WHERE nationality = 98'), 3)
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM ship WHERE has_retrofit = 1'), 106)

    // 分类页的分区断言：五个维度各自把 859 艘船分完，落进导航之外一艘就是建页漏船
    for (const sql of [
      'SELECT COUNT(*) AS n FROM ship s JOIN faction f ON f.nationality = s.nationality',
      'SELECT COUNT(*) AS n FROM ship s JOIN hull_type h ON h.type_id = s.ship_type',
      'SELECT COUNT(*) AS n FROM ship s JOIN hull_type h ON h.type_id = s.ship_type JOIN team_position p ON p.team_type = h.team_type',
      'SELECT COUNT(*) AS n FROM ship s JOIN rarity r ON r.value = s.rarity',
      'SELECT COUNT(*) AS n FROM ship s JOIN handbook_kind k ON k.handbook_type = s.handbook_type',
    ]) {
      assert.equal(count(db, sql), 859, sql)
    }
    // 阵营登记了 29 个但实测有船的只有 28 个（鸢尾教国 0 艘），零成员不建页
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM faction'), 29)
    assert.equal(
      count(
        db,
        `SELECT COUNT(*) AS n FROM (SELECT f.nationality FROM faction f
         LEFT JOIN ship s ON s.nationality = f.nationality GROUP BY f.nationality HAVING COUNT(s.group_type) > 0)`,
      ),
      28,
    )
    assert.equal(get<{ name: string }>(db, 'SELECT f.name FROM faction f WHERE f.nationality = 10').name, '鸢尾教国')
    // 舰种名不唯一（21 个舰种 18 个名），所以 slug 用 type_id、同名靠站位补标签
    assert.equal(count(db, 'SELECT COUNT(DISTINCT type_name) AS n FROM hull_type'), 18)
    assert.deepEqual(
      db.prepare('SELECT name FROM team_position ORDER BY team_type').all().map((r) => r.name),
      ['后排主力', '潜艇编队', '前排先锋'],
    )
    assert.deepEqual(
      db
        .prepare(
          `SELECT k.slug, COUNT(s.group_type) AS n FROM handbook_kind k
           JOIN ship s ON s.handbook_type = k.handbook_type GROUP BY k.handbook_type ORDER BY k.handbook_type`,
        )
        .all()
        .map((r) => `${r.slug}:${r.n}`),
      ['regular:667', 'collab:91', 'research:42', 'meta:59'],
    )
    db.close()
  })
})

test('meta 里记了 schema 版本、来源 SHA 与逐表行数（不含时间戳）', { skip }, () => {
  inTemp((file) => {
    buildDatabase(NORM, file, sha as string)
    const db = new DatabaseSync(file, { readOnly: true })
    const rows = db.prepare('SELECT key, value FROM meta ORDER BY key').all() as Array<{ key: string; value: string }>
    const meta = new Map(rows.map((r) => [r.key, r.value]))
    db.close()
    assert.equal(meta.get('schema_version'), '3')
    assert.equal(meta.get('data_sha'), sha)
    assert.equal(meta.get('count:ship'), '859')
    assert.equal(meta.get('count:ship_stage_attr'), '41124')
    assert.equal(meta.get('count:ship_stage_slot'), '17135')
    assert.equal(meta.get('count:ship_skill'), '9239')
    assert.equal(meta.get('count:ship_voice'), '43495')
    assert.equal(meta.get('count:hexagon_axis'), '6')
    assert.equal(meta.get('count:equip_kind'), '19')
    assert.equal(meta.get('count:handbook_kind'), '4')
    assert.equal(meta.get('count:team_position'), '3')
    assert.equal(meta.get('count:retrofit_node'), '1217')
    assert.equal(meta.get('count:orphan_skin'), '358')
    assert.ok(!rows.some((r) => /sync|time|date/i.test(r.key)), 'meta 里出现了时间类键，建库就不再字节可复现')
  })
})
