---
title: "Learning Garden Guide: From a New Note to the Knowledge Graph"
description: "A complete walkthrough: running the site locally, writing Markdown notes, organising series and connections, then reviews, questions, the learning calendar and publishing to GitHub Pages."
translation:
  mode: auto
  sourceHash: "sha256:e16167def709daec06a417414ca1bf9e4f28f6ac2e620a1383765faee20d1971"
  generatedHash: "sha256:4178087c6b591048d1f260b6a358b32e089dbd0f6b25707584858d08e91f1040"
  rulesVersion: 1
---

Learning Garden is a knowledge base that keeps being revised, reviewed and connected. This guide is for people using the project for the first time. Unless stated otherwise, run commands from the **repository root**, the directory that contains `package.json`. Feature descriptions follow the current code. The example notes only demonstrate the workflow; they are not content published on the site.

## Quick start

With Node.js and Git installed, from the project directory:
```bash
npm install
npm run garden -- new
npm run dev
```

Follow the prompts to create a note, open the generated `src/content/notes/<slug>.md`, and write the body after the second `---`. Open the address the terminal prints in your browser, usually `http://localhost:4321/learning-garden/zh/`. Before publishing, run this in another terminal:
```bash
npm run verify
```

This only checks local content; it does not publish anything. After creating or updating Chinese content, follow the [bilingual workflow](#managing-chinese-and-english-notes) to synchronise the English edition before running the publishing checks. Missing English editions and unsynchronised automatic translations block the build. If you have not downloaded the project yet, start with [Running locally](#running-locally); to go live, see [Publishing](#publishing).

## Contents

This page uses a hand-written table of contents and the existing heading anchors. Automatic series contents are covered under “Managing sections, tags and series”.

1. [What Learning Garden is](#what-learning-garden-is)
2. [Running locally](#running-locally)
3. [Creating your first note](#creating-your-first-note)
4. [Managing Chinese and English notes](#managing-chinese-and-english-notes)
5. [Writing and editing Markdown](#writing-and-editing-markdown)
6. [Managing sections, tags and series](#managing-sections-tags-and-series)
7. [Maintaining and using the knowledge graph](#maintaining-and-using-the-knowledge-graph)
8. [Recording reviews](#recording-reviews)
9. [Editing notes and recording revisions](#editing-notes-and-recording-revisions)
10. [Questions and answers](#questions-and-answers)
11. [Using the learning calendar](#using-the-learning-calendar)
12. [Publishing](#publishing)
13. [Troubleshooting](#troubleshooting)
14. [Privacy and security](#privacy-and-security)

## What Learning Garden is

Notes here do not have to be "finished" before they are published. You can record your current understanding first, find gaps through review, correct explanations through revisions, and add evidence through questions and answers. Series organise reading paths; links in the body preserve the concrete relationships between pieces of knowledge.

The learning calendar answers "what did I do on which days"; the Graph View answers "how does this knowledge connect". The site never treats page views as reviews, and never infers references between notes from similar titles.

This is a static site: reading happens in the browser, while content is maintained locally in Markdown, JSON and Git. There is currently no back-end CMS, no live comments and no automatic review scheduling. Chinese is the primary source; English is maintained in a separate Markdown file with the same ID. Switching language displays the corresponding edition rather than invoking real-time browser translation.

## Running locally

**Goal:** preview content on your own computer and catch errors before publishing.

### Preparing the environment and getting the repository

You need Git, Node.js **≥ 22.23.4** and the npm that comes with Node.js. Node.js 24 matches the current deployment workflow. Check first:
```bash
node --version
npm --version
git --version
```

If you have not downloaded the project yet:
```bash
git clone https://github.com/BoltzMamba/learning-garden.git
cd learning-garden
npm install
npm run dev
```

If you already have a copy, there is no need to clone again. For a clean checkout installed strictly from the lock file, you can use `npm ci` instead of `npm install`.

**Expected result:** the terminal prints a Local address. Usually `http://localhost:4321/learning-garden/zh/` opens the home page; if the port is taken, use the address the terminal shows. Keep the terminal running; press `Ctrl+C` to stop the server. If Windows PowerShell blocks `npm.ps1`, replace `npm` with `npm.cmd` in the commands; there is no need to change the system execution policy.

### Checking changes and the production preview

After saving a Markdown file, look at the browser. The body usually updates with the dev server. Aggregated data in this project is cached per process, so if a new note, series, graph or calendar does not update, stop and rerun `npm run dev`, then refresh the page.

| Command | Purpose and expected result |
| --- | --- |
| `npm test` | Runs the existing unit tests and CLI integration tests |
| `npm run check` | Astro / TypeScript checks |
| `npm run translate:check` | Reports missing English editions, sync states and issues requiring the author; does not translate |
| `npm run translate:check -- --strict` | Strict bilingual publishing check; blocking states return a non-zero exit code |
| `npm run build` | Checks bilingual content strictly, then generates the static site into `dist/` |
| `npm run check:links` | Checks internal links and assets of the generated pages; build first |
| `npm run verify` | Runs the tests, type check, build and internal link check in order |
| `npm run preview` | Previews the latest `dist/` build; use the address the terminal shows |

The dev preview reads local content; the production preview reads the latest build, so after changing sources you need to rebuild. None of these commands update GitHub Pages.

## Creating your first note

**Goal:** create a note with a stable ID, correct metadata and a working page.

### Option A: use the CLI
```bash
npm run garden -- new
```

The CLI already supports series, ordering and manual relations. Here is a fully filled-in example; press Enter to leave a field blank:

| Prompt | Example input | Meaning |
| --- | --- | --- |
| Title | `我的第一篇笔记` | Page title; Chinese is fine |
| Slug | `my-first-note` | Stable ID; required by hand for Chinese-only titles |
| Section | `knowledge` | Maps to the frontmatter `category` |
| Type (note \| overview) | `note` | An ordinary note; defaults to `note` |
| Series overview id (optional) | leave blank | To join a series, the ID of an existing overview |
| Order within the series | not asked in this example | Asked only after choosing a series; numbers such as `10`, `20` |
| Tags | `learning-garden,workflow` | Comma-separated; must come from the topic vocabulary |
| Related note ids | `how-this-garden-works` | Optional; IDs of existing notes |
| One-line description | `记录第一次使用 Learning Garden 的过程。` | Summary; the CLI requires 1–300 characters |
| Published date | press Enter for today | First publication date, in Asia/Singapore time |

You can also pass everything as flags; the date defaults to today when omitted:
```bash
npm run garden -- new --title "我的第一篇笔记" --slug my-first-note --category knowledge --type note --tags "learning-garden,workflow" --related how-this-garden-works --description "记录第一次使用 Learning Garden 的过程。"
```

**Expected result:** `src/content/notes/my-first-note.md` is created. Write the body under its `## 要点` heading, restart the preview, then open `http://localhost:4321/learning-garden/zh/notes/my-first-note/` or reach it from the notes list.

This command creates only the Chinese source. A production build also needs `src/content/notes-en/my-first-note.md` with the same file name; the next section covers the full workflow.

**Note:** the interactive and flag forms are alternatives; do not create the same slug twice in a row. A duplicate slug is rejected and the file is not overwritten. The CLI supports `--type`, `--series`, `--order` and `--related`; the body and later metadata changes still require editing the file.

### Option B: create the Markdown file by hand

Create `my-first-note.md` directly in `src/content/notes/`:
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

Replace the date with the real first publication date. The loader only reads `*.md` files directly inside that directory, not subdirectories or `.mdx`. The file name without `.md` is the note ID; no separate `slug` field is needed. File names use lowercase English letters, digits and single hyphens, up to 80 characters, for example `dynamic-programming-intro`.

The fields below belong to the Chinese source. Do not copy the whole frontmatter into the English directory.

| Field | Required | Rules |
| --- | --- | --- |
| `title` | Yes | A non-empty title |
| `description` | Yes | A non-empty summary; one or two sentences is best |
| `category` | Yes | `guide`, `practice`, `knowledge` or `projects` |
| `published` | Yes | A real calendar date, preferably quoted as `YYYY-MM-DD` |
| `tags` | No | Array of strings, default `[]`, checked against the vocabulary |
| `contentType` | No | `note` (default) or `overview` |
| `series` | No | ID of an existing `overview` note |
| `order` | No | A number that sets the position within the series; ignored without `series` |
| `related` | No | Array of existing note IDs; no duplicates and no self-reference |

**Keep the file name stable after publishing.** URLs, reviews, revisions, questions and series relations all depend on the ID. Changing the title usually does not affect the URL; renaming the file changes the URL, and the project does not create redirects for old note addresses.

`published` shows the first publication date and produces one publish activity; it is not a "last updated" date. The CLI rejects future dates, but a future date written by hand does not schedule publication: there is currently no draft or scheduled-publishing mechanism, and the build reads every valid note. Do not commit content that is not ready to be public to the public repository.

## Managing Chinese and English notes

**Goal:** build knowledge in Chinese while offering English readers a complete, maintainable edition. English can be translated with Claude/Codex assistance or written by the author. The site displays content stored in the repository; it does not use real-time browser translation.

### Files, metadata and tool responsibilities

One note has two files and one logical ID: Chinese lives in `src/content/notes/how-this-garden-works.md`, and English in `src/content/notes-en/how-this-garden-works.md`. Do not add an `-en` suffix or create an extra “English note” in the Chinese directory.

Chinese is the primary source for content and knowledge structure. An English file contains only `title`, `description`, the body and a `translation` block. The site merges `category`, `tags`, `published`, `contentType`, `series`, `order` and `related` from Chinese; putting these fields in English frontmatter is invalid.

| Tool | Responsibility | Does not do |
| --- | --- | --- |
| `garden` CLI | Creates Chinese notes and records reviews and revisions | Does not create English translations |
| `translate:check` | Scans files and reports states and reasons | Does not call AI, translate or rewrite text |
| Claude/Codex agent | Reads Chinese and linked notes, then writes an English candidate under the repository's `AGENTS.md` rules | Does not invent hashes or overwrite Manual content |
| `translate apply/adopt/confirm` | Installs candidates, adopts edits or records the author's confirmation, maintaining metadata | Does not determine technical or semantic correctness |
| GitHub Actions | Strictly checks, builds and deploys committed files | Does not call an agent to translate missing English |

`CLAUDE.md` references the same `AGENTS.md`. Follow its “Translating notes” section and translation rules in daily work.

### Creating a bilingual note

Continuing the earlier `my-first-note` example, skip step 1 if its Chinese file already exists. Run every command from the repository root.

1. Run `npm run garden -- new`, enter `my-first-note` as the slug, and complete the Chinese metadata.
2. Write the body in `src/content/notes/my-first-note.md`.
3. Run `npm run dev` and preview Chinese at `http://localhost:4321/learning-garden/zh/notes/my-first-note/`. Development permits unfinished English and prints warnings. With no English edition, the English page falls back to Chinese and labels it accordingly; this does not mean translation is complete.
4. In another terminal, run `npm run translate:check -- --note my-first-note`. A new note normally reports `MISSING`.
5. Give the request below to a Claude/Codex session with access to this repository. **It is a natural-language request for the agent, not a terminal command.**

> Follow AGENTS.md → Translating notes and check my-first-note. Only for MISSING or AUTO_STALE, read the Chinese source and its linked notes, translate the complete title, description and body into .translations/my-first-note.md, then run npm run translate -- apply --note my-first-note. Preserve code, formulas, commands, paths and link targets; update same-page anchors for English headings. Report manual editions, AUTO_MODIFIED, INVALID or ORPHAN without overwriting them. Finish with the strict check, build and link check. Do not commit, push or deploy.

6. Review the English wording, code, numbers, formulas and links in `src/content/notes-en/my-first-note.md`. The candidate `.translations/my-first-note.md` may contain only `title` and `description` in its frontmatter, followed by the English body. `apply` generates the complete `translation` block and removes the candidate on success by default; `--keep` retains it.
7. Refresh or restart the dev server and open `http://localhost:4321/learning-garden/en/notes/my-first-note/`. Confirm that the title and body are English.
8. Run `npm run translate:check -- --strict`, then `npm run verify`. Passing state checks does not establish semantic accuracy; read and review the translation too.
9. When ready to publish, run `git add src/content/notes/my-first-note.md src/content/notes-en/my-first-note.md`, inspect `git diff --cached`, then follow the publishing section to commit. Do not commit the ignored `.translations/` candidates.

**Expected result:** both language URLs end in `my-first-note/`, the English edition is `AUTO_CURRENT`, and no second logical note has been created.

### Reading translation states

Use `npm run translate:check` for all notes, `npm run translate:check -- --note how-this-garden-works` for one, and `npm run translate:check -- --json` for machine-readable output. Before publishing, use `npm run translate:check -- --strict`. An ordinary check can list blocking states without returning a strict-failure exit code.

The actual state names are more specific than Missing / Current / Stale / Modified:

| CLI state | Meaning | Action and publishing impact |
| --- | --- | --- |
| `MISSING` | Chinese exists, but same-ID English does not | Have the agent write a candidate and `apply` it; blocks publishing |
| `AUTO_CURRENT` | Automatic content, source hash and rules version agree | Still review translation quality; publishing allowed |
| `AUTO_STALE` | Chinese text or the translation rules version changed | Update the candidate and `apply`; blocks publishing |
| `AUTO_MODIFIED` | English text differs from its generated hash | The author decides whether to keep edits or discard and regenerate; blocks publishing |
| `MANUAL_CURRENT` | The manual edition is recorded as matching current Chinese | Never overwritten automatically; publishing allowed |
| `MANUAL_STALE` | Chinese changed after the manual edition was last confirmed | Author reviews, then runs `confirm`; warning only |
| `INVALID` | Invalid file or metadata, or failed preservation/link checks | Fix the reported cause; blocks publishing |
| `ORPHAN` | English has no corresponding Chinese source | Author checks the ID, restores the source or handles the extra file; blocks publishing |

For example, before translating a new note you might see `✗ MISSING        my-first-note` with the summary `1 note(s): MISSING 1`; after installation, `✓ AUTO_CURRENT   my-first-note`. These are illustrative workflow outputs, not claims about the repository's current state.

Classification has precedence rules: a Chinese edit does not always produce `AUTO_STALE`. Adding code blocks, formulas or note links can make the old automatic edition `INVALID` first because preserved content no longer matches. The agent must report this rather than add an overwrite flag on its own.

### Handling Chinese and English edits

| Change | Next step |
| --- | --- |
| Chinese `title`, `description` or body changes | Check the state. Auto usually needs an updated translation; Manual needs the author's review. Wording-only edits count too |
| Only Chinese section, tags, series, order, `related` or publication date changes | The source-text hash stays unchanged; normally rebuild. Structural validation still applies, and publication dates should not be changed casually |
| An Auto English title, description or body is edited | Usually becomes `AUTO_MODIFIED`; preserve the edits and let the author decide who maintains them |
| A Manual English edition is edited | No generated-hash comparison, but links, content and facts still need checking; after reviewing Chinese, use `confirm` when appropriate |

Hashing normalises line endings, Unicode and some leading/trailing whitespace, so equivalent formatting changes do not necessarily produce a stale or modified state. `CURRENT` for a Manual edition means the source hash was confirmed, not that every subsequent edit has been automatically reviewed.

For an unedited Auto edition, if the author verifies that a Chinese change does not affect the existing English at all, `npm run translate -- confirm --note how-this-garden-works` can record that review instead of retranslating blindly. **Do not use it to conceal untranslated changes.** It does not update prose and rejects `AUTO_MODIFIED`, `MISSING` and `INVALID`.

### Auto and Manual: hashes and content protection

`translation.mode: auto` means the agent maintains the edition, not that translation runs continuously in the site's background. `sourceHash` covers the Chinese title, description and body; `generatedHash` covers the generated English title, description and body; `rulesVersion` identifies the translation rules. Tools compute these values; never type them by hand or ask a model to invent them.

`translation.mode: manual` makes the author responsible for the English edition. The author can write it directly, polish an automatic version or take over after reviewing it. `apply` refuses to overwrite any Manual file, and agents must leave its bytes unchanged.

**Safely taking over Auto:** the author runs `npm run translate -- adopt --note how-this-garden-works`, then edits English. If Auto has already been edited, the same command preserves those edits. `adopt` changes the mode to Manual, removes `generatedHash` and `rulesVersion`, and retains the body and original `sourceHash`. If Chinese has changed, the result can therefore still be `MANUAL_STALE`; adoption does not confirm synchronisation. After reviewing or revising English, the author runs `npm run translate -- confirm --note how-this-garden-works`. It updates the source hash without changing English prose.

**Discarding edits and regenerating:** prepare and review a candidate first, preserving any manual text that matters. Only after the author decides to discard edits should they run `npm run translate -- apply --note how-this-garden-works --discard-edits`. Invalid files may also contain handwritten material; use `--replace-invalid` only when the author permits replacement. Default `apply` refuses these cases. A candidate that fails validation rolls the target back and remains available for correction.

Neither overwrite flag bypasses Manual protection. To return Manual to Auto, the author must first back it up and explicitly remove protection. One reviewable approach is for the author to move the English file to a backup outside the content directories, making the same-ID state `MISSING`, then review the candidate and run `apply`. Do not publish until regeneration and strict checks are complete. Merely changing `mode` is insufficient: Auto also requires valid tool-generated hashes and a rules version.

### Writing a manual edition from scratch

There is currently no separate `new-manual` command. To avoid writing hashes, the author can put their complete English draft in `.translations/my-first-note.md` with only the title, description and English body, run `npm run translate -- apply --note my-first-note` for missing English or an updatable Auto edition, then immediately run `npm run translate -- adopt --note my-first-note` after validation. This uses the tooling to establish metadata; the English itself can be entirely author-written.

Initial installation still uses Auto checks, so the candidate must first retain code blocks, formulas, images and note links. Once Manual, the author can change the structure and emphasis. Losing some preserved elements in Manual generally produces warnings, but invalid metadata and broken links still block publication. After checking the facts, the author records the current Chinese version with `confirm`.

For project descriptions, a “problem, personal ownership, technical approach, results and impact” structure can suit English-speaking recruiters. Keep technical conclusions, experimental numbers, responsibilities and personal contributions accurate; add no unverified achievements. Later batch translation will not overwrite Manual. Its author must maintain it rather than wait for an automatic refresh.

### Why English can block a build

`npm run build` runs a strict check first, and content loading also validates bilingual state. `MISSING`, `AUTO_STALE`, `AUTO_MODIFIED`, `INVALID` and `ORPHAN` block production builds; `MANUAL_STALE` only warns. This prevents publishing missing or outdated automatic editions and unconfirmed edits, while respecting the author's control over Manual content.

Troubleshoot in this order: `npm run translate:check -- --strict` → read each state and reason → translate or handle protected states according to the author's decision → repeat the strict check → `npm run build` → `npm run check:links`. Do not edit hashes to suppress errors. Malformed files can also prevent development rendering; permissive development mode does not ignore every invalid input.

### Series, the knowledge graph and the learning calendar

Both languages share the slug, series, tags and knowledge relationships. Manage `series`, `related` and tags only in the Chinese source. English series contents use members' English titles; English graph article nodes use English titles, and topics use the vocabulary's English names. Links added only in English do not create graph relationships: the graph follows the Chinese source, and the checker warns about additional references.

Creating an English file needs no extra graph node and adds no second garden publication event. Dates and activity use the same Chinese source ID. Questions currently have no separate English collection, so question-node titles may still be Chinese.

### Language switching and matching URLs

First visits to `/learning-garden/` default to English without consulting the browser language. Clicking `中` or `EN` in the header saves the `lg-lang` preference, which takes precedence on later visits to the root. Visiting a language-specific URL directly does not rewrite that preference.

This guide's matching URLs are `https://boltzmamba.github.io/learning-garden/zh/notes/how-this-garden-works/` and `https://boltzmamba.github.io/learning-garden/en/notes/how-this-garden-works/`. The language switch keeps the same article path while displaying the corresponding body. You can also visit `/learning-garden/zh/` or `/learning-garden/en/` directly; this deployment requires the `/learning-garden/` base path.

### English-edition troubleshooting

| Question | What to check or do |
| --- | --- |
| Why is English missing? | Check `notes-en`, the matching `.md` name and state. Creating Chinese with the CLI does not create English. Restart after fixing; online publication also requires both files to be committed and deployed |
| Why does English still show old content? | Check the note's state, whether it is stale, whether the candidate was installed with `apply`, and whether rebuilding and deployment finished; a refresh alone is insufficient |
| Why does the strict build fail? | Read the blocking state. Translate missing content, let the author decide how to handle Modified, and fix the reported Invalid cause; do not bypass the gate |
| Why translate again after editing Chinese? | The title, description or body changed its source hash; English needs to be checked for accuracy. Structural-only changes normally need no translation |
| Why was Manual not updated automatically? | It is protected. The author edits, reviews and runs `confirm`; agents do not overwrite it |
| Why did editing English produce Modified? | Auto text differs from `generatedHash`. Keep edits with `adopt`, not by rewriting the hash |
| How do I protect handwritten English? | Use `adopt` when taking ownership and check for Manual mode. Batch tasks handle only Missing and Auto Stale without silent-overwrite permission |
| Why can sections, tags or series change without retranslation? | Structural fields are outside the source hash and merged from Chinese at build time. Body changes still need separate synchronisation |
| Why does the calendar count the article once? | Both files share one logical ID and the Chinese publication date; translation is not a new garden publication event |
| Why are graph titles still Chinese in English? | Distinguish articles, topics and questions. Check the English article title and development fallback, a topic's vocabulary `en` value, or the currently shared question text; restart or rebuild |
| How do I check English internal links? | Prefer `[[id]]` or `../id/`, with same-page anchors matching English headings. Run `check:links` after building and click relative cross-page links with fragments too; do not rely solely on automated checks |

## Writing and editing Markdown

**Goal:** tell metadata apart from the body and write notes that render correctly.

The part between the first two `---` lines is YAML frontmatter; everything after the second one is the body. The page already turns `title` into the H1, so start the body at `##` and use `###` for the next level.

### Common syntax
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

Fence code blocks with three backticks and name the language on the opening line, such as `bash`, `ts`, `python`, `json` or `yaml`. For example, write three backticks followed by `ts` on one line, put the code below on the next lines, and end with three backticks on a line of their own:
```ts
const steps = ["阅读", "解释", "验证"];
console.log(steps.join(" → "));
```

The project is configured with Shiki syntax highlighting, math formulas and the Wiki Link plugin; do not assume that arbitrary extension syntax from other note-taking apps works here.

### Math formulas

Put inline formulas between a pair of `$` and display formulas between two `$$` lines; they are rendered with KaTeX:
```markdown
完成比例为 $p = k/n$。

$$
p = \frac{k}{n}
$$
```

Rendered result: the completion ratio is $p = k/n$.

$$
p = \frac{k}{n}
$$

This is only a typesetting example, not a metric the site computes.

### Links and images
```markdown
[项目仓库](https://github.com/BoltzMamba/learning-garden)
[使用指南](../how-this-garden-works/)
[[how-this-garden-works|使用指南]]
![Learning Garden 图标](/learning-garden/favicon.svg)
```

Write external links as full URLs. For internal note links, `../note-id/` is recommended because it keeps the current language. Do not link directly to `other-note.md`: although the graph parser recognises the file form, the browser does not get a static note page from it, and the link check fails.

English prose should also use ID-based Wiki Links or relative note links, avoiding hard-coded Chinese article URLs. When translating a table of contents, update its anchors to match the English headings. Keep Chinese teaching examples inside code blocks unchanged, but check the target headings of links used in the actual English prose.

Images can go in `public/images/`, for example `public/images/agent-loop.png`, referenced in the body as `![循环示意图](/learning-garden/images/agent-loop.png)`. The URL does not include `public`, but it must include the deployment base path `/learning-garden/`. The `favicon.svg` above is an existing asset; your own images must be added to the directory first. Check letter case: a wrongly cased path that opens on Windows may fail after deployment.

### Editing an existing note

1. Take the ID from the last segment of the note's URL, for example `how-this-garden-works` for this page, or click the source link below the note.
2. Open the matching `src/content/notes/<id>.md` and change the body or metadata, keeping the file name and the first publication date.
3. Start the preview and check the title, tables, code, formulas, images and links.
4. After changing the Chinese title, description or body, check and synchronise the English edition; structural changes alone usually only need a rebuild. Restart the server if aggregated information does not change, and run `npm run verify` before publishing.

## Managing sections, tags and series

**Goal:** express separately which section a note belongs to, which topics it covers, and the suggested reading order.

### Category: all four sections are available

| `category` value | Section | Suitable content |
| --- | --- | --- |
| `guide` | Garden Guide / 花园指南 | How to use, write and maintain the garden |
| `practice` | Practice / 刷题练习 | Solutions, exercises and problem-solving retrospectives |
| `knowledge` | Knowledge / 基础知识 | Concepts, principles and technical notes |
| `projects` | Projects / 项目档案 | Project process, design and results |

All four sections are implemented; they are not plans. After changing `category`, rebuild and the note moves to that section; `projects` content also appears on the Projects page in the navigation. The old values `meta`, `algorithms`, `ai-agents` and `software-engineering` are still mapped for compatibility, but new notes should use the four values above.

### Topic / Tag: a controlled vocabulary

`tags` describe the topics a note covers. A Topic is a canonical entry in the vocabulary; a Tag is how a note is assigned to a topic. First look at the available values:
```bash
npm run garden -- topics
```

`tags: ["ai-agent", "llm"]` resolves to AI Agent and Large Language Models; `llm` is an alias and does not create a duplicate topic.

To add a new topic, add an entry to the top-level object of `src/data/topics.json`, for example:
```json
"retrieval-augmented-generation": {
  "zh": "检索增强生成",
  "en": "Retrieval-Augmented Generation",
  "parent": "large-language-models",
  "aliases": ["rag"]
}
```

This is one vocabulary entry, not a replacement for the whole file; separate it from other entries with a comma. `zh` and `en` are required; `parent` and `aliases` are optional. The parent must exist, the hierarchy is at most three levels deep, and cycles or ambiguous aliases are not allowed. Then put the ID or an alias into a note's `tags` and check the build.

Click a note's tag to open the filtered notes list; or click a tag button in the list, and click it again or use the clear button to remove the filter. The filter currently matches only the canonical topics a note is tagged with directly; a parent topic does not automatically include notes tagged only with its subtopics.

### Series: overviews and automatic contents

An overview is also a note; the difference is `contentType: "overview"`. The commands below are a demonstration; in practice, make sure the IDs do not exist yet:
```bash
npm run garden -- new --type overview --title "AI Agent 专题" --slug ai-agents-overview --category knowledge --tags ai-agent --description "AI Agent 的阅读路径与知识地图。"
npm run garden -- new --title "Agent Loop" --slug agent-loop --category knowledge --series ai-agents-overview --order 10 --tags ai-agent --description "理解智能体的观察、行动和停止条件。"
```

**Expected result:** the overview page automatically lists the notes whose `series` points to it, and member pages show their series, their position in it, and previous/next links to neighbouring notes. The overview body can hold an introduction or stay empty; you do not maintain the contents by hand.

To add an existing note to a series or move it to another one, edit its frontmatter:
```yaml
series: "ai-agents-overview"
order: 20
```

This requires an existing `ai-agents-overview.md` of type `overview`. Notes are sorted by `order` ascending, with notes without one placed last; for equal or missing orders, by publication date from earliest to latest, then by ID. Using `10`, `20`, `30` leaves room for insertions. To leave a series, remove both `series` and `order`.

After a rebuild the contents update; if development still shows the old contents, restart the server. Each note belongs to at most one series, nesting is not supported, and an overview cannot have its own `series`. The series contents are a **list of member notes**, not an automatic table of contents of the body's headings. This guide's table of contents is maintained by hand.

Maintain `series` and `order` only in the Chinese source. Both languages share membership and order; English contents use English titles. New overviews and members also need English editions before a production build.

## Maintaining and using the knowledge graph

**Goal:** give every connection between pieces of knowledge an explicit basis, and explore them in the global and local views.

### Nodes, edges and the two modes

Each logical note ID is one node, not one node per language. An overview is an article node with a ring; public questions are question nodes; topics in use and their ancestor topics are topic nodes. Article relationships come from the Chinese source, while the English graph replaces article and topic labels. Edges come from explicit relationships and are generated at build time:

| Source | Relationship | Shown in |
| --- | --- | --- |
| Body link or Wiki Link | Note A references B, `links_to`, directed | Article Graph |
| `related` | A relation confirmed by the author, `related_to`, undirected | Article Graph |
| `series` | The note belongs to a series, `belongs_to` | Both modes |
| A question's `note` | A public question about a note, `asks_about` | Article Graph |
| A note's `tags` | The note is tagged with a topic, `tagged_with` | Topic Graph |
| The vocabulary's `parent` | Parent–child relation between topics, `parent_of` | Topic Graph |

The global graph implements **two modes, Article Graph and Topic Graph** (the **Articles** and **Topics** buttons); it is more than a switch for showing tags. The first shows references and manual relations; the second shows topic membership and the topic hierarchy.

Two notes with the same tag are each connected to that topic only; they do not automatically become a direct reference. Series contents are never mistaken for body references either. When a pair of nodes has several relationships, the canvas may merge them into one line; the list below the graph distinguishes the relationships and their directions.

### Body references and manual relations

In another note's body you can write:
```markdown
操作流程参考[使用指南](../how-this-garden-works/)。
也可以写 [[how-this-garden-works|Learning Garden 使用指南]]。
跳到小节：[[how-this-garden-works#记录复习]]。
```

Wiki Links support `[[slug]]`, `[[slug|display text]]` and `[[slug#heading]]`, and can also resolve by note title. Prefer the stable slug to avoid ambiguity from renamed or duplicate titles. The target note must exist, and heading fragments should be checked too; a Wiki Link that cannot be resolved produces a warning and is shown as non-clickable text, which does not necessarily fail the build.

If there is no natural place for a body reference but you have confirmed that two notes are related, write this in the frontmatter of one of them:
```yaml
related: ["how-this-garden-works"]
```

An undirected relation only needs to be declared on one side and is shown on both; do not add this self-reference to this guide itself. A target that does not exist, a duplicate or a self-reference fails the build.

The connections area below each note shows the local graph and lists: **Outlinks** (shown as "This note links to") are the notes this note's body references, **Backlinks** are the notes whose bodies reference this one, and **Related** are manual relations. Series and tags are not backlinks. Example links in code blocks and inline code do not create connections, and self-references produce no edge.

### A small example: Agent Loop links to ReAct

This is only a demonstration; you do not need to create test notes to follow the guide. If you already created `agent-loop` in the previous section, skip the first command:
```bash
npm run garden -- new --title "Agent Loop" --slug agent-loop --category knowledge --tags ai-agent --description "智能体循环的基本结构。"
npm run garden -- new --title "ReAct" --slug react --category knowledge --tags "ai-agent,react-paradigm" --description "推理与行动如何交替。"
```

Add this to the body of `src/content/notes/agent-loop.md`:
```markdown
## 推理与行动

循环中的推理与行动可以结合 [ReAct](../react/) 理解。
```

After saving, synchronising both notes' English editions and rebuilding, the Article Graph shows the reference `Agent Loop → ReAct`; the former's Outlinks include the latter, and the latter's Backlinks include the former. In the Topic Graph both notes connect to `ai-agent`, and ReAct also connects to `react-paradigm`. Adding the same tags without a body link does not create a reference edge in the Article Graph.

### Using the graph

Open the [global knowledge graph](../../graph/) from the navigation or from the graph card on the home page.

| Action | How and what happens |
| --- | --- |
| Switch modes | Choose Article Graph or Topic Graph at the top; nodes, edges, legend and list change together |
| Find a node | Type a title or topic name and search to locate and highlight the matching node; only the current mode is searched |
| See neighbours | Hover over a node to highlight its direct neighbours and edges; a search keeps its highlight |
| Move nodes | Drag a node; the layout recovers when you let go, and positions are not saved |
| Pan | Drag an empty area of the canvas |
| Zoom | Scroll in the global graph, or click `+` and `−` |
| Open | Click an article node to open the note; a topic opens the tag filter, a question jumps to the public Q&A |
| Reset | The reset button in the global toolbar refits the view and clears the search highlight |
| Relationship details | Expand the list below and read it by relationship; it also suits keyboard use |

On phones you can tap to open, drag nodes or empty space with one finger, and pinch to zoom; the global graph offers the most complete controls. Graphs embedded on the home page and in notes keep vertical page scrolling first, so gestures may be affected by scrolling; use the global page for its buttons and list.

The local graph below a note shows only that note's one-hop relationships in the Article Graph: references, manual relations, series membership and questions. It has no Topic mode and no full toolbar. In embedded graphs on desktop, hold `Ctrl` or `⌘` while scrolling to zoom; plain scrolling scrolls the page.

**Note:** isolated notes still appear in the global graph; the home page previews at most 24 connected nodes. A local graph with only the current note shows an empty state. After changing links, restart the dev server or rebuild; the live site also needs a commit and a completed deployment.

## Recording reviews

**Goal:** record a deliberate act of recalling, explaining or practising; page visits are not counted.
```bash
npm run garden -- list
npm run garden -- review
```

The CLI lists the notes; enter a number or slug, then the date, Mastery and Reflection. The date defaults to today in Asia/Singapore; to record a past review use `--date YYYY-MM-DD`, and future dates are not allowed. A date earlier than the note's publication date triggers a reminder.

| Mastery | Meaning |
| --- | --- |
| 1 | Almost forgotten; needs relearning |
| 2 | Familiar, but cannot do without the note |
| 3 | Can restate the key points |
| 4 | Can apply it to problems independently |
| 5 | Can teach it to others and answer follow-up questions |

Reflection records what you have mastered, where you are still stuck and how you will verify it next; the CLI requires it to be non-empty and at most 500 characters. For example:
```bash
npm run garden -- review --note how-this-garden-works --date 2026-11-17 --mastery 3 --reflection "能说明专题与标签的区别，下次练习处理一个公开问答。"
```

**Expected result:** saved to `src/data/reviews.json`. Running it again for the same note on the same day **replaces that day's Mastery and Reflection** without increasing the count. After a rebuild, the note shows the total number of reviews and the latest review date, and the calendar counts one review on that day.

**Note:** only run it after actually completing a review, with the real date. Opening and reading a note is not a valid review. The site has no automatic review scheduling; note pages do not show the scores or full reflections, but these fields are still visible in the public repository.

## Editing notes and recording revisions

**Goal:** keep a record of meaningful changes in knowledge.

Typos, formatting and wording can be changed directly in the Markdown without adding a revision each time. Correcting a technical error, adding an important experimental conclusion or changing an earlier explanation is worth recording as a revision. Edit and check the note first, then run:
```bash
npm run garden -- revise
```

Choose the note number or ID and enter the date and a summary of the change; or use flags:
```bash
npm run garden -- revise --note how-this-garden-works --date 2026-11-17 --summary "补充本地维护、专题、知识图谱、问答及发布操作，校正日历统计说明。"
```

**Expected result:** saved to `src/data/revisions.json` with the ID `<note>--<date>--<n>`. The note shows the revision date and summary below it, and the calendar counts one activity per revision ID; the GitHub file history keeps the actual text differences.

**Note:** `revise` only records the entry; it does not change the body or commit to Git. The summary is required and at most 300 characters. Unlike reviews, running it again on the same day adds another record, so do not record the same change twice; if you make a mistake, check and correct the JSON by hand. Keep the original `published` value.

## Questions and answers

**Goal:** turn discussions into reviewed public Q&A that can be referenced long-term.

### Visitors: asking a question or suggesting a change

1. Click the question link at the bottom of a note, or ask from the [public Q&A](../../questions/) page.
2. Sign in to GitHub. The link from a note pre-fills the related note ID and a title prefix; check them.
3. Describe the specific question, the paragraph where you got stuck and what you expected, and add what you tried, examples or reference links.
4. After submitting, the question first appears in the repository's Issues; follow replies through Issue notifications or by subscribing. It does not appear on the site immediately.

If you find an error, choose "Report a correction / 勘误" when creating a new issue and fill in the note ID, the error and the evidence for your suggestion. If you already have a concrete change, fork the repository, edit the Markdown on your own branch and open a Pull Request explaining the reason and how you verified it. It becomes part of the content only after the owner reviews and merges it.

### Owner: turning it into Markdown Q&A

Look at new questions in the repository's Issues and check whether they are duplicates, relevant, have enough context, or contain sensitive information; you can ask follow-up questions in the issue first. Once you decide to include one, run:
```bash
npm run garden -- question
```

Fill in the Question title, Question id, an optional Related note slug, the question description and whether it is public, in that order. The description is required and at most 1000 characters. Flag form example:
```bash
npm run garden -- question --title "如何确认一次有效复习？" --slug effective-review --note how-this-garden-works --description "阅读之后应该做什么，才适合记录为复习？" --public true
```

**Expected result:** `src/content/questions/effective-review.md` is generated with `status: "open"` by default, today as the creation date, an empty body and `sources: []`. `note` takes a note ID, not a title or URL; omit it when the question is not about a note.

The CLI only creates the file; it has no answer editor, no flag for the resolved status and no prompt for sources. Once the answer is ready, edit the file by hand, for example:
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

Use real dates and a checked answer. `resolved` requires `resolvedOn`; `open` requires removing `resolvedOn`, otherwise the build fails. Each source needs a non-empty `title` and a valid URL; you can add the full link to the original issue to keep the context.

After checking and publishing, files with `public: true` appear on the public Q&A page, grouped into `open` / `resolved`; with a `note`, they also appear at the bottom of that note. A public, resolved question produces one answer activity on its `resolvedOn` date.

### Later updates and what is not synchronised

To extend an existing answer, edit the original question file directly, keeping its ID, creation date and real resolution date; do not run `question` again. To reopen a question, change it to `open` and remove `resolvedOn`; the corresponding answer activity then also disappears from the generated calendar. Question files are not a history log of multiple resolution events.

**The issue discussion, the Markdown question record and the public Q&A on the site are three separate steps.** The owner organises replies by hand, then checks, commits and deploys them. Issue comments are not fetched automatically and resolution status is not synchronised; closing an issue does not update the site, and there is no live comment box.

## Using the learning calendar

**Goal:** look back at real activity and understand where the numbers come from.

### Squares and activity details

Each square of the [learning calendar on the home page](../../#log) is one day; the darker the colour, the higher that day's combined activity. The colour scale is based on the 90th percentile of active days in the selected year, with a reference value of at least 4, split into four levels. It is not a fixed "1, 2, 3–4, 5+" scale, does not represent time spent or mastery, and colours are not meant to be compared across years.

Hover or focus a square with the keyboard to see garden activity, GitHub contributions and the total. Click a date to see its activities, links to notes or questions, and a link to that day's GitHub activity. When several years are available, click a year button to switch; the years are those with activity plus the current year. On phones, scroll sideways to see the whole grid.

| Garden activity | Date source | Count |
| --- | --- | --- |
| Published | `published` | Once per note, including overviews |
| Reviewed | `date` in `reviews.json` | Once per note per day |
| Revised | `date` in `revisions.json` | Once per revision ID |
| Answered | `resolvedOn` of public, `resolved` questions | Once per question |

Different types are not de-duplicated against each other: publishing, reviewing and revising the same note on the same day counts as three activities. Browsing, saving files and ordinary edits do not create garden learning events automatically. Dates use `YYYY-MM-DD`, and "today" is computed in Asia/Singapore time.

The English edition shares the Chinese source's logical ID and `published` date. Adding or updating English does not create a second garden publication event; GitHub commit contributions still follow the rules below.

### GitHub contributions are included

The calendar also reads the snapshot `src/data/github-activity.json`; the current account is `BoltzMamba`. The main source is GitHub's GraphQL contribution calendar, which includes the commits, pull requests, issues, reviews and so on that GitHub actually counts; when the API is unavailable, the public contributions page is tried. It does not scan every Git repository on your machine, and it does not guarantee that every commit is counted.

The total is **garden events + de-duplicated GitHub contributions**. The sync script uses Git history to subtract commits in this repository that only changed notes, questions, reviews and revisions, so content activity is not counted twice; in GraphQL mode the subtraction never exceeds that day's commits to this repository or that day's total contributions.

De-duplication has limits: the account is recognised by author name or GitHub noreply email, so commits from an ordinary email or commits mixing source code and content changes are not necessarily subtracted as content commits. When history is unavailable, GraphQL mode falls back to subtracting commits to this site's repository; the HTML fallback lacks detailed data and may not de-duplicate. This is a commit-level rule, not item-by-item semantic matching, and it never invents missing contributions. GitHub's dates are used as returned and are not re-bucketed by local time.

### Updating and investigating missing data

When you need a fresh snapshot locally:
```bash
npm run github:sync
npm run build
npm run github:check
```

Syncing uses the network. Credentials come from `CONTRIBUTIONS_TOKEN`, `GITHUB_TOKEN`, `GH_TOKEN`, then the local GitHub CLI login, in that order; without credentials, the public page is tried. Keep tokens in the environment or in GitHub Secrets only, never in notes or source code. The snapshot is ignored by Git and does not need to be committed; `npm run build` itself does not sync.

A failed sync keeps the last usable snapshot and records the failure; without a valid snapshot, only garden activity is shown. The page states the cut-off date or that data is unavailable; dates after the cut-off do not mean "zero contributions". To get a non-zero exit code on failure, use `npm run github:sync -- --strict`. `github:check` compares the snapshot with the contribution counts, years and calendar squares of the built Chinese and English pages, so build first; it does not download data.

The live workflow syncs before building, and a scheduled rebuild also runs daily at **00:15 (Asia/Singapore)**; it can also be run manually from Actions. Do not treat the schedule as an exact-time guarantee. Refreshing the browser does not trigger a sync or a rebuild.

"I wrote code today, why doesn't it show?" First tell apart GitHub not counting it from this site's snapshot not being updated:

- Code that is only committed locally and not pushed does not enter the GitHub calendar.
- The author email must be linked to the right account; contributions from other accounts are not attributed to this one. Branches, repositories and processing delays also affect what is shown, and eligible commits may still take up to 24 hours. See [troubleshooting missing contributions on GitHub](https://docs.github.com/en/account-and-profile/how-tos/contribution-settings/troubleshooting-missing-contributions).
- Other code platforms at work do not enter this account's GitHub calendar automatically; GitHub Enterprise Server can share counts only under conditions such as unified enterprise contributions. See [GitHub's explanation of profile contributions](https://docs.github.com/en/account-and-profile/how-tos/contribution-settings/viewing-contributions-on-your-profile).
- Whether private contributions are visible depends on the account settings, the identity of the credentials and what GitHub returns; this site never reads or publishes details of private code.
- If GitHub shows contributions that this site does not, check the sync status, the de-duplication mode and the time of the Actions build, then sync and rebuild.

## Publishing

**Goal:** publish verified content and confirm the result online.

The maintainer runs the following steps when ready to go live. **Pushing to `main` of this repository triggers an automatic deployment, so finish the checks before pushing.** Local development, building and committing do not publish anything by themselves.

### Checking and committing
```bash
git status --short
git diff
npm run translate:check -- --strict
npm run verify
npm run preview
```

Resolve blocking translation states before running `verify`; do not push Chinese-only changes expecting Actions to generate English. In the production preview, check notes, sections, tags, series, the graph, Q&A and the calendar in both languages, then stop the preview. Once the scope is right, stage specific files, for example when updating this guide's two editions:
```bash
git add src/content/notes/how-this-garden-works.md src/content/notes-en/how-this-garden-works.md
git diff --cached
git commit -m "docs: expand Learning Garden usage guide"
```

For new notes or images, use the actual paths, including any vocabulary, question and record files needed. Stage `src/data/revisions.json` if you actually recorded a revision. Do not commit `.translations/` candidates, `dist/`, local tool output or credentials. Then check:
```bash
git branch --show-current
git remote -v
```

Once you have confirmed that you are on the `main` you intend to publish and the remote is correct, run:
```bash
git push origin main
```

If you are on a feature branch, push that branch and open a PR, then merge it into `main` after review. Visitors without write access use a fork and a PR. Do not treat `git push origin main` as a command for publishing whatever branch you happen to be on.

### Checking Actions and the live site

Open [GitHub Actions](https://github.com/BoltzMamba/learning-garden/actions) and go to the **Test and deploy to GitHub Pages** run for your commit:

1. It installs dependencies, syncs GitHub contributions, then runs tests, the type check, the strict English check, the build and the internal link check. Actions does not call a translation agent. A failed bilingual check prevents upload and deployment, leaving the previous live version in place.
2. Pull requests are only checked, not deployed; pushes to `main`, manual runs and scheduled runs upload and deploy Pages when the conditions are met.
3. Check both `build` and `deploy`; when something fails, expand the first failing step to see the file and the error. For the first setup, choose GitHub Actions as the source under Settings → Pages.
4. After success, visit the [live site](https://boltzmamba.github.io/learning-garden/zh/), open a note from the list and check the body and related records, and also check the same note under the English path.

If the live site has not updated, confirm in turn that the files were committed, pushed to the right repository and branch, that Actions ran for the right commit, that the deployment succeeded and that the URL is correct; finally force-refresh. Do not keep changing publication dates to manufacture activity.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| A new note does not appear | The file must be a `.md` directly inside `src/content/notes/`; check the frontmatter and restart the server; online, check the commit and the deployment |
| The slug already exists | Use `npm run garden -- list` to find the existing note; edit it or choose a new ID, never overwrite |
| Links broke after renaming a file | Prefer restoring the published file name; if you must migrate, update body links, `series`, `related`, question `note`, and review and revision references; old URLs are not redirected |
| An image does not show | Check that the asset exists in `public/` with the right case; the URL includes `/learning-garden/` and not `public` |
| The internal link check fails | Use `../slug/` rather than the source `.md`; absolute paths need the base path and language; build before checking links |
| A Wiki Link is greyed out but the build succeeds | Check the `[wikilinks]` / `[graph]` warnings and the target ID; a warning is not a successful resolution |
| The graph shows no connection | Make sure the link is in the body rather than a code block, the target exists and is not the note itself, and the Article Graph is selected; restart or rebuild |
| The same tag produced no line | This is expected; the Topic Graph shows shared topics, and real references come from body links or confirmed `related` |
| A note is missing from the home page graph | The home page previews only a limited number of connected nodes; search in the global graph |
| The series contents did not update | `series` must point to an ID of type `overview` and `order` must be a number; restart or rebuild |
| A new tag fails the build | Add the topic or alias to the vocabulary first; check for unknown parents, conflicts, cycles and the depth limit |
| Filtering by a parent topic shows nothing | Only direct tags are matched; subtopics are not included automatically. Choose a topic notes are actually tagged with |
| The calendar shows no new activity | Browsing and ordinary saves create no events; check the real publication date, reviews, revisions, resolution dates of public questions and the selected year, then rebuild |
| GitHub numbers do not match | Compare with the account's calendar; check the snapshot cut-off date, credentials, private contribution settings and the de-duplication mode, and run `github:check`; this site's total is not GitHub's raw number |
| A question does not appear on the site | Issues are not synchronised; the owner must create the Markdown, set `public: true` and publish |
| A question's status fails the build | `resolved` requires `resolvedOn`, and `open` must not have it; check that the related note exists |
| English pages still show the Chinese body | Development can fall back to Chinese when English is missing. Check the same-ID English file and its status, resolve the issue and restart. Production builds do not allow missing English |
| `npm run build` fails | Start from the first error: required fields, dates, references, duplicate records, the vocabulary; check the Node.js version and dependencies |
| It works locally but Actions fails | Look at the failing step, files you forgot to commit, letter case, the lock file and differences between local and CI environments; if deployment fails, check the Pages source and permissions |

Not yet supported: automatic tables of contents for the body, nested or multiple series, live comments and automatic issue synchronisation, online editing, drafts and scheduled publishing, and spaced-repetition scheduling. Questions still use shared files, without the separate English-edition workflow available to notes. Do not add fields that do not exist and assume they will take effect.

## Privacy and security

This repository is public: Markdown, JSON, images and the Git history can all be read by others. `public: false` only hides a question on the generated site; **it does not keep the file secret in the public repository**.

- Do not commit API keys, tokens, passwords or other credentials, including in code examples in notes. Keep sync tokens in environment variables or GitHub Actions Secrets.
- Mastery and Reflection in `reviews.json` and the summaries in `revisions.json` are public in the repository, even though the pages do not show them in full.
- Do not upload internal company code, sensitive data or project material you are not authorised to share; make sure quotations and images can be published.
- Keep private notes somewhere separate and properly protected rather than relying on display fields to hide them. If you commit credentials by mistake, revoke or rotate them immediately; deleting the current file does not remove history that is already public.
