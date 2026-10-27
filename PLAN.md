# 碧蓝航线全量攻略站 · 实施方案

> v8 · 2026-10-26
> 部署：Cloudflare Pages + R2 · 数据范围：CN 国服 · 形态：图鉴 + 工具 + 攻略内容
> 本版不含工期估算，只给依赖顺序与验收标准

**证据等级（读这份文档前先看这条）**

本文里的「已验证」**只指数据调查**——即对 `AzurLaneData` 真实文件的解析与计数，可用 §附录 A 的探测项复现。它**不等于工程验证**：截至目前仓库里只有本文件，没有代码、锁文件、fixture、workflow 运行记录或部署记录。因此：

| 标记 | 含义 | 出现位置 |
|---|---|---|
| **D-verified** | 数据事实，已用真实文件测出，可复现 | 表条目数、字段名、连接命中率、数组长度 |
| **E-unverified** | 设计意图，**尚未跑过一行代码** | 构建时长、产物文件数、Pages/R2 行为、CI 流程、Lighthouse 分数 |
| **待实测** | 已识别但未解决的具体问题 | Pages 构建镜像是否默认暴露 `node:sqlite`（是否需 `--experimental-sqlite`）、CN 立绘与 EN 的约 117 张皮肤缺口清单、`sharp` 在 Pages Linux 的预编译可用性 |

§7 各阶段的「验收」列的是**将来要跑的机器化断言**，不是已经通过的检查。任何 E-unverified 的数字（尤其产物文件数与构建时长）只能当量级参考，阶段 1 的首次冷构建会推翻它们——这是预期内的，不是异常。

---

## 目录

