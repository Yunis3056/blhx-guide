/**
 * 表注册表。三件事在这里强制：
 *   1. 目录前缀 —— CN/ShareCfg 与 CN/sharecfgdata 有 24 组严格互补的同名表，
 *      ShareCfg 侧那 24 张固定是空壳 []/{}，读错侧不报错，只产出空站点。
 *   2. keyStrategy —— 键空间不统一，gametip 是 7449 个字符串键（数字键 0 个），
 *      而多数配置表是数字键 + 一个 all 哨兵（值是 id 数组）。一刀切会清空 gametip。
 *   3. semantic —— 表名会骗人。technology_data_template 是科研项目不是科技树，
 *      equip_data_statistics 是族行+等级行混排不是一行一装备。
 *      未实测条目数的表 measured:false，禁止编造 minRows。
 */

export type Dir = 'ShareCfg' | 'sharecfgdata' | 'GameCfg'
export type KeyStrategy = 'numeric' | 'numeric-excluding-all' | 'string'
export type TopShape = 'dict' | 'list'

export interface TableSpec {
  dir: Dir
  /** 不含 .json */
  name: string
  top: TopShape
  keyStrategy: KeyStrategy
  /** 一句话说明这张表到底是什么 */
  semantic: string
  /** semantic 里引用的具体证据条目，CI 断言非空 */
  evidence: string
  /** 已实测的最小条目数阈值；未实测为 undefined */
  minRows?: number
  measured: boolean
  tier: 'A' | 'B' | 'C' | 'D'
}

const T = (s: TableSpec) => s

