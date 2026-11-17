---
title: "Learning Garden 使用指南：从新建笔记到知识图谱"
description: "从本地启动、新建 Markdown、组织专题与知识关联，到复习、问答、学习日历和 GitHub Pages 发布的完整操作指南。"
category: "guide"
tags: ["learning-garden", "workflow"]
published: "2026-11-16"
---

Learning Garden 是一个持续修改、复习和连接的知识库。本指南面向第一次使用本项目的人。除非另有说明，命令都在**仓库根目录**执行，也就是包含 `package.json` 的目录。功能说明以当前代码为准，示例文章只是操作演示，不是网站已经收录的内容。

## 快速开始

已安装 Node.js、Git，并进入项目目录后：
```bash
npm install
npm run garden -- new
npm run dev
```

按提示创建笔记，打开生成的 `src/content/notes/<slug>.md`，在第二条 `---` 后编写正文。浏览器访问终端打印的地址，通常是 `http://localhost:4321/learning-garden/zh/`。准备发布前另开终端执行：
```bash
npm run verify
```

这只检查本地内容，不会发布。新建或更新中文后，先按[双语文章流程](#如何管理中文与英文文章)同步英文，再运行发布检查；英文缺失或自动译文未同步会阻止构建。尚未下载项目，请先看[本地启动](#本地启动)；正式上线见[发布流程](#发布流程)。

## 阅读导航

本页使用手动目录与现有标题锚点。专题自动目录见“管理栏目、标签与专题”。

1. [Learning Garden 是什么](#learning-garden-是什么)
2. [本地启动](#本地启动)
3. [创建第一篇文章](#创建第一篇文章)
4. [如何管理中文与英文文章](#如何管理中文与英文文章)
5. [编写和编辑 Markdown](#编写和编辑-markdown)
6. [管理栏目、标签与专题](#管理栏目标签与专题)
7. [维护和使用知识图谱](#维护和使用知识图谱)
8. [记录复习](#记录复习)
9. [编辑文章与记录修订](#编辑文章与记录修订)
10. [提问与回复](#提问与回复)
11. [使用学习日历](#使用学习日历)
12. [发布流程](#发布流程)
13. [常见问题](#常见问题)
14. [隐私与安全](#隐私与安全)

## Learning Garden 是什么

这里的文章不必等到“彻底完成”才发布。可以先记录理解，通过复习发现遗漏，通过修订纠正解释，通过问答补充证据。专题组织阅读路径，正文链接保留知识之间的具体关系。

学习日历回答“哪些日子做过什么”；Graph View 回答“这些知识如何联系”。网站不会把浏览次数当作复习，也不会根据标题相似度推测知识引用。

这是静态站点：阅读发生在浏览器，内容维护发生在本地 Markdown、JSON 和 Git 中。目前没有后台 CMS、实时评论或自动复习排程。中文是主要内容来源，英文以同 ID 的独立 Markdown 维护；语言切换会显示对应版本，不会调用浏览器实时翻译。

## 本地启动

**目标：** 在自己的电脑上预览内容，并在发布前检查错误。

### 准备环境与获取仓库

需要 Git、Node.js **≥ 22.23.4** 和随 Node.js 安装的 npm。可以使用 Node.js 24，与当前部署工作流一致。先检查：
```bash
node --version
npm --version
git --version
```

尚未下载项目时执行：
```bash
git clone https://github.com/BoltzMamba/learning-garden.git
cd learning-garden
npm install
npm run dev
```

已有项目副本时不需要再次克隆。干净检出且希望严格按锁文件安装时，可以用 `npm ci` 替代 `npm install`。

**预期结果：** 终端打印 Local 地址。通常打开 `http://localhost:4321/learning-garden/zh/` 即可查看首页；端口被占用时以终端地址为准。保留运行中的终端，停止服务时按 `Ctrl+C`。Windows PowerShell 若阻止 `npm.ps1`，可把命令中的 `npm` 改成 `npm.cmd`，不必修改系统执行策略。

### 检查修改与生产预览

保存 Markdown 后查看浏览器。正文通常随开发服务更新；本项目聚合数据有进程缓存，新文章、专题、图谱或日历没有更新时，停止并重新运行 `npm run dev`，再刷新页面。

| 命令 | 用途与预期结果 |
| --- | --- |
| `npm test` | 执行现有单元测试和 CLI 集成测试 |
| `npm run check` | Astro / TypeScript 检查 |
| `npm run translate:check` | 查看英文缺失、同步状态和需要作者处理的问题，不执行翻译 |
| `npm run translate:check -- --strict` | 严格双语发布检查，阻塞状态返回非零退出码 |
| `npm run build` | 先严格检查双语内容，再生成静态站点到 `dist/` |
| `npm run check:links` | 检查已生成页面的内部链接及资源；先构建 |
| `npm run verify` | 依次执行测试、类型检查、构建和内部链接检查 |
| `npm run preview` | 预览最近一次 `dist/` 构建，以终端地址为准 |

开发预览读取本地内容；生产预览读取最近构建结果，改完源码需要重新构建。这些命令都不会更新 GitHub Pages。

## 创建第一篇文章

**目标：** 创建有稳定 ID、正确元数据和可访问页面的笔记。

### 方式 A：使用 CLI
```bash
npm run garden -- new
```

当前 CLI 已支持专题、顺序和手动关联。下面是完整填写示例，空白项直接回车：

| 提示 | 示例输入 | 含义 |
| --- | --- | --- |
| Title | `我的第一篇笔记` | 页面标题，可以用中文 |
| Slug | `my-first-note` | 稳定 ID；纯中文标题需要手动填写 |
| Section | `knowledge` | 对应 Frontmatter 的 `category` |
| Type (note \| overview) | `note` | 普通笔记，默认 `note` |
| Series overview id (optional) | 留空 | 加入专题时填已存在的综述 ID |
| Order within the series | 本例不出现 | 仅选择专题后询问，可填 `10`、`20` 等数字 |
| Tags | `learning-garden,workflow` | 逗号分隔，必须来自 Topic 词表 |
| Related note ids | `how-this-garden-works` | 可选，已有文章的 ID |
| One-line description | `记录第一次使用 Learning Garden 的过程。` | 摘要，CLI 要求 1–300 字符 |
| Published date | 回车采用当天日期 | 首次发布日期，以 Asia/Singapore 为准 |

也可以一次填写参数，省略日期时默认今天：
```bash
npm run garden -- new --title "我的第一篇笔记" --slug my-first-note --category knowledge --type note --tags "learning-garden,workflow" --related how-this-garden-works --description "记录第一次使用 Learning Garden 的过程。"
```

**预期结果：** 创建 `src/content/notes/my-first-note.md`。在文件的 `## 要点` 下写正文，重启预览后访问 `http://localhost:4321/learning-garden/zh/notes/my-first-note/`，或从笔记列表进入。

此命令只创建中文源文件。正式构建前还需要同名的 `src/content/notes-en/my-first-note.md`，完整流程见下一节。

**注意：** 交互式和参数式是替代方式，不要用同一 Slug 连续创建两次。重复 Slug 会被拒绝，不覆盖文件。CLI 已支持 `--type`、`--series`、`--order`、`--related`；正文和之后的元数据修改仍需编辑文件。

### 方式 B：手动创建 Markdown

在 `src/content/notes/` 直接新建 `my-first-note.md`：
```markdown
---
title: "我的第一篇笔记"
description: "记录第一次使用 Learning Garden 的过程。"
category: "knowledge"
tags: ["learning-garden", "workflow"]
published: "2026-11-17"
related: ["how-this-garden-works"]
---

## 要点

先写下自己的理解，再补充依据和例子。
```

请把日期替换为真实首次发布日期。加载器只读取该目录直接包含的 `*.md`，不读取子目录或 `.mdx`。文件名去掉 `.md` 就是文章 ID，不需要另加 `slug` 字段。文件名使用小写英文字母、数字和单个连字符，最长 80 字符，如 `dynamic-programming-intro`。

下表是中文源文件的字段，不要把整份 Frontmatter 复制到英文目录。

| 字段 | 是否必填 | 填写规则 |
| --- | --- | --- |
| `title` | 是 | 非空标题 |
| `description` | 是 | 非空摘要，建议一两句话 |
| `category` | 是 | `guide`、`practice`、`knowledge`、`projects` |
| `published` | 是 | 真实日历日期，建议写成带引号的 `YYYY-MM-DD` |
| `tags` | 否 | 字符串数组，默认 `[]`，由词表校验 |
| `contentType` | 否 | `note`（默认）或 `overview` |
| `series` | 否 | 已存在的 `overview` 文章 ID |
| `order` | 否 | 数字，控制专题内顺序；无 `series` 时不生效 |
| `related` | 否 | 已存在文章的 ID 数组，不能重复或指向自身 |

**发布后保持文件名稳定。** URL、复习、修订、问题和专题关系都依赖 ID。修改标题通常不影响 URL；重命名文件会改变 URL，项目不会自动为旧文章地址创建重定向。

`published` 显示首次发布日期，并产生一次发布活动，不是“最后更新日期”。CLI 拒绝未来日期，但手动填写未来日期不构成预约发布：当前没有草稿或定时发布机制，构建会读取全部有效文章。未准备公开的内容不要提交到公开仓库。

## 如何管理中文与英文文章

**目标：** 以中文积累知识，同时为英文读者提供完整、可维护的版本。英文可以由 Claude/Codex 辅助翻译，也可以由作者亲自撰写；网站展示保存在仓库中的内容，不使用浏览器实时翻译。

### 文件、元数据与工具分工

同一篇文章有两份文件、一个逻辑 ID：中文在 `src/content/notes/how-this-garden-works.md`，英文在 `src/content/notes-en/how-this-garden-works.md`。不要为英文添加 `-en` 后缀或另建中文目录里的“英文文章”。

中文是内容及知识结构的主要来源。英文文件只保存 `title`、`description`、正文和 `translation` 块；`category`、`tags`、`published`、`contentType`、`series`、`order`、`related` 从中文合并，放入英文 Frontmatter 会被判为非法。

| 工具 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| `garden` CLI | 创建中文笔记、登记复习和修订 | 不创建英文译文 |
| `translate:check` | 扫描文件、报告状态及原因 | 不调用 AI，不翻译或改写正文 |
| Claude/Codex Agent | 按仓库 `AGENTS.md` 阅读中文及关联文章，撰写英文候选稿 | 不编造 Hash，不覆盖 Manual 内容 |
| `translate apply/adopt/confirm` | 安装候选稿、接管人工修改或登记作者确认，维护元数据 | 不判断技术语义是否正确 |
| GitHub Actions | 严格检查并构建、部署已提交文件 | 不自动调用 Agent 补译缺失英文 |

`CLAUDE.md` 引用同一份 `AGENTS.md`，日常工作以其中的 “Translating notes” 及翻译规则为准。

### 新建一篇双语文章

延续前面的 `my-first-note` 示例，已创建中文文件时跳过第 1 步。以下命令均在仓库根目录执行。

1. 运行 `npm run garden -- new`，将 Slug 填为 `my-first-note`，完成中文元数据。
2. 编辑 `src/content/notes/my-first-note.md` 的正文。
3. 运行 `npm run dev`，在 `http://localhost:4321/learning-garden/zh/notes/my-first-note/` 预览中文。开发环境允许英文尚未完成并输出警告；缺英文时英文页会回退中文并标注，不能据此认定已翻译。
4. 另开终端运行 `npm run translate:check -- --note my-first-note`，新文章通常报告 `MISSING`。
5. 在能访问此仓库的 Claude/Codex 会话中发出下面的翻译请求。**这是给 Agent 的自然语言指令，不是终端命令。**

> 请遵循 AGENTS.md 的 Translating notes 规范，检查 my-first-note 的状态。仅在 MISSING 或 AUTO_STALE 时，阅读中文源文件及其关联文章，完整翻译标题、摘要与正文，将候选稿写入 .translations/my-first-note.md，再运行 npm run translate -- apply --note my-first-note。保留代码、公式、命令、路径与链接目标；调整英文标题的页内锚点。遇到人工版、AUTO_MODIFIED、INVALID 或 ORPHAN 时报告原因，不覆盖。完成后运行严格检查、构建和链接检查；不要提交、推送或部署。

6. 检查 `src/content/notes-en/my-first-note.md` 的英文表述、代码、数字、公式和链接。候选稿 `.translations/my-first-note.md` 的 Frontmatter 只能有 `title`、`description`，正文写英文；`apply` 会生成完整 `translation` 块，成功后默认删除候选稿，`--keep` 可保留它。
7. 刷新或重启开发服务，打开 `http://localhost:4321/learning-garden/en/notes/my-first-note/`，确认显示英文标题和正文。
8. 运行 `npm run translate:check -- --strict`，再运行 `npm run verify`。状态检查通过不证明译文语义正确，仍需要阅读核对。
9. 准备发布时运行 `git add src/content/notes/my-first-note.md src/content/notes-en/my-first-note.md`，检查 `git diff --cached`，再按发布章节提交。不要提交被忽略的 `.translations/` 候选稿。

**预期结果：** 两种语言的文章路径末尾都是 `my-first-note/`，英文为 `AUTO_CURRENT`，没有新增第二篇逻辑文章。

### 查看翻译状态

查看全部文章用 `npm run translate:check`；单篇用 `npm run translate:check -- --note how-this-garden-works`；机器可读输出用 `npm run translate:check -- --json`。发布前用 `npm run translate:check -- --strict`，普通检查即使列出阻塞项也不以严格失败退出。

实际状态名比 Missing / Current / Stale / Modified 更具体：

| CLI 状态 | 含义 | 处理方式与发布影响 |
| --- | --- | --- |
| `MISSING` | 有中文，没有同 ID 英文 | Agent 生成候选稿并 `apply`；阻止发布 |
| `AUTO_CURRENT` | 自动版内容、中文 Hash 和规则版本一致 | 读者仍需核对翻译质量；可发布 |
| `AUTO_STALE` | 中文文本或翻译规则版本改变 | 更新候选稿并 `apply`；阻止发布 |
| `AUTO_MODIFIED` | 英文文本与生成时 Hash 不同 | 作者选择保留人工修改或丢弃重译；阻止发布 |
| `MANUAL_CURRENT` | 人工版已登记匹配当前中文 | 不自动覆盖；可发布 |
| `MANUAL_STALE` | 中文变化后，人工版尚未重新确认 | 作者核对后 `confirm`；只警告，不阻止发布 |
| `INVALID` | 文件或元数据非法，或内容保留／链接检查不通过 | 按具体原因修复；阻止发布 |
| `ORPHAN` | 英文没有对应中文源文件 | 作者核对 ID、恢复来源或处理多余文件；阻止发布 |

例如，新建但还没翻译时可能看到 `✗ MISSING        my-first-note`，摘要为 `1 note(s): MISSING 1`；安装成功后为 `✓ AUTO_CURRENT   my-first-note`。这些是流程示例输出，不是对当前仓库状态的断言。

检查按优先级分类，不保证改中文后总是 `AUTO_STALE`：例如新增代码块、公式或文章链接后，旧自动版因保留内容不一致可能先成为 `INVALID`。此时 Agent 应报告，不能自行加覆盖参数。

### 更新中文或英文后如何处理

| 改动 | 下一步 |
| --- | --- |
| 中文 `title`、`description` 或正文改变 | 检查状态；Auto 通常需要重译，Manual 由作者核对。包括只改措辞的情况 |
| 仅中文分类、Tag、专题、顺序、`related` 或发布日期改变 | 不影响源文本 Hash，通常重建即可；仍要通过结构校验，发布日期不应随意改动 |
| 英文 Auto 的标题、摘要或正文被修改 | 通常成为 `AUTO_MODIFIED`，先保护修改并由作者决定归属 |
| 英文 Manual 被人工修改 | 不与生成 Hash 比较，仍需校验链接、内容及事实；必要时核对中文后 `confirm` |

Hash 对换行格式、Unicode 和部分首尾空白做标准化，所以这些等价格式变化不一定产生过期或修改状态。英文 Manual 的 `CURRENT` 只表示源 Hash 已确认，不代表每次后续人工编辑都被自动审阅。

对于未编辑过的 Auto，如果作者检查确认中文改动完全不影响现有英文，也可用 `npm run translate -- confirm --note how-this-garden-works` 登记确认，而不是盲目重译；**不能用它掩盖未翻译的内容变化**。它不会更新正文，不接受 `AUTO_MODIFIED`、`MISSING` 或 `INVALID`。

### Auto 与 Manual：Hash 和内容保护

`translation.mode: auto` 表示由 Agent 维护的译文，不表示网站后台持续运行翻译。`sourceHash` 对应中文标题、摘要和正文；`generatedHash` 对应生成时的英文标题、摘要和正文；`rulesVersion` 对应当前翻译规范版本。全部由工具计算，不能手填或让模型编造。

`translation.mode: manual` 表示作者负责的英文版本，可亲自撰写、从自动版润色，或在审核后接管。`apply` 拒绝覆盖任何 Manual 文件，Agent 也必须保持其字节不变。

**安全接管 Auto：** 作者运行 `npm run translate -- adopt --note how-this-garden-works`，再编辑英文；若已经编辑 Auto，也可用同一命令保留修改。`adopt` 改为 Manual，删除 `generatedHash` 与 `rulesVersion`，保留正文和原 `sourceHash`。因此中文已变化时仍可能显示 `MANUAL_STALE`，并不意味着已经确认同步。作者核对或修订英文后再运行 `npm run translate -- confirm --note how-this-garden-works`；该命令更新源 Hash，不改英文正文。

**丢弃修改重译：** 先让 Agent 准备并审阅候选稿，保留需要的人工文字后，只有作者决定丢弃修改时才运行 `npm run translate -- apply --note how-this-garden-works --discard-edits`。无效英文文件同样可能包含人工内容，只有作者允许替换时才使用 `--replace-invalid`。默认 `apply` 会拒绝这些情况，候选稿验证失败则回滚目标文件并保留候选稿。

这两个覆盖参数都不能绕过 Manual 保护。要把 Manual 交回 Auto，作者必须先备份并明确解除保护；一个可审阅的做法是作者将英文文件移到内容目录外的备份位置，使同 ID 状态变为 `MISSING`，再审核候选稿并 `apply`。在重新生成、严格检查完成前不能发布。不要仅改 `mode`：Auto 还需要工具生成的合法 Hash 与规则版本。

### 从零编写人工英文版

当前没有单独的 `new-manual` 命令。无需手写 Hash 的办法是：作者先把自己的完整英文稿放到 `.translations/my-first-note.md`（只含标题、摘要和英文正文），对缺失英文或可更新的 Auto 运行 `npm run translate -- apply --note my-first-note`，确认通过后立即运行 `npm run translate -- adopt --note my-first-note`。这只是借用工具建立元数据，英文文本可以完全由作者写。

由于首次安装仍走 Auto 校验，该候选稿要先保留代码块、公式、图片和文章链接；转为 Manual 后作者可以调整结构和表达重点。Manual 缺少部分保留内容通常只警告，但非法元数据和无效链接仍会阻止发布。作者完成事实核对后用 `confirm` 登记当前中文版本。

项目介绍可以采用适合英文招聘阅读的“问题、个人职责、技术方案、结果与影响”表达，但技术结论、实验数字、职责及个人贡献必须准确，不得新增未验证成果。后续批量翻译不会覆盖 Manual；需要更新时由作者负责，不能等待自动刷新。

### 为什么英文会阻止构建

`npm run build` 先执行严格检查，内容加载阶段也验证双语状态。`MISSING`、`AUTO_STALE`、`AUTO_MODIFIED`、`INVALID`、`ORPHAN` 阻止正式构建；`MANUAL_STALE` 只警告。设计目的在于避免发布缺失、过期或有未确认人工修改的自动版，同时保留作者维护 Manual 的权利。

排查顺序：运行 `npm run translate:check -- --strict` → 阅读每篇文章的状态和原因 → 补译或按作者决定处理保护状态 → 再次严格检查 → `npm run build` → `npm run check:links`。不要编辑 Hash 来消除错误。格式损坏的文件也可能无法在开发环境渲染，开发宽松并不是忽略所有非法数据。

### 专题、知识图谱与学习日历

两种语言共用 Slug、专题、Tag 和知识关系。`series`、`related`、Tag 只在中文源文件管理；英文专题目录使用成员的英文标题，英文图谱的文章节点使用英文标题、Topic 使用词表的英文名。英文新增的正文引用不会单独生成关系，图谱以中文源文件为准，检查器会对额外引用给出提示。

新建英文文件不需要添加 Graph 节点，也不会增加站内日历的第二次发布记录；日期与活动都依赖同一个中文源 ID。当前问题文件没有独立英文集合，所以问题节点标题仍可能是中文。

### 语言切换与对应 URL

首次访问根路径 `/learning-garden/` 默认进入英文，不读取浏览器语言。点击页头 `中` 或 `EN` 会保存 `lg-lang` 偏好，之后从根路径进入时优先采用该偏好；直接访问语言路径不会改写偏好。

本指南对应地址是 `https://boltzmamba.github.io/learning-garden/zh/notes/how-this-garden-works/` 和 `https://boltzmamba.github.io/learning-garden/en/notes/how-this-garden-works/`。点击语言切换保留相同文章路径，分别显示两份正文。也可直接访问 `/learning-garden/zh/` 或 `/learning-garden/en/`；当前部署路径需包含 `/learning-garden/`。

### 英文文章常见问题

| 问题 | 排查与处理 |
| --- | --- |
| 英文文章没有出现 | 检查 `notes-en` 目录、同名 `.md` 和状态；CLI 新建中文不会生成英文。处理后重启服务，线上还需提交两份文件并部署 |
| 英文仍显示旧内容 | 运行单篇状态检查；检查是否 Stale、候选稿是否已 `apply`、是否重建及部署，不只刷新页面 |
| 严格构建失败 | 阅读具体阻塞状态；缺失先补译，Modified 由作者选择保留或重译，Invalid 按原因修复；不能跳过门禁 |
| 修改中文为什么要重新翻译 | 标题、摘要或正文的源 Hash 改变；需确认英文仍准确。只改结构字段通常无需翻译 |
| 人工版为什么不自动更新 | Manual 受保护，需作者编辑并核对后 `confirm`；Agent 不覆盖 |
| 改英文后为什么 Modified | Auto 英文文本与 `generatedHash` 不一致；保留修改用 `adopt`，不是重写 Hash |
| 怎样避免覆盖人工文章 | 作者接管时使用 `adopt`，检查 mode 为 Manual；批量任务只处理 Missing 和 Auto Stale，不授权静默覆盖 |
| 分类、Tag 或专题改变为何无需重译 | 结构字段不在源 Hash 中，页面从中文合并，重建即可；正文也改了则另需同步 |
| 日历为何只计算一次 | 两个文件共享一个逻辑 ID 和中文发布日期，翻译不是新的站内发布事件 |
| 英文图谱仍显示中文标题 | 区分文章、Topic 和问题；文章检查英文标题及是否开发回退，Topic 检查词表 `en`，问题目前共享原文；重启或重建 |
| 如何检查英文内部链接 | 优先 `[[id]]` 或 `../id/`，英文页内锚点对应英文标题；构建后运行 `check:links`，并实际点开带片段的相对跨页链接，不能只依赖自动检查 |

## 编写和编辑 Markdown

**目标：** 区分元数据与正文，写出能正确呈现的文章。

开头两条 `---` 之间是 YAML Frontmatter；第二条之后是正文。页面已用 `title` 生成 H1，正文建议从 `##` 开始，用 `###` 表示下一层。

### 常用语法
```markdown
## 核心结论

这是普通文本，**这是重点**，*这是强调*，`npm run dev` 是行内代码。

### 操作步骤

1. 先记录问题。
2. 再补充证据。

- 已理解的部分
- 仍需验证的部分

> 引用或提醒可以放在这里。

| 项目 | 说明 |
| --- | --- |
| 输入 | 问题与上下文 |
| 输出 | 结论与依据 |
```

代码块用三条反引号围起来，开头注明语言，如 `bash`、`ts`、`python`、`json`、`yaml`。例如先写一行三个反引号加 `ts`，下一行放以下代码，最后用独占一行的三个反引号结束：
```ts
const steps = ["阅读", "解释", "验证"];
console.log(steps.join(" → "));
```

项目已配置 Shiki 代码高亮、数学公式和 Wiki Link 插件；不要假设其他笔记软件的任意扩展语法也能使用。

### 数学公式

行内公式放在一对 `$` 中，独立公式放在两行 `$$` 之间，用 KaTeX 渲染：
```markdown
完成比例为 $p = k/n$。

$$
p = \frac{k}{n}
$$
```

实际效果：完成比例为 $p = k/n$。

$$
p = \frac{k}{n}
$$

这只是排版示例，不是网站自动计算的指标。

### 链接与图片
```markdown
[项目仓库](https://github.com/BoltzMamba/learning-garden)
[使用指南](../how-this-garden-works/)
[[how-this-garden-works|使用指南]]
![Learning Garden 图标](/learning-garden/favicon.svg)
```

外部链接写完整 URL。内部文章链接推荐 `../文章ID/`，可保留当前语言。不要直接链接 `other-note.md`：虽然图谱解析器能识别文件形式，浏览器不会因此得到静态文章页面，链接检查会失败。

英文正文也使用 ID 形式的 Wiki Link 或相对文章链接，避免硬编码中文文章 URL。翻译页内目录时，锚点需对应英文标题；代码块里的中文教学示例保持原样，实际英文正文链接须检查目标标题。

图片可放入 `public/images/`，例如 `public/images/agent-loop.png`，正文写 `![循环示意图](/learning-garden/images/agent-loop.png)`。URL 不含 `public`，但必须包含部署基路径 `/learning-garden/`。上面的 `favicon.svg` 是已有资源；自己的图片需要先放入目录。检查大小写，Windows 能打开的错误大小写路径可能在部署时失败。

### 编辑已有文章

1. 从文章 URL 最后一段取得 ID，如本页为 `how-this-garden-works`；也可点击文章下方的源码链接。
2. 打开对应的 `src/content/notes/<id>.md`，修改正文或元数据，保留文件名和首次发布日期。
3. 启动预览，检查标题、表格、代码、公式、图片与链接。
4. 中文标题、摘要或正文变化后检查并同步英文；仅结构字段变化通常只需重建。聚合信息未变化时重启服务，发布前执行 `npm run verify`。

## 管理栏目、标签与专题

**目标：** 分别表达文章所在栏目、涉及主题和建议阅读顺序。

### Category：四个栏目已经可用

| `category` 值 | 栏目 | 适合内容 |
| --- | --- | --- |
| `guide` | Garden Guide / 花园指南 | 使用、写作和维护方法 |
| `practice` | Practice / 刷题练习 | 题解、练习和解题复盘 |
| `knowledge` | Knowledge / 基础知识 | 概念、原理和技术笔记 |
| `projects` | Projects / 项目档案 | 项目过程、设计与结果 |

这四个栏目均已实现，不是待办规划。修改 `category` 后重建，文章进入对应栏目；`projects` 内容还会出现在导航的项目页面。旧值 `meta`、`algorithms`、`ai-agents`、`software-engineering` 仍兼容映射，新文章优先使用上表四个值。

### Topic / Tag：受控主题词表

`tags` 描述文章涉及的多个主题。Topic 是词表中的规范主题，Tag 是给文章赋予主题的方式。先查看可用值：
```bash
npm run garden -- topics
```

`tags: ["ai-agent", "llm"]` 会解析为 AI Agent 和大语言模型；`llm` 是别名，不会另外生成重复 Topic。

需要新主题时，在 `src/data/topics.json` 的最外层对象中添加一项，例如：
```json
"retrieval-augmented-generation": {
  "zh": "检索增强生成",
  "en": "Retrieval-Augmented Generation",
  "parent": "large-language-models",
  "aliases": ["rag"]
}
```

这是词表条目，不是覆盖整个文件的内容；与其他条目间需要逗号。`zh`、`en` 必填，`parent` 和 `aliases` 可选。父主题必须存在，层级最多三层，不允许循环或有歧义的别名。之后把 ID 或别名填入文章 `tags`，再检查构建。

点击文章标签进入笔记列表筛选；也可在列表点击标签按钮，再次点击或用清除按钮取消。当前筛选只匹配文章直接标注的规范 Topic；父主题不会自动包含只标注子主题的文章。

### Series：专题综述和自动目录

综述也是文章，区别是 `contentType: "overview"`。下面命令用于演示，实践时确认对应 ID 尚未存在：
```bash
npm run garden -- new --type overview --title "AI Agent 专题" --slug ai-agents-overview --category knowledge --tags ai-agent --description "AI Agent 的阅读路径与知识地图。"
npm run garden -- new --title "Agent Loop" --slug agent-loop --category knowledge --series ai-agents-overview --order 10 --tags ai-agent --description "理解智能体的观察、行动和停止条件。"
```

**预期结果：** 综述页自动列出 `series` 指向它的文章，成员页显示所属专题、阅读位置和相邻文章的上一篇／下一篇链接。Overview 正文可写导读，也可留空，不必手工维护目录。

已有文章加入或转移专题，编辑其 Frontmatter：
```yaml
series: "ai-agents-overview"
order: 20
```

前提是已存在 `ai-agents-overview.md`，且类型为 `overview`。排序先按 `order` 升序，未填写者放后面；相同顺序或都未填写时，按发布日期从早到晚，再按 ID 排序。用 `10`、`20`、`30` 可留出插入位置。移出专题时一起删除 `series` 和 `order`。

重新构建后目录更新，开发中仍显示旧目录则重启服务。每篇文章最多属于一个专题，不支持嵌套；Overview 不能再设置 `series`。专题目录是**成员文章列表**，不是正文标题的自动 TOC。本指南的页内目录为手动维护。

`series`、`order` 只在中文源文件维护；两种语言共用成员与顺序，英文目录使用英文标题。新建 Overview 和成员也都需要英文版才能正式构建。

## 维护和使用知识图谱

**目标：** 让知识关联有明确依据，并在全局和局部视图中查阅。

### 节点、边与两种模式

每个逻辑文章 ID 对应一个节点，中英文不会各建一个。Overview 是带环的文章节点；公开问题对应问题节点；被使用的 Topic 及其祖先主题对应主题节点。文章关系取自中文源文件，英文图谱替换文章与 Topic 显示名称。边来自明确关系，在构建时生成：

| 数据来源 | 关系 | 展示模式 |
| --- | --- | --- |
| 正文链接或 Wiki Link | 文章 A 引用 B，`links_to`，有方向 | Article Graph |
| `related` | 作者确认的关联，`related_to`，无方向 | Article Graph |
| `series` | 文章属于专题，`belongs_to` | 两种模式 |
| 问题的 `note` | 公开问题关联文章，`asks_about` | Article Graph |
| 文章的 `tags` | 文章标注主题，`tagged_with` | Topic Graph |
| 词表的 `parent` | 主题父子关系，`parent_of` | Topic Graph |

全局图谱已经实现 **Article Graph / Topic Graph 双模式**，不只是 Tag 显示开关。前者展示引用与人工关联，后者展示主题归属与层级。

两篇文章有相同标签，只会分别连接同一个 Topic，不会自动形成直接引用。专题目录也不会被误当作正文引用。同一对节点有多种关系时，画布可能合成一条线，下方列表可以分辨关系与方向。

### 正文引用与手动关联

在其他文章正文中可写：
```markdown
操作流程参考[使用指南](../how-this-garden-works/)。
也可以写 [[how-this-garden-works|Learning Garden 使用指南]]。
跳到小节：[[how-this-garden-works#记录复习]]。
```

Wiki Link 支持 `[[slug]]`、`[[slug|显示文字]]`、`[[slug#标题]]`，也能按文章标题解析。优先使用稳定 Slug，避免改标题或重名导致歧义。目标文章必须存在，标题片段也应检查；找不到的 Wiki Link 会警告并显示为不可点击文本，不一定使构建失败。

没有合适正文引用位置，但确认两篇文章相关时，可在其中一篇 Frontmatter 写：
```yaml
related: ["how-this-garden-works"]
```

无方向关联只需一侧声明，双方都会显示；不要在本指南自身添加这个自引用。目标不存在、重复或指向自身会使构建失败。

文章下方知识关联区域展示局部图谱及列表：**Outlinks** 是本文正文引用的文章，**Backlinks** 是正文引用本文的文章，**Related** 是人工关联。专题与标签不是 Backlinks。代码块、行内代码中的示例链接不应产生知识关联，自引用也不会产生边。

### 小例子：Agent Loop 连接 ReAct

这只是演示，不要求为阅读指南创建测试文章。若上一节已创建 `agent-loop`，跳过第一条：
```bash
npm run garden -- new --title "Agent Loop" --slug agent-loop --category knowledge --tags ai-agent --description "智能体循环的基本结构。"
npm run garden -- new --title "ReAct" --slug react --category knowledge --tags "ai-agent,react-paradigm" --description "推理与行动如何交替。"
```

在 `src/content/notes/agent-loop.md` 正文加入：
```markdown
## 推理与行动

循环中的推理与行动可以结合 [ReAct](../react/) 理解。
```

保存并完成这两篇文章的英文同步、重新构建后，Article Graph 出现 `Agent Loop → ReAct` 的引用关系；前者 Outlinks 包含后者，后者 Backlinks 包含前者。Topic Graph 中两篇文章分别连接 `ai-agent`，ReAct 还连接 `react-paradigm`。只添加相同标签而不写正文链接，不会在 Article Graph 产生引用边。

### 实际操作

从导航或首页图谱入口打开[全局知识图谱](../../graph/)。

| 操作 | 方法与结果 |
| --- | --- |
| 切换模式 | 顶部选 Article Graph 或 Topic Graph，节点、边、图例和列表一起变化 |
| 找到节点 | 输入标题或主题显示名并搜索，定位并高亮匹配节点；只搜索当前模式 |
| 查看邻居 | 鼠标悬停节点，高亮直接邻居和连边；搜索定位可保留高亮 |
| 移动节点 | 按住节点拖动，松开后恢复布局，不永久保存位置 |
| 平移 | 拖动画布空白区域 |
| 缩放 | 全局图谱滚轮缩放，或点击 `+`、`−` |
| 跳转 | 单击文章节点打开文章，Topic 打开标签筛选，问题跳到公开问答 |
| 重置 | 全局工具栏重置按钮重新适配视野，清除定位高亮 |
| 查看关系明细 | 展开下方列表，按关系阅读，也适合键盘操作 |

手机可点按跳转、单指拖动节点或空白区域、双指缩放；全局图谱操作最完整。首页和文章内嵌入图谱优先保留页面纵向滚动，手势可能受页面滚动影响，可进入全局页使用按钮和列表。

文章下方的局部图谱只展示当前文章在 Article Graph 的一跳关系，包括引用、人工关联、专题归属和问题，不包含 Topic 模式，也没有完整工具栏。桌面嵌入图谱按住 `Ctrl` 或 `⌘` 再滚轮缩放，普通滚轮用于翻页。

**注意：** 孤立文章仍出现在全局图谱；首页仅预览最多 24 个有连接的节点。局部图谱只有当前文章时显示空状态。改完链接后重启开发服务或重新构建；线上还需提交并完成部署。

## 记录复习

**目标：** 保存一次有意识的回顾、解释或练习，不统计页面访问。
```bash
npm run garden -- list
npm run garden -- review
```

CLI 列出文章，输入编号或 Slug，再填日期、Mastery 和 Reflection。日期默认 Asia/Singapore 的今天；补记用 `--date YYYY-MM-DD`，不能填未来日期。日期早于文章发布日会提醒。

| Mastery | 含义 |
| --- | --- |
| 1 | 几乎忘了，需要重学 |
| 2 | 有印象，但离不开笔记 |
| 3 | 能复述核心要点 |
| 4 | 能独立应用到问题中 |
| 5 | 能讲给别人听并回答追问 |

Reflection 记录掌握了什么、还卡在哪里、下一步怎样验证，CLI 要求非空且不超过 500 字符。例如：
```bash
npm run garden -- review --note how-this-garden-works --date 2026-11-17 --mastery 3 --reflection "能说明专题与标签的区别，下次练习处理一个公开问答。"
```

**预期结果：** 保存到 `src/data/reviews.json`。同一文章同一天再次执行会**替换当天的 Mastery 和 Reflection**，不增加次数。重建后文章显示累计次数和最近复习日期，日历在该日计一次复习。

**注意：** 只在实际完成复习后执行，使用真实日期。打开文章阅读不等于完成一次有效复习。网站没有自动复习排程，文章页不展示评分和反思全文，但这些字段在公开仓库仍可见。

## 编辑文章与记录修订

**目标：** 保留有意义的知识变化。

错别字、排版、措辞可直接修改 Markdown，不必每次添加 Revision。纠正技术错误、补充重要实验结论、改变原有解释才适合记录修订。先编辑并检查文章，再运行：
```bash
npm run garden -- revise
```

选择文章编号或 ID，填写日期和变化摘要；也可使用参数：
```bash
npm run garden -- revise --note how-this-garden-works --date 2026-11-17 --summary "补充本地维护、专题、知识图谱、问答及发布操作，校正日历统计说明。"
```

**预期结果：** 保存到 `src/data/revisions.json`，ID 为 `<note>--<date>--<n>`。文章下方显示修订日期和摘要，日历按每个修订 ID 计一次；GitHub 文件历史保留实际文本差异。

**注意：** `revise` 只登记记录，不修改正文、不提交 Git。摘要必填且不超过 300 字符。与复习不同，同日重复执行会增加记录，不要为同一次变化重复登记；误录时核对后编辑 JSON 修正。保留 `published` 原值。

## 提问与回复

**目标：** 把讨论整理成经过审阅、可长期引用的公开问答。

### 访客：提交问题或修改建议

1. 点击文章底部提问入口，或从[公开问答](../../questions/)进入提问。
2. 登录 GitHub 账号。文章入口预填相关笔记 ID 和标题前缀，请检查。
3. 填写具体问题、卡住的段落、期待结果，补充尝试过程、例子或参考链接。
4. 提交后首先出现在仓库 Issues，通过 Issue 通知或订阅跟踪回复，不会立即出现在网站。

发现错误可在新建 Issue 时选择“Report a correction / 勘误”，填写笔记 ID、错误与建议依据。已有明确修改时可 Fork 仓库、在自己的分支编辑 Markdown，再提交 Pull Request，说明理由与验证结果。站主审阅并合并后才进入正式内容。

### 站主：整理为 Markdown 问答

到仓库 Issues 查看新问题，检查是否重复、是否相关、上下文是否充分、是否包含敏感信息；可先在 Issue 追问。决定收录后执行：
```bash
npm run garden -- question
```

依次填写 Question title、Question id、可选 Related note slug、问题描述和是否公开。描述必填且不超过 1000 字符。参数式示例：
```bash
npm run garden -- question --title "如何确认一次有效复习？" --slug effective-review --note how-this-garden-works --description "阅读之后应该做什么，才适合记录为复习？" --public true
```

**预期结果：** 生成 `src/content/questions/effective-review.md`，默认 `status: "open"`、创建日期为当天、正文为空、`sources: []`。`note` 填文章 ID，不填标题或 URL；不关联文章时省略。

CLI 只负责创建，没有回答编辑器、解决状态参数或 Sources 提示。回答完成后手动编辑，例如：
```markdown
---
title: "如何确认一次有效复习？"
note: "how-this-garden-works"
status: "resolved"
public: true
created: "2026-11-17"
resolvedOn: "2026-11-17"
description: "阅读之后应该做什么，才适合记录为复习？"
sources:
  - title: "Learning Garden 使用指南"
    url: "https://boltzmamba.github.io/learning-garden/zh/notes/how-this-garden-works/"
---

尝试不看原文复述要点，或完成一个练习，再记录掌握程度和仍有疑问的地方。
```

填写真实日期和核对过的答案。`resolved` 必须有 `resolvedOn`；`open` 必须删除 `resolvedOn`，否则构建失败。Sources 每项需要非空 `title` 和合法 URL，可补原 Issue 完整链接保留上下文。

检查、发布后，`public: true` 的文件出现在公开问答页，按 `open` / `resolved` 分组；有 `note` 时也出现在文章底部。公开且已解决的问题在 `resolvedOn` 产生一次解答活动。

### 后续更新与同步边界

补充已有答案直接编辑原问题文件，保留 ID、创建日期和真实解决日期，不重新运行 `question`。重新打开时改为 `open` 并删除 `resolvedOn`，对应解决活动也会从当前生成的日历消失；问答文件不是多次解决事件的历史日志。

**Issue 讨论、Markdown 问题记录、网站公开问答是三个环节。** 站主需手动整理回复，再检查、提交、部署。当前不自动抓取 Issue 评论或同步解决状态，关闭 Issue 不会更新网站，也没有实时评论框。

## 使用学习日历

**目标：** 回看真实活动，同时理解数字的来源。

### 方块与活动详情

[首页学习日历](../../#log)的一个方块代表一天，颜色越深表示当天合并活动量越高。当前颜色参考所选年份活跃日数量的第 90 百分位，参考值至少为 4，再划分四级；不是固定“1、2、3–4、5+”档位，不代表时长或掌握程度，不宜直接比较不同年份颜色。

悬停或键盘聚焦可查看站内活动、GitHub 贡献和合计。点击日期查看活动条目、文章或问题链接，以及 GitHub 当日活动入口。有多个可选年份时点击年份按钮切换；年份来自有活动的年份加当前年份。手机可横向滚动完整网格。

| 站内活动 | 日期来源 | 计数 |
| --- | --- | --- |
| 发布 | `published` | 每篇文章一次，包括 Overview |
| 复习 | `reviews.json` 的 `date` | 同一文章同一天一次 |
| 修订 | `revisions.json` 的 `date` | 每个修订 ID 一次 |
| 解答问题 | 公开且 `resolved` 问题的 `resolvedOn` | 每个问题一次 |

不同类型不互相去重：同日发布、复习并修订同一文章可以有三项活动。浏览、保存文件和普通编辑不会自动生成站内学习事件。日期使用 `YYYY-MM-DD`，今天按 Asia/Singapore 计算。

英文版与中文共用逻辑 ID 和 `published`，新增或更新英文不会增加第二次站内发布事件；GitHub 提交贡献仍按后文规则处理。

### GitHub Contributions 已接入

日历还读取 `src/data/github-activity.json` 快照，当前账号是 `BoltzMamba`。主要来源为 GitHub GraphQL 贡献日历，包含 GitHub 实际统计的提交、PR、Issue、评审等；API 不可用时尝试公开贡献页面。它不扫描本机所有 Git 仓库，也不保证每个 Commit 都计数。

合计为**站内事件数 + 去重后的 GitHub 贡献数**。同步脚本用 Git 历史尝试扣除本仓库中只修改文章、问题、复习和修订文件的提交，减少内容活动重复计数；GraphQL 模式扣除量不超过本仓库当日提交数或当日贡献总数。

去重有边界：按作者名或 GitHub noreply 邮箱识别账号，普通邮箱、混合修改源码与内容的提交不一定按内容提交扣除。历史不可用时 GraphQL 回退为扣除本站仓库提交，HTML 回退缺少精细数据，可能不去重。这是提交级规则，不是逐项语义匹配，也不会为缺失贡献补造活动。GitHub 日期沿用返回值，不按本地时间重新分桶。

### 更新与排查缺失

本地需要新快照时：
```bash
npm run github:sync
npm run build
npm run github:check
```

同步访问网络，凭据依次来自 `CONTRIBUTIONS_TOKEN`、`GITHUB_TOKEN`、`GH_TOKEN`，再尝试本机 GitHub CLI 登录状态，无凭据则尝试公开页面。Token 只放环境或 GitHub Secrets，不能写入文章或源码。快照已被 Git 忽略，无需提交；`npm run build` 本身不执行同步。

同步失败保留上次可用快照并记录失败状态；没有有效快照时只显示站内活动。页面提示截止日期或不可用，超过截止日期不能理解为“零贡献”。要求失败返回非零退出码时用 `npm run github:sync -- --strict`。`github:check` 对照快照与中英文构建页面的贡献数、年份和日历方块，因此应先构建；它不负责下载数据。

线上工作流在构建前同步，另配置每日 **00:15（Asia/Singapore）** 定时重建，也可在 Actions 手动运行；不应把定时任务当作准点保证。刷新浏览器不会触发同步或重建。

“今天写了代码，为什么没显示？”先区分 GitHub 未计数与本站快照未更新：

- 只有本地提交、尚未推送的代码不会进入 GitHub 日历。
- 作者邮箱需关联正确账号，其他账号的贡献不会自动归给当前账号。分支、仓库及处理延迟也影响显示，符合条件的提交仍可能等待最多 24 小时。见 [GitHub 缺失贡献排查](https://docs.github.com/en/account-and-profile/how-tos/contribution-settings/troubleshooting-missing-contributions)。
- 公司其他代码平台不会自动进入这个账号的 GitHub 日历；GitHub Enterprise Server 需满足企业统一贡献配置等条件才可能共享计数。见 [GitHub 个人贡献说明](https://docs.github.com/en/account-and-profile/how-tos/contribution-settings/viewing-contributions-on-your-profile)。
- 私有贡献可见性取决于账号设置、凭据身份及 GitHub 返回结果；本站不读取并公开私有代码详情。
- GitHub 已有而本站没有时，核对同步状态、去重模式与 Actions 构建时间，再同步、重新构建。

## 发布流程

**目标：** 发布已验证的内容并确认线上结果。

以下操作由维护者准备上线时自行执行。**推送到当前仓库 `main` 会触发自动部署，推送前完成检查。** 本地开发、构建和提交本身不会发布。

### 检查并提交
```bash
git status --short
git diff
npm run translate:check -- --strict
npm run verify
npm run preview
```

先处理翻译检查的阻塞项，再运行 `verify`；不能写完中文直接推送并期待 Actions 生成英文。生产预览检查两种语言的文章、栏目、标签、专题、图谱、问答和日历，结束后停止预览。确认范围正确后暂存具体文件，例如更新本指南中英文：
```bash
git add src/content/notes/how-this-garden-works.md src/content/notes-en/how-this-garden-works.md
git diff --cached
git commit -m "docs: expand Learning Garden usage guide"
```

新建文章或图片时替换成实际路径，包含必要的词表、问题及记录文件；实际登记了修订时再暂存 `src/data/revisions.json`。不要提交 `.translations/` 候选稿、`dist/`、本地工具产物或凭据。再检查：
```bash
git branch --show-current
git remote -v
```

确认当前就是要发布的 `main`，远程仓库正确后，再执行：
```bash
git push origin main
```

若在功能分支，推送该分支并提交 PR，审阅后合并到 `main`。无写权限的访客使用 Fork / PR。不要把 `git push origin main` 当成发布任意当前分支的命令。

### 查看 Actions 和线上结果

打开 [GitHub Actions](https://github.com/BoltzMamba/learning-garden/actions)，进入对应提交的 **Test and deploy to GitHub Pages**：

1. 安装依赖、同步 GitHub 贡献，再执行测试、类型检查、严格英文检查、构建和内部链接检查。Actions 不调用 Agent 翻译；双语检查失败时不上传或部署，线上保留之前版本。
2. PR 只检查不部署；`main` 推送、手动或定时运行满足条件时上传并部署 Pages。
3. 检查 `build` 与 `deploy`，失败时展开最先失败的步骤，查看具体文件和错误。首次配置在 Settings → Pages 选择 GitHub Actions 为来源。
4. 成功后访问[正式网站](https://boltzmamba.github.io/learning-garden/zh/)，从列表打开文章，核对正文与相关记录，也检查英文路径的同一文章。

线上未更新时依次确认文件已提交、推送到正确仓库和分支、Actions 对应正确提交、部署成功、URL 正确，最后强制刷新。不要反复改发布日期来制造活动。

## 常见问题

| 现象 | 排查方法 |
| --- | --- |
| 新文章未出现 | 文件必须直接在 `src/content/notes/` 且为 `.md`；检查 Frontmatter，重启服务；线上查提交和部署 |
| Slug 已存在 | 用 `npm run garden -- list` 找已有文章；编辑它或选新 ID，不覆盖 |
| 改文件名后失效 | 优先恢复已发布文件名；确需迁移需同步正文链接、`series`、`related`、问题 `note`、复习和修订引用；旧 URL 不自动重定向 |
| 图片不显示 | 检查 `public/` 中资源是否存在、大小写是否正确；URL 带 `/learning-garden/`，不带 `public` |
| 内部链接检查失败 | 用 `../slug/` 而非源码 `.md`；绝对路径带基路径与语言；先构建再查链接 |
| Wiki Link 变灰但构建成功 | 检查 `[wikilinks]` / `[graph]` 警告，核对目标 ID，不把警告当成成功解析 |
| 图谱没有关联 | 确认链接在正文而非代码块，目标存在且非自引用，当前为 Article Graph；重启或重建 |
| 相同标签没产生连线 | 这是预期行为；Topic Graph 看共同主题，真正引用写正文链接或确认后的 `related` |
| 首页图谱找不到文章 | 首页只预览有限数量的连接节点，去全局图谱搜索 |
| 专题目录未更新 | `series` 必须指向类型为 `overview` 的 ID，`order` 为数字；重启或重建 |
| 新标签导致失败 | 先在词表添加主题或别名，检查未知父主题、冲突、循环和深度上限 |
| 父 Topic 筛选结果为空 | 当前只匹配直接标签，不自动包含子主题；选择实际标注的主题 |
| 日历没有新活动 | 浏览和普通保存不生成事件；核对真实发布日期、复习、修订、公开问答解决日期及所选年份，再重建 |
| GitHub 数量不符 | 对照账号日历，检查快照截止日期、凭据、私有贡献设置和去重模式，运行 `github:check`；本站合计不等于 GitHub 原始数 |
| 提问后未出现在网站 | Issue 不自动同步，需站主创建 Markdown、设置 `public: true` 并发布 |
| 问题状态构建失败 | `resolved` 必须有 `resolvedOn`，`open` 不得带该字段；检查关联文章存在 |
| 英文页面仍是中文正文 | 开发时缺失英文可回退中文；检查同 ID 英文文件和翻译状态，处理后重启。正式构建不会允许缺失英文 |
| `npm run build` 失败 | 从第一处错误查必填字段、日期、引用、重复记录、词表；确认 Node.js 版本和依赖 |
| 本地成功但 Actions 失败 | 查失败步骤、漏提交文件、大小写、锁文件及本地与 CI 环境差异；部署失败再查 Pages 来源及权限 |

尚未支持正文自动 TOC、嵌套或多重专题、实时评论与 Issue 自动同步、在线编辑、草稿定时发布和间隔复习调度。问答仍使用共享文件，没有笔记这样的独立英文版流程。不要添加不存在的字段并假设功能会生效。

## 隐私与安全

本仓库公开，Markdown、JSON、图片及 Git 历史都可能被他人读取。`public: false` 只隐藏生成网站中的问题，**不让文件在公开仓库中保密**。

- 不要提交 API Key、Token、密码或访问凭据，包括文章中的代码示例。同步用 Token 放环境变量或 GitHub Actions Secrets。
- `reviews.json` 的 Mastery、Reflection 和 `revisions.json` 的摘要会在仓库中公开，即使网页不展示全文。
- 不上传公司内部代码、敏感数据、未获授权的项目材料；引用与图片也应确认可公开使用。
- 私人笔记放在独立且适当保护的地方，不依赖显示字段隐藏。误提交凭据后应立即撤销或轮换，仅删除当前文件不能清除已经公开的历史。
