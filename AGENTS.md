<!-- TRELLIS:START -->
# mini-trellis

This project uses mini-trellis as a memory layer. Working knowledge lives under `.trellis/`:

- `.trellis/spec/` — durable contracts (short markdown; read `index.md` first)
- `.trellis/research/` — topic inbox (`<topic>.md`; `README.md` is not a topic)
- `.trellis/workspace/` — per-developer journals

Record a session with `/mini-trellis:remember` (Claude/OpenCode), `/mini-trellis-remember` (Pi), or `$mini-trellis-remember` (Codex). When earlier decisions or relevant project rules are needed, use `mini-trellis mem recall "<topic or path>"`; expand evidence with `mini-trellis mem read "<ref>"`. No search is required for unrelated work. Promote lasting boundaries into spec with `mini-trellis-update-spec`.

Record only confirmed decisions, reusable research findings, or the session/compact handoff. Skip ordinary turns and unconfirmed guesses. New installs write notes without an automatic git commit; use `mini-trellis doctor` to check host wiring and `mini-trellis refresh --dry-run` before refreshing assets.

Keep confirmed rules short and faithful. Unconfirmed scope, exceptions, and implementation choices stay open or are labeled as inference, not added to the contract.

For a confirmed update, follow this short order: read the existing topic; edit that file; read it back and check the new rule, limits, and negations; run `python3 ./.trellis/scripts/add_session.py --title "..." --summary "..." --topic <actual-topic-path>`; read the journal and check its topic link. Journal-only success is not topic success; report partial writes accurately. New notes follow the requested or discussion language; updates preserve the document language.

When recall excerpts already answer the question with source and qualifiers, cite them and stop. Expand only missing context; do not repeat a lookup or fall back to dialogue-only `search` merely to reconfirm sufficient evidence.

mini-trellis does not create or drive tasks.

Managed by mini-trellis. Edits outside this block are preserved.
<!-- TRELLIS:END -->

<!-- TAVERN-RULES:START v3.0.0 -->
<!-- 本块由 tavern-harness/scripts/modules/rules_sync.py 自动生成，请勿手动编辑 -->
<!-- 真源: tavern-harness · registry/rules.json · 类别 host · v3.0.0 -->
<!-- 同步时间: 2026-11-17T14:25:26Z -->
<!-- 内容哈希: sha256:625cdf1d4356501bf479e073c2e1589eece767ea028ee2327b95fa498dff4193（仅覆盖规则正文，不含头部与项目覆盖） -->
# 统一开发规则（v3.0.0 · 宿主 fork）

> 本块由 tavern-harness 生成，请勿手改正文。
> 规范全文在 `.trellis/spec/`；项目特例写文末「项目覆盖」。

## 通用红线