export const TABLES = {
  // ── A 档：舰船图鉴主线 ──────────────────────────────────────────
  shipGroup: T({
    dir: 'ShareCfg',
    name: 'ship_data_group',
    top: 'dict',
    keyStrategy: 'numeric',
    semantic: '图鉴基船条目，页面主键 group_type。注意本表没有 name 字段，船名须经皮肤层两跳取得',
    evidence: '859 行；字段无 name；trans_type 非零 78、trans_skin 非零 106',
    minRows: 700,
    measured: true,
    tier: 'A',
  }),
  shipSkinTemplate: T({
    dir: 'ShareCfg',
    name: 'ship_skin_template',
    top: 'dict',
    keyStrategy: 'numeric',
    semantic: '皮肤层，id 即图片 join 用的 skinId（不是基船 id）',
    evidence: '2,730 行；distinct ship_group 1,211；skin_type -1 为默认立绘',
    minRows: 2200,
    measured: true,
    tier: 'A',
  }),
  shipStats: T({
    dir: 'sharecfgdata',
    name: 'ship_data_statistics',
    top: 'dict',
    keyStrategy: 'numeric',
    semantic:
      '★ 混合两套行：3,429 行是 (船 × 突破阶段) 行，判据 id - skin_id ∈ 1..4；其余 528 行是 attrs 全 1 的展示单位与 id 自指的非舰船行。按 skin_id 聚合时必须先切阶段行，否则同一艘船会读出两个 rarity（全表 11 例）',
    evidence:
      '3,957 行 = 阶段行 3,429（860 个 skin_id，856 组正好 4 行，rarity 域恰好 {2,3,4,5,6}，0 例冲突）+ 非阶段行 528（rarity=18 的三行全在这侧）；attrs / attrs_growth / attrs_growth_extra 三个数组全部定长 12',
    minRows: 3200,
    measured: true,
    tier: 'A',
  }),
  shipTemplate: T({
    dir: 'sharecfgdata',
    name: 'ship_data_template',
    top: 'dict',
    keyStrategy: 'numeric',
    semantic: '舰船基础配置；等级上限的唯一来源',
    evidence: '3,806 条；max_level 全部 = 100（故成长曲线只承诺 1-100，不是 1-125）',
    minRows: 3200,
    measured: true,
    tier: 'A',
  }),
  shipBreakout: T({
    dir: 'sharecfgdata',
    name: 'ship_data_breakout',
    top: 'dict',
    keyStrategy: 'numeric',
    semantic: '突破材料表。条数少于阶段行数，不可假设每个 stats 行都取得到材料',
    evidence: '3,347 条 ≠ ship_data_statistics 的 3,957，两表非一一对应',
    minRows: 2800,
    measured: true,
    tier: 'A',
  }),
  attrInfo: T({
    dir: 'ShareCfg',
    name: 'attribute_info_by_type',
    top: 'dict',
    keyStrategy: 'numeric-excluding-all',
    semantic: '12 项属性的权威定义（下标 → name/condition），属性映射的唯一来源，禁止硬编码',
    evidence: '位 2 是 cannon「炮击」而非「火力」；含 all:[1..12]，键集与 enemy_data_statistics 具名属性一致',
    minRows: 11,
    measured: true,
    tier: 'A',
  }),
  shipByType: T({
    dir: 'ShareCfg',
    name: 'ship_data_by_type',
    top: 'dict',
    keyStrategy: 'numeric-excluding-all',
    semantic: '舰种权威枚举（含 team_type 站位、维修/退役回收等经济参数）',
    evidence: '22 键 = 21 个数值类 + all:[1..13,17..24]；14/15/16 不存在',
    minRows: 18,
    measured: true,
    tier: 'A',
  }),
  gametip: T({
    dir: 'sharecfgdata',
    name: 'gametip',
    top: 'dict',
    keyStrategy: 'string',
    semantic: '全部中文显示文本索引（阵营名、舰种名、装备类别等）。★ 空壳时最隐蔽：不影响行数统计却清空所有中文名',
    evidence: '7,449 键，数字键 0 个，样本 0815_main_help / word_shipNation_*；word_* 前缀 402 条',
    minRows: 6000,
    measured: true,
    tier: 'A',
  }),
  voiceActorCN: T({
    dir: 'ShareCfg',
    name: 'voice_actor_CN',
    top: 'dict',
    keyStrategy: 'string',
    semantic: 'CV 姓名表，使皮肤页可显示配音演员（画师无此来源，不展示）。键是 CV 的字符串 id，不是数字',
    evidence: '502 条 {actor_name, code}；skin.voice_actor 全部是 int，用到 476 个 id；「无 CV」有两个哨兵 0 与 -1（0 只出现在 900xxx 的 NPC 皮肤段 39 行，-1 出现在其余非图鉴皮肤），除这两个哨兵外全部命中；illustrator.json 41 行只有 code 无姓名',
    minRows: 400,
    measured: true,
    tier: 'A',
  }),

  // ── B 档：改造、语音、科技、掉落 ────────────────────────────────
  shipTrans: T({
    dir: 'ShareCfg',
    name: 'ship_data_trans',
    top: 'dict',
    keyStrategy: 'numeric-excluding-all',
    semantic: '改造分支（哪个船改造成哪个皮肤/技能）。节点条件与成本不在本表',
    evidence: '107 键 = 106 条 + all；字段 {group_id, skin_id, skill_id, transform_list}；transform_list 恒为 6 个分支、共 1,217 个 [槽类型, 节点 id] 二元组，与 transform_data_template 双射；槽类型实测 {2:329, 3:636, 4:252} 且无文本说明其语义',
    minRows: 90,
    measured: true,
    tier: 'B',
  }),
  transformNode: T({
    dir: 'ShareCfg',
    name: 'transform_data_template',
    top: 'dict',
    keyStrategy: 'numeric',
    semantic: '改造节点的条件与成本 —— 改造消耗计算的唯一来源。缺它就只能列节点名',
    evidence: '1,217 节点无 all 键；节点 501 = 舰体改良I / effect:[{durability:45}] / use_gold:200 / use_item:[[[18001,1]]]',
    minRows: 1000,
    measured: true,
    tier: 'B',
  }),
  researchProject: T({
    dir: 'ShareCfg',
    name: 'technology_data_template',
    top: 'dict',
    keyStrategy: 'numeric-excluding-all',
    semantic: '★ 科研项目目录，不是舰队科技树（表名骗人）。舰队科技另由 fleet_tech_* 建模。' +
      '注意此表在 ShareCfg 侧且有数据（506KB），不属于 24 组同名空壳 —— 目录不可凭「像是数值表」推断',
    evidence: '686 键 = 685 条 + all；项目 1 = C-153-MI / time=21600；项目 11 描述原文「该科研项目致力于…收集各种实验数据」',
    minRows: 550,
    measured: true,
    tier: 'B',
  }),
  shipSkinWords: T({
    dir: 'sharecfgdata',
    name: 'ship_skin_words',
    top: 'dict',
    keyStrategy: 'numeric',
    semantic: '语音文本（battle/home/expedition/gift 等场景的全中文台词）',
    evidence: '2,485 条，各场景字段均为中文',
    minRows: 2000,
    measured: true,
    tier: 'B',
  }),
  skillTemplate: T({
    dir: 'ShareCfg',
    name: 'skill_data_template',
    top: 'dict',
    keyStrategy: 'numeric',
    semantic: '技能名与静态描述。机制/触发/buff 数值不在本表，在 GameCfg/skill.json（不取）',
    evidence: '3,030 行全部有 name',
    minRows: 2400,
    measured: true,
    tier: 'A',
  }),
  enemyStats: T({
    dir: 'ShareCfg',
    name: 'enemy_data_statistics',
    top: 'dict',
    keyStrategy: 'numeric',
    semantic: '敌方单位属性，用具名字段（与舰船侧的位置数组互为交叉验证）',
    evidence: '13,568 条；仅 1,962 行有 name；base 不回连任何舰船表（交集 0）',
    minRows: 11000,
    measured: true,
    tier: 'B',
  }),

  // ── C 档：装备 ─────────────────────────────────────────────────
  equipStats: T({
    dir: 'sharecfgdata',
    name: 'equip_data_statistics',
    top: 'dict',
    keyStrategy: 'numeric',
    semantic: '★ 族行与强化等级行混排，靠 base 继承。8,261 行自身无 name/type/rarity/icon，不展开继承就是 8,261 个空名字页',
    evidence: '10,365 行；8,841 带 base；stats[501] base=500 且自有字段仅 value_1/value_2',
    minRows: 9000,
    measured: true,
    tier: 'A',
  }),
  equipTemplate: T({
    dir: 'sharecfgdata',
    name: 'equip_data_template',
    top: 'dict',
    keyStrategy: 'numeric',
    semantic: '普通强化等级链（next/prev）+ 装备正体判定连接表 + 分解/回收/转换经济参数',
    evidence: '9,170 条；8,261 行有 next 且全部能在本表解析，0 断裂（500 lv1 → 501 lv2 → 502…）',
    minRows: 8000,
    measured: true,
    tier: 'A',
  }),
  equipByType: T({
    dir: 'ShareCfg',
    name: 'equip_data_by_type',
    top: 'dict',
    keyStrategy: 'numeric-excluding-all',
    semantic: '装备分类的权威枚举；装备条目的正向判据之一',
    evidence: '20 键 = 19 个数值类 + all；type_name 12 种（舰炮/鱼雷/防空炮/战斗机/…）',
    minRows: 17,
    measured: true,
    tier: 'A',
  }),
  equipUpgradeData: T({
    dir: 'ShareCfg',
    name: 'equip_upgrade_data',
    top: 'dict',
    keyStrategy: 'numeric-excluding-all',
    semantic: '★ 装备转换 / 研发图（有分叉与汇合），不是普通强化等级链（那是 equip_data_template.next/prev）',
    evidence: '282 键 = 281 条 + all:[4340,11060,…]；{id, upgrade_from, target_id, material_consume, coin_consume}',
    minRows: 240,
    measured: true,
    tier: 'A',
  }),

  nameCode: T({
    dir: 'ShareCfg',
    name: 'name_code',
    top: 'dict',
    keyStrategy: 'numeric',
    semantic:
      '★ 船名占位符解析表。ship_skin_template.name 里的 {namecode:N} 必须在这里展开，否则图鉴近半标题是字面量花括号。nation / type 两个字段恒定（439 条里 437 条 nation=0），不可当阵营用',
    evidence:
      '439 条数字键，无 all 哨兵；1,213 条规范名（skin_type=-1）中 361 条是占位；全表实际引用 276 个 namecode，逐个命中；带后缀形态如 {namecode:197}(μ兵装)、{namecode:93}·META，须逐处替换而非整串查表',
    minRows: 400,
    measured: true,
    tier: 'A',
  }),
  memoryStoryline: T({
    dir: 'ShareCfg',
    name: 'memory_storyline',
    top: 'dict',
    keyStrategy: 'numeric-excluding-all',
    semantic:
      '★ 活动 / 剧情线一览，带 shipnation 数字阵营数组与中文事件名 —— 这是 CN 数据里第二处出现数字阵营的地方，也是把 nationality 钉成阵营名的主要证据源（如 89「重樱的邀约」shipnation=[3]）',
    evidence: '95 条 + all 哨兵；字段 {id,name,description,bgm,shipnation,link_event,memory_id,chapter,…}；shipnation 观测值 {1,2,3,4,5,6,7,10,11,97}',
    minRows: 90,
    measured: true,
    tier: 'B',
  }),
  equipByQuality: T({
    dir: 'ShareCfg',
    name: 'equip_data_by_quality',
    top: 'dict',
    keyStrategy: 'numeric-excluding-all',
    semantic:
      '装备档位经济表（gear_score / gear_score_addition / destory_resource_ratio）。名字像品质标签表，实际**没有任何显示名字段** —— 装备稀有度在 CN 数据里没有文本源，只能人工登记',
    evidence: '6 档 + all:[1,2,3,4,5,6]；单条字段仅 {destory_resource_ratio, equip_quality, gear_score, gear_score_addition}',
    minRows: 6,
    measured: true,
    tier: 'A',
  }),

  // ── 尚未实测的表：禁止编造 minRows，首次取数时由脚本记录真实条目数 ──
  fleetTechGroup: T({
    dir: 'ShareCfg',
    name: 'fleet_tech_group',
    top: 'dict',
    keyStrategy: 'numeric-excluding-all',
    semantic: '舰队科技的四个分组，**分组名自带阵营**（「作战技术-白鹰」+ nation:[1]），是科技体系的入口表',
    evidence: '4 条 + all；{id, name, nation[], shiptype[], techs[9]}；techs 恰好覆盖 fleet_tech_template 的 36 个节点，无孤儿',
    minRows: 4,
    measured: true,
    tier: 'A',
  }),
  fleetTechTemplate: T({
    dir: 'ShareCfg',
    name: 'fleet_tech_template',
    top: 'dict',
    keyStrategy: 'numeric-excluding-all',
    semantic: '舰队科技节点 —— 与科研项目 technology_data_template 是两个体系，名字像但完全不同源',
    evidence: '36 节点 + all；{id 1001..4009, groupid 1..4, cost, pt, time, add[[[舰种数组, 1..12, 数值]]], level_award_display 首元恒为类型 2}；add 的舰种集合 ⊆ ship_data_by_type 键集',
    minRows: 30,
    measured: true,
    tier: 'A',
  }),
  fleetTechShipClass: T({
    dir: 'ShareCfg',
    name: 'fleet_tech_ship_class',
    top: 'dict',
    keyStrategy: 'numeric-excluding-all',
    semantic: '★ 舰级表（「法拉格特级」「格里德利级」）—— 数据里唯一带**权威中文舰级名**的一张，可进舰船页与搜索别名',
    evidence: '385 条 + all；{id, name, nation, ships[]→group_type, shiptype ⊆ ship_data_by_type, t_level, t_level_1}；nation 分布 1..11 与 96/97，**不含 98 与 101–115**（联动与布里没有舰级）',
    minRows: 350,
    measured: true,
    tier: 'A',
  }),
  fleetTechShipTemplate: T({
    dir: 'ShareCfg',
    name: 'fleet_tech_ship_template',
    top: 'dict',
    keyStrategy: 'numeric-excluding-all',
    semantic: '单船科技点加成。**主键 id 就是 group_type**（726/726 落在图鉴白名单内），class 字段才指向舰级表',
    evidence: '726 条 + all；id ∈ ship_data_group.group_type 全覆盖，class ∈ fleet_tech_ship_class 726/726；覆盖 726/859 艘船，缺的 133 艘是联动与布里；字段 pt_get / pt_level / pt_upgrage（上游就把 upgrade 拼成 upgrage）',
    minRows: 700,
    measured: true,
    tier: 'A',
  }),
  shipDataByStar: T({
    dir: 'ShareCfg',
    name: 'ship_data_by_star',
    top: 'dict',
    keyStrategy: 'numeric',
    semantic: '★ 星级经济参数表（分解产物/油料回复比/兑换价/等级限制），不是稀有度显示名标签',
    evidence: '字段 destory_item / energy_recover_food_ratio / energy_recover_time_ratio / exchange_price / level_restrictions；无显示名字段',
    measured: false,
    tier: 'A',
  }),
} satisfies Record<string, TableSpec>

