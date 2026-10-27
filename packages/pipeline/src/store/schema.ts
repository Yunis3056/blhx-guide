/**
 * data/al.sqlite 的 DDL。构建期唯一的一份建库定义，页面侧只读。
 *
 * 确定性（§4.6）：page_size 固定、插入前一律按主键排序、索引名显式且不依赖
 * SQLite 自生成的名字。缺任何一条，「同数据两次建库逐字节相同」就不成立，
 * §6.2 的确定性重建与 manifest 哈希校验会同时失去依据。
 *
 * 属性不按 3×12 列铺开，而是 attr_def × ship_stage 的窄表：舰船页要画的是
 * 「某一项属性随突破的变化」，窄表直接按 attr 名取，不必知道它在数组第几位。
 */

export const SCHEMA_VERSION = 2

export const DDL = `
PRAGMA page_size = 4096;

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE faction (
  nationality INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  source      TEXT NOT NULL
);

CREATE TABLE attr_def (
  idx   INTEGER PRIMARY KEY,
  attr_id INTEGER NOT NULL UNIQUE,
  name  TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL
);

-- 六维雷达的六个位置各自是哪一项属性。顺序**不是** attr_def 的 1..6：
-- 构建期按 856 条船的实测相关性逐位取 |Spearman| 最大项，六个必须互不相同，
-- 任一位置换人即中止（见 normalize/hexagon.ts）。
CREATE TABLE hexagon_axis (
  pos   INTEGER PRIMARY KEY,
  attr  TEXT NOT NULL REFERENCES attr_def(name),
  label TEXT NOT NULL
);

CREATE TABLE equip_kind (
  type_id    INTEGER PRIMARY KEY,
  type_name  TEXT NOT NULL,
  type_name2 TEXT NOT NULL
);

CREATE TABLE rarity (
  value INTEGER PRIMARY KEY,
  label TEXT NOT NULL
);

CREATE TABLE hull_type (
  type_id   INTEGER PRIMARY KEY,
  type_name TEXT NOT NULL,
  team_type TEXT NOT NULL
);

CREATE TABLE ship (
  group_type      INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  english_name    TEXT NOT NULL,
  code            TEXT NOT NULL,
  index_id        INTEGER NOT NULL,
  handbook_type   INTEGER NOT NULL,
  nationality     INTEGER NOT NULL REFERENCES faction(nationality),
  ship_type       INTEGER NOT NULL REFERENCES hull_type(type_id),
  rarity          INTEGER REFERENCES rarity(value),
  default_skin_id INTEGER,
  skin_count      INTEGER NOT NULL,
  has_retrofit    INTEGER NOT NULL,
  fleet_class_id  INTEGER,
  hexagon         TEXT NOT NULL
);
CREATE INDEX ship_filter ON ship (nationality, ship_type, rarity, handbook_type);
CREATE INDEX ship_name ON ship (name);

CREATE TABLE ship_stage (
  row_id     INTEGER PRIMARY KEY,
  group_type INTEGER NOT NULL REFERENCES ship(group_type),
  skin_id    INTEGER NOT NULL,
  stage      INTEGER NOT NULL,
  star       INTEGER NOT NULL,
  rarity     INTEGER NOT NULL,
  armor_type INTEGER NOT NULL,
  default_equip_list TEXT NOT NULL,
  fix_equip_list     TEXT NOT NULL
);
CREATE INDEX stage_ship ON ship_stage (group_type, stage);

CREATE TABLE ship_stage_attr (
  group_type INTEGER NOT NULL REFERENCES ship(group_type),
  stage      INTEGER NOT NULL,
  attr       TEXT    NOT NULL REFERENCES attr_def(name),
  base       REAL    NOT NULL,
  growth     REAL    NOT NULL,
  growth_extra REAL  NOT NULL,
  PRIMARY KEY (group_type, stage, attr)
);

-- 装备位：槽位号 1..5 与「这一位允许哪些装备类型」。槽位含义随舰种变（实测
-- 槽 1 可为舰炮/防空炮/战斗机/鱼雷…，槽 4/5 只出设备/反潜机/直升机/货物），
-- 所以页面按可装类型显示，不给槽位起固定名字。
CREATE TABLE ship_stage_slot (
  group_type INTEGER NOT NULL REFERENCES ship(group_type),
  stage      INTEGER NOT NULL,
  slot       INTEGER NOT NULL,
  kinds      TEXT NOT NULL,
  PRIMARY KEY (group_type, stage, slot)
);

-- 技能名与描述：阶段行的 buff_list_display 逐条解析到 skill_data_template。
-- 实测 9,239 项全部命中，零未解析，所以这里用外键级约束而不是宽松文本。
CREATE TABLE ship_skill (
  group_type INTEGER NOT NULL REFERENCES ship(group_type),
  stage      INTEGER NOT NULL,
  seq        INTEGER NOT NULL,
  skill_id   INTEGER NOT NULL,
  name       TEXT NOT NULL,
  descr      TEXT NOT NULL,
  skill_type INTEGER NOT NULL,
  PRIMARY KEY (group_type, stage, seq)
);
CREATE INDEX skill_ship ON ship_skill (group_type, stage);

CREATE TABLE ship_skin (
  skin_id     INTEGER PRIMARY KEY,
  group_type  INTEGER NOT NULL,
  name        TEXT NOT NULL,
  skin_type   INTEGER NOT NULL,
  painting    TEXT NOT NULL,
  voice_actor TEXT
);
CREATE INDEX skin_ship ON ship_skin (group_type, skin_type);

CREATE TABLE ship_source (
  group_type INTEGER NOT NULL REFERENCES ship(group_type),
  seq        INTEGER NOT NULL,
  text       TEXT NOT NULL,
  command    TEXT NOT NULL,
  args       TEXT,
  PRIMARY KEY (group_type, seq)
);
CREATE INDEX source_command ON ship_source (command);

CREATE TABLE retrofit (
  group_type      INTEGER PRIMARY KEY REFERENCES ship(group_type),
  trans_type      INTEGER NOT NULL,
  trans_skin      INTEGER NOT NULL,
  trans_skill     TEXT NOT NULL,
  trans_radar     TEXT NOT NULL,
  result_skin_id  INTEGER NOT NULL,
  result_skill_id INTEGER NOT NULL
);

CREATE TABLE retrofit_node (
  node_id     INTEGER PRIMARY KEY,
  group_type  INTEGER NOT NULL REFERENCES retrofit(group_type),
  branch      INTEGER NOT NULL,
  seq         INTEGER NOT NULL,
  slot_type   INTEGER NOT NULL,
  name        TEXT NOT NULL,
  descrip     TEXT NOT NULL,
  effect      TEXT NOT NULL,
  use_gold    INTEGER NOT NULL,
  use_item    TEXT NOT NULL,
  use_ship    TEXT NOT NULL,
  level_limit INTEGER NOT NULL,
  star_limit  INTEGER NOT NULL
);
CREATE INDEX retrofit_branch ON retrofit_node (group_type, branch, seq);

CREATE TABLE fleet_tech_group (
  group_id INTEGER PRIMARY KEY,
  name     TEXT NOT NULL,
  nation   TEXT NOT NULL,
  techs    TEXT NOT NULL
);

CREATE TABLE fleet_tech_node (
  node_id  INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES fleet_tech_group(group_id),
  cost     INTEGER NOT NULL,
  pt       INTEGER NOT NULL,
  time     INTEGER NOT NULL,
  awards   TEXT NOT NULL
);

CREATE TABLE fleet_tech_node_add (
  node_id   INTEGER NOT NULL REFERENCES fleet_tech_node(node_id),
  seq       INTEGER NOT NULL,
  shiptypes TEXT NOT NULL,
  level     INTEGER NOT NULL,
  value     INTEGER NOT NULL,
  PRIMARY KEY (node_id, seq)
);

CREATE TABLE fleet_tech_ship (
  group_type    INTEGER PRIMARY KEY REFERENCES ship(group_type),
  class_id      INTEGER NOT NULL,
  class_name    TEXT NOT NULL,
  class_nation  INTEGER NOT NULL,
  class_type    INTEGER NOT NULL,
  max_star      INTEGER NOT NULL,
  pt_get        INTEGER NOT NULL,
  pt_level      INTEGER NOT NULL,
  pt_upgrade    INTEGER NOT NULL,
  add_get       TEXT NOT NULL,
  add_level     TEXT NOT NULL
);

CREATE TABLE orphan_skin (
  skin_id    INTEGER PRIMARY KEY,
  group_type INTEGER NOT NULL,
  name       TEXT NOT NULL,
  reason     TEXT NOT NULL
);
`