- **G-01** 需要用户决策时用问答工具，一次聚合多个问题；重大设计多轮问答。
- **G-02** 任何工具调用前先输出可见短汇报；禁止无文本直接调工具。
- **G-03** 多项改动先落计划文件；验收标准不得 TBD；执行中实时勾选。
- **G-04** 用文件实时记录进度与交接；丢弃 AI IDE 上下文后可续跑。
- **G-05** 独立任务并行发起；命令非阻塞；禁止空等与轮询。
- **G-06** 子代理任务自包含；模型与并发由用户裁定；阻塞宿主不开子代理。
- **G-07** 删除、覆盖、装依赖、大重构、对外写操作前必须显式授权。
- **G-08** 删除一律走回收站或归档；禁止用命令直接删除。
- **G-09** 变更用 diff 与块级编辑；禁整文件覆盖与 shell 重定向写源码。
- **G-10** Git 只用显式 pathspec；提交前校验暂存区；完成即推 origin。
- **G-11** 交付物零凭据、零隐私、零真实数据、零本机绝对路径。
- **G-12** 先检索复用；UI 复用设计系统；DB 复用 schema 与迁移；不自造。
- **G-13** 运行时零 CDN 与网络引用；无法本地化须说明并隔离。
- **G-14** 脚本禁硬编码业务数据；路径、端口、URL、阈值一律读配置。
- **G-15** 一仓一份脚本目录；模块登记；中控统一派发；禁一次性脚本。
- **G-16** UI 文案短；禁长句、合并连词、分隔符、括号说明、说明性副标题。
- **G-17** UI 布局紧凑；禁大间隔、大空白、横竖颠倒；改动必须截图检查。
- **G-18** UI 区域用阴影或色差区分；禁线条分割、边框滥用、卡片套卡片、中控台风格。
- **G-19** 异步等待必须有界；Worker 终止后置空；高频 DOM 更新用 rAF 合帧。
- **G-20** 耗时操作有进度与结果；失败不静默、不整体中断。
- **G-21** 发版前测试全绿、零回归；未验证项不得写成已验证。
- **G-22** 改前读 spec；复杂功能先写设计再写代码。
- **G-23** 文档、注释、回复用中文；代码标识符与专有名词除外。
- **G-24** 工作流改动覆盖 skills、MCP、agent、配置文件与 TDD，并留验证证据。
- **G-25** 单一真源；禁散落规则与副本；规范入 spec，注入只留短摘要。
- **G-26** 任何完成声明必须有可复现证据；未验证项如实标注。
- **G-27** 多事项物理分行；禁连词、分隔符、括号合并；单项断言独立成行。
- **G-28** 对话正文不贴完整文件内容；落地文件，只给可点击路径。
- **G-29** opencode/workbuddy 会话必须用子代理多并行推进；禁止主代理单干。
- **G-30** 子代理必须使用免费模型；调用前实时查询注册表并确认 cost 输入输出均为 0；禁止误用付费模型。
- **G-31** 输出与工具调用禁止简写；禁止把用户简写直接当作具体模型、工具、仓库或路径名。

## 宿主 fork 红线

- **H-01** upstream 只读；改动只推 origin；拉取上游只用 ff-only。
- **H-02** 上游改动拆单一功能 PR；禁把不相关改动塞进同一个 PR。
- **H-03** 禁直接编辑上游快照；改动走公开函数、钩子或版本化 patch。
- **H-04** 原生 message.extra 与 chat.jsonl 是唯一数据源；禁私有数据库；写操作委托原生 API。
- **H-05** 权限最小化；禁顺手声明未使用的高危能力。
- **H-06** 端口与路径固定；占用即失败；禁静默回退到其他端口。
- **H-07** Dev 与 Real 只靠端口和路径区分；E2E 只对 Dev；启动即断言目标地址。
- **H-08** 端口段位：实例段独占；8000 禁用；3000 系统保留；周边工具 3010 起。
- **H-09** 交付前必须构建与测试；没有构建产物等于没有可运行实例。
- **H-10** 实例边界：运行时数据可写、宿主源码禁改、链接禁写穿；写入前备份。
- **H-11** 浏览器自动化分工：回归用 Playwright；一次性诊断用 chrome-devtools；依赖进项目。
- **H-12** 确定性判断用内容指纹；不用时间戳判断内容是否变化。

## 规范入口

- `.trellis/spec/tavern-host/index.md`

## 技能策略

- 允许 pack：dev, infra, upstream
- 禁止 pack：card

## 项目覆盖
（本仓自有内容，同步器保留；无则留空。）

<!-- TAVERN-RULES:END -->

# 仓库 Git 政策（用户指令，必须遵守）

**每次提交必须推送到远程，禁止只做本地提交。**

- 任何一批 `git commit` 完成后，必须立即执行 `git push origin <当前分支>`（首次推送到新分支用 `git push -u origin <分支>`）。
- 工作提交、归档提交、日志提交全部适用；「不推送」的例外仅当用户在同一轮明确说「先不要推」。
- 推送目标固定为 `origin`（jiozhaoyue fork），绝不推送到 `upstream`。