export type TableKey = keyof typeof TABLES

/**
 * 仓库根相对路径。ShareCfg 与 sharecfgdata 存在同名表，
 * 任何按裸文件名读表的代码都属于缺陷。
 */
export function relPath(spec: TableSpec): string {
  return `CN/${spec.dir}/${spec.name}.json`
}

/**
 * 按 keyStrategy 取主键集合。
 * 全局一律 /^\\d+$/ 会把 gametip（7,449 个字符串键）取成空集。
 */
export function keysOf(raw: unknown, spec: TableSpec): string[] {
  if (Array.isArray(raw)) {
    if (spec.top !== 'list') {
      // 措辞很重要：把「读错目录」报成「类型不匹配」会把排查引向 schema 而不是路径。
      // ShareCfg 侧那 24 张空壳是 [] 或 {}，空数组正是走这条分支进来的。
      throw new Error(
        `${spec.name}: 顶层是数组（${raw.length} 项）但注册表声明 top:'dict'。` +
          (raw.length === 0
            ? '空数组 —— 高度怀疑读到了同名空壳表，应读 sharecfgdata 侧'
            : '非空数组 —— 上游改了顶层结构') +
          `（声明路径 ${spec.dir}）`,
      )
    }
    return raw.map((_, i) => String(i))
  }
  if (raw && typeof raw === 'object') {
    if (spec.top !== 'dict') {
      throw new Error(`${spec.name}: 顶层是对象但注册表声明 top:'${spec.top}'`)
    }
    const all = Object.keys(raw)
    switch (spec.keyStrategy) {
      case 'numeric': {
        // 严格：这张表除主键外不该有任何非数字键。出现即上游改了键空间，必须停
        const bad = all.filter((k) => !/^\d+$/.test(k))
        if (bad.length > 0) {
          throw new Error(
            `${spec.name}: keyStrategy:'numeric' 但出现 ${bad.length} 个非数字键（样本 ${bad.slice(0, 3).join(', ')}）。` +
              `若该表本就带 all 哨兵，应显式声明 numeric-excluding-all`,
          )
        }
        return all
      }
      case 'numeric-excluding-all':
        // 允许且仅允许 all 这一个非数字哨兵
        return all.filter((k) => /^\d+$/.test(k))
      case 'string':
        return all
    }
  }
  throw new Error(`${spec.name}: 无法识别的顶层类型`)
}