- [核心原则](#核心原则)
- [0. 前置准备](#0-前置准备)
- [1. 架构总览](#1-架构总览)
- [2. 仓库结构](#2-仓库结构)
- [3. 数据层](#3-数据层)
- [4. 应用层](#4-应用层)
- [5. 内容层](#5-内容层)
- [6. CI/CD](#6-cicd)
- [7. 实施顺序](#7-实施顺序)
- [8. 能力边界：能从数据做到什么](#8-能力边界能从数据做到什么不能做到什么)
- [9. 成本](#9-成本)
- [10. 风险登记册](#10-风险登记册)
- [11. 数据调查结论](#11-数据调查结论)
- [12. 待提供输入](#12-待提供输入)
- [附录 A：已验证事实](#附录-a已验证事实)
- [附录 B：参考资料](#附录-b参考资料)

---

## 核心原则

**能被解包数据覆盖的，绝不手写；只有「判断与经验」才人工创作。**

图鉴类内容（属性、突破、皮肤、改造、科技点、材料掉落、装备数值）自动生成；人工只写配队理由、开荒路线、活动打法这类主观判断。

五条硬规则：

1. **正向建模，不猜枚举，也不猜 id 区间。** 舰船、舰种、属性、装备分类一律用游戏自带定义表作权威来源。**任何 `id ≥ N` / `id ∈ [a,b]` 形式的截断都不算判据**——本项目的装备条目判定先后犯过两次：`id≥10000` 把 175 条真装备（小海狸中队队徽、珍珠之泪、九一式穿甲弹、Z旗…）连同整个低编号段切掉，而同一区间里又确实混着内建条目（id 2 序章演示、id 20 关卡测试鱼雷）。id 既非充分也非必要，只能用定义表 + 连接表 + 结构身份（族根）三条共同判定。
2. **构建期零网络依赖。** 只有取数环节碰外网，产出是提交进仓库的归一化数据集；Pages 构建只消费仓库内容。
3. **数据版本是硬事实。** 渲染所用的 commit SHA、同步时间、递增快照号全部入库，`/about` 展示的截止日期必然真实。
4. **表名不等于内容。** `CN/ShareCfg` 与 `CN/sharecfgdata` 存在 **24 组同名表**，ShareCfg 侧固定是空壳（`[]` / `{}`），权威数据只在 sharecfgdata 侧，两侧严格互补。所有表引用必须带目录前缀，并在加载时断言条目数下限（§3.4）。
5. **做不到的写明做不到。** 数据的边界在 §8 逐条列明，宁可功能范围小而准确，不做大而含糊。

---

## 0. 前置准备

| # | 事项 | 说明 | 负责 | 需要时点 |
|---|---|---|---|---|
| 1 | GitHub 公开仓库 | 建 `blhx-guide`，**必须公开**（Actions 才有无限免费分钟） | Agent | 起步 |
| 2 | Cloudflare Pages 项目 | 连 GitHub 仓库，**Framework preset 选 None**，Build command `pnpm build`，Output `apps/web/out`，环境变量 `NODE_VERSION=24` | Agent | 起步 |
| 3 | 域名 NS 切到 Cloudflare | 添加站点（Free 计划）→ 拿两个 NS 地址 → 回注册商改 NS → 等生效。**R2 绑自定义域名的硬前提** | 用户 | 上云时 |
| 4 | 开通 R2 | Dashboard → R2 → 需绑信用卡或 PayPal（不扣费）→ 创建 bucket `blhx-img` | 用户 | 上云时 |
| 5 | R2 绑自定义域名 | bucket → Settings → Custom Domains → 填 `img.<域名>`，CF 自动建 CNAME | 用户 | 上云时 |
| 6 | 创建 API Token | R2 → Manage R2 API Tokens → 权限 Object Read & Write，限定该 bucket；记下 Account ID | 用户 | 上云时 |
| 7 | GitHub Secrets | `CF_ACCOUNT_ID` / `R2_AK` / `R2_SK` | 用户 | 上云时 |
| 8 | 主站绑域名 | Pages → Custom domains → `www.<域名>` | 用户 | 上云时 |
| 9 | `corepack enable` | 当前环境未装 pnpm，Node 24 自带 corepack。**非管理员下直接 `corepack enable` 会 EPERM**（要写 `D:\Program Files\nodejs`），本地须改用 `corepack enable --install-directory "$HOME/.corepack-bin" pnpm` 且把该目录加入 `PATH`——turbo 自己找包管理器二进制，不认 `corepack pnpm` 这层调用 | Agent | 起步 |
| 10 | **图片再分发授权决定** | 两个上游仓库 GitHub API 均返回 `license: null`（`AzurLaneTools/AzurLaneData` 与 `Fernando2603/AzurLane`）。README 里的非商业声明、署名或 DMCA 邮箱**都不构成再分发许可**。上线前必须三选一：①取得蛮啾/勇仕/YoStar 书面授权 ②不转托管图片，改为不保存图片的方案 ③只做本地/内网演示不公开。详见 §8.5 | 用户 | **上线前**，非上云时 |

**阶段 1–2 不依赖第 3–8 项，但依赖第 10 项的判断**：`LocalAdapter` 写 `data/images/`（不入库），阶段 1–2 只在本地验证 skinId join 与转码链路，**线上图片验收从阶段 1 移除**（见 §7 阶段 1 验收），到阶段 3 R2 就绪且第 10 项有结论时才做。否则阶段 1 部署出的页面必然断链——Pages 构建拿不到 `data/images/`。

不使用 `r2.dev` 做开发期方案：它有约 1,000 req/min 限制且官方明确不推荐生产，用它等于验证一条生产不会走的路径。

第 2 项的 preset 必须选 **None**：Next.js preset 会走 `@cloudflare/next-on-pages`（已弃用，官方推 OpenNext）的 SSR 路径，与 `output: 'export'` 冲突。另需注意 **Cloudflare Pages 构建期仍会执行依赖安装**，官方文档亦说明 Pages 会 install 依赖；因此本文的口径是「**构建阶段不访问业务数据源**」，不是「构建全程零网络」。

---

## 1. 架构总览

```
                        ┌──────────────────────────────────┐
   每日 UTC 19:00       │  GitHub Actions  data-sync       │
   (北京 03:00)  ──────►│  —— 唯一碰外网的环节 ——           │
                        │                                  │
                        │  1. codeload 拉 AzurLaneData 全仓 │
                        │     tarball（125MB / 约 40 秒）    │
                        │     记录 commit SHA                │
                        │  2. 只解出分档所需文件，比对本地上次 │
                        │     文件的 git blob OID，跳过未变更 │
                        │  3. Zod 校验 + 非空断言             │
                        │     （失败即中止 + 自动开 issue）    │
                        │  4. 归一化 → normalized/*.jsonl.gz  │
                        │  5. 与上次快照 diff                 │
                        │  6. 变更图片 → sharp → R2（增量）    │
                        │  7. 生成更新页 MDX                  │
                        │  8. commit normalized+manifest+更新页 → push │
                        └───────────────┬──────────────────┘
                                        │ push 触发
                                        ▼
                        ┌──────────────────────────────────┐
                        │  Cloudflare Pages  Build         │
                        │  —— 零网络依赖 ——                 │
                        │                                  │
                        │  1. 解压 normalized → 建 SQLite    │
                        │  2. 导出客户端 JSON + 搜索索引      │
                        │     （写入 public/，须在 build 前） │
                        │  3. next build（全量预渲染）        │
                        │  4. 生成 sitemap / RSS / OG 图      │
                        │  5. 性能与文件数守卫（最后一步）     │
                        └───────────────┬──────────────────┘
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
        https://www.<域名>/                    https://img.<域名>/
        HTML + JS + CSS + 搜索索引              R2 → CF Cache 边缘加速
        （零图片，产物约 4,900 文件）            （零出口流量费）

   每周一 UTC 04:00  ──►  weekly-verify.yml（独立、只 warn、不阻断）
                          抽样 50 艘比对 biligame wiki，产出差异报告 issue
```

**闭环效果**：上游更新 → 24 小时内站点自动跟进并产出更新公告页，零人工、零服务器。

`weekly-verify` 与 `data-sync` 分离是刻意的：交叉校验本质是一个 MediaWiki 模板解析器，对方改模板不能停掉数据更新链路。

---

## 2. 仓库结构

```
blhx-guide/
├── .github/workflows/
│   ├── data-sync.yml              # 每日同步（§6.1）
│   ├── en-images-sync.yml         # EN 图片增量（§6.6），授权通过后启用
│   ├── weekly-verify.yml          # 每周交叉校验，只 warn 不阻断（§6.3）
│   ├── image-backfill.yml         # 手动触发，全量图片重刷
│   └── ci.yml                     # PR：lint + typecheck + schema 回归 + 构建演练
├── pnpm-workspace.yaml            # packages/* + apps/*
├── pnpm-lock.yaml                 # ★ 必须提交进仓库
├── package.json                   # ★ 必须含 "packageManager": "pnpm@9.x.x"
├── turbo.json                     # ★ 定义 data / normalized / web#build 的 inputs 与 outputs
├── .nvmrc                         # 24，与 workflow 的 node-version 同源
├── tsconfig.json                  # strict，workspace 根
├── packages/
│   ├── pipeline/                  # 数据管道（Node + TS，仅构建期运行）
│   │   ├── src/
│   │   │   ├── fetch/
│   │   │   │   ├── tarball.ts             # codeload 全仓 tarball + 选择性解包
│   │   │   │   ├── oid-diff.ts            # 用 git blob OID 判定变更，跳过未变文件
│   │   │   │   ├── en-repo.ts             # Fernando2603 EN 资源（git 路径）
│   │   │   │   └── sha.ts                 # commit SHA 固定与落盘
│   │   │   ├── tables.ts                  # ★ 表注册表：目录前缀 + 分档 + 非空断言
│   │   │   ├── schema/                    # Zod，每表一文件
│   │   │   ├── normalize/
│   │   │   │   ├── attr-map.ts            # 由 attribute_info_by_type 生成，非硬编码
│   │   │   │   ├── ship.ts                # ship / ship_stage / ship_skin
│   │   │   │   ├── retrofit.ts            # ship_data_trans
│   │   │   │   ├── tech-point.ts          # fleet_tech_*
│   │   │   │   ├── equipment.ts           # 909 条 + base 继承展开 + 图标族归并
│   │   │   │   ├── skill.ts
│   │   │   │   ├── chapter.ts             # chapter / expedition / award → drop
│   │   │   │   ├── blueprint.ts           # 科研船
│   │   │   │   ├── technology.ts          # 舰队科技树
│   │   │   │   ├── meta.ts                # META 突破与技能任务
│   │   │   │   └── voice.ts               # 语音文本 + CV 名
│   │   │   ├── display/
│   │   │   │   ├── gametip.ts             # word_* 显示文本抽取
│   │   │   │   ├── factions.ts            # 合并人工 factions.json
│   │   │   │   └── rarity.ts              # 合并人工 rarity.json
│   │   │   ├── emit/
│   │   │   │   ├── jsonl.ts               # 归一化 → normalized/*.jsonl.gz + manifest
│   │   │   │   └── client-index.ts        # → apps/web/public/data/*.json + 搜索索引
│   │   │   ├── store/
│   │   │   │   ├── migrate.ts             # DDL 建表 + 索引
│   │   │   │   └── load.ts                # 由 normalized 重建 SQLite
│   │   │   ├── images/
│   │   │   │   ├── adapter.ts             # LocalAdapter | R2Adapter
│   │   │   │   ├── resolve.ts             # 三级回退：CN 覆盖 → EN 源 → 占位
│   │   │   │   ├── join.ts                # skinId / Equips/{n} → EN 路径
│   │   │   │   ├── transform.ts           # sharp：WebP/AVIF 多尺寸 + LQIP
│   │   │   │   └── upload.ts              # 按源 OID 增量，按内容哈希命名
│   │   │   ├── diff/
│   │   │   │   ├── snapshot.ts
│   │   │   │   └── report.ts              # → 自动生成更新页 MDX
│   │   │   ├── verify/
│   │   │   │   └── cross-check.ts         # 抽样比对 biligame wiki（仅 weekly-verify 调用）
│   │   │   ├── codegen/types.ts
│   │   │   └── cli.ts
│   │   └── tests/fixtures/                # 脱敏样本，schema 回归测试
│   └── shared/
│       ├── src/types/                     # pipeline codegen 产出
│       ├── src/constants/                 # 由权威表 + 人工表生成
│       └── src/format/
├── apps/web/
│   ├── next.config.ts                     # ★ 必须在应用目录，见 §4.6
│   ├── app/                               # App Router（§4.2）
│   ├── components/
│   │   ├── ui/                            # shadcn/ui
│   │   ├── ship/                          # 属性曲线、突破表、技能卡、装备位、皮肤画廊、雷达图
│   │   ├── equipment/
│   │   ├── chapter/
│   │   ├── filter/
│   │   ├── search/
│   │   └── content/                       # MDX 自定义组件
│   ├── content/
│   │   ├── guide/                         # 人工 MDX 攻略（§5）
│   │   └── update/                        # 自动生成，不手写
│   ├── lib/
│   │   ├── db.ts                          # 构建期只读 SQLite
│   │   ├── queries/                       # 所有 SQL 集中在此
│   │   └── seo.ts
│   └── out/
├── data/
│   ├── normalized/                        # ★ 入库：Pages 构建的唯一数据源
│   │   ├── manifest.json                  #   dataSha / snapshotSeq / files / tableDirs（无墙上时间）
│   │   ├── ships.jsonl.gz
│   │   ├── ship-stages.jsonl.gz
│   │   ├── ship-skins.jsonl.gz
│   │   ├── ship-retrofits.jsonl.gz
│   │   ├── ship-meta.jsonl.gz
│   │   ├── fleet-tech.jsonl.gz
│   │   ├── technology.jsonl.gz
│   │   ├── equipment.jsonl.gz
│   │   ├── equip-icons.jsonl.gz           #   558 个图标族 → EN 路径（89.4% 命中）
│   │   ├── skills.jsonl.gz
│   │   ├── chapters.jsonl.gz
│   │   ├── expeditions.jsonl.gz
│   │   ├── drops.jsonl.gz                 #   64,963 条 award 展开
│   │   ├── items.jsonl.gz
│   │   ├── research.jsonl.gz              #   科研船 42
│   │   ├── voice-lines.jsonl.gz
│   │   ├── world.jsonl.gz
│   │   └── enums.jsonl.gz                 #   舰种/属性/装备分类权威枚举
│   ├── manual/                            # ★ 入库：人工层。turbo inputs 与回滚集合都按这个目录名引用
│   │   ├── factions.json                  #   nationality → 词键 → slug；中文名构建期从 gametip 读回比对
│   │   ├── rarity.json                    #   字段/取值域/标签读法的声明；舰船标签来自 gametip，装备侧无文本源
│   │   │                                  #   （不得用 star 推：star 是突破阶段，会随突破变化）
│   │   ├── aliases.json                   #   别名 / 昵称表
│   │   ├── pinyin-overrides.json          #   多音字人工例外（长门=chang2 等）
│   │   ├── drop-overrides/equipment/      #   人工补的装备本体掉落（按需）
│   │   └── image-overrides/cn/            #   人工提供的 CN 立绘（按需）
│   ├── images.manifest.json               # ✗ 无图模式不入库；阶段 3B 授权转 R2 后随图一起入库
│   ├── snapshots/index.json               # ★ 入库：snapshotSeq → {commitSHA, dataSha, 清单} 台账，回滚按它取目标
│   ├── raw/<sha>/                         # ✗ 不入库
│   ├── al.sqlite                          # ✗ 不入库（构建期重建）
│   └── images/                            # ✗ 不入库（LocalAdapter 输出）
├── docs/
│   ├── adr/                               # 架构决策记录
│   ├── data-inventory.md                  # 全字段清单
│   ├── findings.md                        # §11 调查结论的证据与复现命令
│   └── runbook.md                         # 故障处理 + 环境陷阱
├── PLAN.md
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

---

## 3. 数据层

### 3.1 数据源

| 源 | 内容 | 用途 |
|---|---|---|
| `AzurLaneTools/AzurLaneData` | CN 服解包数据，`CN/` 区 625 文件 / 425.8MB。`CN/sharecfgdata`（**24 表 / 152.4MB**，按等级展开的数值表，全部有数据）+ `CN/ShareCfg`（**593 表 / 92.9MB，其中 24 表是空壳**，余 569 表为主配置与显示文本）+ `CN/GameCfg`（6 表 / 180.5MB，逻辑与剧情）。空壳规律见 §3.4 | 数值与文本的唯一来源 |
| `Fernando2603/AzurLane` | EN 策展数据集，约 9.91GB，每日 23:00 UTC 同步 | 图片的唯一自动来源 |
| biligame 碧蓝航线 WIKI | 昵称术语 / 船名对照 / 装备别称 | 别名表来源；独立周级校验对照 |
| `data/manual/image-overrides/cn/` | 人工提供的 CN 立绘 | 图片最高优先级 |

**`AzurLaneData` 不含任何图片文件**（全树 3,157 条目 = 3,134 blob：3,122 `.json` + 5 `.svg` + 5 `.txt` + 1 `.yml` + 1 `.md`，`.png` / `.webp` / `.ogg` 计数为 **0**，`truncated: false`）。CN 立绘不存在可自动化的公开数据集，获取只能解包客户端（AssetStudio + `AssetBundles/painting`，且立绘是 mesh + texture 分片需按 `.obj` 坐标拼合），手工、不可 CI、每版本重做。因此图片走三级回退（§3.8）而非全量 CN 化。

### 3.2 取数方式

**先锁 SHA，再按 SHA 取包。** 直接抓 `refs/heads/main` 的 tarball、再另发一次 `ls-remote` 取 SHA，是**两次独立请求**，上游在中间前进一次就会把内容记成另一个 SHA——manifest 里的 `dataSha` 就不再是硬事实，回滚与 diff 基准一起失效。固定顺序：

```
1  GET https://api.github.com/repos/{repo}/commits/{branch}
   → 取该响应里的 SHA（同一次响应给出 SHA 与 tree 指针，不是二次查询）
2  GET https://codeload.github.com/{repo}/tar.gz/{sha}     ← 按 SHA 取包，不按分支
3  GET https://api.github.com/repos/{repo}/git/trees/{sha}?recursive=1
   → 全树 blob OID + size（实测 3,134 条 / 986KB / truncated:false，一次拿完）
4  断言：解出集合 == 本阶段分档白名单 ∩ tree 清单里 CN/ 的文件集合
   （**不是**等于 CN 全部 .json——本设计只解白名单，且 word_template / word_legal_template
    被明确禁止解出。按「全量相等」写会把断言做成必然失败，或为了满足它去全解而违反排除规则）
5  逐个核对解出文件的 blob OID 与 tree 清单一致；不一致即中止（防解包半途失败留下旧文件）
断言任一步不符即中止，不用半成品覆盖 normalized
```

**步骤 3 不是可选的**。tarball 是归档快照，**里面没有 git blob OID**，所以「按 OID 判定哪些文件变了」的增量策略在 codeload 路径上根本无法实现——必须从 Trees API 单独取 OID，并存成 `data/raw/<sha>/tree-index.json`。这条不补，增量判定会退化成「每天全量重编码 2GB 图片」。

实测数据（固定提交 `4cca5c24` 全链路跑通后取到）：codeload tarball **125,181,350 字节**，不受 REST 限额约束；**但耗时方差极大：同机同网先后两次实测 27 秒与 423 秒**，因此 `timeout-minutes` 必须按最坏情况给（本 workflow 设 25 分钟，其中取数预留 10 分钟），不能按 40 秒排。Trees API 一次调用 3,157 条 / 约 0.8MB。每日同步共 3 次 API 调用，远低于未认证 60 次/小时限额，但**认证后跑**（`GITHUB_TOKEN`）以避免限额与限流突发。

完整性判据用 `gzip -t`，不用体积阈值：体积检查拦不住「下载了 125MB 但中途截断」这种最常见的失败形态，而截断的 tarball 报出来的是 `gzip: stdin: unexpected end of file`，与真实原因隔了好几层。

**为什么不用其它三条路**（都是实测踩到的）：

| 方式 | 结果 |
|---|---|
| `raw.githubusercontent.com` 直连 | **DNS 层阻断**，HTTP 000 / 0.1 秒即失败 |
| REST API `GET /git/blobs/{sha}` | 可用且单文件上限 100MB，但**未认证限额 60 次/小时**——实测在第 60 次后全部返回 403，且 280 字节的错误体很容易被当成成功响应写进文件。**必须校验响应体积与可解析性** |
| `git clone --filter=blob:none` + 按需取 blob | tree 能拿到，但 **blob 按需取回在 `github.com` 降级时会失败**（实测该域名从 0.6 秒劣化到 15.5 秒，触发 `unable to read sha1 file`，且索引被清空成 0 条目）。`--no-cone` 文件级 sparse-checkout 在该状态下静默产出空工作区 |

结论：CI 里 `git clone --depth 1 --filter=blob:none --sparse` 可行（GitHub 自有网络），但**本地开发以「SHA 锁定的 codeload tarball + Trees API 取 OID」为默认**。管道实现同时支持两种后端，按 `FETCH_BACKEND` 切换，并在任一后端产出空文件时硬失败。

SHA 必须落盘（`data/raw/<sha>/` 与 manifest），否则 diff 无基准、无法回滚。

**EN 仓库（约 36GB 仓库体积，树约 9.91GB）不能用 tarball**，走 `git clone --depth 1 --filter=blob:none --sparse` + cone 模式只取 `images/skin` `images/equipment` 与根目录元数据 JSON；该路径**天然持有 blob OID**，增量判定可用。注意这条链路与 §8.5 的授权门槛绑定：在图片再分发未获授权前，EN 抓取步骤不进入每日同步。

### 3.3 分档取数

| 档 | 表 | 实测体积 | 实施阶段 |
|---|---|---|---|
| **A** | `sharecfgdata`: ship_data_statistics 7.14 · equip_data_template 4.67 · ship_data_template 2.68 · equip_data_statistics 2.60 · ship_data_breakout 1.03 · **gametip 1.06**<br>`ShareCfg`: ship_skin_template 5.9 · skill_data_template 3.35 · ship_data_group 0.57 · skill_data_display 0.26 · fleet_tech_* 0.36 · ship_data_trans 0.08 · ship_data_by_type 0.01 · ship_data_by_star 1.7K · attribute_info_by_type 0.001 · equip_data_by_type 3.6K · equip_data_by_quality 0.8K · equip_data_code 1K · l2dhx 0.5K · painting_filte_map 499K · **illustrator 1.2K · voice_actor_CN 33K · name_code 48.9K · memory_storyline 48.5K · fleet_tech_group 1.2K · fleet_tech_template 22K · fleet_tech_ship_class 79K · fleet_tech_ship_template 246K** | **~31MB** | 图鉴主线。`name_code` 是船名占位符的解析表（不是可选项，见 §11 J），`memory_storyline` 是数字阵营的唯一文本证据源兼后续剧情层入口 |
| **B** | `sharecfgdata`: chapter_template 8.84 · chapter_template_loop 6.27 · **expedition_data_template 17.20** · item_data_statistics 2.57 · shop_template 2.22 · **ship_skin_words 6.04**<br>`ShareCfg`: **transform_data_template 0.73（改造节点 1,217 个，改造消耗唯一来源）** · ship_transform 0.01 · box_data_template · drop_data_restore 0.11 · technology_data_template 0.51（科研项目目录）· ship_data_strengthen 0.21 · ship_strengthen_blueprint 0.72 · **ship_data_blueprint 0.06** · skill_need_exp 0.5K · ship_meta_breakout · ship_meta_skilltask 1.34 · enemy_data_statistics 12.9 · enemy_data_by_type · enemy_data_skill | **~63MB** | 关卡掉落、材料计算、语音文本、敌方 |
| **C** | `sharecfgdata`: weapon_property 21.05 · bullet_template 19.87 · barrage_template 10.24 · aircraft_template 4.15 · spweapon_data_statistics 0.58 · weapon_name 0.13<br>`ShareCfg`: gameset 65K | **~56MB** | 面板估算 |
| **D** | `sharecfgdata`: world_chapter_template 11.10 · world_event_data 4.56 · world_effect_data 4.11 · activity_coloring_template 3.44 · task_data_template 7.20 · item_virtual_data_statistics 3.66<br>`ShareCfg`: world_* · dorm3d_* · island_* | ~50MB | 大世界、活动、任务 |

**排除项与一项必要的重新纳入**：

- `GameCfg/story.json`（65.5MB）不取，剧情文本另议。
- `GameCfg/skill.json`（12.5MB）与 `buff.json`（22.6MB）：**技能名与描述**在 `ShareCfg/skill_data_template` + `skill_data_display`，可取；但**技能效果数值、触发器与 BUFF 机制**只存在于这两张逻辑半区。因此 §8.1 的承诺拆成两半：静态名称与描述 = 可做；机制解析（触发条件、持续时间、叠层、加成公式）= 需要额外引入这两张表，当前不承诺。
- **`GameCfg/dungeon.json`（80.0MB）必须纳入**，否则「每关敌人编组」做不到：它是 `stages[].waves[].spawn[].monsterTemplateID` 的唯一来源。做法不是把它提交进仓库，而是取数阶段解析后**只产出 0.59MB 的 `stage_enemy` 归一化表**（dungeon id → 怪物 id 列表 + waveIndex + boss 标记），全量 80MB 留在 `data/raw/<sha>/` 不入库。构建期成本是一次 80MB JSON 解析。
- **`ShareCfg/word_template.json`（16.8MB）与 `word_legal_template.json` 绝对不取**——敏感词过滤前缀树，与枚举无关，内容不得进入仓库、产物、日志或错误 dump。

### 3.4 表注册表：目录前缀 + 非空断言

**两侧目录严格互补，规律无例外。** `CN/ShareCfg` 与 `CN/sharecfgdata` 各有 24 个同名表；ShareCfg 侧这 24 个固定是空壳，权威数据只在 sharecfgdata 侧。实测（`git/trees/main` 全树 size）：

```
CN/ShareCfg 空壳数           24 / 593
CN/sharecfgdata 文件数        24 / 24 全部有数据
空壳 ⟄ sharecfgdata 存在      双向完全对应，无一个例外
  · ShareCfg 空壳但 sharecfgdata 无对应：0
  · 同名两侧都有数据：0
```

这 24 张表正是攻略站最依赖的表——**读错目录不会报错，只会静默产出空站点**：

| 表（ShareCfg 侧为 `[]` / `{}`） | 权威侧条目数 | 体积 | 影响 |
|---|---|---|---|
| `ship_data_statistics` | 3,957 | 7.14MB | 全部舰船面板（**3,429 阶段行 + 528 非阶段行，两套行混排**） |
| `ship_data_template` | 3,806 | 2.68MB | 舰船基础配置 |
| `ship_data_breakout` | 3,347 | 1.03MB | 突破材料（**不是改造**，改造见 §3.5 的 `trans_*`） |
| `ship_skin_words` | 2,485 | 6.04MB | 语音文本 |
| `equip_data_statistics` | 10,365 | 2.60MB | 装备面板 |
| `equip_data_template` | 9,170 | 4.67MB | **普通强化等级链**（next/prev，0 断裂）；装备正体判定的连接表 |
| `spweapon_data_statistics` | 2,619 | 0.58MB | 特殊武器 |
| `chapter_template` | 981 | 8.84MB | 关卡与掉落入口 |
| `chapter_template_loop` | 862 | 6.27MB | 周回/自律配置 |
| `expedition_data_template` | 15,515 | 17.20MB | 出击节点与 `award_display` |
| `item_data_statistics` | 3,030 | 2.57MB | 掉落物解析（材料/设计图） |
| `item_virtual_data_statistics` | 4,118 | 3.66MB | 虚拟货币物品 |
| `gametip` | 7,449 | 1.06MB | **阵营名、舰种名、稀有度名等全部显示文本** |
| `shop_template` | 2,393 | 2.22MB | 商店/兑换 |
| `task_data_template` | 7,948 | 7.20MB | 任务 |
| `world_chapter_template` | 644 | 11.10MB | 大世界章节 |
| `world_event_data` | 5,802 | 4.56MB | 大世界事件 |
| `world_effect_data` | 12,370 | 4.11MB | 大世界效果 |
| `activity_coloring_template` | 119 | 3.44MB | 活动涂色 |
| `weapon_name` | 2,380 | 0.13MB | 武器名 |
| `weapon_property` | 53,585 | 21.05MB | 武器逐等级数值 |
| `bullet_template` | 19,165 | 19.87MB | 弹道 |
| `barrage_template` | 26,975 | 10.24MB | 弹幕 |
| `aircraft_template` | 7,224 | 4.15MB | 舰载机 |
| | **合计 206,309 条** | **152.4MB** | |

**解析规则（`tables.ts`）**：

```ts
// 每张表登记「目录 + 表名」完整路径，禁止裸文件名
// 同名的 24 张表，目录字段固定为 sharecfgdata
const T = {
  shipStats:   { dir: 'sharecfgdata', name: 'ship_data_statistics',  top: 'dict', minRows: 3000 },
  equipStats:  { dir: 'sharecfgdata', name: 'equip_data_statistics', top: 'dict', minRows: 9000 },
  equipTempl:  { dir: 'sharecfgdata', name: 'equip_data_template',   top: 'dict', minRows: 8000 },
  gametip:     { dir: 'sharecfgdata', name: 'gametip',               top: 'dict', minRows: 6000 },
  chapter:     { dir: 'sharecfgdata', name: 'chapter_template',      top: 'dict', minRows: 900 },
  shipGroup:   { dir: 'ShareCfg',     name: 'ship_data_group',       top: 'dict', minRows: 800 },
  skinTempl:   { dir: 'ShareCfg',     name: 'ship_skin_template',    top: 'dict', minRows: 2500 },
  // ...
}
```

阈值取「实测值的 ~80%」，低于阈值即**硬失败中止同步**，绝不允许把 `[]` 当有效数据写进归一化产物。加载后额外断言：顶层类型匹配、首条记录含声明的主键字段。

**第二道必守规则：按表声明 key strategy，不能一刀切。** 两类表的键空间完全不同，实测：

```
数字键表   technology_data_template  686 键 = 685 条 + all:[1,2,3,4,11,…]
           ship_data_blueprint        43 键 =  42 条 + all
           ship_data_trans           107 键 = 106 条 + all:[10103,10104,…]
           equip_upgrade_data        282 键 = 281 条 + all:[4340,11060,11140,…]
           equip_data_by_type         20 键 =  19 条 + all
字符串键表 gametip                 7,449 键，**数字键 0 个**
           样本 0815_main_help · 2023Valentine_minigame_a · word_shipNation_*
           其中 word_* 前缀仅 402 条，其余是活动与对话文本
```

**过滤规则必须逐表声明，不是全局规则。** 把 `/^\d+$/` 施加到 `gametip` 会得到空集，随后 `minRows=6000` 直接中止同步——或者更糟，静默产出一个没有任何中文名的站点：

```ts
type KeyStrategy = 'numeric-excluding-all' | 'string' | 'array'
const T = {
  gametip:     { dir: 'sharecfgdata', keyStrategy: 'string',                minRows: 6000 },
  shipTrans:   { dir: 'ShareCfg',     keyStrategy: 'numeric-excluding-all', minRows:   90 },
  equipUpData: { dir: 'ShareCfg',     keyStrategy: 'numeric-excluding-all', minRows:  240 },
  // ...
}
```

- `numeric-excluding-all`：取 `/^\d+$/` 的键，`minRows` 按此计数。不加这条会虚高 1，且把 `all` 当记录渲染会拿到一个数组崩在构建期。
- `string`：取全部键（`gametip` 的键本身就是文本索引）。
- 注册表里每张表**必须**显式声明 `keyStrategy`，类型上不给默认值，缺字段即编译不过。

`gametip` 是空壳时最隐蔽——它不影响行数统计却清空所有中文显示名（阵营、舰种、稀有度、装备类别），站点会「构建成功但满屏空白」，因此它的 `minRows` 断言单独列在 §6.5 失败处理里。

### 3.5 舰船数据模型（三层）

```
ship_data_group.group_type        859 条   ★ 基船 / 图鉴条目，图鉴主键
        ↓ ship_skin_template.ship_group
ship_skin_template.id           2,730 条   皮肤层（默认立绘 + 换装）
        ↓ ship_data_statistics.skin_id（= 默认皮肤 ID，不是基船 ID）
ship_data_statistics.id         3,957 行   其中 3,429 行是 (船 × 突破阶段) 行（id - skin_id ∈ 1..4），
                                           另 528 行是展示单位与 NPC 行（§11 A）
```

突破阶段是行维度而非皮肤维度，实测每个 `skin_id` 对应的行数分布：

```
1 行:185  2 行:7  3 行:1  4 行:609（众数）  5 行:197  6 行:42  7 行:7  8 行:3  9 行:1
```

4 行对应突破 0/1/2/3。实证（北卡罗来纳）：

```
id=105121  北卡罗来纳  star=3   ← 突破0
id=105122  北卡罗来纳  star=4   ← 突破1
id=105123  北卡罗来纳  star=5   ← 突破2
id=105124  北卡罗来纳  star=6   ← 突破3
id=900133  北卡罗来纳  star=6   ← 9xxxxx ID 段
id=900194  黎塞留      star=6   ← 同 skin_id 但船名不同，进隔离清单
```

`star` 随突破递增，`ship_data_template` 的 `star` / `max_level` / 装备位同样按突破变化。

**图鉴条目构成**（`ship_data_group.handbook_type`，游戏自己的分类）：

| `handbook_type` | 含义 | 条数 | 交叉验证 |
|---|---|---|---|
| 0 | 常规舰船 | 667 | nationality 主要为 1–9 |
| 1 | 联动舰船 | 91 | nationality 全部落在 101–115 |
| 2 | **科研开发船** | 42 | 42 个 `group_type` 与 `ship_data_blueprint` 的 42 个数字键**完全双射**（19901 西雅图 · 19902 佐治亚 · 29901 海王星 · 39901 …），id 段即科研段 |
| 3 | META 舰船 | 59 | nationality 全部为 97 |
| | **合计** | **859** | |

**改造不是 `handbook_type` 维度**，而是 `ship_data_group` 上的一组字段，与 `handbook_type=2` 交集为 0：

```
trans_type          int    78 条非零，取值 1:32 · 2:17 · 3:9 · 5:6 · 6:7 · 7:3 · 10:4（0 = 不可改造 781 条）
trans_skin          int   106 条非零 → 改造后皮肤 ID（如 10103 → 101039）
trans_skill         int[]  96 条非零 → 改造新增技能（是数组，不是标量）
trans_radar_chart   str[] 106 条非零 → 六格雷达字母，如 ["B","C","E","B","C","C"]
ship_data_trans    {group_id, skin_id, skill_id, transform_list}，106 条
```

`transform_list` 实测每条船**恒为 6 个分支**、共 1,217 个 `[槽类型, 节点 id]` 二元组，与 `transform_data_template` 的 1,217 行**双向双射**（每个节点被引用恰好一次，无孤儿无重复）——这句话现在由 `normalize/retrofit.ts` 在构建期强制。槽类型只有 `{2:329, 3:636, 4:252}`，**数据里没有任何文本说明它的含义**，原样带出并标注未证，不编名目。`skill_id` 不等于最后一个分支节点（106 条里只有 45 条相等），不能当派生字段用。

科研船与改造船各自独立建模：科研 42 条走 `ship_data_blueprint`（`price` / 逐日 `unlock_task` / 30 项 `strengthen_effect` / `blueprint_version`），改造 78–106 条走上面的 `trans_*`。图鉴筛选面板两者是两个不同维度，不合并。

**舰队科技是四张表一条链，join 全部实测闭合**（`normalize/fleet-tech.ts` 逐条断言）：

```
fleet_tech_group          4 条  {id, name「作战技术-白鹰/皇家/重樱/铁血」, nation[], techs[9]}
  ↓ techs = 节点 id              ↑ groupid
fleet_tech_template      36 条  {id 1001..4009, cost, pt, time, add[[舰种数组, 等级 1..12, 数值]], level_award_display}
fleet_tech_ship_class   385 条  {id, name「法拉格特级」, nation, ships[]→group_type, shiptype, t_level}
  ↑ class                                                ↑ id 就是 group_type
fleet_tech_ship_template 726 条  {id, class, max_star, pt_get, pt_level, pt_upgrage, add_get_*, add_level_*}
```

三条可复用的结论：**科技节点 36 = 4 组 × 9，无孤儿**；`add` 里的舰种集合与 `shiptype` 全部落在 `ship_data_by_type` 键集内；**`fleet_tech_ship_class.nation` 与 `ship_data_group.nationality` 在 726 艘船上 100% 相等**——这是 nationality 口径的第二个独立证据。另外 726/859 艘有科技行，缺的 133 艘是联动与布里（舰级表的 nation 恰好不含 98 与 101–115），是数据覆盖范围而非取数遗漏。**顺带得到一份计划原先没有的字段：权威中文舰级名**，进舰船页与搜索别名。字段 `pt_upgrage` 是上游拼错的 upgrade，原样保留不改名。

**规范名规则（必须显式，否则页面标题会漂）**：`ship_data_group` 本身**没有 name 字段**，船名要经 `group_type ← ship_skin_template.ship_group` 再 `ship_data_statistics.skin_id → name` 两跳取得。实测 859 个 `group_type` **全部取得名字（0 空名）**，但 **54 组存在多个名字**，形态是正常共存而非脏数据：

```
20502 → 厌战 / 厌战.改        20503 → 纳尔逊 / 纳尔逊.改
20501 → 伊丽莎白 / 伊丽莎白女王   20507 → 约克公爵 / 约克公爵—幼儿园
```

规则：**canonical name = 该 group 下 `skin_type = -1`（默认立绘）那条皮肤的名字**；带 `.改` / 别名的行归入改造分支与 `aliases.json`，不参与标题。`.改` 类名自动并入别名索引，使「厌战改」这类搜法能命中。真正需要人工裁决的是 `skin_id=105120` 那种同键不同船（北卡罗来纳 / 黎塞留），进隔离清单。

联动、META、布里**全部纳入**图鉴：`handbook_type` 作为筛选维度与展示徽标。联动船额外标注所属活动与「版权到期后不可获取」状态——这是真实攻略信息，不能与常规船混为「可获得」。

### 3.6 过滤一律用正向权威表

| 维度 | 权威来源 | 实测取值 |
|---|---|---|
| 舰种 | `ship_data_by_type.json` 的 `all` | `[1,2,3,4,5,6,7,8,9,10,11,12,13,17,18,19,20,21,22,23,24]`（21 种，14/15/16 不存在） |
| 舰种展示名 | 同表 `type_name` | 驱逐 轻巡 重巡 战巡 战列 轻航 正航 潜艇 航巡 航战 雷巡 维修 重炮 潜母 超巡 运输 导驱(20) 导驱(21) 风帆(22) 风帆(23) 风帆(24) |
| **站位** | 同表 `team_type` | `vanguard`（前排）/ `main`（后排）/ `submarine`（潜艇） |
| 图鉴条目 | `ship_data_group` 全部 859 行 | 表内即合法条目 |
| 属性定义 | `attribute_info_by_type.json` | §3.7 |
| 装备分类 | `equip_data_by_type.json`（19 数值类 + `all` 哨兵）+ `word_equipment_*`（19 个 UI 标签） | 见 §3.10 |
| **装备条目** | 族根身份（`base` 为空且自有 `name`）+ `type ∈ equip_data_by_type` + `id ∈ equip_data_template` 三条正向判定，**不含任何 id 数值范围条件** | 909 条（曾用 `id≥10000` 猜范围，得 734，漏 175 条真装备，已废弃） |
| **稀有度** | 舰船侧：`ship_data_statistics` 阶段行 `rarity`(2–6)，标签 = `gametip` 的 `index_rare{value}`；装备侧：`equip_data_statistics.rarity`(1–6) 有档无名（`equip_data_by_quality` 无显示名字段）。`star` 是突破阶段，不得使用 | 见 §8.2 与 §11 A |
| 舰船白名单不需要排除法 | 352 个孤儿 `ship_group` 已定性（§11 B） | — |

**不使用** `ship_data_group.hide`（859 行全为 0）与 `redirect_id`（全为 101），二者是常量死字段。

`ship_data_by_type` 还含 `arena_buff`、`team_limit`、`energy_recover_time_ratio`、`energy_recover_food_ratio`、`fix_resource_gold`（维修费用）、`distory_resource_gold_ratio`（退役回收）、`strengthen_choose_type`——面板估算的真实参数来源。

### 3.7 属性数组位置映射（已确认）

`ship_data_statistics` 有**三个定长 12 的位置数组**，实测 3,957 行全部长度为 12：

| 字段 | 长度 | 样本（北卡一行） | 含义 |
|---|---|---|---|
| `attrs` | 12 | `[100, 10, 10, 10, 10, 50, 0, 50, 50, 35, 100, 20]` | 1 级基础值 |
| `attrs_growth` | 12 | `[1000, 100, 100, 100, 100, 500, 0, 500, 500, 0, 0, 100]` | 常规成长（×1000 定点） |
| `attrs_growth_extra` | 12 | 多为全 0；`[12798, 0, 0, 599, 1205, 521, 0, 0, 766, 0, 0, 0]` | 额外成长，**仅 118/3,957 行非零**，集中在 `star=5` 的 9xxxxx ID 段（META / 特殊船） |

数组下标从 0 起，定义来自 `CN/ShareCfg/attribute_info_by_type.json`：

| 位 | `name` | `condition` |
|---|---|---|
| 1 | `durability` | 耐久 |
| 2 | `cannon` | **炮击** |
| 3 | `torpedo` | 雷击 |
| 4 | `antiaircraft` | 防空 |
| 5 | `air` | 航空 |
| 6 | `reload` | 装填 |
| 7 | `armor` | 装甲 |
| 8 | `hit` | 命中 |
| 9 | `dodge` | 机动 |
| 10 | `speed` | 航速 |
| 11 | `luck` | 幸运 |
| 12 | `antisub` | 反潜 |

表内含 `"all": [1..12]`，直接用于长度校验。

映射不硬编码在业务代码里：`normalize/attr-map.ts` 从该表读出生成并写入 `enums.jsonl.gz`，上游调整顺序时数据自动跟随，长度不符则校验失败。

**交叉验证**：`enemy_data_statistics` 的属性字段是**具名**的（`cannon` `durability` `luck` …），键集与本表完全一致。管道里加断言比对两者键集，不一致即失败——这是独立于舰船表的一份证据。

**等级上限是 100，不是 125。** `ship_data_template.max_level` 实测 **3,806 行全部 = 100**，且这套数据里没有任何 >100 的等级字段。因此：

- 可承诺：**1–100 级**成长曲线，由 `attrs` + `attrs_growth`（定点 ×1000）+ 突破阶段行直接算出，取整规则用 golden fixture 锁死。
- **不承诺 1–125**。125 来自游戏内后续解锁（好感度、觉醒、科技等加成），其规则不在解包数据里，公式在客户端代码中。
- `attrs_growth_extra` 必须并入公式，否则 118 条 META/特殊船的属性曲线全错。在拿到取整规则前，这 118 条曲线**标注「成长数据不完整」而不是硬算**。
- 突破维度是行而非列：`(船 × 突破阶段)` 每行一组 `attrs`，同一船最多 6 行（`star` 1→6），所以页面上是**每条突破线各一条 1–100 曲线**。

### 3.8 图片管道

**join 键是 skin ID，不是 `painting` slug。** EN 仓库 `images/skin/` 以数字 ID 建目录，与 `ship_skin_template.id` 同一命名空间（双方都是 `100000` `100001` `100002` `100010` `100011`…），且 `ship_skin_list.json` 的 `gid` 与 CN `group_type` 完全对齐。纯数字主键匹配，不做字符串匹配。

每个皮肤目录含 6 个已按用途分离的文件（尺寸为 skinId 205020「厌战」的实测值，跨皮肤差异很大，不能当预算常数）：

```
images/skin/{skinId}/painting.png    2,107,722 B  立绘（→ 600w WebP + 1200w AVIF 源）
images/skin/{skinId}/shipyard.png      109,793 B  船坞半身像
images/skin/{skinId}/icon.png           25,404 B  方形头像
images/skin/{skinId}/chibi.png          34,069 B  Q 版小人
images/skin/{skinId}/banner.png         29,779 B  横幅
images/skin/{skinId}/qicon.png          20,724 B  Q 版头像
```

EN 侧 **894 个皮肤组 / 2,613 张皮肤**，CN 侧 859 组 / 2,730 张，约 117 张缺口，逐条比对在首次 backfill 时产出清单。

**三个必须绕开的写法**：

1. **不要用 `ship_skin_list.json` 的 `painting` 字段取图**——它是 `https://raw.githubusercontent.com/...` 完整 URL，该域名在开发环境 DNS 阻断。管道必须自己拼 `images/skin/{id}/painting.png`，经 git 或 API blob 接口取。
2. **阵营图标编号体系不通用**：EN `nationality_icon.json` 键是 `0`–`24`（25 个），CN `ship_data_group.nationality` 是 **1–9、11、96、97、98、101–115 共 28 个离散值**（10 无船，区间也不连续）。必须经 `data/manual/factions.json` 显式映射，不能拿数字直接取图，也不能按区间补全。
3. **装备图标是族级不是件级，且实测有缺口**：909 条装备族代表行对应 **558 个不同 `icon` 值**（形如 `11000` `12060`，5 位为主），EN `equipment_icon.json` 有 936 个键、`images/equipment/{n}.png`。实测重叠结果：

   ```
   图标族命中   499 / 558 = 89.4%
   装备条目命中 811 / 909 = 89.2%        缺口 98 条 / 59 个族
   缺口的 icon 族全部落在 500xx–562xx 与 85240
   即 Mle1924 / Mle1929 / Mle1930 / Mle1931 / B-54 100mm 一系（维希教廷·自由鸢尾线）
   ```

   这 98 条走 §3.8 三级回退的第 3 级（占位图 + 「暂无图标」），并在首次 backfill 产出的「装备图标族未命中」清单里逐条列出。909 条装备**全部带 `icon` 值**（实测 0 缺失），因此 `icon` 可安全作为连接键。另注意 `item_data_statistics.icon` 里也有 `Equips/{n}` 形式（331 条），与装备表是两个引用点。

**三级回退**（`images/resolve.ts`）：

```
1. data/manual/image-overrides/cn/{skinId}.png     人工提供的 CN 立绘，最高优先
2. Fernando2603 EN 源（skinId 精确匹配）      自动同步，覆盖全量
3. 内置占位图 + 「暂无立绘」                   兜底，绝不允许图裂
```

页面标注「立绘来源：国际服客户端资源」；使用覆盖层的条目标注「国服立绘」。和谐立绘标记来自 `l2dhx.json`（26 条，键即 `painting` slug：`qiye_7` `wuqi_3` `bisimai_2` `daofeng_5` `ougen_6` `z23` …）与 `ship_skin_template.shop_dynamic_hx`（7 条）。

**处理规格**（sharp）：

```
icon      → 96×96   WebP q80   <20KB
portrait  → 600w    WebP q82   <300KB
portrait  → 1200w   AVIF q70   <350KB   详情页大图，懒加载
LQIP      → 24w     WebP q30   <2KB     内联 base64，防布局跳动
```

**取数与编码实测**（本机，2026-10-28，EN 源锁定 `2d8770b6921d`，该 commit 时间 2026-10-23）：

- 目录定位用 `GET /repos/{owner}/{repo}/git/trees/{enSha}:images/skin/{skinId}`——先锁 commit SHA 再按路径遍历，一次请求只返回一个皮肤目录，**不需要拉 9.91GB 的全树清单**；内容按返回的 blob OID 用 `application/vnd.github.raw` 取，避开 base64 的 33% 膨胀。`raw.githubusercontent.com` 在本机 DNS 阻断，这条 REST 路径是实测唯一通的取图方式
- 产物实测（2 艘船共 14 个文件、992KB）：icon 96×96 = 3.4–3.7KB；portrait 600w WebP = 83–119KB；portraitHi 1200w AVIF = 70.7–203.7KB；LQIP 24w = 0.7–0.9KB。全部落在上面的预算内，而且**离上限很远**——按源图大小（painting 2.1MB）推产物会得出「必然爆预算」的错误结论，预算要按编码后的实测值守
- `shipyard.png` 源图 109,793 B 大于产物预算 80KB：预算约束的是出口字节，源图大小只影响下载量，两者不能混谈
- 源图窄于目标时不插值：skinId 100000 的 painting 是 670×1024，1200w AVIF 出来仍是 670 宽
- 请求数斜率：1 次 commits + 每个 skinId 1 次列目录 + 每个源文件 1 次取内容 = 2 艘船 6 次。按此推算全量 2,730 皮肤约 8,200 次调用，未认证 60 次/小时不可行、认证 5,000 次/小时也要约 2 小时。**所以首次 backfill 与每日增量走 `git clone --filter=blob:none --sparse` 的 `images/skin` + `images/equipment` 两个 cone，REST 路径只用于小批量、本地验证与缺项补取**
- 按 OID 跳过实测成立：同一艘船第二次跑，下载 0 张、跳过 7 项，一个 blob 都不取。这条路径在 `test/images.test.ts` 里用覆盖层离线钉住，不受限速影响
- 清单是全量台账：一次局部重跑只替换自己碰过的逻辑名，其余条目原样留着；漏了这条就会把几百张已编码图的引用擦掉，下次同步全量重下载

**R2 key 规范（内容哈希入文件名）**：

```
ship/{groupType}/icon.{hash8}.webp
skin/{skinId}/portrait.{hash8}.webp
skin/{skinId}/portrait.{hash8}.avif
skin/{skinId}/shipyard.{hash8}.webp
equip/icon/{familyKey}.{hash8}.webp
item/{id}.{hash8}.webp
```

哈希进文件名是 `Cache-Control: public, max-age=31536000, immutable` 的前提。站点构建期生成，HTML 直接写死哈希 key 无额外成本。旧哈希**不是永久保留**——R2 存储是 10GB·月额度而非无限，按 §9 的 lifecycle 规则保留**最近 5 个哈希版本**即够回滚，更早的删除；`images.manifest.json` 里记录每个逻辑名的历史哈希，使保留窗口内的历史部署仍能取到图。

**增量检测用源文件 git blob OID，不用内容哈希**：取数阶段已持有全树 OID，无需下载内容即可判定哪些文件变了；只有 OID 变化的文件才拉取并重新编码。否则每日同步要为算哈希把几 GB 皮肤全量下一遍。

首次全量 backfill 走独立 workflow（2,730 皮肤 × 1200w AVIF 编码是小时级，装不进同步任务的 timeout），按 OID 跳过、失败可续传。

**体积预算**：

| 内容 | 数量 × 单张 | 小计 |
|---|---|---|
| 舰船 icon WebP 96×96 | 859 × 20KB | 17MB |
| 立绘 WebP 600w | 2,730 × 300KB | 819MB |
| 立绘 AVIF 1200w | 2,730 × 350KB | 956MB |
| 船坞图 shipyard WebP | 2,730 × 80KB | 218MB |
| **Q 版头像 qicon** | 2,730 × 18KB | **49MB** |
| **Q 版小人 chibi** | 2,730 × 26KB | **71MB** |
| **横幅 banner** | 2,730 × 31KB | **85MB** |
| 装备图标（499 族命中） | 499 × 15KB | 7MB |
| 物品图标 | 3,030 × 12KB | 36MB |
| LQIP | — | 10MB |
| **合计** | | **~2.66GB** |

**上面 6 类源图在管道里都会被拉取，所以三类小图必须计入预算**（此前只算了 painting / shipyard / icon / 装备 / 物品，漏掉 qicon + chibi + banner 共 205MB）。监控阈值：**warn 4GB，hard stop 8GB**（10GB-month 免费额度留 2GB 余量）。

保留 AVIF：R2 存储与出口均免费，真正瓶颈是用户端带宽，用存储换带宽划算。若需压缩，换装只做 WebP 可降到约 1.2GB。

**不做**：语音音频（2.99GB / 37,401 文件）、BGM（934MB）。语音**文本**可做（`ship_skin_words`，见 §3.10）。

**适配器接口**：

```ts
interface ImageAdapter {
  put(key: string, buf: Buffer, meta: ImageMeta): Promise<void>
  getUrl(key: string): string
  list(prefix: string): Promise<string[]>
}
// LocalAdapter  → data/images/ + 本地静态服务
// R2Adapter     → S3 兼容 API，@aws-sdk/client-s3 指向 R2 endpoint
```

### 3.9 关卡与掉落链

**这是本次调查中改动最大的一块。**

```
chapter_template              981 行 × 97 字段
  ├─ type:     1（普通）522 · 2（困难）459
  ├─ act_id:   非零 846 行 → 活动关卡；主线只有约 135 关
  ├─ chapter_name "1–1" · name "近海演习" · icon ["dahuangfeng"]
  ├─ difficulty 2–10 · oil · unlocklevel · star_require_1..3
  ├─ air_dominance · best_air_dominance · mitigation_level/rate
  ├─ investigation_ratio · ambush_ratio_extra · ammo_total · submarine_num
  ├─ grids · weather_grids · risk_levels
  ├─ box_list · random_box_list                        ← 物资箱
  └─ expedition_id_weight_list / boss_expedition_id /
     elite_expedition_list / ambush_expedition_list /
     guarder_expedition_list / ai_expedition_list      ← 指向出击节点
                    ↓  实测 11,701 / 11,702 命中（唯一落空的是哨兵 0）
expedition_data_template      15,515 行 × 34 字段
  ├─ id · dungeon_id · map_id · name · level · difficulty · type
  ├─ exp · exp_commander · time_limit · sink_limit · objective_1..3
  ├─ icon（拼音 slug）· bgm · ai · ai_mov
  └─ award_display    13,720 行有值，共 64,963 条；**元素是 2 或 3 元组，第三元素语义不统一**
                    ↓  resource_type=2 的 1,799 个 distinct id
item_data_statistics          3,030 行
  ├─ name / display    如「五联装533mm鱼雷T1设计图」
  ├─ icon              SquareIcon 1,291 · Props 1,150 · Equips 331 · ChargeIcon 217
  └─ 名称构成：设计图 320 · 含箱 215 · 其它（材料与货币等）2,490
```

**`award_display` 的第三元素不是数量，是展示标签。** 实测三元素形式共 92 条，第三位取值只有 6 种：

```
'1'  52 条        ← 才是真实数量
少量 18 · 较少 5 · 普通 5 · 较多 4 · 大量 8
样本 [[2, 59001, '少量'], [2, 59001, '普通'], …]
```

所以这套数据给不出「掉几个 / 概率多少」。页面渲染规则：第三元素命中 `{少量,较少,普通,较多,大量}` 时作为**原文标签展示**，是 `'1'` 时展示数量 1，其余一律不猜测。**另外 `chapter_template` 有独立的 `awards` 字段**（2 元组 `[[2, 56001], [2, 54011], …]`），与 `expedition.award_display` 是两个引用点，两处都要取并集展示，不能只读一边。

**关键结论：`award_display` 的 resource_type=2 命中的是 `item_data_statistics`，只有 0.3% 命中装备表。** 即关卡直接发放的是**物资与设计图**，不是装备本体。

装备本体走物资箱：`chapter.box_list` / `random_box_list` → `box_data_template`（85 行，字段只有 `{id, name:"物资箱", effect_id, icon, type}`）→ **`effect_id` 指向效果脚本，箱子内的装备随机池不在任何结构化数据表里**。

因此掉落反查的可行边界写在 §8，`drop` 表只承载能确证的部分：**能承诺「解析并展示已配置的奖励项与其展示标签」，不能承诺「与游戏内实际掉落数量与概率完整一致」。**

**其它已确认的关卡侧数据**：

```
chapter_template_loop   862 行 × 47 字段  周回/自律配置
  比主表少 50 字段，多 air_dominance_loop_rate / fightauto / slg_effect
  chapter_name 为 None（按 id 引用主表），不是独立关卡
enemy_data_statistics   12.9MB / 13,568 行  敌方单位，具名属性字段
enemy_data_by_type      25 类（含舰船侧没有的 14 鱼雷艇 / 15 运输舰 / 16 自爆艇 / 25 未知）
drop_data_restore       643 行  字段 {drop_id, resource_num, resource_type, target_id, target_type, type}
                        → 是掉落补正/保底表，不是主掉落表
world_chapter_template  644 行（sharecfgdata 版）  大世界海域
  expedition_map_id · grids · float_items · is_sairen · difficulty ·
  expedition_level · is_auto · is_transfer · map_bg · bgm
```

### 3.10 其余已验证的表

```
装备
  equip_data_statistics  10,365 行（sharecfgdata 版；ShareCfg 版是 [] 空壳）
    id 全局唯一。**这张表是「族 + 强化等级」混排的**，靠 base 继承组织：

    ★ 继承模型（先展开，再谈过滤与计算）
        8,841 行带 base；其中 **8,261 行自身没有 name / type / rarity / icon**，
        全部靠 base 指向父行继承。实证：
          stats[500] name='小海狸中队队徽' type=10 rarity=5 icon=500 base=None
                     value_1='14' value_2=25
          stats[501] name=None     type=None rarity=None icon=None base=500
                     value_1='16' value_2=30        ← 501 是 500 的强化形态
        **null 不等于「没有这个属性」。** 当独立条目处理会产出 8,261 个空名字装备页；
        当脏数据丢掉会丢掉整张强化后属性表。此前版本把这 8,261 行描述成
        「升级链与经济行」是错的——它们是继承子行。
        展开规则（normalize/equip-inherit.ts，在 Zod 校验之前跑）：
          1. resolved(r) = { ...resolve(r.base), ...ownNonNullFields(r) }
             派生行的非 null 字段是**覆盖**，value_1/value_2 是各等级自己的数值
          2. base 指向不存在的 id → 抛错中止（断链）
          3. base 成环 → 抛错中止，附环路径样本
          4. 链深上限 12（实测最长是强化 +0…+10，留余量）
          5. 族代表行 = base 为 null 的行，图鉴条目只挂在族代表行上
    ★ 装备条目判定（族代表行）
        1. 自身 name 非空 且 base 为 null（是族根，不是等级派生行）
        2. type ∈ equip_data_by_type 的数值键枚举（正向枚举，不是观测范围）
        3. id 出现在 equip_data_template（该族确有强化/经济配置）
      **不使用 id 数值截断。** 此前的 id ≥ 10000 是猜范围，两个方向都错：
        被误排除的真装备（均 type=10 合法且在模板表中）：
          500 小海狸中队队徽 · 520 珍珠之泪 · 580 九一式穿甲弹 · 600 一式穿甲弹 · 640 Z旗
        但低编号段也确有内建条目，须由条件 2/3 排除而不是由编号排除：
          2 序章重巡-萨福克（瞄准型） · 20 U556关卡单发鱼雷-弹药2 ·
          60231 烈焰崩袭 · 61007 约克城技能随机扫射海面LV1
        实测 id<10000 且过 name+type 的有 275 条，其中真装备与内建条目并存，
        进一步证明 id 不是判据。
      条数：**909 族代表行**（实测：10,365 行 → 族根且有 name 1,524 → type 合法 1,431
        → id 在 equip_data_template **909**）。旧口径 `id ≥ 10000` 得 734，**漏掉 175 条真装备**：
        500 小海狸中队队徽 · 520 珍珠之泪 · 540 治愈系猫爪 · 560 "宁海号"水上侦察机 ·
        580 九一式穿甲弹 · 600 一式穿甲弹 · 620 超重弹 · 640 Z旗 ·
        660 100/150号航空燃油 · 680 归航信标 · 700 九八式射击延迟装置 · 720 约定的证明
      rarity 分布 1:38 · 2:123 · 3:209 · 4:248 · 5:263 · 6:28（六档齐备）
      重名是不同稀有度/科技层的独立装备，各占一页：
        三联装152mm主炮 → 12100,12120,12140,22200,22220,22240
        三联装305mm主炮Mk8 → 13180,14000,14020,14040
    909 条族代表行全部带 icon 值（实测 0 条缺失），icon 可安全作为图片连接键；
    共 558 个 icon 族，EN 命中见 §3.8
    字段：name · descrip · icon · weapon_id · nationality · rarity · type ·
          part_main / part_sub · tech · skill_id / hidden_skill_id · speciality ·
          property_rate · ammo / torpedo_ammo / ammo_icon / ammo_info · label ·
          equip_parameters · equip_info · value_2 / value_3
  equip_data_template    9,170 行 · 升级与经济（next/prev/level/equip_limit/
                         ship_type_forbidden/upgrade_formula_id/destory_*/restore_*/trans_use_*）
                         ★ **普通强化链的真正来源**：{id, level, next, prev, group}
                           实测 8,261 行带 next 且**全部能在本表解析，0 断裂**
                           （500 lv1 → 501 lv2 → 502 …），group 是族号
                         ★ 经济参数同源：destory_*（分解）· restore_*（回收）· trans_use_*（转换）
                         **装备正体的判定依据：只有出现在此表的 id 才是可获得装备**
                         ★ equip_data_statistics 中 8,261 行 name/type 为 null 的行，就是与
                           此表共用的 5xx 强化等级键空间——两表是同一族的「等级行」与
                           「展示行」，不是脏数据
  equip_data_by_type     19 个数值类 + "all" · type_name · type_name2 · compare_group · equip_skin
                         type_name 12 种：舰炮 · 鱼雷 · 防空炮 · 战斗机 · 鱼雷机 · 轰炸机 ·
                         水上机 · 直升机 · 反潜机 · 设备 · 货物 · 导弹
  equip_data_by_quality  6 档 · gear_score · gear_score_addition · destory_resource_ratio
  equip_data_code        14 项特性中文：FP 炮击 · TRP 雷击 · AIR 空战 · BOMB 轰炸 ·
                         ASW 反潜 · GUID 制导 · LOCK 锁定 · SCA 散射 · VOL 跨射 ·
                         LRG 远程 · SRG 近程 · NORM 通常 · WAVE /轮 · NA 无
                         → 渲染 equip_data_statistics.speciality（形如 "<[LOCK]>"）
  equip_upgrade_data      281 条（282 键含 all）· **装备转换 / 研发图，不是普通强化等级链**
    { id, upgrade_from, target_id, material_consume:[[itemId,count],…], coin_consume }
    同一 upgrade_from 可指向多个 target，也可能多源汇入一 target，**有分叉与汇合**，
    对应游戏内「装备转换 / 研发」，不是 +0→+N 的等级提升（等级链见上面 equip_data_template）
    实证：4240 ← 28040（材料 18105×24 · 18108×18 · 18115×9，金币 500）
          4260 ← 4240（材料 18123×9 · 18106×30 · 18116×30，金币 4000）
    material_consume 的 itemId（18xxx 段）落在 item_data_statistics，
    → 「转换这件装备要哪些材料、哪里刷」可端到端连到 §3.9 的掉落反查
  equip_upgrade_template   50 条（51 键含 all）· 转换图谱的展示配置
    { id, category1, category2, equipments[], links[], gridSize, canvasSize, canvasPadding }
    category1 实测 7 类：1(9) · 2(9) · 3(9) · 4(9) · 6(3) · 7(4) · 10(7)
    → category1/2 提供装备二级分类，links 是图谱连线
  spweapon_upgrade        13.6KB · 特殊武器强化
  word_equipment_*       19 个 UI 标签：舰炮 · 小型舰炮 · 中型舰炮 · 大型舰炮 · 防空炮 ·
                         鱼雷 · 水面鱼雷 · 潜艇鱼雷 · 舰载机 · 战斗机 · 轰炸机 · 鱼雷机 ·
                         设备 · 其他 · 强化 · 外观 · 稀有度 · 类型 · 全部
                         → 与 equip_data_by_type 的 19 个数值类是两套口径：
                           数值类驱动数据关联与条目判定，UI 标签驱动筛选面板文案

技能
  skill_data_template    3,030 行，全部有 name（ShareCfg 版；GameCfg/skill.json 是逻辑半区）
    id · name · desc · desc_add · desc_get · desc_get_add · max_level · type ·
    system_transform · world_death_mark
  skill_data_display     266KB · 技能展示文本
  skill_need_exp         10 行 {exp, level} · 技能升级经验

突破与强化
  ship_data_breakout     3,347 条（实测数字键计数，非 3,957）· {breakout_id, breakout_view,
                         icon, id, level, pre_id, use_char, use_char_num, use_gold,
                         use_item[], weapon_ids[]}
                         ★ 与 ship_data_statistics(3,957) **不是一一对应**：突破材料表条数
                           少于阶段行数，不能假设每个 stats 行都能取到 breakout 材料。
                           normalize 时对取不到的阶段留空并计数，不硬造。
  ship_data_strengthen   829 行（830 键含 all）{id(=group_type), attr_exp[5], durability[5], level_exp[5]}
                         ★ 按 group_type 而非 skin_id 索引。859 组中 **59 组无强化配置**，
                           id 全为 97xxxx 段 = 正好是 handbook_type=3 的 59 条 META 船。
                           META 页因此不渲染强化曲线，而不是显示空表。
  ship_strengthen_blueprint 1,410 行 {id, lv, need_exp, need_lv, effect[5], effect_desc,
                         effect_dialog[], effect_skill, effect_skin, effect_breakout,
                         effect_equipment_proficiency, effect_preload, change_skill, special}

改造与科技
  ship_data_trans        106 行 {group_id, skin_id, skill_id, transform_list[[[3,501],…],…]}
  ship_data_group.trans_type 非零 78 · trans_skin 非零 106
  ★ 改造节点的条件与成本不在 ship_data_trans 里，只在 transform_data_template：
    transform_data_template  1,217 个节点（CN/ShareCfg，725KB，无 all 键）
      { id, name, descrip, icon, effect[], use_gold, use_item[[[itemId,count]]],
        use_ship, level_limit, star_limit, max_level, gear_score[],
        skill_id, ship_id, skin_id, condition_id[], edit_trans[] }
      实证节点 501：name=舰体改良I · effect=[{durability:45}] · use_gold=200 ·
                     use_item=[[[18001,1]]] · level_limit=1 · star_limit=1 · max_level=1
      → 改造消耗的**唯一**来源。ship_data_trans.transform_list 只是节点 id 引用，
        没有这张表就只知道「有哪些节点」而不知道「花多少、加什么」。
      → 归一化为 retrofit_node 表，use_item 的 itemId 落回 item_data_statistics，
        与装备转换共用一条掉落反查。
  ship_transform           12.5KB · 与上表配合使用（阶段 1 建表时一并纳入并实测语义）
  fleet_tech_ship_template 246KB · fleet_tech_template · fleet_tech_ship_class · fleet_tech_group
                         → **舰队科技树由这组表建模**（按船/按阵营的科技点加成）
  technology_data_template 685 条（686 键含 all）{name, sub_name, desc(长中文), consume,
                         drop_client, rarity, lv_limit, blueprint_version, type, label,
                         label_color, time, bg, bg_icon}
      ★ **这是「科研项目」目录，不是舰队科技树**（此前版本定性错误）。实证：
          项目 1  name='C-153-MI'  type=1  time=21600  desc 讲心智魔方基础构造
          项目 11 name='B-622-MI'  type=1  time=14400
                  desc 原文：「该科研项目致力于通过实战的手段，收集各种实验数据…」
          type 分布 {1: 456, 2: 229}（对应「小型/中型项目」两类）
          time 是研究耗时秒数，取值 1800/3600/…/21600
      → 建模为 research_project 目录页（名称、耗时、消耗、解锁条件、版本），
        与 fleet_tech_* 是两个独立页面体系，不能合并成一个 /tech。
        科研**船**另由 ship_data_blueprint(42) 建模，三者互不替代。

META
  ship_meta_breakout     236 行 {breakout_id, breakout_view(中文), gold, id, level,
                         pre_id, item1/item1_num, item2/item2_num, repair, weapon_ids[]}
  ship_meta_skilltask    1,396 行 {id, level, need_exp, skill_ID,
                         skill_levelup_task[[类型,值,数量],…], skill_unlock}
  另有 ship_meta_repair · ship_meta_repair_effect · ship_strengthen_meta

科研船
  ship_data_blueprint    42 行 {id, name(西雅图), price(1500), attr_exp[5],
                         blueprint_version, change_skill, fate_strengthen[5],
                         strengthen_effect[30], strengthen_item, gain_item_id,
                         is_pursuing, simulate_dungeon, unlock_task[[id, 秒],…]
                         （秒值 0/86400/172800/259200/345600 → 逐日解锁）,
                         unlock_word, luck_story, normal_display}
                         → 科研船蓝图需求工具完全可做，42 条规模可控

皮肤与语音
  ship_skin_template     2,730 行（5.9MB）
    ★ painting（立绘 slug：gin / gin_2 / qiye_7 / wuqi_3 …）2,725 行有值
    ★ skin_type：-1 默认立绘 1,213 · 4 换装 1,343 · 1:61 · 2:107 · 3:3 · 6:3
    name · desc · ship_group · tag · time · shop_id / shop_type_id
    ★ voice_actor / voice_actor2 / voice_lang     → 配 voice_actor_CN 可得 CV 姓名
    illustrator / illustrator2                    → 无姓名表，见 §11
    shop_dynamic_hx（7 条商店动态立绘和谐标记）
    bg · bgm · bound_bone · spine_use_live2d · l2d_* · fx_container
  voice_actor_CN         502 行 {actor_name, code}，493 行含中文 → CV 可展示
  ship_skin_words        2,485 行（sharecfgdata 版；ShareCfg 版是 [] 空壳）
    battle · detail · expedition · feeling1..5 · gift_dislike · gift_prefer ·
    headtouch · home · drop_descrip · couple_encourage …
    → 语音文本全中文，5.8MB，详情页高价值内容，可做

武器与弹道（面板估算用）
  weapon_property        53,585 行 × 33 字段
    damage · bullet_ID · barrage_ID · aim_type · attack_attribute · attack_attribute_ratio ·
    min_range · charge_param · precast_param · auto_aftercast · initial_over_heat ·
    action_index · corrected · angle · axis_angle · fire_fx · fire_sfx · expose …
  bullet_template        19,165 行 × 25 字段
    ammo_type · damage_type · hit_type · pierce_count · range · acceleration ·
    random_damage_rate · antisub_enhancement · attach_buff · effect_type · extra_param …
  barrage_template       26,975 行 × 16 字段（纯弹幕几何：angle / delay / delta_* /
                         offset_* / primal_repeat / senior_repeat / trans_ID）
  aircraft_template      7,224 行 × 25 字段
    accuracy · attack_power · max_hp · dodge · dodge_limit · crash_DMG ·
    ACC_growth · AP_growth · hp_growth · nationality · icon · name · model_ID …
  spweapon_data_statistics 2,619 行 × 26 字段（有 name/icon/rarity/tech/usability/
                         unique/uncraftable/skill_upgrade）→ 兵装图鉴可做
  weapon_name            2,380 条，仅 170 条有 name → 基本无用，只作 5xxxx 武器名补充
  gameset                408 键全局常量：air_dominance_a/p/q/r/s/t/x/y、
                         air_dominance_level_1..5、unoccupied_ship_nationality[97] 等

其它
  shop_template · item_virtual_data_statistics · task_data_template 7,948 行
    {name, desc, award, award_choice, level, fix_task, auto_commit,
     guild_coin_award, activity_client_config, count_inherit, is_head, added_tip}
    → **task_data_template 是任务表，不是日常委托表**。AL 的「委托」在这套数据里的
      归属表尚未定位，见 §11 F。
```

### 3.11 校验策略

| 情况 | 处理 |
|---|---|
| 必需字段缺失 / 类型不匹配 | 抛错，中止，上传 artifact + 自动开 issue |
| 表条目数低于注册表阈值（含空壳 `[]`/`{}`） | 抛错，中止 |
| `attrs` 长度 ≠ `attr_def` 条目数 | 抛错，中止 |
| `attr_def` 键集 ≠ `enemy_data_statistics` 属性字段集 | 抛错，中止（映射漂移） |
| `type` 不在 `ship_data_by_type.all` | 抛错，中止（正向依据被破坏） |
| 装备 `type` 不在 `equip_data_by_type` 数值键集 | 抛错，中止（同舰船侧，装备分类也是正向枚举） |
| 装备 `id` 不在 `equip_data_template` | 静默排除出图鉴条目，并计入「伪条目排除数」快照字段；该数突增（>±15%）即 warn，说明上游改了条目语义 |
| 图鉴装备条目缺 `icon` | 抛错，中止（909 条实测全部有 icon，缺失即数据异常） |
| 装备 `base` 指向不存在的 id（断链） | 抛错，中止，附样本 —— 继承未展开时 8,261 行会被当空名字条目 |
| 装备 `base` 成环 / 链深 > 12 | 抛错，中止，附环路径或最深链样本 |
| 把带 `base` 的行当独立装备条目计入图鉴 | 构建期断言：条目集中每行 `base` 必须为空（§3.10 族根条件） |
| 改造节点 `use_item` 的 itemId 不在 `item_data_statistics` | warn + 进隔离清单 |
| 用 `star` 推稀有度 | 禁止，且有实证：856 组阶段行的 `star` 四行互不相同而 `rarity` 恒定。`rarity.json` 分舰船与装备两段（标签来源不同），构建期若代码引用 `star` 作为 rarity 输入即失败 |
| 装备 `icon` 在 EN 侧无对应 | warn + 走占位图，不中止（已知 59 族 / 98 条） |
| `handbook_type` 出现未知值 | 抛错，中止（图鉴分类语义变了） |
| `nationality` 不在 `factions.json` | 抛错，中止（不允许静默显示未知阵营） |
| `factions.json` 的 `name` ≠ gametip 的 `word_shipNation_{wordKey}` | 抛错，中止（上游改名或词键接错，整站阵营标签一起错位；文本只从 gametip 渲染，表里的 name 仅用于比对） |
| 规范名里的 `{namecode:N}` 在 `name_code` 里找不到 | 抛错，中止 —— 1,213 条规范名里 362 条是占位（重樱 / 铁血 / META 为主），漏解就是页面标题带花括号 |
| 阶段行内部同一 `skin_id` 出现两个 `rarity` | 抛错，中止。判据是先按 `id - skin_id ∈ 1..4` 切行；全表 11 例冲突全部来自把非阶段行算了进来 |
| 阶段行数 / `skin_id` 数低于基线（3,429 / 860），或 4 行/船占比 < 0.9 | 抛错，中止（`ship_data_statistics` 的行结构语义变了） |
| 同一 `skin_id` 出现多个不同船名 | warn + 进隔离清单，不静默合并 |
| `painting` 为空 / EN 侧无对应 skinId | warn + 走占位图，不中止 |
| `award_display` 的 id 在 `item_data_statistics` 找不到 | warn + 进隔离清单 |
| 科技节点没被任何 `fleet_tech_group.techs` 引用，或 `class.ships` 列出无科技行的船 | 抛错，中止（四表链条断一环，页面科技区块会半空） |
| 舰级 `nation` ≠ 舰船 `nationality` | 抛错，中止（实测 726/726 相等，这是 nationality 的第二个独立证据源） |
| 改造节点引用数 ≠ 1,217，或有节点被引用两次 | 抛错，中止（`transform_list` 与模板表是双向双射） |
| `SHIPBLUEPRINT` / `COLLECTSHIP` 参数里的 `shipGroupId` 不是本船 | 抛错，中止（实测 46 条全自指；指错就是活动链接错船） |
| `description` 出现未登记的获取方式命令 | 抛错，中止（新命令的跳转语义要先能说清） |
| 未知新增字段 | 存入 `raw`，warn 不失败 |
| `weapon_name` 缺 name（2,210/2,380） | 预期行为，不告警 |

原则：**宁可构建失败，不可静默产出错数据。**

### 3.12 归一化产物与版本 diff

```jsonc
// data/normalized/manifest.json —— 入库，Pages 构建的唯一数据源
// 由 pipeline#normalize 生成，构建期只读不写；字段必须全部由数据内容决定
{
  "dataSha":     "4cca5c2437007b62d30a6235fcfc0c0203231378",
  "snapshotSeq": 47,                       // 单调递增，可排序
  "server":      "CN",
  "tier":        ["A","B"],
  "counts":      { "ship": 859, "shipStage": 3427, "shipRowOther": 528, "shipSkin": 2730,
                   "retrofit": 106, "equipment": 909, "equipIconFamily": 558,
                   "skill": 3030, "chapter": 981, "expedition": 15515,
                   "dropEntry": 64963, "item": 3030, "research": 42,
                   "technology": 685, "world": 644, "voiceLine": 2485,
                   "orphanSkinGroup": 352, "equipLevelRows": 8261,
                   "retrofitNode": 1217, "researchProject": 685, "fleetTechNode": 0 },
  "tableDirs":   { "ship_data_statistics": "sharecfgdata",
                   "gametip": "sharecfgdata", "ship_data_group": "ShareCfg" },
  // ↑ 每张表实际读取的目录也入库，24 组互补表可事后审计，防止误读空壳
  "files":       { "ships.jsonl.gz": { "rows": 859, "bytes": 812345, "sha256": "…" } }
}
```

版本比较一律用 `snapshotSeq` 判序；`dataSha` 只做来源追溯，**不可用于判序**。同步的墙上时间不进这个文件——`data/normalized/**` 是 `pipeline#emit` 的输入指纹，掺时间戳等于「数据没变也整站重建」（实测过一版带 `syncedAt` 的 manifest：同一份数据重跑一次 normalize，建库缓存 key 就换一个）。时刻记在 `data/snapshots/index.json` 台账，那里不进指纹。

diff 输出：`addedShips[]` `changedShips[]` `removedShips[]` `addedSkins[]` `addedEquips[]` `changedEquips[]` `addedChapters[]` `enumChanges[]`（新舰种/新阵营）

→ 自动生成 `apps/web/content/update/{snapshotSeq}-{date}.mdx`：新船卡片、数值变更对照表、新皮肤、新装备。`handbook_type=1` 的新联动条目自动生成活动关联占位供人工补写。

**自动生成的 MDX 只允许写 frontmatter 与组件调用，绝不把外部字符串拼进 MDX 正文。** 船名、描述、别名、wiki 对照文本都是**上游可控输入**，MDX 会把 `{`、`` ` ``、`<Comp/>`、`{/* */}` 当语法解析——一个含 `{` 的装备名就能让 Pages 构建失败，而这类输入里确实存在花括号（`speciality` 字段形如 `<[LOCK]>`，掉落标签是中文但 wiki 对照文本无约束）。规则：

```ts
// ✅ 数据走 props / JSON，MDX 正文只放组件与自有文案
---
title: "更新公告 #47"
generatedFrom: 47
ships: [{ name: "…", attrs: [...] }]     // frontmatter 里是 JSON，安全
---
<ShipTable rows={frontmatter.ships} />

// ❌ 禁止：模板字符串把上游文本插进 MDX 正文
`### ${ship.name}\n${equip.descrip}\n${wikiNote}`
```

落地的强制项：`pipeline report` 生成器**只输出 frontmatter JSON + 固定组件标签**，`data/*.json` 单独 emit；再加一条 CI 断言——生成的 `.mdx` 正文（frontmatter 之外）不得包含未在白名单内的 `<`、`` ` ``、`{`。若将来必须内联文本，用 `JSON.stringify` 进 frontmatter，由组件渲染，而不是拼进正文。

入库量：A 档 gzip 后约 2.5MB；B 档（含 64,963 条掉落展开）约 4MB。C 档只提交面板估算需要的派生精简结果（武器 damage/射速/效率聚合表），**不提交 `bullet_template` 与 `barrage_template` 全量**。

---

## 4. 应用层

### 4.1 技术选型

| 选型 | 理由 |
|---|---|
| Next.js 15 + `output: 'export'` | 全静态，托管零成本，SEO 最优 |
| TypeScript 严格模式 | 上游数据无类型，TS 是唯一防线 |
| Tailwind + shadcn/ui | 高密度数据表格 UI |
| **`node:sqlite`（内置）** | 构建期查询，同步 API。已从待实测转为定案：Node 24.21 实测 11 项能力全通（含 `ATTACH`、FTS5、`PRAGMA user_version`、`readOnly`），且同数据两次建库**逐字节相同**。零原生依赖，避开 `better-sqlite3` 的 ABI 与 node-gyp 风险。详见 §4.6 |
| nuqs | 类型安全的 URL query state |
| MiniSearch（主索引）+ Orama（正文） | §4.4 |
| Recharts | 属性成长曲线 |
| pinyin-pro | 中文名 → 全拼与首字母，配 `pinyin-overrides.json` 处理多音字 |
| MDX + next-mdx-remote | 攻略内容，可嵌入交互组件 |
| sharp | 图片压缩与多尺寸生成 |
| Turborepo | monorepo 构建缓存与任务编排 |

Pages 而非 Workers：A+B 档每日构建约 31 次 × 数分钟，Pages Free 的 500 次/月与 20 分钟超时均充裕，静态导出零配置。后续迁 Workers 静态资源成本低，两者共用同一套 CDN。

### 4.2 路由清单

**详情页**（`generateStaticParams` 全量预渲染）

| 路由 | 数量 | 数据来源 | SEO title 模板 |
|---|---|---|---|
| `/ship/[groupType]` | **859** | ship + stages + skins + retrofit + fleet_tech + skill + voice + obtain | {name} - {阵营}{舰种} \| 属性·突破·技能·皮肤·配装 |
| `/equipment/[id]` | **909** | equipment + upgrade_chain + apply ships | {name} - {类别} \| 属性·获取·适用舰船 |
| `/chapter/[id]` | **981** | chapter + expeditions + drops + enemy | {chapter_name} {name} - 掉落与攻略 |
| `/skill/[id]` | 3,030 | skill + 反向舰船索引 | {name} - 技能效果与持有舰船 |
| `/guide/[...slug]` | ~50 | MDX | {文章标题} |
| `/update/[seq]` | 累积 | 自动生成的 diff 页 | {日期} 更新内容 |

`/chapter/[id]` 中活动关卡 846 / 主线约 135，两种模板：主线强调材料掉落与推荐等级，活动强调 pt 与兑换。**技能页是否独立成页在首个阶段决定**（3,030 页会明显拉长构建，可作为可选项延后）。

**SEO 索引页**（受控枚举，服务端渲染列表，各页独立 title / description / H1 / canonical）

生成规则：**只为包含 ≥ 5 条记录的组合建页**，避免薄页 / doorway page 被降权。

| 路由 | 说明 | 预计数 |
|---|---|---|
| `/ship/faction/[slug]` | 阵营页，slug 来自 `data/manual/factions.json`，标题取 gametip 实时文本 | 28（实出值；10 鸢尾教国无船不建页） |
| `/ship/hull/[type]` | 舰种页：**slug 用数字 `ship_type`，标题用 `type_name`** —— 21 个舰种只有 18 个不同显示名（导驱 20/21 同名、风帆 22/23/24 同名），按名字做 slug 会撞成 18 页 | 21 |
| `/ship/position/[teamType]` | 站位页：`team_type` ∈ {vanguard, main, submarine}（9 / 9 / 3 个舰种） | 3 |
| `/ship/rarity/[rarity]` | 稀有度页（`data/manual/rarity.json`，实测阶段行取值 2–6 五档） | 5 |
| `/ship/category/[handbookType]` | 图鉴分类页：常规 / 联动 / 改造 / META | 4 |
| `/ship/faction/[slug]/[type]` | 阵营 × 舰种，满足 ≥5 阈值者 | ~60 |
| `/equipment/category/[type]` | 装备分类页（19 数值类） | 19 |
| **合计** | | **~140** |

三维以上长尾组合不生成静态页，只走客户端筛选，明确放弃收录。

**交互与功能页**

| 路由 | 渲染 | 说明 |
|---|---|---|
| `/` | SSG | 当前版本、新船、新皮肤、热门攻略 |
| `/ship` | SSG + CSR 筛选 | 全量交互筛选；query 变体 canonical 指向 `/ship` |
| `/ship/compare` | CSR | 最多 4 艘 |
| `/equipment` | SSG + CSR 筛选 | 用 `compare_group` 做同类对比 |
| `/skill` | SSG + 搜索 | |
| `/chapter` | SSG | 主线 / 活动 / 困难分组 |
| `/drop` | CSR | 见 §8，只承载可确证的掉落 |
| `/item` | SSG + CSR | 物品与设计图 3,030 条（可选） |
| `/tech` | SSG | 舰队科技树 685 节点 |
| `/research` | SSG | 科研船 42 条 |
| `/build` | SSG | 建造时间表与检索（概率见 §8） |
| `/tools/dps` | CSR | 面板估算 |
| `/tools/material` | CSR | 强化与突破材料计算 |
| `/tools/retrofit` | CSR | 改造分支与消耗 |
| `/tools/blueprint` | CSR | 科研船蓝图需求 |
| `/world` | SSG | 大世界海域 644（D 档） |
| `/guide` | SSG | 攻略合集 |
| `/update` | SSG | 版本更新追踪 |
| `/search` | CSR | |
| `/about` | SSG | 数据来源、`dataSha`、`syncedAt`、核验声明、能力边界、反馈入口 |

**舰船详情页内容清单**（除标注外均有数据支撑）：六维雷达图（`property_hexagon`）、12 项属性 **1–100 级**成长曲线（`attrs` + `attrs_growth` + `attrs_growth_extra`，上限实测 100，见 §3.7）、突破阶段表与材料消耗（每船 1–9 行，众数 4；材料来自 `ship_data_breakout` 3,347 条，**非每行都取得到**，见 §3.10）、装备位与效率、技能名与描述文本（**buff 机制与触发数值不覆盖**，见 §8.2）、皮肤画廊（**画师除外**，无姓名源）、改造分支（`trans_type` / `trans_skin` / `trans_skill` / `ship_data_trans`）、舰队科技点、语音文本、获取方式（结构化文本 + 跳转参数）、该船可穿装备的转换材料（`equip_upgrade_data` → `item_data_statistics`）。

### 4.3 构建期数据访问

```ts
// apps/web/lib/db.ts —— 仅构建期（Node）运行
export function getShip(groupType: number): ShipDetail | null
export function listShips(filter: ShipFilter): ShipSummary[]
export function getSkins(groupType: number): ShipSkin[]
export function getStages(groupType: number): ShipStage[]
export function getRetrofit(groupType: number): Retrofit | null
export function getVoiceLines(skinId: number): VoiceLine[]
export function getItemDrops(expeditionIds: number[]): DropRow[]
export function getSourcesForItem(itemId: number): ChapterSource[]
```

所有 SQL 集中在 `lib/queries/`，页面不写 SQL。

库结构在 `packages/pipeline/src/store/schema.ts`（`SCHEMA_VERSION = 1`，16 表，`data/al.sqlite` 2.83 MiB）。三条约束是实测出来的，不是设计偏好：

- 属性走窄表 `ship_stage_attr(group_type, stage, attr, base, growth, growth_extra)`，`attr` 取值即 `attr_def.name`。不用 3×12 列宽表：定义表多一项属性时宽表要改 DDL，窄表只多一行
- 全部行在**单个事务**里插完，41,124 行属性逐条自动提交时 `emit` 超过两分钟没跑完就被杀；同一步骤里逐表核对「jsonl 行数 == 表行数」，末尾断言 `PRAGMA integrity_check = ok`
- `meta` 只写 `schema_version` / `data_sha` / `count:*`，不写任何时间。时间戳会直接摧毁「同数据两次建库逐字节相同」这条性质（`data/al.sqlite` 不入库，靠这条性质保证缓存与 CI 产物可复现）
- 外键常开，且测试真去撞它：往 `ship_stage` 插一个不存在的 `group_type` 必须 `FOREIGN KEY constraint failed`。阶段行孤儿 group 是在 normalize 层处理的（2 行进隔离清单），不是靠放宽约束

实测读路径（`packages/pipeline/test/store.test.ts` 逐条钉住，不是示例代码）：`20502` → 厌战 / 皇家 / 超稀有 / 战列 / main；耐久突破曲线 `1298 → 1615 → 2248 → 3197`；该组 5 行皮肤，规范名取 `skin_type = -1` 行，另含改造皮肤「厌战.改」；`ship_source.command = 'SHIPBLUEPRINT'` 42 条；筛选面板基数 `nationality=97`（META）59 条、`98`（布里）3 条、`has_retrofit=1` 106 条；`fleet_tech_ship.group_type=10102` 的舰级名是「法拉格特级」。

客户端 JSON：

```
/public/data/ships.index.json      ~300KB gzip   列表页筛选
/public/data/equips.index.json     ~320KB gzip
/public/data/drop.index.json       ~500KB gzip   材料反查（分片）
/public/data/chapters.index.json   ~200KB gzip
/public/data/search.index.json     ~260KB        主搜索索引
```

单文件 gzip 超 500KB 即分片按 chunk 懒加载。

### 4.4 搜索

游戏数据库搜索的真实意图是「按名字找东西」，不是全文检索散文。

**主索引**（自建，MiniSearch，~260KB）

```
索引字段：舰船名 / 英文名 / 皮肤名 / 别名昵称 / 拼音全拼 / 拼音首字母
          装备名 / 装备别名 / 技能名 / 物品名 / 关卡名
```

拼音首字母是关键能力：`qy` → 企业，`bsm` → 俾斯麦，`dhs` → 大凤改。通用分词引擎提供不了。

两个必备配套：

- `data/manual/aliases.json`：人工维护的别名表，来源为 biligame wiki 的「昵称术语」「船名对照」「装备别称」三张表。这是搜索真正的价值所在。
- `data/manual/pinyin-overrides.json`：**多音字例外表**。自动拼音在舰船名上必错（长门 `chang2` 非 `zhang3`、齐柏林、香格里拉等），逐条人工登记。859 艘里量不大但不可省。

**MDX 正文搜索**：Orama（具备 CJK tokenizer），内容层阶段加入，索引懒加载，不进首屏。

### 4.5 性能预算（写进 CI，超限构建失败）

| 指标 | 预算 | 说明 |
|---|---|---|
| 产物文件数 | **< 18,000** | Pages 硬上限 20,000，留 2,000 余量 |
| 单文件体积 | < 25 MiB | Pages 硬限制 |
| 单页 HTML | < 60KB gzip | 国内首屏 1–3s 前提下 HTML 越小越好 |
| 首屏 JS | < 170KB gzip | 详情页只加载必要 chunk |
| icon | < 20KB WebP | |
| 立绘 | < 300KB WebP / < 350KB AVIF | 懒加载 + LQIP |
| LCP | < 3.5s（国内 4G） | Cloudflare 免费版无大陆节点，预算相应放宽 |
| Lighthouse | SEO ≥ 95，A11y ≥ 90，Perf ≥ 85 | |

**产物文件数预算**：

| 项 | 数量 |
|---|---|
| HTML（859 舰船 + 909 装备 + 981 关卡 + 140 索引页 + 50 攻略 + 更新页 + 功能页 + 杂项） | ~2,900 |
| 技能页（若独立成页） | +3,030 |
| Next.js 共享 chunk | ~300 |
| 客户端 JSON 与搜索索引 | ~15 |
| CSS / 字体 / 杂项 | ~200 |
| **合计（不含技能页）** | **~3,400** |
| **合计（含技能页）** | **~6,400** |

两种都在 18,000 守卫线内，但含技能页会使构建时长翻倍——该取舍在首个阶段实测后定。图片零入产物。

**国内体验措施**：

- `<link rel="preconnect" href="https://img.<域名>">`
- 首屏 icon 用 `priority` + `fetchPriority="high"`；立绘一律 `loading="lazy"`
- R2 侧 `Cache-Control: public, max-age=31536000, immutable`
- LQIP 内联 base64，防布局跳动
- 中文字体子集化（全量字体数 MB，只切常用字 + 数字）
- 掉落与反查的索引 JSON 按 chunk 懒加载，不进首屏

---

### 4.6 静态导出必须落到代码级配置（此前的版本只写了概念）

`output: 'export'` 不是一句注释就能生效的，以下每一项都是验收条件，缺一即在构建期或运行时失败：

```ts
// apps/web/next.config.ts —— 必须与 package.json 同目录，放仓库根不会被读取
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'export',
  images: {
    unoptimized: true,          // ★ 必开：静态导出没有 /_next/image 服务端，
                                //   否则 next/image 产出的 URL 在 Pages 上是 404
  },
  trailingSlash: true,          // Pages 上 /ship/10103/index.html 的可访问形式
  generateBuildId: async () => process.env.CF_PAGES_COMMIT_SHA ?? 'dev',
  env: { NEXT_PUBLIC_IMG_BASE: process.env.NEXT_PUBLIC_IMG_BASE },
}
export default nextConfig
```

**动态路由**：`/ship/[groupType]`、`/equipment/[id]`、`/chapter/[id]`、`/skill/[id]`、`/index/[facet]/[slug]` 每一个都必须：

```ts
export const dynamicParams = false      // ★ 未预渲染的路径直接 404，不允许运行时生成
export async function generateStaticParams() {
  return db.listShips({}).map(s => ({ groupType: String(s.groupType) }))
}
```

`dynamicParams` 不关时，`output: 'export'` 下访问任何不在 `generateStaticParams` 里的路径都会拿到 404 页——这本身是期望行为，但**必须在 CI 里断言 `out/` 下 HTML 文件数 == 期望路由数**，否则漏一条路由构建照样成功。

**图片 URL 生成**：`next/image` 在 `unoptimized: true` 下只负责尺寸属性，实际 src 由 `lib/img.ts` 拼 R2 域名与哈希 key：

```ts
export const imgSrc = (key: string, w: number) =>
  `${process.env.NEXT_PUBLIC_IMG_BASE}/${key}?w=${w}`   // 无 /_next/image
```

**禁止服务器专用 API**：`apps/web` 里不得出现 `cookies()` / `headers()` / `revalidate` / Route Handler / `export const runtime = 'edge'`。

主判据用 ESLint，不用 grep——grep 在这一条上出过两次事故：`(runtime|dynamic)` 会**误杀 §4.6 自己强制要求的 `export const dynamicParams = false`**，而扫 `apps/web/src` 时该目录并不存在（本项目是 `apps/web/app`），`! grep` 对空目录返回成功，检查会静默通过并给出「已守卫」的假象。

```jsonc
// apps/web/eslint.config.mjs 追加
{
  rules: {
    'no-restricted-syntax': ['error',
      { selector: "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > Identifier[regex='^(runtime|revalidate|revalidatePath|fetchCache|preferredRegion)$']",
        message: '静态导出不允许该段配置' },
      { selector: "CallExpression[callee.name=/^(cookies|headers|connection|draftMode)$/]",
        message: '静态导出不能使用请求期 API' }
    ]
  }
}
```

`dynamicParams` **不在禁止名单里**（它是必须存在的那一个）。grep 只作兜底，且必须显式失败而不是静默通过：

```yaml
- name: 静态导出守卫（目录不存在即失败）
  run: |
    test -d apps/web/app || { echo "::error::apps/web/app 不存在，守卫失效"; exit 1; }
    if grep -rnE "export const (runtime|revalidate|fetchCache|preferredRegion)( |=)|revalidatePath\(|\bcookies\(|\bheaders\(" apps/web/app apps/web/lib; then
      echo "::error::发现服务器专用 API（见上）"; exit 1
    fi
```

**Pages 侧配置（唯一口径，其余章节以此为准）**：

```
Root directory    （留空 = 仓库根）      ← 不能填 apps/web
Build command     pnpm build             ← 仓库根的总构建脚本
Output directory  apps/web/out
```

**Root directory 必须是仓库根**：构建顺序里的「解 normalized → 建 SQLite → 导出客户端 JSON 到 `apps/web/public/data/`」是跨包步骤（§6.2），把 Root 设成 `apps/web` 会让 Pages 在应用目录里跑 `next build`，**跳过这三步前置任务**，产物用的是仓库里遗留的旧 `public/data/`——构建成功、页面是旧数据，属于最难察觉的失败类型。

`next.config.ts` 必须在 `apps/web/`（与它的 `package.json` 同目录），放仓库根不会被读取。

**环境变量只允许一个名字**：`NEXT_PUBLIC_IMG_BASE`。此前 §4.6 代码读 `IMG_BASE`、§6.2 却设 `IMG_CDN`，两边对不上会让图片 URL 变成 `undefined/...`。`ci.yml` 加一条断言：构建产物里 grep 不到字符串 `undefined/`。

这条断言的**搜索串必须是带斜杠的 `undefined/`**：单页实测里 `undefined` 出现 29 次，全部是 Next RSC flight 载荷自己的 `"$undefined"` 哨兵，扫裸词等于天天误报。同理 `/_next/image` 只能扫 HTML——`out/_next/static/chunks/main-*.js` 里含这个字面量 2 次，是 Next 运行时自带的 image loader，删不掉。

**首版页面实测**（本机 Windows，Node 24，Next 15.5.28 + React 19.3.1）：

| 项 | 值 |
| --- | --- |
| `node:sqlite` 在 `next build` 的预渲染进程里 | 可直接用，不需要 `--experimental-sqlite`；Pages Linux 镜像仍待 1.12 验 |
| 首页 First Load JS | 106 kB（共享 chunk 102 kB） |
| 舰船详情页 HTML | 47.7 kB（12 张属性图 + 3 张表 + 页脚来源） |
| 每条成长线的顶点数 | 2 个端点。按 1–100 逐点画线时同一页是 **298 kB**，859 页即 250MB+；公式对等级线性，端点即精确 |
| 产物文件数（1 艘船切片） | 24 个文件 / 953KB，其中 HTML 4 个（`/`、`/404`、`/404/index`、`/ship/20502/`） |
| 未预渲染路径 | `/ship/99999/` → 404，与 `dynamicParams = false` 一致 |
| §4.6 的 ESLint 守卫 | 反证过：塞进 `export const runtime = 'edge'` 与 `cookies()` 各报一条错，而 `export const dynamicParams = false` 不被误杀 |

构建期 `next build` 的类型检查保持开启（它在首跑就抓到一个真实错误：查询里取了不存在的 `label` 列）；ESLint 不在构建里重跑一遍，`apps/web/eslint.config.mjs` 继承根配置并追加守卫规则，由 `pnpm lint` 单独执行——两处都跑只会让同一个错误有两份日志。

**依赖安装确实需要网络**。Cloudflare Pages 在构建时执行 install（官方 Next.js Static HTML Export 文档明说），因此本文对「零网络」的口径统一为：**构建阶段不访问业务数据源**（AzurLaneData / EN 仓库 / biligame wiki），依赖安装与 CF 平台自身通信不在禁止之列。§7 阶段 1 的断网验收改为「把 `data/raw` 与网络出口 mock 掉，`pnpm build` 仍产出与联网时逐字节相同的 `out/`」。

**原生模块：改用 `node:sqlite`，`better-sqlite3` 从依赖里去掉**（原为「待实测」项，本机已实测完成）。

Node 24.21 + `node:sqlite` 逐项探针结果，11 项能力全部可用：

```
OK  basic exec + insert / prepare().all()
OK  PRAGMA user_version
OK  ATTACH DATABASE                              ← 计划原本担心不支持
OK  ATTACH 后跨库 JOIN
OK  FTS5 VIRTUAL TABLE                           ← 计划原本担心不支持
OK  JSON1 json_extract
OK  transaction BEGIN/COMMIT
OK  窗口函数 row_number() OVER
OK  readOnly: true 打开已落库文件
OK  无 -wal 残留
```

另外测了**同数据两次建库是否逐字节相同**：两次 `DatabaseSync` 建库（含 `page_size`、`PRIMARY KEY`、二级索引、固定顺序插入）产出的文件 **sha256 完全一致**（`d258ab11…`，均 12,288 字节）。这让 §6.2 的「确定性重建」与 §3.12 的 manifest 文件哈希校验第一次拿到真实依据，而不是纸面承诺。

因此定案：

- **`node:sqlite` 为主**，零原生依赖，无 ABI 风险，本机和 Pages Linux 行为一致。
- **`better-sqlite3` 移出依赖**。理由是它在本机缺少源码编译回退所需的工具链（`gcc` / `make` 均不存在，一旦 Node 24 无对应 prebuild 就装不上），而它的 prebuild 覆盖情况**我没有实测**——也就是说继续用它，风险是「不确定能否装上」；用 `node:sqlite`，能力已实测。两者取后者，不必赌上游二进制。
- 仍需**冷构建实测一次** Pages 构建镜像里的 Node 24 是否默认暴露 `node:sqlite`（Node 22 起为实验特性、24 已稳定，但 `--experimental-sqlite` 标志在部分小版本仍需显式传，需在真实构建环境验证并决定是否加 `NODE_OPTIONS`）。这一条留在阶段 1.12。
- 建库必须**显式固定**：`PRAGMA page_size`、插入顺序（按主键排序后写入）、不依赖 `randomness` 的索引名——上面的一致性是这些条件成立时才成立的，runbook 里写死。

## 5. 内容层

### 5.1 目录与 frontmatter

```
apps/web/content/
├── guide/
│   ├── starter/  ·  team/  ·  event/  ·  world/  ·  gear/  ·  mechanic/
└── update/                     # 自动生成，不手写
```

```yaml
---
title: 新手前 30 天该怎么玩
slug: starter/first-30-days
category: starter
tags: [新手, 开荒, 资源规划]
author: <你>
publishedAt: 2026-11-01
updatedAt: 2026-11-01
gameSnapshotSeq: 47             # 递增快照号，可判新旧
gameSyncedAt: "2026-10-26"      # 展示用
relatedShips: [10000, 10102]    # ship.group_type
relatedEquips: [11100]
difficulty: beginner
draft: false
---
```

构建时用 `gameSnapshotSeq` 与当前 `manifest.snapshotSeq` 比较：若文章关联的舰船 / 装备在区间内发生数值变更，自动在顶部挂「本文基于 N 期数据（{日期}），部分数值可能已调整」。递增序号可比、可排序、可显示，SHA 不行。

### 5.2 MDX 自定义组件

`<ShipCard groupType={10102}/>` · `<TeamPreset ships={[...]}/>` · `<EquipTable ids={[...]}/>` · `<DropTable chapter="13-3"/>` · `<AttrCurve groupType={10102}/>` · `<SkinGallery groupType={10102}/>` · `<VoiceLines skinId={101020}/>` · `<Callout type="warn"/>` · `<VersionNote/>`

组件直接读构建期 SQLite，**文章只写 ID 不写数值**——数值变了文章自动跟着变。机制类文章写完即不会过期。

### 5.3 首发内容与分工

按「Agent 不能玩游戏」这一约束分工，避免制造悬空承诺。

**机制 / 数学类（可从数据推导，不随版本失效）— Agent 起草，用户审校**

1. 舰种与站位机制详解（直接用 `team_type` 与 `ship_data_by_type` 参数）
2. 装备搭配入门：效率、弹种与适用舰种（`equip_data_code` 特性 + `part_main/sub`）
3. 建造系统详解：池子、时间（概率见 §8，不承诺）
4. 材料掉落与刷图路线（`award_display` → 设计图来源）
5. 科研船优先级与蓝图规划（42 条，`unlock_task` 逐日解锁机制）
6. 舰队科技树与科技点规划（685 节点 + `fleet_tech_*`）

**META 判断类（依赖当前版本实战，Agent 无法验证）— 用户出判断，Agent 成文**

7. 新手前 30 天路线（资源优先级、该练谁）
8. 开荒编队推荐 · 前排 / 后排 / 潜艇三套
9. 演习（PVP）META 与阵容克制
10. 大世界入门与自律配置（`world_chapter_template` 结构 + 用户实战配置）

最坏情况是「6 篇完整 + 4 篇框架待填」，而非 10 篇全部悬空。

---

## 6. CI/CD

### 6.1 `data-sync.yml`

```yaml
name: data-sync
on:
  schedule: [{ cron: '0 19 * * *' }]      # UTC 19:00 = 北京 03:00
  workflow_dispatch: {}

permissions:
  contents: write          # 提交 normalized 并 push（触发 Pages）
  issues: write            # §6.5 承诺的失败自动开 issue，不给权限就开不出来

concurrency:
  group: data-sync         # 定时与手动只允许串行；否则两条跑会同时 push 同一分支
  cancel-in-progress: false # 绝不中途取消，避免留下半提交

jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 25                    # 只处理增量
    outputs:
      status: ${{ steps.gate.outputs.status }}
      seq: ${{ steps.meta.outputs.seq }}
    steps:
      - uses: actions/checkout@v4
        with: { persist-credentials: true, fetch-depth: 1, fetch-tags: true }
      - uses: pnpm/action-setup@v4
        # 不给 version 输入：v4 见到 version 与 package.json 的 packageManager 同时存在
        # 会直接失败（首跑实测报 ERR_PNPM_BAD_PM_VERSION），版本口径只留 packageManager 一处
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile

      # 1. SHA 锁定取数（§3.2 步骤 1–4），SHA 与 OID 索引一起落盘
      # 必须写 `run fetch`：`pnpm fetch` 是 pnpm 内建命令（把依赖灌进虚拟存储），
      # `pnpm --filter pipeline fetch` 会命中内建的那个，一句 pipeline 代码都不跑。
      # 本地已踩到：输出是 "Importing packages to virtual store"，exit 0。
      - run: pnpm --filter pipeline run fetch --server=CN --tier=A,B --by=oid
      # 变更判定不能只看上游 SHA / 图片 OID：归一化代码、Zod schema、人工四表、
      # 图片尺寸与编码器版本变了，上游没变也必须重建。
      # check-changes 的指纹 = sha256(上游SHA + 白名单OID + packages/pipeline/src/**
      #                          + data/manual/** + image-pipeline 版本常量)
      # 任一组件变了就判为「有变化」。强制重建：workflow_dispatch 传 force=true

      # 2. 无变化 → 成功退出且不再执行后续任何步骤
      - id: gate
        run: |
          # 退出码语义必须由脚本自己定义清楚，不能把「所有非 0」都当「没有变化」：
          #   0 = 有变化   10 = 无变化（正常）   其它 = 执行失败（崩溃/坏文件/命令错误）
          set +e
          pnpm --filter pipeline check-changes --json > .gate.json
          rc=$?
          set -e
          case "$rc" in
            0)  echo "status=changed"  >> "$GITHUB_OUTPUT" ;;
            10) echo "status=nochange" >> "$GITHUB_OUTPUT"
                echo "::notice::上游 SHA 未变，跳过本次同步" ;;
            *)  echo "status=error" >> "$GITHUB_OUTPUT"
                cat .gate.json
                echo "::error::check-changes 异常退出 rc=$rc，这不是「无变化」"
                exit "$rc" ;;      # ← 让它真的失败，走末尾统一失败处理并开 issue
          esac
      - run: echo "no upstream change, exiting green"
        if: steps.gate.outputs.status == 'nochange'
      # 无变化是正常状态：绿色退出，后续步骤全部用 if 跳过，
      # 不能用 --exit-code 让步骤失败——那会触发失败处理并每天刷一条 issue

      - id: meta
        run: pnpm --filter pipeline next-snapshot-seq >> "$GITHUB_OUTPUT"
        if: steps.gate.outputs.status == 'changed'
      # ↑ SEQ 必须由这一步从 data/snapshots/ 现有最大编号 +1 算出，之前版本直接引用
      #   ${SEQ} 是个未定义变量，提交信息会写成 "snapshot # "

      - run: pnpm --filter pipeline validate
        if: steps.gate.outputs.status == 'changed'

      - run: pnpm --filter pipeline normalize && pnpm --filter pipeline emit
        if: steps.gate.outputs.status == 'changed'
      - run: pnpm --filter pipeline diff && pnpm --filter pipeline report
        if: steps.gate.outputs.status == 'changed'
      - run: pnpm --filter pipeline images --adapter=${{ vars.IMAGE_ADAPTER }}
        if: steps.gate.outputs.status == 'changed'

      # 3. 唯一提交层：提交内容与信息都由这一个脚本负责，不再手写 git add/commit
      - run: pnpm --filter pipeline commit-output --seq ${{ steps.meta.outputs.seq }}
        if: steps.gate.outputs.status == 'changed'
      - run: |
          for i in 1 2 3; do
            git push --follow-tags && break     # ★ 普通 git push 不推 tag，回滚目标会丢
            git pull --rebase || exit 1
            [ $i = 3 ] && exit 1
            sleep $((i*10))
          done
        if: steps.gate.outputs.status == 'changed'

      # ── 失败处理必须放在 job 末尾 ──
      # 此前这两步夹在 validate 之后，normalize / emit / diff / report / images /
      # commit / push 任何一步崩溃都不会回头触发它们，等于「自动开 issue」只对前几步成立。
      # GitHub Actions 的 if: failure() 是「到此步为止前面有失败」，放在末尾才覆盖全流程。
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: failed-raw-data, path: data/raw, retention-days: 14 }
      - uses: actions/github-script@v7
        if: failure()
        with:
          script: |
            const fs = require('fs')
            // 分两类：schema 漂移（有 .drift-report.md）与一般执行失败
            const drift = fs.existsSync('.drift-report.md')
              ? fs.readFileSync('.drift-report.md', 'utf8') : null
            const label = drift ? 'data-schema-drift' : 'ci-failure'
            const key = drift
              ? `schema drift: ${process.env.FAILED_TABLE || 'unknown'}`
              : 'data-sync run failed'
            const open = await github.rest.issues.listForRepo({
              ...context.repo, state: 'open', labels: label })
            if (open.data.some(i => i.title === key)) return   // 去重，不每天刷一条
            await github.rest.issues.create({ ...context.repo, title: key, labels: [label],
              body: (drift || '见运行日志').slice(0, 60000)
                + '\n\nrun: ' + context.payload.repository.html_url
                + '/actions/runs/' + context.runId })
```

要点：**提交层只能有一个**。之前版本既跑 `pipeline commit-output` 又手写 `git add/commit/push`，两处对提交范围的定义一旦不同步就会出现「脚本已提交、手工 add 为空、commit 因空 diff 被跳过但 push 却执行」这类难查状态。现在 `commit-output` 独占 add + commit + 信息拼装，workflow 只负责带重试的 push。

### 6.2 Pages 构建（`pnpm build`）

```
Framework preset  None
Build command     pnpm build
Output directory  apps/web/out
Env               NODE_VERSION=24
                  NEXT_PUBLIC_IMG_BASE=https://img.<域名>   # ★ 与 §4.6 代码同名，只允许这一个
                  IMAGE_ADAPTER=local|r2
```

顺序（**构建阶段不访问业务数据源**，且顺序不可调换）：

```
1. 核对 data/normalized/manifest.json：文件集合与每个 gz 的 sha256 逐个对上
   （manifest 与 jsonl 都是入库文件，只改其一 = 页面用旧数据，必须在建库前拦住）
2. 解压 data/normalized/*.jsonl.gz → 建 data/al.sqlite
   （确定性重建；库内 meta 不写时间戳，只写 schemaVersion / dataSha / 逐表行数）
3. 导出客户端 JSON 与搜索索引 → apps/web/public/data/    ← 必须在 build 之前
4. next build（generateStaticParams 全量预渲染）
5. 生成 sitemap.xml / RSS / OG 图
6. 性能与文件数守卫（最后一步，检查 out/ 实际产物）
   - 文件数 > 18,000 → 失败并打印目录明细
   - 单文件 > 25 MiB → 失败
   - 首屏 JS 超预算 → 失败
```

第 1–3 步都不读 `data/raw/`——raw 不入库，Pages 的检出里没有它；构建期需要的来源标识从 `manifest.json` 取。

第 3 步在 `next build` 之前是必需的：`public/` 在构建时被复制进 `out/`，构建后再写 `public/` 不会进入产物。第 6 步必须在最后，否则测不到真实产物。

### 6.3 `weekly-verify.yml`（独立、不阻断主链路）

```yaml
name: weekly-verify
on:
  schedule: [{ cron: '0 4 * * 1' }]        # 每周一 UTC 04:00
  workflow_dispatch: {}

permissions:
  contents: read
  issues: write

concurrency: { group: weekly-verify, cancel-in-progress: false }

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4         # 不写 version，理由见 §6.1
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter pipeline verify --sample=50 --report-only
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: verify-report, path: reports/verify-*.md }
      # 两种结果必须分开：报告发现差异（退出 0 + 报告非空）与任务执行失败（退出非 0）
      - name: 有差异则开 issue（脚本本身成功）
        if: success()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs')
            const p = 'reports/verify-latest.md'
            if (!fs.existsSync(p)) return
            const body = fs.readFileSync(p, 'utf8')
            if (body.includes('DIFF_COUNT: 0')) return          // 无差异不开单
            const key = 'weekly-verify drift'
            const open = await github.rest.issues.listForRepo({
              ...context.repo, state: 'open', labels: 'cross-source-drift' })
            if (open.data.some(i => i.title === key)) return     // 去重：同题只保留一条
            await github.rest.issues.create({ ...context.repo, title: key,
              labels: ['cross-source-drift'], body: body.slice(0, 60000) })
      - name: 执行失败另开 issue
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            const key = 'weekly-verify run failed'
            const open = await github.rest.issues.listForRepo({
              ...context.repo, state: 'open', labels: 'ci-failure' })
            if (!open.data.some(i => i.title === key))
              await github.rest.issues.create({ ...context.repo, title: key,
                labels: ['ci-failure'],
                body: '见 run: ' + context.payload.repository.html_url + '/actions/runs/' + context.runId })
      # 抽样 50 艘，解析 biligame wiki 页面比对 rarity / 建造时间 / 基础属性 / 阵营
      # --report-only 下有差异仍退出 0，所以差异必须靠报告内容判断，不能挂 if: failure()
      # 只产出报告 + issue，绝不阻断 data-sync，也不影响线上版本
```

之前这份 YAML 只有 `jobs.verify.steps` 里没有 `runs-on`、没有 checkout、没有 Node/pnpm、没有 install——**是一条跑了必失败的 workflow**，而它唯一的产出（对照报告）又刚好依赖 pipeline 装好。现在补齐。

它本质是一个 MediaWiki 模板解析器子项目，对方改模板不该停掉数据更新。

局限需明确：两个源可能同源同错。它能抓到解析错误，抓不到上游的系统性错误。因此仍需人工抽检 + `/about` 诚实披露。

### 6.4 `image-backfill.yml`

首次全量（2,730 皮肤 × 6 类图 + 396 装备图标族 + 3,030 物品图，含 1200w AVIF 编码，小时级）与后续任何全量重刷都走这个 workflow：手动触发、`timeout-minutes: 360`、按源 blob OID 跳过未变更、失败可续传（manifest 记录已上传项）。同时输出三份清单：EN 未命中的 skinId、装备图标族未命中（**已知 59 族 / 98 条，全清单见 §3.8**）、`painting` 缺失项。

### 6.5 失败处理

| 失败点 | 处理 |
|---|---|
| 上游 SHA 未变 | 第 2 步直接退出，不 push，不消耗 Pages 构建次数 |
| codeload 或 git 取数失败 | 重试 3 次；仍失败则保留线上旧版并开 issue，**不用半成品覆盖 normalized** |
| 取到 280 字节的限流错误体 | 表注册表的非空断言拦截（条目数远低于阈值即中止） |
| 取到同名空壳 `[]` / `{}` | 同上，24 组互补表逐表设阈值（§3.4）。**`gametip` 单独设阈值**：它空壳时行数统计看似正常，却清空阵营名/舰种名/稀有度名/装备类别，失败模式是「构建成功、满屏空白」 |
| Zod 校验失败 | 中止，上传原始数据 artifact，自动开 issue。**线上保持旧版本不受影响** |
| `type` / `handbook_type` / `nationality` 出现枚举外值 | 中止并开 issue，附取值样本 |
| 同一 `skin_id` 多船名 | 进隔离清单 + warn，不静默合并，站点用主名 |
| 图片上传部分失败 | 重试 3 次，仍失败记入 manifest 待补，不阻断部署（走占位图） |
| 构建超时 | Pages 保留上一次成功部署，站点不下线 |
| 文件数 / 单文件 / 首屏 JS 超限 | 构建脚本主动失败并打印明细 |
| R2 总量超 8GB | 图片任务硬失败，阻止继续膨胀 |

### 6.6 `en-images-sync.yml`（此前缺一条链路：EN 图不在每日同步里）

图片增量依赖 EN 仓库的 blob OID，但 EN 抓取原先不在 `data-sync` 里，也不在任何定时任务里——**结果是上游出新皮肤时，CN 数据每天有快照、图却永远不更新**，三级回退会静默把新皮肤全部降级成占位图，而页面看不出异常。

补成独立 workflow，与 CN 数据解耦（两条链路失败互不拖累）：

```yaml
name: en-images-sync
on: { schedule: [{ cron: '0 23 * * *' }], workflow_dispatch: {} }   # EN 仓库每日 23:00 UTC 更新
permissions: { contents: write }
concurrency: { group: en-images-sync, cancel-in-progress: false }
concurrency:
  group: publish        # ★ 与 data-sync、image-backfill 共用同一个组名：
  cancel-in-progress: false   #   三条链路都会写 images.manifest.json，不同组名 = 会互相覆盖

jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 120
    if: github.ref == 'refs/heads/main'
    env:
      IMAGE_REDISTRIBUTION_AUTHORIZED: ${{ vars.IMAGE_REDISTRIBUTION_AUTHORIZED }}
    steps:
      # 0. 授权门禁放在 job 内第一步，后面每个写图步骤都依赖它，
      #    而不是只挡 en-fetch —— 否则编码/上传/提交三步会在无授权时照常跑
      - id: gate
        run: |
          if [ "$IMAGE_REDISTRIBUTION_AUTHORIZED" = "true" ]; then
            echo "enabled=true" >> "$GITHUB_OUTPUT"
          else
            echo "enabled=false" >> "$GITHUB_OUTPUT"
            echo "::notice::图片再分发未授权（§8.5），整条 EN 链路跳过"
          fi
      - uses: actions/checkout@v4
        if: steps.gate.outputs.enabled == 'true'
        with: { persist-credentials: true }
      - uses: pnpm/action-setup@v4         # 不写 version，理由见 §6.1
        if: steps.gate.outputs.enabled == 'true'
      - uses: actions/setup-node@v4
        if: steps.gate.outputs.enabled == 'true'
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
        if: steps.gate.outputs.enabled == 'true'
      - run: pnpm --filter pipeline en-fetch --sparse=images/skin,images/equipment
        if: steps.gate.outputs.enabled == 'true'
      - run: pnpm --filter pipeline images --only=changed --adapter=r2
        if: steps.gate.outputs.enabled == 'true'
        env:
          CF_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}    # Secrets 必须显式映射给真正用它的步骤，
          R2_AK: ${{ secrets.R2_AK }}                    # 只列在 §12 输入清单里等于没给
          R2_SK: ${{ secrets.R2_SK }}
          R2_BUCKET: ${{ vars.R2_BUCKET }}
      - run: pnpm --filter pipeline commit-output --scope=images
        if: steps.gate.outputs.enabled == 'true'
      - name: push + 推送 tag
        if: steps.gate.outputs.enabled == 'true'
        run: |
          for i in 1 2 3; do git push && git push --follow-tags && break
                      git pull --rebase || exit 1; sleep $((i*10)); [ $i = 3 ] && exit 1; done
      - name: 失败处理（放在末尾，覆盖上面所有步骤）
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            const key = 'en-images-sync failed'
            const open = await github.rest.issues.listForRepo({ ...context.repo,
              state: 'open', labels: 'ci-failure' })
            if (!open.data.some(i => i.title === key))
              await github.rest.issues.create({ ...context.repo, title: key,
                labels: ['ci-failure'],
                body: 'run: ' + context.payload.repository.html_url + '/actions/runs/' + context.runId })
```

**无图默认模式下整条链路在第 0 步就跳过**，不装依赖、不取 EN、不碰 R2，也不产生任何 issue。

失败处理必须放在 job **末尾**：先前版本把 `if: failure()` 的步骤摆在 normalize / report / images / commit / push **之前**，后面任何一步崩了都不会回头触发它——等于承诺了自动开 issue，实际只在最前面几步失败时开。`data-sync.yml` 同样调整：把校验、归一化、提交各步的失败统一收到末尾一个 `if: failure()` 块里处理。

只取 `images/skin` 与 `images/equipment` 两个 cone（EN 全仓约 36GB / 树约 9.91GB，含音频，绝不全量 clone）。未命中清单写进 `reports/en-image-misses.md` 作为 artifact，供 §12 第 10/10b 项人工补图使用。

---

### 6.7 `ci.yml`（已落地）与部署通道

`.github/workflows/ci.yml` 在 PR 与手动触发时跑：`pnpm typecheck` → `pnpm lint` → `pnpm test` → `pnpm build`，然后三条守卫：

- **静态导出守卫**：HTML 里 grep 不到 `/_next/image` 与 `undefined/`；`apps/web/app` 与 `apps/web/out` 目录不存在即失败（不写这条，`grep` 扫空目录会返回成功，给出「已守卫」的假象）。搜索范围只限 `*.html`，理由见 §4.6 的实测口径
- **产物预算守卫**：文件数 < 18,000、单文件 < 25 MiB
- **路由覆盖守卫**：从 `apps/web/lib/slice.ts` 读出这一版声明的路由，逐个断言 `out/ship/<groupType>/index.html` 存在——名单只有一处定义，首页链接列表与 `generateStaticParams` 都读它，避免「首页链到一个没渲染的路径」

四条命令与三段脚本都在本机跑通过（当前产物 24 文件 / 4 个 HTML）。CI 里没有 `data/raw`，`pnpm build` 照样出全部产物，这正是 §4.6 那条「干净检出即可重建」的机器化形态。

**部署通道（用户选定：wrangler + API Token，首个线上版本用 `*.pages.dev`）**：

```
CLOUDFLARE_API_TOKEN=$(cat <仓库外的 token 文件>) \
  npx --yes wrangler@latest pages deploy apps/web/out \
  --project-name=<项目名> --branch=main --commit-dirty=true
```

- 凭据**不进仓库、不进对话**：token 放在仓库外的文件里，命令用 `$(cat ...)` 现场读取；权限按最小项给——`Cloudflare Pages: Edit` + 对应 Account
- `wrangler` 不进 `package.json` 依赖：只有部署这一步用它，进锁文件会让每次 CI `pnpm install` 多拉一份用不到的二进制
- 走 wrangler 直传产物时，Pages 项目的构建来源必须是 **Direct Upload**。如果同一仓库同时留着 Git 集成（Connected → 自动构建），两条链路会互相覆盖，症状是「线上页面不是刚部署的那一版」，且日志各说各话
- 环境变量在 Pages 项目设置里配，只有一个名字：`NEXT_PUBLIC_IMG_BASE`。无图模式（§8.5）下留空即可——产物里根本不出 `<img>`

**已选定通道 A：Actions 构建 + 直传**（`ci.yml` 的 `site` job 里，`github.ref == 'refs/heads/main'` 才跑的两步）：

- 部署不另开 job，接在守卫后面复用同一份 `out/`——两次构建各出一份产物时，「检查过的」和「上线的」可能根本不是同一代
- 需要仓库 Secrets 两项：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`。缺任何一步都当场以中文报错退出，不留下「跑绿了但其实没部署」的状态
- `wrangler` 版本钉死（当前 4.153.0）：部署工具的漂移不该成为线上行为变化的原因
- 部署后紧跟一步**线上自检**：`/ship/20502/` 必须 200、`/ship/99999/` 必须 404、线上 HTML 里必须含舰名。这三条都在守卫本地通过之后仍然可能因 Pages 侧失效而破裂（例如 minify 之外的改写、别名没切过来），只看 wrangler 报成功是不够的
- `concurrency.cancel-in-progress` 按事件区分：PR 上取消旧提交，main 上绝不取消（半取消的直传会留下部分文件的新代）

首跑实测两件事值得记：

- **基线**：ubuntu-latest + Node 24 上整个 job 63 秒（14 步：install → 四项检查 → 构建 → 三段守卫 → 直传 → 线上自检），产物 24 文件。`node:sqlite` 与 `sharp` 在这台机器上都不需要实验标志——原本挂在「Pages 构建镜像」上的那条待实测，随 Direct Upload 一起作废
- **直传是内容寻址的**：同一份产物第二次部署报 `Uploaded 0 files (24 already uploaded)`、0.53 秒。所以「每次 push 都部署」的边际成本几乎只剩 Pages 侧换代，不是重传
- **`pnpm/action-setup@v4` 不接受 `version` 输入**（当 `package.json` 已有 `packageManager` 时）：它会以 `ERR_PNPM_BAD_PM_VERSION` 直接退出，后面所有步骤 skip。版本口径只留 `packageManager` 一处


不含工期，只给依赖与验收。**排序原则：不依赖用户人力且已被数据证实的前置；依赖用户判断或来源未定位的后置。**

### 阶段 1 · 垂直切片（1 艘船端到端上线）

| # | 任务 | 产出 |
|---|---|---|
| 1.1 | GitHub 仓库 + Pages 项目（preset None、`NODE_VERSION=24`）+ `corepack enable` | 空站可部署 |
| 1.2 | Monorepo 脚手架（pnpm workspace + turbo + tsconfig strict + eslint + prettier） | `pnpm build` 空跑通；实测：`turbo 2.11.10` + `pnpm 9.15.4`（corepack 需 `corepack enable --install-directory` 把 pnpm 落到 PATH 上，否则 turbo 报 `Unable to find package manager binary`）；tsconfig 另开 `noUnusedLocals` / `noUnusedParameters`（一开就抓到 3 处死导入）；ESLint 9 用根级 `eslint.config.mjs` + `typescript-eslint`，包内 `lint` 脚本才有配置可读 |
| 1.3 | `tables.ts` 表注册表：**24 组同名互补表的目录解析**（§3.4）+ 分档 + **逐表条目数下限断言**；codeload fetch + SHA 落盘 + OID 变更判定 | `data/raw/<sha>/` |
| 1.4 | A 档舰船相关表 Zod schema + fixtures 回归 | 校验通过 |
| 1.5 | `attr-map.ts` 由 `attribute_info_by_type` 生成 + 与 `enemy_data_statistics` 键集交叉断言 | 属性定义落地 |
| 1.6 | `data/manual/factions.json`（29 条，`nationality → wordKey → slug`）与 `data/manual/rarity.json`（两段声明）；显示名与标签构建期从 gametip 读回并逐条比对 | 阵营覆盖 + 稀有度取值域两侧对齐 + 船名占位全解析 |
| 1.7 | normalize 三层 + 改造 + 舰队科技（`ship` / `ship_stage` / `ship_skin` / `ship_retrofit` / `fleet_tech`）+ 枚举表 + `manifest.json`，全部 join 断言内置 | 实测 859 / **3,427**（表内阶段行 3,429，skin 900424 的 2 行属于 352 个孤儿 group 之一，进隔离清单不入库）/ 2,730 / 106 / (4+36+726)，产物 226.0KB gz，隔离清单 529 条 |
| 1.8 | emit JSONL → 建 SQLite（16 表、外键常开、逐表行数与 jsonl 对账、`PRAGMA integrity_check`） | `data/al.sqlite` 2.83 MiB 可查：ship 859 · ship_stage 3,427 · ship_stage_attr 41,124 · ship_skin 2,730 · orphan_skin 358 · ship_source 1,432 · retrofit_node 1,217 · fleet_tech_ship 726；两次建库逐字节相同；建库 < 1s；`$TURBO_ROOT$` 输入指纹按 §6.5 实测表逐条通过 |
| 1.9 | 图片：1 艘船的 icon + 默认立绘 + 1 张换装，**skinId 精确 join** → sharp → LocalAdapter（**仅本地验证，不上线**） | 实测 `--limit=1`（group 10000）出 7 个产物、`--group=20502` 再 7 个，共 14 文件 992KB；全部 EN 命中、零降级；第二次跑同一艘船下载 0 张跳过 7 项 |
| 1.10 | Next.js 脚手架 + `/ship/[groupType]`（**仅 1 艘**）+ §4.6 全部配置项 | 实测：`out/` 24 文件 953KB，详情页 HTML 47.7KB，首页 First Load JS 106KB；`/ship/99999/` 走 404；页面渲染 12 项属性表 + 12 张 1–100 端点图 + 5 个皮肤（含 CV）+ 12 条改造节点（中文 descrip，机器格式 effect 不入库展示）+ 舰级与科技点 + 3 条获取方式；构建期与浏览器双端零 console 错误 |
| 1.11 | 部署 Pages（**无图版本**，立绘位置渲染占位块） | 实测：`wrangler pages project create blhx-guide` + `pages deploy apps/web/out` 直传 24 文件，3.46s 上传完成。线上 `https://blhx-guide.pages.dev/` 与 `/ship/20502/` 均 200，`/ship/99999/` 404；线上 HTML 里 `undefined/`、`/_next/image`、`<img>` 全部 0 命中 |
| 1.12 | 冷构建实测：记录产物文件数、构建时长、`out/` 清单；确认 `node:sqlite` 是否需要 `NODE_OPTIONS=--experimental-sqlite`；确认 `sharp` 在构建镜像里的可用性 | **Actions Linux 基线已拿到**（通道 A 首跑）：整个 job 63 秒（install → typecheck → lint → test → build → 三段守卫 → 直传 → 线上自检，14 步全绿），产物 24 文件 / 4 个 HTML；`node:sqlite` 与 `sharp` 在 ubuntu-latest + Node 24 上都不需要任何实验标志。Pages 构建镜像那条路已随 Direct Upload 作废 |

**Pages 侧的构建通道换了含义**：选定 wrangler 直传（Direct Upload）后，Pages 不再跑 `pnpm build`，所以原本挂在「Pages 构建镜像」上的两个待实测项（`node:sqlite` 是否需要显式标志、`sharp` 在 Pages Linux 的可用性）转移到了**真正执行构建的那台机器**上——目前是开发机（Windows + Node 24.21，两项都已实测可用），若接 GitHub Actions 就是 ubuntu-latest + Node 24。三条可选路径与代价：

| 通道 | 构建发生在 | 代价 |
| --- | --- | --- |
| 人工 `wrangler pages deploy` | 开发机 | 每次上线都要人跑一遍，做不到「上游更新 24 小时内自动跟进」（§6.5 的承诺） |
| `ci.yml` 构建 + 直传 **（2026-10-28 选定）** | GitHub Actions ubuntu-latest | 要把 Cloudflare 令牌存进仓库 Secrets；构建环境从 Pages 镜像换成 Actions 镜像，`node:sqlite` / `sharp` 要在新镜像里重测一次 |
| Pages Git 集成（Connected） | Pages 自己的构建镜像 | 回到原命题：Pages Linux 镜像里 `node:sqlite` 与 `sharp` 的可用性未验；且 Root directory 必须留空为仓库根，填 `apps/web` 会跳过 emit 前置步骤（§4.6 的难察觉失败） |

**Pages 默认开 HTML minify**：同一份 `out/ship/20502/index.html` 本地 47,712 字节，线上传回 44,826 字节；把两边都压掉标签间空白后逐字节相同（44,775）。所以「产物体积」有两个数，比对预算时要用线上数，而 §4.5 的守卫跑在本地 `out/` 上，留的余量天然覆盖这个差值。

**令牌权限以实测为准**：这把令牌在 `GET /user/tokens/verify` 上返回 `Invalid API Token`，却能列账户下的 Pages 项目、能建项目、能直传部署——按提示判断会误判成「令牌不能用」，按调用结果判断才知道它够用。R2 的 S3 兼容凭证（access key / secret）在无图模式下完全没用到。

**验收**（2026-10-28 已在 `https://blhx-guide.pages.dev/ship/20502/` 逐条核过）：线上打开该船页，12 项属性曲线（键名与 `attr_def` 一致）、**1–100 级**成长（不是 125，§3.7）、突破阶段、皮肤列表（含 CV 姓名，不含画师）、改造分支（来自 `trans_*`，§3.5）、科技点、获取方式全部渲染。**图片链路只在本地验收**：`pnpm --filter pipeline images --limit=1` 一艘船产出 7 个产物（icon 1 + 默认立绘 3 变体 + 换装立绘 3 变体），逻辑名里的 skinId 与 `ship_skin_template.id` 逐个对得上，且降级占位为 0；线上断链风险通过「阶段 1 不放图」消除，不放线上图片验收项。构建期把 `data/raw` 与业务数据源出口 mock 掉后，`pnpm build` 仍产出与联网时逐字节相同的 `out/`（口径见 §4.6）。1.12 的冷构建数字**只记录不达标线**——此前所有产物数与时长都是推算值，第一次真实构建的目的就是推翻它们。

### 阶段 2 · 舰船图鉴全量

- 扩至 859 条目 / 3,427 阶段行入库（表内阶段行 3,429，覆盖 860 个 skin_id，其中 2 行属孤儿 group 进隔离清单）/ 2,730 皮肤；落实正向枚举过滤（阶段 1 已跑通，见 §7 1.7 实测行）
- 详情页完整：六维雷达、**1–100 级**属性曲线（含 `attrs_growth_extra`，见 §3.7）、突破表、装备位与效率、**技能名与描述文本**（buff 机制与触发数值不在范围，§8.2）、皮肤画廊、改造分支、舰队科技点、**语音文本**（B 档 `ship_skin_words`）、获取方式（含跳转文案）
- 隔离清单落地（同 `skin_id` 多船名的处理）
- `/ship` 全量交互筛选（阵营 / 舰种 / 站位 / 稀有度 / 图鉴分类 / 获取方式 / 排序），URL 可分享，query 变体 canonical
- ~140 个 SEO 索引页（≥5 条阈值）
- 联动船标注所属活动与「不可获取」；**META（`handbook_type=3`，59）与科研船（`handbook_type=2`，42）各有独立分类页**；改造是舰船详情页上的分支区块（来自 `trans_*`），**不是图鉴分类维度**（§3.5）
- **人工抽检 5 艘**（覆盖不同舰种与站位）对照游戏内数值
- **用户核对 3 个阵营**：8 / 9 谁是自由鸢尾谁是维希教廷，10 是否即鸢尾教国（其余 25 个值已在数据内钉死，§11 C）

**验收**：859 页正确；5 艘抽检通过；产物文件数 < 18,000；构建 < 20 分钟；无一条数据来自枚举猜测。

### 阶段 3 · 装备、技能与图片上云

- 装备条目按三条件正向规则产出 **909 条**族代表行（§3.10），先展开 `base` 继承再过滤；分类走 `equip_data_by_type`，UI 标签走 `word_equipment_*`，两套口径并存
- 装备图标按 **558 个图标族** 归并取图；EN 命中实测 **499 族 / 811 条（89.4% / 89.2%）**，缺口 59 族固定走占位图
- `/equipment` + `/equipment/[id]`：属性、强化链、适用舰种与禁忌、科技树位置、关联技能、`compare_group` 同类对比
- `/skill` 检索（3,030 条）；**决定是否独立成 3,030 页**（实测构建时长后定）
- `/research` **科研项目目录**（`technology_data_template` 685 条：C-153-MI 等，含耗时、消耗、解锁条件、中文长描述）
- `/tech` **舰队科技**（`fleet_tech_*`：按船与按阵营的科技点加成）——与上者是两个体系，不合并
- `/retrofit` 改造节点表（`transform_data_template` 1,217 节点：效果、金币、材料、等级与星级前置）
- 主搜索索引上线（拼音全拼 / 首字母 / 别名 / 多音字例外表）；`aliases.json` 首批整理
- `/ship/compare` 对比（最多 4 艘）
- 响应式 + 暗色模式；SEO：sitemap、robots、`VideoGame` 结构化数据、OG 图自动生成；主站绑域名

**阶段 3 拆成两套验收——默认路线（无图）必须能独立跑完，不能卡在等授权上**（此前这里把「图片切 R2 + backfill」写成阶段 3 的必经步骤，而 §8.5 的默认决策是不托管图片，两条撞在一起会让默认路线在阶段 3 直接停摆）：

**3A · 无图模式（默认，不依赖 §0 第 2–8 项，不依赖授权）**

- 图片位统一渲染为**程序生成的占位图形**（舰种 silhouette + 阵营色 + 首字），立绘区给「去官方/WIKI 查看」外链
- 验收：Lighthouse SEO ≥ 95；909 装备页无空名字；859 舰船页无空名字；搜 `qy` 命中企业、`bsm` 命中俾斯麦、`changmen` 命中长门；**产物内零图片且页面上没有 `<img>` 指向不存在的资源**（grep 断言 `out/` 内无 `undefined/` 与空 src）；`IMAGE_REDISTRIBUTION_AUTHORIZED` 为 false 时 `en-images-sync` 在第 0 步跳过、不装依赖、不开 issue
- 本模式即「可上线 MVP」的完整定义

**3B · 授权后图片模式（§8.5 拿到书面许可才启用，随时可切，不返工）**

- `IMAGE_ADAPTER=r2` + 首次全量 backfill + `en-images-sync` 上线；输出未命中清单；用 `l2dhx` 打和谐标记
- 前置：§0 第 2–8 项（域名 NS、R2 bucket、`img.` 绑定、API Token、Secrets）全部就绪
- 验收：首屏图片走 `img.<域名>` 带 `immutable`；`images.manifest.json` 的逻辑名→哈希 key→源 OID 三项映射可审计；EN 未命中清单（约 117 张皮肤 + 59 族装备图标）逐项有结论；R2 用量监控 warn 4GB / stop 8GB

### 阶段 4 · 关卡与材料掉落反查

- 取 B 档：`chapter_template` / `chapter_template_loop` / `expedition_data_template` / `item_data_statistics` / `shop_template` / `enemy_data_*` / `box_data_template` / `drop_data_restore` / **`transform_data_template`**
- **另需 `GameCfg/dungeon.json`（80MB，只在取数阶段解析，产出 0.59MB `stage_enemy` 入库）**——关卡敌人编组的唯一来源，§3.3 / §11 D
- `chapter` / `expedition` / `drop`（**只装 award_display 可确证的材料与设计图部分**）三表建模
- 掉落双向反查：「这材料哪来」（item → chapter）／「这关出什么」（chapter → item）
- `/chapter/[id]`：981 关（主线 135 / 活动 846 两套模板）、材料掉落表、敌方配置（`enemy_data_statistics` 具名字段直接渲染）、出击消耗、周回配置
- `/item` 物品与设计图 3,030 条
- `/build` 建造时间表与检索（**不含概率**，见 §8）
- **`data/manual/drop-overrides/equipment/` 人工覆盖层**：装备本体掉落无法自动获取，按需人工登记高频关卡

**验收**：随机抽 20 关，页面展示的奖励项与 `award_display` ∪ `chapter.awards` 的解析结果**逐条一致**（这是自洽性检查，不是与游戏内掉落一致——数量与概率不可得，§8.2）；展示标签（少量/较少/普通/较多/大量）原样呈现不做数值化；敌人编组与 `dungeon.json` 解析结果一致且无名怪显示描述性标签而非空白；反查双向正确；页面明示「装备本体掉落需人工登记，未登记项标注未知」。

### 阶段 5 · 自动化闭环

- `data-sync` 定时上线 + 失败自动开 issue；`weekly-verify` 独立上线
- 版本 diff → 自动生成 `/update/[seq]`；联动新条目自动建活动占位
- `docs/runbook.md`：MSYS 路径陷阱、DNS 阻断域名、REST 限额（含「校验响应体大小与可解析性」）、空壳表、后端切换、失败重放
- Cloudflare Web Analytics；**前端 JS 错误监控**（Pages Functions + 一个轻量上报端点，或免费的第三方，本阶段定案）
- 数据回滚演练，**且回滚路径必须先到能执行的粒度**：`data/raw/` 不入库，所以「重放取数」不可复现（上游可能已前进）。可复现的回滚单位是**提交进仓库的 `data/normalized/`**——`commit-output` 每次同步除打 tag `data/<seq>` 外（**普通 `git push` 不推 tag，必须显式 `git push --follow-tags`；checkout 也要 `fetch-tags: true`，浅检出默认不带历史 tag，否则回滚脚本会找不到要回的目标**），同时把 `snapshotSeq → {commitSHA, dataSha, normalized 文件 sha256 清单}` 追加进 `data/snapshots/index.json`。回滚 = `git checkout data/<seq> -- data/normalized data/snapshots data/manual data/images.manifest.json apps/web/content/update` 后重新 `pnpm build`，**不重新取数**。`data/manual/`（人工四表）必须在回滚集合里，否则旧数据配新映射会错列；`images.manifest.json` 也在，否则页面引用的哈希 key 与图不同代。

**必须写清「哪些版本能完整重建」**，因为「任意历史快照可回滚」与「图片只保留最近若干哈希」两条不能同时成立：

| 回滚目标 | 数据 | 图片 | 结论 |
|---|---|---|---|
| 最近 5 个快照以内 | `data/normalized` 在 git 里 ✓ | 哈希仍在 R2 保留窗口内 ✓ | **完整回滚** |
| 超出图片保留窗口 | git 里 ✓ | 已被清理 ✗ | 只能回滚到无图模式，或用 `image-backfill` 从上游重编码（要求上游对应文件仍在） |
| 代码版本与数据版本不匹配 | — | — | `data/snapshots/index.json` 里同时记 `schemaVersion` 与 `pipelineVersion`；`web#build` 断言当前代码的 `schemaVersion` ≥ 快照声明值，否则明确报错要求同代代码，不静默渲染错列 |

Pages 侧另用「回滚到历史部署」作为秒级预案。两者是不同层次，runbook 分开写：部署回滚不动数据，数据回滚要重建。
按 Turborepo 规则，task 的 `inputs`/`outputs` **相对于该 task 所在的 `package.json`**，不是仓库根：仓库级路径必须带 `$TURBO_ROOT$`，包内路径不带包名前缀。写错的两种症状是「缓存永不命中」和「复用了错的东西」，都表现为构建成功但页面是旧数据。下面是已落地并实测过的定义：

```jsonc
// turbo.json
{
  "tasks": {
    // 取数与归一化都不进缓存：fetch 每次真取；normalize 读 data/raw（不入库，
    // CI 与 Pages 的检出里没有它），人工表 data/manual/** 也只在这一步被消费
    "pipeline#fetch":     { "cache": false },
    "pipeline#normalize": { "cache": false },

    "pipeline#emit": {
      "inputs": [
        "$TURBO_ROOT$/data/normalized/**",       // 仓库级：跨包读取，含 manifest.json
        "$TURBO_ROOT$/packages/pipeline/src/**",
        "$TURBO_ROOT$/packages/pipeline/package.json"
      ],
      // 产物落在输入集合之外：建库任务不读自己写的文件，指纹不会被自引用搅浑
      "outputs": ["$TURBO_ROOT$/data/al.sqlite"]
    },
    "web#build": {
      "dependsOn": ["pipeline#emit"],          // ← 缺这行就会与 emit 并行，读到旧 public/data
      "inputs": [
        "$TURBO_ROOT$/data/al.sqlite",         // 实际读的库，不声明就不进指纹
        "$TURBO_ROOT$/apps/web/public/data/**",// 客户端 JSON 与搜索索引，同样是传递产物
        "app/**", "components/**", "content/**", "lib/**",
        "next.config.ts", "tsconfig.json", "package.json",
        "$TURBO_ROOT$/packages/ui/**"          // 共享组件包
      ],
      "outputs": ["out/**"],                   // 包内相对路径，不写 apps/web/ 前缀
      "env": ["NEXT_PUBLIC_IMG_BASE", "IMAGE_ADAPTER"]   // 进 cache key，换域名/换模式不复用旧产物
    }
  }
}
```

`pipeline#emit` 不读 `data/manual/**`，也不读 `data/raw/**`：它只把已提交的 `data/normalized/*.jsonl.gz` 灌进 SQLite。人工表进站点的唯一路径是

```
data/manual/**  →(pipeline#normalize, cache:false)→  data/normalized/*.jsonl.gz + manifest.json
                →(pipeline#emit)→  data/al.sqlite  →(web#build)→  页面文本
```

所以人工表不声明成 emit / `web#build` 的输入：声明了也不读，只会得到一个「缓存未命中但产物逐字节相同」的假验证，把真正的消费点（normalize）藏起来。

**`$TURBO_ROOT$` 指纹实测**（2026-10-27，本机，`pipeline#emit` 的 turbo 缓存 key）：

| 动作 | 结果 |
| --- | --- |
| 数据不动，重复 `normalize` + `emit` | `cache hit`，key 恒为 `4d803daa82b5a5b2` |
| 只改 `data/manual/factions.json` 一个 slug，**不跑** normalize 直接 `emit` | `cache hit`（人工表不在建库输入里，符合上面的链路） |
| 同一次改动后跑 `normalize` 再 `emit` | `cache miss`，key `4e0bdd2e8648089a`，且 `SELECT slug FROM faction WHERE nationality=1` 返回改后的值 |
| 还原那一个字符，`normalize` + `emit` | `cache hit`，回到 `4d803daa82b5a5b2` |

最后一行是这个实验真正要证的性质：**缓存 key 是数据内容的函数**。同一份数据无论从哪条路径绕回来，都映射到同一个 key；改一个字节就立刻换 key 并让页面文本跟着变。

由此得出一条约束：`manifest.json` 里不能有墙上时间。带 `syncedAt` 的那版实测过——数据一模一样、只是重跑了一次 normalize，建库 key 就换了，等于每天定时同步都在无意义地重建整站。同步时刻记在 `data/snapshots/index.json`，那个文件不进任何构建指纹。

**验收**（全部机器化，不接受人工目测）：连续 7 天无人工干预；上游更新后 24 小时内站点自动跟进并产出更新公告；`git checkout data/<seq-1> -- data/normalized && pnpm build && wrangler pages deploy` 演练一次成功且页面数据确回到旧值；`out/` HTML 文件数与 `generateStaticParams` 声明的路由数逐一相等（§4.6）；`out/` 的 **HTML** 里 grep 不到 `/_next/image`（Next 自带的 `main-*.js` 运行时 chunk 里就有这个字面量，扫全产物目录的守卫会永远自打）；冷构建时长与产物数写入 `docs/baseline.md` 作为后续基准。

### 阶段 6 · 计算工具（面板估算）

范围限定为面板估算，不做弹道与命中模拟（依据见 §8）。

保留（确定性计算，可对账）：

- 面板属性对比与成长曲线
- DPS 估算：`weapon_property.damage` × 射速 × 装备效率，公开公式，页面标注估算
- 装备效率与弹种克制静态对照表（只查不算）：`equip_data_code` 特性 + `attack_attribute`
- `/tools/material` 强化与突破材料（`ship_data_strengthen` + `ship_data_breakout` + `ship_strengthen_blueprint`）
- `/tools/retrofit` 改造分支与消耗（`ship_data_trans`）
- `/tools/blueprint` 科研船蓝图（42 条，`unlock_task` 逐日解锁 + `price` + `strengthen_effect`）
- 油料 / 维修费用 / 退役回收（`ship_data_by_type` 的 `fix_resource_gold`、`distory_resource_gold_ratio`、`energy_recover_*`）——**可精确对账，不加估算标注**
- 兵装图鉴（`spweapon_data_statistics` 2,619 行）
- META 突破与技能任务（`ship_meta_breakout` / `ship_meta_skilltask`）

不做：弹道模拟、弹幕命中判定、装甲克制精确减伤链、制空权对命中率的精确影响。

**验收**：DPS 估算与公开公式手算一致；材料、油料、维修、回收这类**确定性经济计算**与表内参数逐项一致（`equip_data_template` 的 `destory_*`/`restore_*`/`trans_use_*` + `ship_data_by_type` 的 `fix_resource_gold`/`distory_resource_gold_ratio`，这些是确定性的，不接受误差）；估算类页面均有明确免责标注；**改造消耗计算以 `transform_data_template` 的 `use_gold`/`use_item` 为准，逐节点对账**。

### 阶段 7 · 大世界与活动

- 取 D 档：`world_chapter_template`（644）+ `world_event_data` + `world_effect_data` + 活动表 + `task_data_template`
- `/world` 海域页与自律路线
- 活动页骨架，跟随版本 diff 自动建条目
- 定位「日常委托」的真实数据表（§11 F），补委托工具

### 阶段 8 · 攻略内容

- MDX 管线 + 目录 / 侧边栏 / 标签 / 作者
- 9 个自定义组件
- `gameSnapshotSeq` 过期提示机制
- 首发 10 篇（§5.3 分工）
- MDX 正文搜索（Orama，懒加载）
- RSS + 文章 sitemap

**验收**：文章内所有数值来自组件而非硬编码；改一处舰船数据，相关文章自动更新；关联数据变更后过期提示正确出现。

---

## 8. 能力边界：能从数据做到什么、不能做到什么

这一节是整体评估的核心依据。每条都基于实测，不含推测。

### 8.1 完全可做（数据齐备且结构化）

| 能力 | 依据 |
|---|---|
| 舰船图鉴 859 条 + 皮肤 2,730 张 | `ship_data_group` + `ship_skin_template`，实测 |
| 12 项属性 **1–100 级**成长曲线 | `attrs` 定长 12 + `attrs_growth` 定长 12 + `attrs_growth_extra` 定长 12 + `attribute_info_by_type`，两处键集交叉验证；上限由 `ship_data_template.max_level`=100 钉死 |
| 突破阶段与材料 | `ship_data_breakout` + `ship_meta_breakout` |
| 改造分支与**改造消耗** | `ship_data_group.trans_type/trans_skin/trans_skill/trans_radar_chart`（非零 78/106/96/106）+ `ship_data_trans`(106) 给分支；**节点条件与成本来自 `transform_data_template`(1,217 节点)**：`effect[]` / `use_gold` / `use_item[[[id,count]]]` / `level_limit` / `star_limit`（实证节点 501 舰体改良I：耐久+45 · 金币200 · 18001×1）。缺此表只能列出节点名，算不出消耗 |
| 舰队科技点与科技加成 | `fleet_tech_template` / `fleet_tech_ship_template`(246KB) / `fleet_tech_ship_class` / `fleet_tech_group`（按船与按阵营的科技点） |
| **科研项目目录**（不是科技树） | `technology_data_template` 685 条：`name`（如 C-153-MI）· `time`（研究耗时秒，1800–21600）· `consume` · `type`（1:456 · 2:229）· `desc` 长中文 · `blueprint_version` |
| 技能名与描述 | `skill_data_template`（3,030 条全部有 name）+ `skill_data_display` |
| 装备图鉴 909 条 + 二级分类 + 普通强化等级链 | `equip_data_statistics` + `equip_data_template`（条目判定 + `next/prev` 等级链，8,261 链接 0 断裂）+ `equip_data_by_type`（19 类正向枚举）+ `equip_data_by_quality`（6 档） |
| 装备转换 / 研发材料 | `equip_upgrade_data`（281 条，有分叉汇合）+ `equip_upgrade_template`（50 图谱 / category1 7 类），材料 id 落回 `item_data_statistics` → 可接到掉落反查 |
| **关卡敌人真实编组** | `GameCfg/dungeon.json` 的 `stages[].waves[].spawn[].monsterTemplateID` → `enemy_data_statistics.id`。实测 **9,288/9,301 个 dungeon 有怪物清单，977/981 关可解析出完整编组**；80MB 抽取后仅 **0.59MB**。**代价：必须引入原本排除的 dungeon.json**（§3.3） |
| 装备特性中文对照 | `equip_data_code`（14 项） |
| 关卡结构 981 关 + 出击节点 15,515 | `chapter_template` + `expedition_data_template`，**join 实测 11,701/11,702 命中** |
| 材料与设计图掉落（双向反查，**展示已解析的配置项与其标签**） | `expedition_data_template.award_display`(64,963 条) 与 `chapter_template.awards` 两处引用取并集 → `item_data_statistics`。数量/概率不可得，见 §8.2 |
| 敌方配置 | `enemy_data_statistics`（13,568 行，**具名属性字段**）+ `enemy_data_by_type`（25 类） |
| 舰船获取方式 | `ship_data_group.description` 结构化文本 + 跳转参数 |
| 建造时间表 | `ship_data_template`（时间字段）+ `ship_data_group` |
| 阵营 / 稀有度 / 舰种显示 | `word_shipNation_*`（32）+ `word_equipment_*`（19）+ `ship_data_by_type`；稀有度需人工表（§8.3） |
| CV 与语种 | `voice_actor_CN`（502 条 `actor_name`）+ `ship_skin_template.voice_actor/voice_lang` |
| 语音文本 | `ship_skin_words`（2,485 行全中文，多场景字段） |
| 科研船蓝图与解锁 | `ship_data_blueprint`（42 条，含 `price`、逐日 `unlock_task`、30 项 `strengthen_effect`） |
| 强化材料需求 | `ship_data_strengthen` + `ship_strengthen_blueprint` + `skill_need_exp` |
| 兵装 | `spweapon_data_statistics`（2,619 行，有名有图标） |
| 和谐立绘标记 | `l2dhx.json`（26 条 painting slug）+ `shop_dynamic_hx` |
| CN 立绘存在性清单 | `painting_filte_map.json`（2,589 条 AssetBundle 路径） |
| 油料 / 维修 / 退役回收计算 | `ship_data_by_type` + `ship_data_statistics.oxy_*`（确定性参数） |
| 大世界海域结构 | `world_chapter_template`（644 行，grids / float_items / is_sairen） |
| 面板 DPS 估算 | `weapon_property.damage` + `aircraft_template` 属性 + 效率 |

### 8.2 做不到 / 必须降级

| 原设想 | 实测结论 | 处理方式 |
|---|---|---|
| **关卡装备本体掉落** | 装备本体走物资箱，`box_data_template` 只有 85 行 `{id, name:"物资箱", effect_id, type}`，**装备随机池在效果脚本里，不在任何结构化数据表** | `/drop` 只提供材料与设计图反查；装备掉落设 `data/manual/drop-overrides/equipment/` 人工覆盖层；页面明示「未登记 = 未知」，不猜 |
| **建造概率查询** | 全部 623 张表里没有建造概率数据。概率是服务端逻辑 | `/build` 只做时间表与舰船检索；概率页**从计划中删除**，除非人工维护 |
| **精确伤害模拟** | 需串 `weapon_property`(53,585) → `bullet_template`(19,165) → `barrage_template`(26,975) → `aircraft_template`(7,224) ≈ **10.7 万行弹道几何**，且装甲克制 / 命中 / 制空公式在代码不在表 | 只做面板估算 + 明确免责；见阶段 6 |
| **画师展示** | `illustrator.json` 41 行**只有 `code` 无姓名**；`gametip` 402 个 `word_*` 类目里 `word_illustrator*` = 0 | **不展示画师字段**，不留空占位。若日后从社区获得映射表再补 |
| **装备稀有度显示名** | 舰船侧有文本源：`ship_data_statistics` 阶段行的 `rarity` 取值恰好 {2,3,4,5,6}，与 `gametip` 的 `index_rare2`…`index_rare6`（普通 / 稀有 / 精锐 / 超稀有 / 海上传奇）两侧一一对上，**舰船稀有度不是缺口**。**且不能用 `star` 代替**：856 组阶段行里 `star` 四行互不相同而 `rarity` 恒定；`ship_data_by_star` 是星级经济表；`ship_data_group` 无 `rarity` 字段。装备侧才是真缺口：`equip_data_statistics` 10,365 行中 1,524 行带 `rarity`（{1..6}），而 `equip_data_by_quality` 六档**没有任何显示名字段**，CN 数据里查不到装备稀有度的中文词 | 舰船稀有度构建期由 `gametip` 生成（`data/manual/rarity.json` 只声明取值域与读法，不抄文本）；装备侧按 `labelPolicy: numeric` 只显示档位数字与配色，`/data-quality` 公开记这一条 |
| **日常委托收益计算** | `task_data_template`(7,948) 是任务表不是委托表；`expedition` 在本套数据里指**出击战斗节点**不是委托。真实委托表未定位 | 该功能暂不排期；定位到表后再评估（§11 F） |
| **舰船掉落来源（打捞得船）** | `award_display` 只指向 item，不含舰船。但 `ship_data_group.description` 是**结构化三元组** `[文本, [命令, 参数], 0]`，共 1,432 项：命令枚举 `{空=纯文本 569, GETBOAT 447, SHOP 201, LEVEL 119, METACHARACTER 50, SHIPBLUEPRINT 42, COLLECTSHIP 4}`，其中 `LEVEL` 参数带 `chapterid`（117 艘船 / 44 个关卡）——所以「哪关能捞」是**可读的 id 不是文本**。缺的 join 是 `chapter_template`（在 sharecfgdata 侧，尚未入白名单），17 艘船无任何来源 | 舰船页渲染来源标签与关卡链接；打捞**概率**仍不承诺（数据里没有）。无来源显示「未知」。`SHIPBLUEPRINT`/`COLLECTSHIP` 参数里的 `shipGroupId` 自指，构建期断言必须等于本船 id（实测 46 条全等） |
| **敌人名称** | 编组能解析（977/981 关），但**名字取不到**：`enemy_data_statistics` 13,568 行只有 1,962 行有 `name`；关卡实际用到的 11,292 个怪里**仅 679 个有名（6.0%）**。`base` 字段不回连 `ship_data_statistics`（交集 0），也不回连 `ship_skin_template`（交集 0），无法借舰船名恢复 | 有名则显示名；无名一律渲染成描述性标签「{`enemy_data_by_type.type_name`} · Tier.N · Lv.{level}」，**不编造名字**。已命名的 679 个恰是 META / 塞壬 Boss，正是玩家需要认出的那批 |
| **技能机制解析** | `skill_data_template` + `skill_data_display` 给得出名称与静态描述；触发条件、持续时间、叠层规则、加成数值在 `GameCfg/skill.json`(12.5MB) 与 `buff.json`(22.6MB)，两者当前不取 | 承诺「技能名 + 描述文本」；机制与数值加成**标注为未覆盖**，不画 buff 时间轴 |
| **1–125 级成长曲线** | `ship_data_template.max_level` 实测 3,806 行全部 = **100**，数据里没有 >100 的等级字段；125 级的达成依赖好感度/觉醒/科技加成，其公式在客户端代码 | 只承诺 **1–100**；`attrs_growth_extra` 必须并入（118 行非零，集中在 META），取整规则未定前这些船标注「成长数据不完整」而不是硬算 |
| **掉落数量与概率** | `award_display` 第三元素实测只有 6 种取值：`'1'`(52) · 少量(18) · 较少(5) · 普通(5) · 较多(4) · 大量(8) —— 是**展示标签不是数量或概率** | 标签原文展示，不做数值化；`chapter_template.awards` 与 `expedition.award_display` 是两个引用点，取并集 |

### 8.3 需要人工维护的表（共 4 张，全部小表）

| 文件 | 内容 | 规模 | 来源 |
|---|---|---|---|
| `data/manual/factions.json` | nationality → `wordKey` → slug，每条带 `source` 与 `evidence`；中文名不落地（构建期从 gametip 读回并比对）；EN 图标号在图片层接线时（§6.6 / 阶段 3B）才加 | 29 条（28 实出 + 10 无船） | `memory_storyline` 事件名与 `ship_data_group.description` 共现钉死，8/9/10 待用户核对（§11 C） |
| `data/manual/rarity.json` | 声明两段：舰船 2–6（标签 `gametip:index_rare{value}`，取值域与文本两侧互校）、装备 1–6（`labelPolicy: numeric`，CN 无文本源） | 两段 | 实测字段（§11 A / §8.2） |
| `data/manual/aliases.json` | 舰船/装备/技能 别名与昵称 | 数百条 | biligame wiki 三张表 |
| `data/manual/pinyin-overrides.json` | 多音字例外 | 数十条 | 人工 |

可选：`data/manual/drop-overrides/equipment/`、`data/manual/image-overrides/cn/`——按需增量，不要求一次做完。

### 8.4 规模汇总（用于评估）

| 维度 | 数量 |
|---|---|
| 静态 HTML 页 | 859 舰船 + 909 装备 + 981 关卡 + 140 索引页 + 3,030 技能(可选) + 其它 ≈ **2,900–5,900** |
| SQLite 主要表 | ship 859 · ship_stage 3,429（阶段行）+ ship_row_other 528（非阶段行，只登记不渲染） · ship_skin 2,730 · equipment 909 · equip_level_row 8,261（base 继承子行）· equip_level_link 8,261 · skill 3,030 · chapter 981 · expedition 15,515 · stage_enemy 9,288 · drop 64,963 · item 3,030 · research_project 685（technology_data_template，科研项目目录）· fleet_tech 节点（fleet_tech_*）· **research_ship 42**（ship_data_blueprint，科研船）· retrofit_node 1,217（transform_data_template）· retrofit_branch 78–106（`trans_type`/`trans_skin`/`ship_data_trans`）· world 644 · voice_line 2,485 · enemy 13,568 |
| R2 图片 | 估算 **2.66GB** / 10GB（补入 shipyard / qicon / chibi / banner 四类后，见 §3.8） |
| 取数体积 | A 31MB · B 63MB · C 56MB · D 50MB + `GameCfg/dungeon.json` 80MB（只用一次，产出 0.59MB，不入库） |
| normalized 入库 | A 约 2.5MB · B 约 4MB · stage_enemy 约 0.6MB（gzip） |

### 8.5 授权与合规：上线前必须解决的门槛

这一节是**发布阻断项**，不是风险备注。此前版本的 §0 与 §9 都把它当作「非商业 + 署名 + 不放广告」就够了，这是错的。

**实测的授权状态**：

| 源 | GitHub API `license` | 内容 | 本计划的用法 |
|---|---|---|---|
| `AzurLaneTools/AzurLaneData` | **null** | 游戏解包配置数据 | 取数值与文本，衍生为攻略表 |
| `Fernando2603/AzurLane` | **null** | 游戏解包**美术资源**（立绘等，仓库 36GB） | 转码后**再托管到 R2 公开分发** |

README 里的非商业声明、作者署名、DMCA 邮箱，都不等于权利人授予了再分发权。**「本站不商用」不是授权**——美术作品的复制权与信网传权不受是否营利影响。当前设计里唯一构成明确再分发的是图片那一条链路，因此门槛精确落在图片上。

**三个可执行选项，必须选一个才能上线带图的版本**：

| 方案 | 做法 | 代价 | 结论 |
|---|---|---|---|
| A 取得授权 | 向蛮啾 / 勇仕 / YoStar 申请书面许可（攻略站用途） | 周期不可控，可能被拒 | 最干净，但不能作为排期假设 |
| B **不托管图片** | 去掉 R2 图片链路，图鉴用舰种+阵营剪影占位、用 `icon` 族生成统一图形；立绘只给「去官方/WIKI 查看」外链 | 视觉表现明显下降 | **默认可上线方案**；美术再分发暴露归零，但**不等于整体法律风险归零**（见下方说明） |
| C 纯数据不公开 | 阶段 1–2 只在本地/内网跑，公网只放不含美术资源的版本 | 无法达成「攻略站」的产品目标 | 过渡期用 |

**当前计划的默认执行路径是 B（阶段 3A）**：图片上云步骤挂起，直到第 10 项有明确结论。已完成的图片管道代码与 `images.manifest.json` 保留（它们是纯逻辑与哈希，不含美术资产），授权到手后切 R2 即可，不返工。

**「不托管图片即无风险」这个说法本身要收敛**，此前写得过于绝对，两处需要更正：

- `license: null` 只表示 **GitHub 未识别到许可证文件**，不能单凭它断言「所有使用必然未经授权」。它是「没有公开授权」的信号，不是「权利人已禁止」的证据。真正的依据是：这些是游戏客户端解包资产，著作权默认归权利人，未获许可即无再分发权——**结论不变，但论据要写对**。
- 即走方案 B，页面仍会呈现来自解包的**文本**：技能描述、语音文本、装备描述、掉落名称。这些同样是受著作权保护的表达性内容，「不放图」不等于「法律零暴露」。因此 B 项下仍要：①记录每条内容的具体来源与抓取时间 ②`/about` 与 `/data-quality` 公开数据出处 ③保留 DMCA 联系邮箱与下架流程 ④控制引用粒度（展示必要字段，不整段搬运长文本；长文本另拟自有描述）。

数据侧另记：数值配置本身（`attrs`、掉落映射、强化消耗、价格）是事实性数据，据此产出攻略表格属于独立创作，风险显著低于美术与长文本再分发；但**不把上游 JSON 原文对外提供下载**，只提供衍生视图。`word_template` / `word_legal_template` 仍然绝对禁止进入任何输出。

---

## 9. 成本

**月度支出：额度内预计 ¥0，但不是「无限免费」。** 唯一必要支出是域名（约 ¥60–90/年，已购买）。之前这里写的是绝对「¥0」，且把 R2 写成「10GB 免费」一句话带过——R2 的免费额度和 Pages 的构建数都是有边界的服务额度，超了会计费，必须列出来。

| 项 | 免费额度 | 本项目预估用量 | 结论 |
|---|---|---|---|
| Cloudflare Pages | 无限静态请求与**带宽**、500 构建/月 | 每日 1 次成功构建 + PR 演练 ≈ 60–90 构建/月 | 额度内；但构建数不是无限的，`ci.yml` 不能对每个 push 都跑全量构建 |
| Cloudflare R2 · 存储 | **10 GB·月** | 阶段 3 全量后约 **2.66GB**（§3.8） | 额度内 |
| Cloudflare R2 · Class A（写） | **100 万请求/月** | 首次 backfill ≈ 2.2 万次 PUT；**每日增量约 200–2,000 次**（按 OID 跳过） | 额度内，余量很大 |
| Cloudflare R2 · Class B（读） | **1,000 万请求/月** | 与访问量同量级：每页 2–8 张图，10 万 PV/月 → 约 40–80 万读 | 额度内约 12 倍余量 |
| Cloudflare R2 · 出口流量 | **¥0**（这是 R2 相对 OSS/COS 的真实优势） | — | 恒定 0 |
| Cloudflare DNS / SSL / Web Analytics | ¥0 | | |
| GitHub Actions | 公开仓库无限免费分钟（**Linux**） | Windows runner 才计费；本管道全跑 `ubuntu-latest` | ¥0 |
| 全套技术栈 | ¥0 | Next.js / React / TS / Tailwind / shadcn / MiniSearch / Orama / `node:sqlite`（Node 内置）/ Recharts / pinyin-pro / MDX / sharp，均开源 | |
| 域名 | ~¥60–90/年 | 已购买。**R2 生产访问的必要条件**：`r2.dev` 有约 1,000 req/min 限制且官方不推荐生产；绑自定义域名要求域名 DNS 托管在 Cloudflare | |

**会让额度失效的三个动作，必须有对策**：

1. **旧哈希不删** → 存储单调增长。对策不是 lifecycle：**R2 的对象生命周期规则只按前缀与时间操作，认不出「同一逻辑图片的最近 5 个哈希版本」**，因为每个哈希 key 是彼此独立的对象，没有版本关系。正确做法是**自建引用扫描 GC**：`image-gc` 任务读 `images.manifest.json`，把每个逻辑名按写入时间排序，保留最近 5 个哈希 + **所有被仍存活的 Pages 部署引用过的哈希**（保留窗口须 ≥ Pages 回滚窗口），其余列入删除清单，人工确认后执行；`image-backfill` 只在内容 OID 变化时 PUT，不重传。这一步在无图模式下不启用。
2. **误触发全量重刷** → 一次 2.2 万次 PUT，量级无害；但若被 cron 天天触发就白烧写请求。对策：`image-backfill.yml` 只允许 `workflow_dispatch`，**不写 `schedule`**。
3. **图片被热链** → Class B 读被打满。**必须说清：停掉 workflow 不会停止计费**——公网 GET 走 R2 自定义域名的数据面，与同步任务无关，「超阈值即中止任务」只能阻止我们继续*写入*，拦不住已消耗的*读请求*。热链需要的是**访问侧降级**而非任务侧熔断，按可用性从高到低三选一：①`img.` 域名加 Referer 白名单（Cache Rules + 必要时一条 WAF 规则）②WAF 速率限制按 IP/UA 节流 ③最后手段把 DNS 记录临时切到占位图源，全站降级为无图模式（3A 本就是默认模式，这条路确实可走）。**监控阈值本身只等于告警**，§6.5 按告警处理，不写成止损手段。

**监控阈值**：R2 存储 warn 4GB / stop 8GB；Class B 月读 warn 600 万 / stop 900 万；构建数 warn 400/月。超 stop 即中止任务并开 issue，不静默计费。

**红线与授权是两件事**，此前混为一谈：

- **商业化红线**（自主可控）：不放广告位、不接商业推广、不卖会员。投广告、接推广、卖会员都涉及商用，需蛮啾 / 勇仕 / YoStar 授权，个人开发者基本拿不到。
- **再分发授权**（**不受这条红线保护**）：把游戏美术转托管到 R2 公开提供，即便完全非商业也构成复制与信网传行为。两个上游仓库 GitHub `license` 均为 null，README 的非商业声明不是许可。**该项见 §8.5，是上线前的硬门槛，不是成本项也不是风险备注。**

对比国内方案：阿里云 OSS / 腾讯 COS 出口流量约 ¥0.5/GB，月访问 10 万次即数十 GB → ¥15–30/月且随流量线性增长。R2 在这一点上的优势是真实的。

---

## 10. 风险登记册

| 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|
| 上游改数据结构 | 高 | 构建失败 | 正向权威表 + Zod 严格校验 + 自动开 issue + 线上保持旧版；固定 SHA 可回滚 |
| **美术再分发无授权** | **已确认为事实**（两个上游 `license: null`） | 上线即构成未经授权的复制与信网传；被要求下架时图片链路整体崩塌 | **上线前硬门槛**，不是风险备注。§8.5 三选一，默认走方案 B（不托管图片）；已写的图片管道保留，授权到手后切换不返工 |
| **把数据调查结论当工程结论** | 中（本文档自身的失效模式） | 按 E-unverified 的数字排期或验收，首次真实构建即推翻 | 文档头部标 D-verified / E-unverified / 待实测三级；§7 阶段 1.12 强制一次冷构建并记录 baseline，之后所有产物数与时长以实测值替换推算值 |
| **推断当权威** | 现存 4 处（`nationality` 8/9/10 与 98），其余 25 处已由数据文本或舰船身份钉死 | 阵营名错标，与「不猜枚举」原则冲突 | `factions.json` 每条带 `source: data-text\|ship-identity\|inferred\|structural` 与 `evidence`；`/data-quality` 按档公开；显示名构建期与 gametip 逐条比对，改名即中止（§11 C） |
| 上游改枚举语义 | 中 | 分类页错乱 | `handbook_type` / `type` / `nationality` 出现未知值即中止开 issue；`weekly-verify` 独立发现漂移 |
| 取数被网络与限额中断 | **已确认会发生** | 同步失败 | 主路径 codeload tarball（不限额）；API 兜底时校验响应体大小与可解析性；多后端可切换；失败不覆盖 normalized |
| 误取空壳同名表 | **已确认 24 处，且规律严格互补** | 拿到 `[]`/`{}` 当有效数据 → 站点构建成功但满屏空白 | `tables.ts` 注册表强制目录前缀 + 每张表最小条目数断言（§3.4 全表已列） |
| 数据脏关联（同 `skin_id` 多船名） | 已确认存在 | 页面串船 | 隔离清单：不静默合并，warn + 人工裁决 |
| 上游停更 | 中 | 数据陈旧 | normalized 已入库，站点可无限期正常跑；`/about` 标注截止日期；降级为人工月度更新 |
| `skinId` 与 EN 目录存在缺口 | 中（约 117 张） | 部分立绘缺失 | 三级回退兜底；backfill 输出未命中清单逐项决定 |
| 装备图标 EN 侧缺 59 族 | **已实测确定**（89.4% 命中，缺 98 条） | 维希/自由鸢尾舰炮线装备无图标 | 占位图 + 「暂无图标」；缺口清单固定，可按需人工补图，不影响其它 811 条 |
| CN 与 EN 立绘和谐差异引发投诉 | 中 | 用户不满 | 页面明示来源；`l2dhx` + `shop_dynamic_hx` 打标记；按需人工覆盖 |
| 掉落功能被理解为「不完整」 | 高 | 用户预期落空 | 页面内明示「材料与设计图掉落 / 装备掉落需人工登记」；能力边界写进 `/about`，不装作完整 |
| 伤害估算被当成权威结论 | 中 | 信任受损 | 固定免责标注；可精确对账的经济类计算单独区分，不加估算标签 |
| 构建超 20 分钟 | 中 | 无法部署 | 分阶段实测；技能页可选；重页面改 CSR；Turborepo 缓存 |
| 产物超 20,000 文件 | 低 | 部署被拒 | 预算 2,900–5,900，余量充足；守卫排最后一步 |
| R2 额度用尽 | 中（不是「低」——存储、Class A、Class B 三项额度都会随时间消耗，且旧哈希不删会单调增长） | 图片失效 | 2.66GB 对 10GB·月；warn 4GB / stop 8GB；lifecycle 只保留最近 5 个哈希版本；Class B warn 600 万 / stop 900 万；禁止语音音频与 BGM |
| 数据错误未被发现 | 中 | 信任受损 | 三重保障：人工抽检 5 艘 + `weekly-verify` 抽样 50 条 + `/about` 明示「未逐项人工核验」与反馈入口 |
| 中文搜索召回差 | 中 | 搜索不可用 | 主索引以名字 / 别名 / 拼音为核心，不依赖分词；多音字例外表；`aliases.json` 人工维护 |
| 误取敏感词表 | 低 | 泄露审查词库 | 取数白名单机制，禁止目录级粗拉；CI 产物扫描断言 |
| 无前端错误监控 | 中 | 故障无人知 | 阶段 5 定案并接入 |
| 版权争议 | 低 | 项目下架 | 非商业、零广告、署名、不修改立绘、DMCA 响应 |
| 与 biligame WIKI 同质化 | 中 | 无流量 | 差异化：站位/阵营/图鉴分类多维筛选、材料掉落双向反查、拼音别名搜索、CV 与语音文本检索、自动版本追踪、面板与材料计算——MediaWiki 架构做不好这些 |
| 攻略内容烂尾 | 高 | SEO 冷启动失败 | 按内容性质分工；内容层排最后（阶段 8），前序阶段不依赖它 |

**已知取舍（非风险）**：

- Cloudflare 免费版在中国大陆无节点。已确认接受首屏 1–3s，换取免备案与零成本。
- 立绘以 EN 源为准，CN 差异靠人工覆盖层按需纠正。
- 伤害计算只做到面板估算；材料与经济计算保持精确。
- 三维以上筛选组合不生成静态页、不被收录。
- 掉落功能只覆盖可确证的部分，装备本体掉落明确标注。

**环境陷阱（记入 `docs/runbook.md`，全部实测触发过）**：

- Git Bash 的 MSYS 会把前导斜杠参数翻译成 Windows 路径（`/CN/x.json` → `D:/Program Files/Git/CN/x.json`），导致 sparse-checkout **零检出但 exit code 为 0**。手动调试加 `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'`；生产代码用 `spawn('git', [args])` 数组传参不经 shell。
- **Windows 换行陷阱**：Python 在 Windows 写文件与管道输出默认 `\r\n`，`while read` 循环里变量会带 `\r`，导致 `curl -o` 报「No such file or directory」且原因完全不直观。清单文件必须 `open(..., 'w', newline='\n')` 或管道后接 `tr -d '\r'`。
- `raw.githubusercontent.com` 与 `cdn.jsdelivr.net` 在部分网络被 DNS 阻断（HTTP 000 / 0.1 秒），`api.github.com` / `codeload.github.com` 正常。本地一律走 codeload 或 API。
- **`github.com` 本身不稳定**：同一台机器一小时内 `git push` 先成功、后 `Recv failure: Connection was reset`，再变 `Failed to connect to github.com:443`（21 秒超时），而同一时刻 `api.github.com` 0.33 秒返回 200。所以「本地能 push」不能作为任何步骤的前提：push 必须写成可重放的动作，取数与探测一律走 api/codeload 域名。CI 在 GitHub runner 上跑，不受本机这条影响。
- `github.com` 会降级（实测 0.61 秒劣化到 15.5 秒），此时 `--filter=blob:none` 的按需取回报 `unable to read sha1 file` 且**索引被清空成 0 条目**。取数后必须断言文件非空且可解析。
- REST API 未认证限额 60 次/小时；超限返回 **280 字节的 JSON 错误体，极易被当成成功响应写进文件**。每次 API 调用后校验体积与可解析性。
- `AzurLaneData` git 历史约 4GB，当前树仅 3,157 文件，必须 `--depth 1` 或走 codeload tarball。
- Windows 文件系统大小写不敏感；本项目路径 `CN/sharecfgdata` 与 `CN/ShareCfg` 不止差大小写，暂无冲突，但解包与索引仍以完整路径为键。
- Windows 下 Node 与 Git Bash 的 `/tmp` 解析不一致，脚本一律用工作区内绝对路径。

---

## 11. 数据调查结论

### A. 舰船与皮肤模型：三层，主键是 `group_type`

`ship_data_group.group_type`(859) → `ship_skin_template.id`(2,730) → `ship_data_statistics.id`(3,957)。`skin_id` 指向皮肤不是基船。

`ship_data_statistics` 内部是**两套行混在一张表里**，切法只能用字段关系：

```
阶段行  id - skin_id ∈ 1..4   3,429 行 / 860 个 skin_id（856 组正好 4 行，3 组 1 行，1 组 2 行）
                              rarity 在每个 skin_id 内唯一，取值域恰好 {2,3,4,5,6}
非阶段行 其余                  528 行   attrs 全 1 的展示单位、id 自指的 NPC 行
                              rarity=18 的三行全在这一侧，不是新的稀有度档
```

不拿 `id >= 900000` 这类阈值切：阈值是观测出来的巧合，`id - skin_id` 才是定义。按阶段行聚合后 `star` 随阶段递增而 `rarity` 恒定，这也是「禁止用 star 推稀有度」的实证。已用北卡罗来纳等实例验证。

`handbook_type` 是游戏自己的图鉴分类：0 常规 667 / 1 联动 91 / 2 科研船 42 / 3 META 59。

### B. 352 个孤儿 `ship_group`：确认排除出图鉴

`ship_skin_template` 引用 1,211 个 `ship_group`，`ship_data_group` 只有 859。差额 352 个的身份（已逐个查名）：

| 分段 | 数量 | 身份 | 例 |
|---|---|---|---|
| 9xxxxx | 339 | 塞壬与仲裁者等敌方单位、已下架联动、活动剧情角色 | 领航员-TB、仲裁者·司特莲库斯·VIII、古立特、电光机王 |
| 5xxxx | 2 | **开发测试单位** | 导驱type20测试机、导驱type21测试机 |

判定依据：这些 `ship_group` 对应的 `skin_id` 段在 `ship_data_statistics` 中出现 **0 次**，即没有玩家侧数值行。反向检查：`group` 有但 `skin` 无 = **0**，每个图鉴条目都有立绘。

处理：`ship_data_group` 的 859 条是图鉴唯一白名单；孤儿皮肤登记进 `orphan_skin` 表，只为让图片管道解释其存在，不生成页面、不进搜索。

### C. `nationality` → 阵营名：靠 `memory_storyline` 的事件名与活动描述共现钉死

`CN/sharecfgdata/gametip.json`（7,449 键 / 402 个 `word_*` 类目）中 `word_shipNation_*` 32 条给全阵营与联动名（`baiYing` 白鹰 · `huangJia` 皇家 · `chongYing` 重樱 · `tieXue` 铁血 · `dongHuang` 东煌 · `beiLian` 北方联合 · `ziyou` 自由鸢尾 · `weixi` 维希教廷 · `saDing` 撒丁帝国 · `yuanwei` 鸢尾教国 · `yujinwangguo` 郁金王国 · `mot` 飓风 · `meta_index` META（`meta` 显示为 `???`）· `np` 海王星 · `holo` hololive · `imas` 偶像大师 · `senran` 闪乱神乐 · `ssss` SSSS · `dal` Date A Live · `doa` 维纳斯假期 · `um` 传颂之物 · `tolove` To LOVE-Ru · `ryza` Atelier Ryza · `yumia` Atelier Yumia · `brs` BLACK★ROCK SHOOTER · `ai` KizunaAI · `bili` 哔哩哔哩 · `danmachi` danmachi · `link` 联动 · `other` 其他 · `all` 全阵营）。**这些条目只有词键与文本，不带数字。**

数据里出现数字阵营的一共三处，彼此之间没有任何 `nationality → 词键` 映射：

| 表 | 字段 | 实测取值 |
|---|---|---|
| `ship_data_group`（859） | `nationality` | **恰好 28 个：1–9、11、96、97、98、101–115**（没有 10；不是「1–11」连续段） |
| `lover_nation`（16 键，ShareCfg） | `nation` | 0–11、96、97、98 + `all`；带 `letter`，取值只有 `en`/`jp`/`cn`/`meta` —— 是书信文体的语言码，不是国别码 |
| `memory_storyline`（94 条，ShareCfg） | `shipnation[]` | {1, 2, 3, 4, 5, 6, 7, **10**, 11, 97}；8 与 9 从不出现在任何事件里 |

可用的正向判据是**文本共现**：`memory_storyline` 带中文事件名，`ship_data_group.description` 带每艘船的出处活动名。事件名里出现某个阵营名时，该事件的 `shipnation` 与这批船的 `nationality` 就把数字钉住。逐条钉出的 29 条（28 个实出值 + 10 只在剧情侧出场）：

| `nationality` | 阵营 | 船数 | `source` | 依据 |
|---|---|---|---|---|
| 1 | 白鹰 | 159 | data-text | 事件 30「迷雾之下」、40「渐入迷踪」文本含「白鹰」，`shipnation` 恰为 `[1]` |
| 2 | 皇家 | 120 | data-text | 50「意外的旅途」`shipnation=[2]` 且文本含「皇家」；39「皇家号令」`[2,10,1]` |
| 3 | 重樱 | 165 | data-text | 89「重樱的邀约」`shipnation` 恰为 `[3]`，bgm `story-newsakura`；另 26/29/41 三事件互证 |
| 4 | 铁血 | 91 | data-text | 9「铁血、音符与誓言·上」`shipnation` 恰为 `[4]`；13「…·下」`[4,2]` |
| 5 | 东煌 | 26 | ship-identity | `lover_nation` 5 `letter=cn`；船名全是中国近代舰（鞍山/逸仙/宁海/镇海/寰昌） |
| 6 | 撒丁帝国 | 37 | data-text | 8「神圣的悲喜剧」/42「复兴的赞美诗」/63「绿洲往事」`shipnation` 恰为 `[6]`，bgm `battle-boss-italy`、`story-italy`；52「撒丁的邀约」`shipnation` 首位是 6，bgm `story-roma-outside` |
| 7 | 北方联合 | 38 | ship-identity | 36「破晓冰华」/47「黎明之暗」/62「极地风暴」`shipnation` 恰为 `[7]`，bgm `bgm-cccp*`；船名为苏联舰（阿芙乐尔/基洛夫/塔什干/苏维埃罗西亚） |
| 8 | 自由鸢尾 | 27 | **inferred** | 见下 |
| 9 | 维希教廷 | 24 | **inferred** | 见下 |
| 10 | 鸢尾教国 | 0 | **inferred** | `lover_nation` 与 `memory_storyline` 都有 10（64「奏响鸢尾之歌」`shipnation` 恰为 `[10]`，bgm `theme-irisangel`，25 处引用），但图鉴无一条船：这是只在剧情侧存在的战前鸢尾 |
| 11 | 郁金王国 | 3 | data-text | 三条船（七省/埃佛森/金狮）`description` 为「限时活动：扬起郁金之旗」与科研开发；86「扬起郁金之旗」`shipnation` 含 11，bgm `story-tulipa` |
| 96 | 飓风 | 16 | data-text | 16 条船 `description` 全为「限时活动：飓风与青春之泉／沉眠之海／自由群岛」；`gametip` 的 `battle_text_haidao_1` 原文「侦测到非「飓风」舰船」；`type` 全为 22/23/24（风帆） |
| 97 | META | 59 | data-text | `handbook_type=3` 的 59 条全落 97；`lover_nation` 97 `letter=meta`；50 条 `description` 含「META」 |
| 98 | 其他 | 3 | structural | 泛用型布里 / 试作型布里MKII / 特装型布里MKIII 三条素材船，`description` 只有勋章商店、军需商店、每周任务、原型商店；32 个词键里能容纳它的只剩 `other`。页面按「其他」分组，不宣称这是游戏内阵营名 |
| 101 | 海王星 | 8 | ship-identity | 涅普顿/诺瓦露/布兰/贝露 + 四色之心 |
| 102 | 哔哩哔哩 | 2 | ship-identity | 船名即「22」「33」（站娘 22 娘 / 33 娘） |
| 103 | 传颂之物 | 6 | ship-identity | 久远/猫音/露露缇耶/乌璐露/萨拉娜/芙米露露 |
| 104 | KizunaAI | 4 | ship-identity | 绊爱 + 三个形态 |
| 105 | hololive | 7 | ship-identity | 白上吹雪/时乃空/湊阿库娅/夏色祭/百鬼绫目/紫咲诗音/大神澪 |
| 106 | 维纳斯假期 | 15 | ship-identity | 玛莉萝丝/穗香/霞/海咲/凪咲/女天狗… |
| 107 | 偶像大师 | 7 | ship-identity | 天海春香/如月千早/水濑伊织/秋月律子/双海姐妹 |
| 108 | SSSS | 9 | ship-identity | 宝多六花/新条茜/南梦芽/飞鸟川千濑… |
| 109 | Atelier Ryza | 6 | ship-identity | 莱莎琳·斯托特 + 同伴 |
| 110 | 闪乱神乐 | 7 | ship-identity | 飞鸟/斑鸠/焰/雪泉/紫… |
| 111 | To LOVE-Ru | 6 | ship-identity | 菈菈/娜娜/梦梦·贝莉雅·戴比路克、金色暗影… |
| 112 | BLACK★ROCK SHOOTER | 2 | ship-identity | BLACK★ROCK SHOOTER / DEAD MASTER |
| 113 | Atelier Yumia | 4 | ship-identity | 优米雅·利斯菲尔德 + 同伴 |
| 114 | danmachi | 2 | ship-identity | 赫斯缇雅 / 琉·璃昂 |
| 115 | Date A Live | 6 | ship-identity | 夜刀神十香/鸢一折纸/五河琴里/四糸乃/时崎狂三/八舞 |
| | | **859** | | 101–115 恰好 15 个值 ↔ `gametip` 恰好 15 个联动词键，双射无剩余 |

`source` 四档的定义（构建期不区分渲染，`/data-quality` 按档公开）：

- **data-text** —— 数字与阵营名在数据文本里同现，链在库内闭合：8 条（1/2/3/4/6/11/96/97）。
- **ship-identity** —— 链在库内断，靠舰船名的史实归属或 IP 身份判定，可复核但不是读出来的：17 条（5/7 + 15 个联动）。
- **inferred** —— 一组互斥候选之间还需要一次人为分配：3 条（8/9/10）。
- **structural** —— 排除法归到剩余类目：1 条（98）。

**8 / 9 / 10 是这块唯一没闭合的缺口。** 三者的船名全是法国系，而 `shipnation` 里只有 10、从不出现 8 与 9；分 8 与 9 只能靠「哪艘在 1940 之后站在维希那边」这类史实：本表把 黎塞留/贝亚恩/凯旋/鲁莽/倔强/絮库夫/福尔班/埃米尔·贝尔汀 归 8=自由鸢尾，把 敦刻尔克/斯特拉斯堡/让·巴尔/阿尔及利亚/拉·加利索尼埃/霞飞/克莱蒙梭 归 9=维希教廷，10 则是无船可造的战前鸢尾教国。这三条在用户核对（§12 第 7 项）之前状态是**待核**，不得对外称权威。判定反了的影响面是两张阵营筛选页与 51 艘船的标签，数字键本身不受影响 —— 这是缺口可控的原因。

落地为 `data/manual/factions.json`，29 条，每条只登记 `nationality / wordKey / slug / name / source / evidence`：

- **`name` 不用于渲染。** 页面文本构建期从 `gametip` 的 `word_shipNation_{wordKey}` 实时读出，`assertNamesAgreeWithGametip` 把表里的 `name` 逐条比对上游文本，不一致即中止 —— 抄写会随上游改名分叉，比对不会。
- `assertCovers`：`ship_data_group` 出现表里没有的数字即构建失败，不允许静默显示未知阵营。反向不强制（10 允许 0 条船）。
- `slug` 是站点自己的 URL 身份（`eagle-union` / `tulip-kingdom` / `hololive`），与 `nationality` 数字解耦：数字会随上游变，URL 不能。


### D. 敌方单位属性在 `enemy_data_*`；每关编组必须靠 `GameCfg/dungeon.json`

```
enemy_data_statistics   12.9MB / 13,568 行  具名字段：cannon torpedo antiaircraft air
                        durability reload hit dodge armor luck speed antisub（各带 _growth）
                        + battle_unit_type equipment_list pilot_ai_template_id star rarity base
enemy_data_by_type      26 键（驱逐…，含舰船侧不存在的 14 鱼雷艇 / 15 运输舰 / 16 自爆艇 / 25 未知）
```

**`expedition_data_template` 完全没有敌人字段**（34 字段逐个查过，`enemy` / `wave` / `spawn` 命中 0），`chapter_template` 只有 `enemy_refresh`，而它是每格刷新次数数组（71 种形态，取值仅 `0,1,2,3,4,6,7,8,9,10,12`），不含敌人身份。所以「某一关到底派什么怪」只能从 `GameCfg/dungeon.json` 的 `stages[].waves[].spawn[].monsterTemplateID` 取——实测 **9,288 / 9,301 个 dungeon 有怪物清单，977 / 981 关可解析出完整编组，11,263 / 11,292 个 monsterTemplateID 能在 `enemy_data_statistics.id` 找到行**。抽取后仅 0.59MB，原 80MB 不入库（§3.3）。

名称是另一回事：见 §8.2「敌人名称」——用到的怪里只有 6.0% 有名字，且 `base` 字段不回连任何舰船表。

附带收益：敌方表用具名字段而舰船表用位置数组，两者键集一致，独立交叉验证了属性映射。

### E. 装备条目：base 继承展开 + 三条件正向判定 → 909 条

`equip_data_statistics` 10,365 行的 `id` 全局唯一，但**不是「一行一装备」**：它是族行与强化等级行混排在一张表里，靠 `base` 组织。实测 8,841 行带 `base`，其中 **8,261 行自身无 `name`/`type`/`rarity`/`icon`**，字段全靠父行继承——此前把这 8,261 行称作「升级链与经济行」是错的，且**不展开继承就把它们当独立条目，会直接产出 8,261 个空名字装备页**。实证 `stats[501]`（base=500）只有 `value_1='16' value_2=30` 两个自有值，其余全空，而 500 是「小海狸中队队徽」。

判定链路（§3.10）与实测漏斗：

```
10,365 全行
  → 族根（base 为空 且 自有 name）        1,524
  → type ∈ equip_data_by_type 数值键枚举   1,431
  → id ∈ equip_data_template               909   ★ 装备图鉴条目
```

三个条件都不含 id 数值范围。**曾用过的 `id ≥ 10000` 截断把条目数错标成 734，漏掉 175 条真装备**（小海狸中队队徽、珍珠之泪、九一式穿甲弹、超重弹、Z旗、100/150号航空燃油、归航信标、约定的证明…），而低编号段里又确实混着内建条目（id 2「序章重巡-萨福克（瞄准型）」、id 20「U556关卡单发鱼雷-弹药2」）——即 id 既非充分也非必要条件，必须由 `type` 正向枚举 + 模板连接 + 族根身份三条共同判定。被条件正确排除的内建条目样本：60231「烈焰崩袭」、61007「约克城技能随机扫射海面LV1」、54xxx「航空攻击展示-×」系。

收敛后 909 条**每条都有 `icon`**（实测 0 缺失，558 族）、rarity 六档齐备，可作图片连接键。重名是不同稀有度/科技层的独立装备，各占一页。

**稀有度不能用 `star` 推，也不能两侧共用一张映射表。** 舰船侧的字段是 `ship_data_statistics.rarity`，且只在阶段行上成立：856 组四行阶段行里 `star` 从 1 递增到 6 而 `rarity` 恒定（北卡 105121→105124 即 star 3→6），按 star 映射会让同一艘船突破后换档。取值恰好 {2,3,4,5,6}，与 `gametip` 的 `index_rare2`…`index_rare6`（普通/稀有/精锐/超稀有/海上传奇）一一对上，`index_rare1` 不存在——两侧域相同才是这条链可用的证据。装备侧 `rarity` 是 1–6，同名不同义（`equip_data_by_quality` 只有经济数值没有显示名），必须独立成段。

`weapon_name`(2,380 条，仅 170 有名) 属 5xxxx 武器体系，**不是装备名来源**，只作武器名补充。

### H. `ShareCfg` 与 `sharecfgdata` 严格互补（24 组空壳）

`CN/ShareCfg` 的 593 张表里恰有 24 张是空壳，而这 24 张正是 `CN/sharecfgdata` 的全部 24 张表——双向无例外（空壳无对应 0 处、两侧同有数据 0 处）。含义是：**一张表只在一个目录里有数据，而光看文件名无法判断在哪一侧**。`ship_data_statistics`、`chapter_template`、`equip_data_statistics`、`item_data_statistics`、`expedition_data_template`、`gametip` 全部落在这 24 张里，读错侧的失败模式是「构建成功、内容全空」而非报错。完整清单与 `minRows` 阈值见 §3.4。

### F. 尚未定位：日常委托表

`expedition` 在这套数据里是**出击战斗节点**（15,515 行），不是日常委托。`task_data_template`（7,948 行）是任务表（`award`/`award_choice`/`fix_task`/`auto_commit`/`guild_coin_award`）。AL 的「委托 / Commission」对应的数据表尚未确认，候选是 `task_data_template` 的某个子集或 `tradingport_template` / `oilfield_template`。

处理：委托收益工具**暂不排期**，在阶段 7 定位到表后再评估可行性。

### I. 九处「表名骗人」的语义陷阱（均属 D-verified）

共同规律：**表名与直觉语义不一致，只有读进内容才能发现**。这几处靠名字推断会必然踩空，所以单列一条并写进验收。

| 表 | 名字暗示 | 实测语义 | 判据 |
|---|---|---|---|
| `technology_data_template` | 舰队科技树 | **科研项目目录** | 项目 1 = `C-153-MI` / `time=21600` 秒；项目 11 描述原文「该**科研项目**致力于通过实战的手段，收集各种实验数据…」；`type` 仅 {1:456, 2:229} 两类项目规模 |
| `equip_data_statistics` | 一行一装备 | **族行与强化等级行混排，靠 `base` 继承** | 8,841 行带 `base`，其中 8,261 行无自有 name/type/rarity/icon；`stats[501]` 只有 `value_1='16' value_2=30`，其余全空，父行 500 才是「小海狸中队队徽」 |
| `ship_data_by_star` | 星级→稀有度标签 | **星级经济参数表** | 字段是 `destory_item` / `energy_recover_food_ratio` / `energy_recover_time_ratio` / `exchange_price` / `level_restrictions`，无任何显示名 |
| `ship_data_statistics` | 一行一（船 × 阶段） | **两套行混排** | 3,429 行阶段行（`id - skin_id ∈ 1..4`）+ 528 行非阶段行；不切分就有 11 个 `skin_id` 读出两个 `rarity`（§11 A） |
| `name_code` | 船名码表 | **是船名占位符的唯一解，且自带两个诱人道字段** | 439 条；`ship_skin_template` 的 1,213 条规范名里 362 条是 `{namecode:N}`；而本表 `nation` 字段 437/439 恒为 0、`type` 恒为 1，看着像阵营/舰种其实全是死值 |
| `fleet_tech_ship_template` | 按船的科技行，主键自指 | **主键 `id` 就是 `group_type`**，真正指向舰级的是 `class` | 726/726 的 id 落在图鉴白名单内，class ∈ `fleet_tech_ship_class` 也是 726/726；字段 `pt_upgrage` 是上游把 upgrade 拼错，原样保留不改名 |
| `ship_data_by_type` | 舰种→唯一名 | **21 个舰种只有 18 个不同显示名** | `type_name`：导驱 = {20,21}、风帆 = {22,23,24}；数字键也不连续（1–13、17–24，14/15/16 是敌方专用）。按名字做 slug 会撞页 |
| `equip_data_by_quality` | 装备品质名 | **只有经济数值，没有任何显示名** | 6 档字段仅 `equip_quality` / `gear_score` / `gear_score_addition` / `destory_resource_ratio`；装备稀有度的中文词在 CN 数据里不存在 |
| `memory_storyline` | 剧情回忆 | **唯一带数字阵营且有中文事件名的表** | `shipnation[]` 只出现 {1,2,3,4,5,6,7,10,11,97}——**8 与 9 从不出现**，所以法系三阵营的分配只能在这里失手；`letter`/`bgm` 键（`bgm-cccp`、`story-italy`、`story-tulipa`）是可用的旁证 |

连带的一条：**改造不是一级分类**。`ship_data_group.handbook_type=2` 是科研船（42 条与 `ship_data_blueprint` 双射），改造在 `trans_type`/`trans_skin`/`trans_skill`/`trans_radar_chart` + `ship_data_trans`，且与 `handbook_type=2` 交集为 0。改造的**节点条件与成本**又不在这些表里，只在 `transform_data_template`（1,217 节点）。一条链上三个层次，混用任意一层去做另一层的事都会出错。

**防复发条款**：`tables.ts` 每张表必须写 `semantic` 字段（一句话说明它到底是什么），且凡本文标注为「表名骗人」的表，其 `semantic` 里必须引用一个具体证据条目（如 `project 1 = C-153-MI`）。CI 断言该字段非空。这样下一轮加表时会被迫先读内容再命名。

### G. 无数据源的能力（已在 §8.2 定案）

建造概率（服务端逻辑）、装备本体掉落池（`box_data_template` 只有 `effect_id` 指向脚本）、画师姓名（`illustrator` 只有 code，`gametip` 无对应类目）、**装备**稀有度显示名（`equip_data_by_quality` 六档无文本字段；舰船侧有源，见 §11 A）、弹道与命中的精确解算（10.7 万行几何数据 + 代码内公式）。

---

## 12. 待提供输入

| # | 内容 | 需要时点 |
|---|---|---|
| 1 | 域名字符串（配置 CDN URL 与 Pages 绑定） | 阶段 3 |
| 2 | R2 已开通 + bucket 名 + `img.` 子域已绑定 | 阶段 3 |
| 3 | GitHub Secrets：`CF_ACCOUNT_ID` / `R2_AK` / `R2_SK` | 阶段 3 |
| 4 | 站名与 slogan（`<title>`、OG 图、页脚） | 阶段 1（可先用占位） |
| 5 | 版权与免责措辞确认 | 阶段 1（可由 Agent 先拟稿） |
| 6 | **人工抽检 5 艘舰船**（覆盖不同舰种与站位） | 阶段 2 |
| 7 | **核对 3 个阵营**：8 是自由鸢尾还是维希教廷、9 反之、10 是否即鸢尾教国（11 郁金王国 / 96 飓风 / 6 撒丁帝国已由事件名与活动描述在数据内钉死，不再需要核对） | 阶段 2 |
| 8 | `data/manual/rarity.json` 稀有度显示与配色确认。**舰船与装备两套**，不可用 `star` 推（star 是突破阶段） | 阶段 2 |
| 8b | ~~舰船侧稀有度字段待定位~~ **已确证**：字段是 `ship_data_statistics.rarity`，只在阶段行（`id - skin_id ∈ 1..4`）上成立，取值恰好 {2,3,4,5,6}，与 `gametip` 的 `index_rare2`…`index_rare6` 两侧一一对上（§11 A）。剩下的不是缺口而是数据本身没有：装备侧 1–6 档无中文词源，按数字渲染 | 已关闭 |
| 9 | `data/manual/aliases.json` 与 `pinyin-overrides.json` 首批整理 | 阶段 3 |
| 10 | CN 立绘文件（可选，放入 `data/manual/image-overrides/cn/`） | 任意 |
| 10b | 装备图标补图（可选，98 条维希/自由鸢尾舰炮，EN 侧无对应；先走占位图不阻断） | 阶段 3 之后任意 |
| 11 | 高频关卡的装备掉落人工登记（可选，按需） | 阶段 4 |
| 12 | 攻略文章署名 | 阶段 8 |
| 13 | META 类 4 篇的判断输入（该练谁、开荒编队、演习 META、大世界自律） | 阶段 8 |

**阶段 1 全程与阶段 2 大部分不依赖以上任何一项**（第 4、5 项影响文案，可用占位符先行）。

---

## 附录 A：已验证事实

### A.1 取数与网络

| 探测项 | 结果 |
|---|---|
| `codeload.github.com` 全仓 tarball | **125MB / 约 40 秒，不受 REST 限额约束**，主路径 |
| `git push` 到 `github.com` | 同机一小时内先通后断：`Recv failure: Connection was reset` → `Failed to connect to github.com:443`（21s 超时），同时刻 `api.github.com` 返回 200 / 0.33s。本地 push 只能当可重放动作，不可当前提 |
| **Windows 下 `tar` 吃 Windows 绝对路径** | 传 `E:\agents\…\x.tar.gz` 给 Git Bash 的 tar，先报 `Cannot connect to E: resolve failed`（tar 的 `[host:]path` 语法把盘符当远程主机），并连带抛出误导性的 `gzip: stdin: unexpected end of file`。加 `--force-local` 只是把症状换成 `E\:\agents\\qoder\…\004cca5c…: Cannot open: No such file or directory`——**连 SHA 都被转义改写**。**可用写法：`cwd` 定位 + 全部相对路径**（`tar -xzf <name>.tar.gz -C . <members>`）。`ubuntu-latest` 是 POSIX 路径不会触发，但同一份代码两边都得跑 |
| **tarball 体积不能当完整性判据** | 实测同一 SHA 两次下载 125,181,350 与 125,157,642 字节级别相近，「< 50MB 即异常」这类阈值拦不住中途截断。用 `gzip -t` 验流 |
| `corepack enable` 在非管理员环境 | `EPERM: operation not permitted, open 'D:\Program Files\nodejs\pnpm'`。改用 `corepack pnpm <cmd>`（`corepack prepare pnpm@9.15.4 --activate` 本身成功），CI 侧由 `pnpm/action-setup` 装不受影响 |
| **但 `corepack pnpm` 救不了 turbo** | turbo 自己去找包管理器二进制，不认 `corepack pnpm` 这层调用，报 `Unable to find package manager binary: cannot find binary path`。**可用解法**：`corepack enable --install-directory "$HOME/.corepack-bin" pnpm`（写用户目录，不需管理员）并把该目录加进 `PATH`。这是本地开发环境步骤，须写进 §0 与 runbook，否则新机器上 `pnpm build` 直接跑不起来 |
| `git ls-remote` AzurLaneData | 通，`main = 4cca5c2437007b62d30a6235fcfc0c0203231378` |
| `git clone --depth 1 --filter=blob:none` | tree 可取；**blob 按需取回在域名降级时失败**（`unable to read sha1 file`，索引被清空成 0） |
| cone 模式检出 `sharecfgdata` + `GameCfg` | 335MB / 2 分 20 秒 |
| `--no-cone` 文件级检出 P0 | 54MB / 8 文件（正常网络下） |
| `github.com` | HTTP 200，0.61 秒（正常）→ **15.5 秒（实测劣化，会触发取回失败）** |
| `api.github.com` | 正常，但**未认证限额 60 次/小时**；超限返回 280 字节 JSON 错误体 |
| `GET /git/blobs/{sha}` + `Accept: application/vnd.github.raw` | 通，单文件上限 100MB，5.9MB 与 22MB 均可直取 |
| `codeload.github.com` 根 | HTTP 301（正常） |
| `raw.githubusercontent.com` | **HTTP 000 / 0.10 秒，DNS 层阻断** |
| `cdn.jsdelivr.net` | **HTTP 000 / 0.23 秒，同样被阻断** |
| MSYS 路径转换 | 实测触发，`/CN/...` → `D:/Program Files/Git/CN/...`，零检出但 exit 0 |
| Windows 换行 | Python 输出 `\r\n` 导致 `while read` 变量带 `\r`，`curl -o` 报无此文件 |
| npm registry | 通；pnpm 未安装，Node v24.21.0 自带 corepack |

### A.2 仓库结构

| 探测项 | 结果 |
|---|---|
| AzurLaneData 全树 | 3,157 条目 = **3,134 blob**，`truncated: false`；`.json` 3,122 · `.svg` 5 · `.txt` 5 · `.yml` 1 · `.md` 1 |
| **图片 / 音频文件数** | **0**（`.png` `.webp` `.avif` `.ogg` `.mp3` 全部为 0） |
| git 历史体积 | ~4GB（当前树仅 3,134 blob） |
| `CN/` | `GameCfg` · `ShareCfg` · `sharecfgdata` · `buffCfg.json` · `skillCfg.json`；合计 625 文件 / **425.8MB** |
| `CN/sharecfgdata` | **24 表 / 152.4MB / 206,309 条目**，逐表条目数见 §3.4 |
| `CN/ShareCfg` | **593 表 / 92.9MB**，其中 **24 表为空壳**，有效 569 表；87 表 >100KB |
| `CN/GameCfg` | 6 表 / 180.5MB：`dungeon.json` 80.0MB · `story.json` 65.5MB · `buff.json` 22.6MB · `skill.json` 12.5MB · `card.json` 7.8KB · `dorm.json` 7.5KB |
| **同名空壳规律（24 组，全树 size 实测）** | `CN/ShareCfg` 中 size ≤ 2B 的表恰为 24 张，与 `CN/sharecfgdata` 的 24 张表名**一一对应，无例外**：空壳无对应 0 处 · 两侧同有数据 0 处。含 `ship_data_statistics` `chapter_template` `equip_data_statistics` `item_data_statistics` `expedition_data_template` `gametip` 等核心表，完整清单见 §3.4 |
| 其余服区同构 | `EN` `JP` `KR` `TW` 四区 `ShareCfg` 空壳数同为 24；`JP/sharecfgdata` 26 文件（多 2 个且含 2 空壳）。本站仅 CN 服，其余区不取 |

### A.3 舰船与皮肤

| 探测项 | 结果 |
|---|---|
| `ship_data_group` | 859 行；`hide` 全 0；`redirect_id` 全 101 |
| `handbook_type` | 0:667 · 1:91 · 2:42 · 3:59 |
| `nationality`（group 表） | 1–9, 11, 96, 97, 98, 101–115 共 28 值 |
| `ship_skin_template` | 2,730 行；`distinct ship_group` 1,211；2,725 行有 `painting` |
| `skin_type` | -1:1,213（默认立绘）· 4:1,343（换装）· 1:61 · 2:107 · 3:3 · 6:3 |
| `painting` 样本 | `gin` / `gin_2` / `gin_3` / `kin` / `buli_super` |
| `shop_dynamic_hx` | 7 行为 1 |
| `ship_data_statistics` | 3,957 行；`distinct skin_id` 1,052；`attrs` 长度全部为 12；`english_name` 覆盖 3,952。阶段行判据 `id - skin_id ∈ 1..4` 切出 3,429 行 / 860 个 skin_id（856 组正好 4 行） |
| 舰船来源 | `ship_data_group.description` 是 `[文本, [命令, 参数], 0]` 三元组共 1,432 项 / 859 船；命令 7 种计数见 §8.2；`LEVEL` 带 `chapterid`（117 船 / 44 关）；17 艘无来源 |
| CV 与皮肤 | `voice_actor_CN` 502 条；「无 CV」有两个哨兵 `0` 与 `-1`（`0` 只在 900xxx 的 39 行 NPC 皮肤上）；2,730 条皮肤里 2,388 条有 CV 名；`skin_type` 取值 {-1,1,2,3,4,6}，-1 是 1,213 条默认立绘；`painting` 是 slug 字符串（5 条为空） |
| 每 `skin_id` 行数 | 1:185 · 2:7 · 3:1 · **4:609** · 5:197 · 6:42 · 7:7 · 8:3 · 9:1 |
| 突破实证 | 北卡罗来纳 id 105121→105124，`star` 3→4→5→6 |
| 脏数据 | 同 `skin_id=105120` 下并存「北卡罗来纳」与「黎塞留」（9xxxxx 段） |
| `ship_data_trans` | 106 行 |
| 孤儿 `ship_group` | 352 个；对应 skin_id 段在 statistics 中出现 0 次；`group` 有 `skin` 无 = 0 |

### A.4 枚举与属性

| 探测项 | 结果 |
|---|---|
| `ship_data_by_type.all` | `[1..13, 17..24]`（21 种，无 14/15/16） |
| `team_type` | `vanguard` / `main` / `submarine` |
| `attribute_info_by_type` | 12 项 `name` + `condition` + `all:[1..12]`；2 号位是 `cannon` **炮击** |
| `attrs` / `attrs_growth` | 定长 12 / 定长 6 位置数组 |
| 布里样本 | `[100,10,10,10,10,50,0,50,50,35,100,20]` → 航速 35、幸运 100 |
| `enemy_data_statistics` | 13,568 行，属性字段具名，键集与 `attribute_info_by_type` 一致 |
| `enemy_data_by_type` | 25 类（含 14 鱼雷艇 / 15 运输舰 / 16 自爆艇 / 25 未知） |
| `gametip` | 7,449 键 / 402 个 `word_*` 类目；`word_shipNation_*` 32 · `word_attr` 21 · `word_equipment` 19 · `word_shipType` 8 · `word_shipState` 13；**`word_illustrator*` = 0**；稀有度只有标签 `word_rarity→'稀有度'` 无等级值 |
| `word_equipment_*` | 19 个 UI 分类标签 |
| `gameset` | 408 键，含 `air_dominance_a/p/q/r/s/t/x/y`、`air_dominance_level_1..5`、`unoccupied_ship_nationality[97]` |
| `l2dhx` | 26 条 Live2D 和谐清单，键即 painting slug |
| `painting_filte_map` | 2,589 键 → `painting/{slug}_tex` 与 `painting/{slug}` |
| `illustrator` | 41 行只有 `code`，无姓名 |
| `voice_actor_CN` | 502 行 `{actor_name, code}`，493 含中文 |
| `word_template` | 16.8MB **敏感词前缀树**，禁止取用 |

### A.5 装备、技能与关卡

| 探测项 | 结果 |
|---|---|
| `equip_data_statistics`（sharecfgdata） | 10,365 行，id 全局唯一；**8,841 行带 `base`，其中 8,261 行无自有 name/type/rarity/icon，靠 base 继承父行**（实证 501 base=500，自有字段仅 value_1/value_2）；族根且有 name 1,524 → `type ∈ equip_data_by_type` 得 1,431 → `id ∈ equip_data_template` 得 **909 条**（**distinct icon 558**，图标是族级 · 909 条全部有 icon · rarity 1:38 2:123 3:209 4:248 5:263 6:28）。旧口径 `id≥10000` 的 734 为**错值**，漏掉 175 条真装备 |
| `equip_data_template` | 9,170 行 × 16 字段，升级与经济 |
| `equip_data_by_type` / `by_quality` / `code` | 20 类（含 `compare_group`）/ 6 档 / 14 项特性中文 |
| `weapon_name` | 2,380 条，仅 170 有名，5xxxx 武器体系 |
| `skill_data_template` | 3,030 行全部有 name |
| `chapter_template` | **981 行 × 97 字段**；type 1:522 / 2:459；`act_id` 非零 846（主线约 135）；`difficulty` 2–10；被引用 expedition id 共 **11,702** |
| `chapter_template_loop` | 862 行 × 47 字段，多 `air_dominance_loop_rate` `fightauto` `slg_effect`；`chapter_name` 为 None（按 id 引用主表） |
| `expedition_data_template` | **15,515 行 × 34 字段**；13,720 行有 `award_display`，共 **64,963 条** `[[type,id],…]` |
| **关卡 → 出击 join** | **11,701 / 11,702 命中 `expedition.id`**（唯一落空为哨兵 0）；`dungeon_id` 只命中 6,036，故正确连接键是 `id` |
| **`award_display` 落点** | resource_type=2 的 1,799 个 distinct id → 命中 `item_data_statistics`，**只有 6 个（0.3%）命中装备** → 关卡直发的是材料与**设计图** |
| `item_data_statistics` | 3,030 行；名称构成：设计图 320 · 含箱 215 · 其它 2,490；icon 前缀 SquareIcon 1,291 · Props 1,150 · Equips 331 · ChargeIcon 217 |
| `box_data_template` | **85 行**，字段仅 `{id, name:"物资箱", effect_id, icon, type}`；`effect_id` 70 个不同值 → **装备随机池在效果脚本里，结构化数据中没有** |
| `drop_data_restore` | 643 行 `{drop_id, resource_num, resource_type, target_id, target_type, type}` → 掉落补正/保底表，非主掉落表 |
| `ship_data_blueprint` | 42 行，含 `price`、`unlock_task[[id, 0/86400/172800/259200/345600]]` 逐日解锁、30 项 `strengthen_effect` |
| `ship_data_strengthen` / `ship_strengthen_blueprint` | 829 行 `{id, attr_exp[5], durability[5], level_exp[5]}` / 1,410 行 |
| `technology_data_template` | 685 行，含中文长描述 |
| `ship_meta_breakout` / `ship_meta_skilltask` | 236 行 / 1,396 行 |
| `ship_skin_words` | 2,485 行（sharecfgdata 版），battle/detail/expedition/feeling1-5/gift_*/headtouch/home/couple_encourage 全中文 |
| `world_chapter_template` | 644 行（sharecfgdata 版），`expedition_map_id`/`grids`/`float_items`/`is_sairen`/`is_auto` |
| `task_data_template` | 7,948 行，是任务表；**日常委托表未定位** |
| `weapon_property` / `bullet_template` / `barrage_template` / `aircraft_template` | 53,585 × 33 / 19,165 × 25 / 26,975 × 16 / 7,224 × 25，合计约 10.7 万行 |
| `spweapon_data_statistics` | 2,619 行，有名有图标 |
| `equip_upgrade_data` | **281 条**（282 键含 `all`）`{id, upgrade_from, target_id, material_consume[[itemId,count]], coin_consume}`；281 个 `(from,to)` 对全部唯一，链无孤立记录 |
| `equip_upgrade_template` | **50 条**（51 键含 `all`）`{id, category1, category2, equipments[], links[], gridSize, canvasSize, canvasPadding}`；category1 分布 1:9 · 2:9 · 3:9 · 4:9 · 6:3 · 7:4 · 10:7 |
| `technology_data_template` | **685 条**（686 键含 `all`），含 `name`/`desc` 中文与 `consume` |
| `ship_data_blueprint` | **42 条**（43 键含 `all`），`price`/`unlock_task`/`strengthen_effect`/`blueprint_version` |
| `ship_data_trans` | **106 条**（107 键含 `all:[10103,…]`），字段 `group_id`/`skin_id`/`skill_id`/`transform_list` |
| **`all` 哨兵键（6+ 张表实测）** | 值为 **id 数组不是记录**。`technology_data_template` `ship_data_blueprint` `ship_data_trans` `equip_upgrade_data` `equip_data_by_type` `ship_data_by_type` 均如此 → 主键一律按数字键过滤，条目数按数字键计，否则每张表虚高 1 且渲染会拿到数组崩在构建期 |
| **依赖表非空壳对账** | 计划引用的 ShareCfg 表逐张核对 tree size，`equip_upgrade_data` 79,015 · `equip_upgrade_template` 79,227 · `ship_data_strengthen` 218,279 · `technology_data_template` 506,311 · `ship_data_blueprint` 60,453 · `drop_data_restore` 110,933 · `fleet_tech_template` 45,811 · `skill_data_display` 273,571 · `ship_strengthen_blueprint` 723,932 等**全部 >2B**，24 组空壳只在 sharecfgdata 侧 |

### A.6 EN 图片源

| 探测项 | 结果 |
|---|---|
| `Fernando2603/AzurLane` 结构 | `images/{attribute,background,equipment,iconframe,intimacy,meowfficer,nationality,rarity,skill,skin,stats,type,unknown}` + `audio/` + 根目录 `ship.json`(861) `ship_skin.json` `ship_skin_list.json`(894 组 / 2,613 皮肤) `equipment.json` `equipment_icon.json`(**936 键**) `nationality.json` `nationality_icon.json`(**25 键，0–24**) `hulltype.json` `attribute.json` `bgm*.json` `meowfficer*.json` |
| `images/skin/` 命名 | **数字 ID 目录**：`100000` `100001` `100002` `100010`…，与 CN `ship_skin_template.id` 同命名空间；`ship_skin_list.json` 的 `gid` 与 CN `group_type` 对齐 |
| 单个皮肤目录内容 | 6 个文件：`painting.png` ~492KB · `shipyard.png` ~80KB · `icon.png` ~21KB · `chibi.png` ~26KB · `qicon.png` ~18KB · `banner.png` ~31KB |
| **`painting` 字段陷阱** | `ship_skin_list.json` 的 `painting` 是 `https://raw.githubusercontent.com/...` 完整 URL，该域名在开发环境 DNS 阻断，必须自己拼路径 |
| 覆盖 | EN 894 组 / 2,613 皮肤 vs CN 859 组 / 2,730 皮肤，约 117 张缺口 |
| 阵营图标编号 | EN 键 0–24（25 个），CN `nationality` 是 1–9、11、96、97、98、101–115 共 28 个离散值（无 10），**编号体系不同且区间不连续**，须经 `factions.json` 映射 |
| 装备图标覆盖（**已实测**） | CN 909 装备族代表行 → 558 icon 族；EN `equipment_icon.json` 936 键。**族命中 499/558 = 89.4%，条目命中 811/909 = 89.2%**；缺 59 族 / 98 条，全部落在 `500xx–562xx` 与 `85240`（Mle1924/1929/1930/1931/B-54 一系维希·自由鸢尾舰炮）。缺口走占位图，不阻断构建 |
| `Pelom777/AzurLaneTools` | 排除：Vue 源码项目（100 文件），7GB 全是 git 历史 |
| `LmeSzinc/AzurLaneUncensored` | 反和谐补丁（397MB），反证 CN 立绘存在和谐差异 |
| CN 立绘数据集 | GitHub 搜索两轮未找到；只能解包 AssetBundles，手工不可 CI |
| 萌娘百科命名规范 | `BLHX_<拼音>.png`，皮肤加序号，`hx` 尾缀者为国服和谐立绘 |

### A.7 Cloudflare 平台限制

| 项 | 免费额度 |
|---|---|
| Pages 构建 | 500 次/月 · 1 并发 · 单次超时 20 分钟 |
| Pages 文件数 | **20,000 / 站点**（付费 100,000，需 `PAGES_WRANGLER_MAJOR_VERSION=4`） |
| Pages 单文件 | 25 MiB |
| Pages 带宽 / 静态请求 | **无限**（官方条款） |
| Pages 自定义域 | 100 / 项目 |
| Pages 商用 | **允许**（Vercel Hobby 限非商用；GitHub Pages 禁止商用） |
| `_headers` / `_redirects` | 100 条 / 2,000 条 |
| R2 存储 | 10GB |
| R2 出口流量 | **¥0** |
| R2 `r2.dev` | 约 1,000 req/min，官方明确不推荐生产 |
| R2 自定义域名前提 | 域名 DNS 必须托管在 Cloudflare |
| R2 开通 | 需绑信用卡或 PayPal（不扣费） |
| Workers Free | 10 万请求/天 · 10ms CPU · 128MB 内存 · 50 子请求（Pages Functions 共用） |
| Workers Builds Free | 3,000 构建分钟/月 |

---

## 附录 B：参考资料

**数据源**

- [AzurLaneTools/AzurLaneData — Raw data extracted from AzurLane](https://github.com/AzurLaneTools/AzurLaneData)
- [AzurLaneTools/AzurLaneLuaScripts — Extracted lua scripts（阵营/建造概率等代码常量的候选来源）](https://github.com/AzurLaneTools/AzurLaneLuaScripts)
- [Fernando2603/AzurLane — Azur Lane Resources（EN 策展数据集，图片源）](https://github.com/Fernando2603/AzurLane)
- [碧蓝航线WIKI_BWIKI_哔哩哔哩](https://wiki.biligame.com/blhx/)
- [LmeSzinc/AzurLaneUncensored — 碧蓝航线反和谐](https://github.com/LmeSzinc/AzurLaneUncensored)
- [azurlane-doujin/AzurLanePaintingExtract — 立绘还原工具](https://github.com/azurlane-doujin/AzurLanePaintingExtract-v1.0)
- [萌娘百科：碧蓝航线专题编辑指南（图片命名规范，`hx` 为国服和谐立绘）](https://zh.moegirl.org.cn/zh-hk/Help:%E7%A2%A7%E8%93%9D%E8%88%AA%E7%BA%BF%E4%B8%93%E9%A2%98%E7%BC%96%E8%BE%91%E6%8C%87%E5%8D%97)
- [分享一个碧蓝航线立绘的提取与合成方案（AssetBundles 目录结构）](https://blog.csdn.net/weixin_54217201/article/details/130722495)
- [blhx-wiki-mirai-plugin — 基于 biligame wiki 数据的机器人插件](https://gitee.com/arisaka-iris/blhx-wiki-mirai-plugin)

**Cloudflare 平台**

- [Cloudflare Pages 官方定价页](https://www.cloudflare.com/zh-cn/developer-platform/products/pages/)
- [Cloudflare Pages 深度评测：免费静态托管的香与坑](https://blog.csdn.net/macowl/article/details/164305472)
- [被 Vercel 暂停后我换到了 Cloudflare Pages：官方 Limits 与竞品横评](https://cloud.tencent.com/developer/article/2724477)
- [Cloudflare Workers Builds：免费额度、超限处理与费用计算](https://yindongliang.com/docs/Cloudflare/workers-builds-pricing-and-limits/)
- [Cloudflare R2 对象存储搭建高速免费图床完全指南](https://m.blog.csdn.net/weixin_38821611/article/details/145668756)
- [用 Cloudflare R2 + PicGo 打造稳定图床方案（r2.dev 生产图裂实测）](https://zhuanlan.zhihu.com/p/1999618641881215019)
- [Cloudflare 免费额度 2026：Pages、Workers、R2、D1](https://www.bilibili.com/video/BV1ompf69E9K)