/** 加载后断言。空壳 []/{} 在这里被拦下，不会静默进入归一化产物。 */
export function assertSpec(raw: unknown, spec: TableSpec): string[] {
  if (spec.semantic.length === 0) throw new Error(`${spec.name}: 缺少 semantic 说明`)
  if (spec.evidence.length === 0) throw new Error(`${spec.name}: 缺少 evidence 证据条目`)
  const keys = keysOf(raw, spec)
  if (keys.length === 0) {
    throw new Error(
      `${spec.name}: 条目数为 0。这通常是读到了同名空壳表 —— 应读目录 ` +
        `${spec.dir}，检查 ${relPath(spec)} 是否取自 sharecfgdata 侧`,
    )
  }
  if (spec.measured) {
    if (spec.minRows === undefined) {
      throw new Error(`${spec.name}: measured:true 却没有 minRows 阈值`)
    }
    if (keys.length < spec.minRows) {
      throw new Error(
        `${spec.name}: 条目数 ${keys.length} 低于注册表阈值 ${spec.minRows}（` +
          `实测基准见 evidence: ${spec.evidence}）。中止同步，不覆盖 normalized`,
      )
    }
  } else if (spec.minRows !== undefined) {
    throw new Error(`${spec.name}: 未实测的表不允许设置 minRows，请先实测再回填`)
  }
  return keys
}
