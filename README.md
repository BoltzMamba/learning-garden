# Learning Garden

A quiet, static, bilingual (中文 / English) technical knowledge garden. It combines:

- a **GitHub-style learning calendar** built from real records,
- **Markdown notes** with syntax highlighting and KaTeX math,
- **review and revision tracking**, recorded through a local CLI,
- a **question-and-answer** knowledge base that takes contributions through GitHub Issues and PRs.

Live site: <https://boltzmamba.github.io/learning-garden/>

> Knowledge is not finished when an article is published. It evolves through review, correction, questions and answers.

Stack: Astro 7 (static output), Tailwind CSS 4, TypeScript. There is no backend, no database, no UI framework and no API keys.

---

## Quick start

Requires **Node.js ≥ 22.23** (Node 24 recommended). The CLI and tests run TypeScript natively, without a build step.

```bash
npm install
npm run dev            # http://localhost:4321/learning-garden/
npm test               # unit + CLI integration tests (node:test)
npm run build          # static site → dist/
npm run check:links    # verify every internal link in dist/
npm run verify         # test + type check + build + link check (what CI runs)
```

## Writing a note

```bash
npm run garden -- new
```

The CLI asks for a title, slug, category, tags and a one-line description. It then creates `src/content/notes/<slug>.md` with validated frontmatter, and `published` defaults to today in **Asia/Singapore**. Write the body in Markdown, then commit and push to publish.

- The **file name is the note's permanent ID**. Reviews, revisions and questions all refer to it, so don't rename it once you've published.
- A Chinese-only title has no Latin letters to build a slug from, so you'll be asked to choose one (for example `dp-intro`).
- A duplicate slug is rejected and nothing is overwritten.
- `category` is one of four sections: `guide` (花园指南), `practice` (刷题练习), `knowledge` (基础知识), `projects` (项目档案). Older slugs (`meta`, `algorithms`, `ai-agents`, `software-engineering`) are still accepted and mapped, and their old category URLs redirect.
- `tags` must be topics from the controlled vocabulary in `src/data/topics.json` (an id, an alias or a display name; `npm run garden -- topics` lists them). Synonyms such as `LLM Agent` resolve to one topic. To add a topic, add an entry with `zh`, `en`, an optional `parent` (at most three levels deep) and optional `aliases`.

Frontmatter reference:

```yaml
---
title: "ReAct 智能体循环"
description: "One-line summary shown in lists."
category: "knowledge"         # guide | practice | knowledge | projects
tags: ["ai-agent", "llm"]     # topic ids or aliases
published: "2026-11-16"       # YYYY-MM-DD, calendar date in Asia/Singapore
contentType: "note"           # optional: note (default) | overview
series: "ai-agents-overview"  # optional: id of an overview note
order: 10                     # optional: position in the series (gaps are fine)
related: ["mcp-basics"]       # optional: confirmed related notes (undirected)
---
```

A **series** is an ordinary note with `contentType: "overview"`. Its body is an optional overview, and its contents list is generated at build time from every note whose `series` points to it, sorted by `order` (notes without `order` come after, sorted by date and then id). A note belongs to at most one series, and series cannot be nested. The build fails with the file, field and value if a `series`, `related` or tag reference is invalid.

```bash
npm run garden -- new --type overview --title "AI Agent" --slug ai-agents-overview --category knowledge --description "..."
npm run garden -- new --title "MCP 基础" --slug mcp-basics --category knowledge --series ai-agents-overview --order 20 --tags mcp --description "..."
```

## Learning experiments

A knowledge note can end with a few small hands-on experiments that test what it explains (roughly 30 minutes to 2 hours each). They are optional: add one only when building it would sharpen your understanding. The workflow with Claude Code or Codex (propose → you confirm → register → build → complete) is in `AGENTS.md` → "Learning Experiments".

**Register (planned).** Add `experiments` to the Chinese note. Both languages live here, so there is one copy of each requirement. The English edition needs no change of its own.

```yaml
experiments:
  - id: minimal-react-agent        # stable, global id; never rename it
    category: agent-learning       # agent-learning | ai-fundamentals | algorithms | ai-engineering
    status: planned                # planned | in-progress | completed
    public: true                   # false hides it on the site (the repo itself stays public)
    title: { zh: "从零实现最小 ReAct Agent", en: "Build a Minimal ReAct Agent" }
    description: { zh: "不依赖 Agent Framework，实现最小工具调用循环。", en: "Implement a minimal tool-calling loop without an agent framework." }
    requirements:                  # acceptance criteria; cards show 4, the rest fold away
      - { zh: "实现 Agent Loop", en: "Implement the agent loop" }
      - { zh: "处理工具执行异常", en: "Handle tool execution failures" }
```

Public experiments appear as cards in a **Hands-on** section under the note's body. A note without experiments shows nothing extra.

**Complete.** Set `status: completed` and add result links, an article, or both. Links are only allowed once work has started (`in-progress` or `completed`):

```yaml
    status: completed
    links:
      - { kind: code, url: "https://github.com/<you>/minimal-react-agent" }   # code | demo | result
      - { kind: demo, url: "https://…", label: { zh: "在线演示", en: "Live demo" } }   # label is optional
```

**Optional project article.** Create a note in the `projects` section and link it to the experiment. Don't repeat the requirements; the article page shows them from the source note under **Related Knowledge**, and the note's card links to the article. The article is bilingual like every note (`npm run translate`). It publishes together with its experiment: until the experiment is `completed`, the article is an unpublished draft. A draft gets no page, no list entry, no graph node and no calendar event, and it never blocks the build, even without an English edition. You can create it early and fill it in while you work. Set its `published` date to the day you complete it, and make sure it has an English edition by then.

```yaml
category: "projects"
projectTier: experiment            # featured (the default when omitted) | experiment
experimentId: minimal-react-agent
sourceNote: react-agent-loop       # the note that defines the experiment
```

**Where things show up.**
- Projects lists **featured** projects only. Project articles without `projectTier` stay featured.
- **More Experiments** (`/projects/experiments/`, filterable by category) lists only experiments that are completed, public, and have a link or an article. Planned and in-progress experiments appear only on their note, and their cards link to the article only after it is published.
- The graph and the learning calendar ignore experiments: no nodes, no edges, no activity. Publishing a project article counts once, like any note.

**Checks.** The build fails on an invalid id, category or status, on missing `zh`/`en` text, on empty requirements, on a non-http(s) link, or on a link attached to a planned experiment. It also fails on a duplicate id, on a project article whose experiment doesn't exist or whose `sourceNote` doesn't define it, on two articles for one experiment, on an article that names itself, on a featured project carrying `experimentId`, and on an article for a non-public experiment. The rules live in `src/lib/experiments.ts`.

**Translation.** The Chinese experiment text (titles, descriptions, requirements) is part of the note's translation source hash. Editing it marks the English edition stale until the `en` text has been reviewed. Changing `status`, `links` or `public` never does.

## Knowledge graph

`/graph/` has two views built from one set of build-time data (`src/lib/graph.ts`):

- **Article graph** shows body links (`links_to`, directed), `related` (`related_to`, undirected), series membership (`belongs_to`) and public questions.
- **Topic graph** shows articles, their topics (`tagged_with`), the topic hierarchy (`parent_of`) and series membership.

Two notes that share a tag are never linked directly, and nothing is inferred automatically. The homepage shows a capped preview of connected articles, and each note shows its one-hop neighbourhood.

Non-interactive form (every prompt has a flag):

```bash
npm run garden -- new --title "ReAct Agent Loop" --category ai-agents --tags "agent,llm" --description "..."
```

## Recording a review

A **review** is a deliberate act of revisiting and consolidating a note. Page views don't count.

```bash
npm run garden -- review
# or
npm run garden -- review --note react-agent-loop --mastery 3 --reflection "Can explain the loop, unsure about stop conditions"
```

- The date defaults to today in Asia/Singapore. Use `--date YYYY-MM-DD` to backfill; future dates are rejected.
- **One review per note per day.** Reviewing the same note again on the same date *updates* that day's record instead of adding a new one.
- Records are stored in `src/data/reviews.json`.

Mastery scale:

| Level | Meaning |
| --- | --- |
| 1 | Barely remember; needs relearning / 几乎忘了 |
| 2 | Vague; still depends on the notes / 离不开笔记 |
| 3 | Can explain the main points / 能复述要点 |
| 4 | Can apply it independently / 能独立应用 |
| 5 | Can teach it and handle follow-ups / 能讲给别人听 |

## Recording a meaningful revision

```bash
npm run garden -- revise --note react-agent-loop --summary "Corrected the stop condition; added failure modes"
```

Use this only for real changes in knowledge, not for typos or formatting. Each revision gets a stable ID (`<note>--<date>--<n>`) and is stored in `src/data/revisions.json`. Its summary is shown on the note page.

## Questions

```bash
npm run garden -- question
```

This creates `src/content/questions/<id>.md`:

```yaml
---
title: "Why does the agent loop forever?"
note: "react-agent-loop"      # optional related note
status: "open"                # open | resolved
public: true                  # show on the website?
created: "2026-11-16"
resolvedOn: "2026-11-20"      # required when resolved; omit while open
description: "Short statement of the question."
sources:
  - title: "ReAct paper"
    url: "https://arxiv.org/abs/2210.03629"
---

The Markdown body is the answer. Leave it empty while the question is open.
```

**Community workflow:** visitors ask through the GitHub *Ask a question* issue form, which is linked from every note and from the Questions page. You review each issue and turn the ones you accept into question files. Answers and corrections from others come in as Pull Requests. Nothing is published without your review.

## The learning calendar

Activity is derived at build time, by a pure function in `src/lib/activity.ts`, from explicit records only:

| Event | Source | Counting |
| --- | --- | --- |
| Publish | note `published` | once per note |
| Revision | `revisions.json` | once per revision ID |
| Review | `reviews.json` | **once per note per calendar date** |
| Question resolved | public question `resolvedOn` | once per question |

Intensity is based on the number of events per day (1, 2, 3–4, 5+). Event types are never deduplicated against each other. Git commits, typo fixes and deployments are **not** inputs, so they never count. All dates are `YYYY-MM-DD` strings handled without local-timezone conversion, and "today" is computed in Asia/Singapore.

Bad data fails the build: unknown note references, invalid dates, duplicate reviews or revision IDs, and resolved questions with no `resolvedOn`.

## ⚠️ Privacy: everything in this repository is public

- `reviews.json` (including mastery and reflection text) and `revisions.json` are publicly readable on GitHub. The website shows only review counts and dates.
- `public: false` on a question only hides it from the **generated website**. **It is not a security boundary**: the file is still visible in the repository and its Git history.
- Don't store anything private or sensitive here. If you ever need private notes, keep them in a separate private repository.

## Deployment (GitHub Pages)

`.github/workflows/deploy.yml` runs tests, a type check, the build and the link check on every push and PR. Pushes to `main` are then deployed to Pages.

One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site is configured for the project path `/learning-garden/` in `astro.config.mjs` (`site` + `base`). Internal links all go through `url()`/`localePath()` in `src/i18n/paths.ts`, and `npm run check:links` fails if a link misses the base path.

Publishing an update:

```bash
git add -A
git commit -m "notes: add react-agent-loop"
git push            # Actions builds and deploys in ~1–2 minutes
```

## Project structure

```text
.github/                 workflow + issue forms
scripts/garden.ts        CLI (new / review / revise / question / list)
scripts/check-links.ts   internal link checker for dist/
src/content.config.ts    content schemas (notes, questions)
src/content/notes/       Markdown notes  (file name = id)
src/content/questions/   Markdown questions (body = answer)
src/data/                reviews.json, revisions.json, categories.json, profile.ts
src/lib/                 pure logic: dates, activity, calendar, records, slug, site
src/lib/garden.ts        build-time loader + validation
src/i18n/                UI dictionary + localised path helpers
src/components/          Header, Footer, AsciiOcean, ActivityCalendar, NoteList, CategoryNav
src/pages/[lang]/        localised routes: /zh/… and /en/…
tests/                   node:test suites
```

## Internationalisation

UI strings live in `src/i18n/ui.ts`, and TypeScript makes sure `en` has every key that `zh` has. Routes are statically generated under `/zh/` and `/en/`. The language switch keeps you on the same logical page. `/` redirects using your saved choice, then the browser language, then Chinese. Articles are not translated.

## Personalising

The homepage hero reads from `src/data/profile.ts`: name, avatar URL (the GitHub avatar, fetched by user ID), the zh/en introduction and the current interests. Keep it factual.

The ASCII ocean behind the hero is `src/components/AsciiOcean.astro`, driven by `src/scripts/ascii-ocean.ts` (a dependency-free canvas character grid). The big animals are drawn from species body plans in `src/scripts/creatures/`, partly adapted from the MIT-licensed [ascii-sharks](https://github.com/stackedlol/ascii-sharks); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The small fish schools and the feeding behaviour are in `src/scripts/ocean-sim.ts`. Run `npm run dev` and open `/learning-garden/lab/creatures/` to see each species on its own in both themes. That page is dev-only and is not built. Its colours are the `--ocean-*` variables in `src/styles/global.css`, with one set per theme. It stops animating under `prefers-reduced-motion`, when the tab is hidden, and when scrolled out of view.

Future sections (Projects, About, experience) can be added as new content collections in `src/content.config.ts`, with new routes under `src/pages/[lang]/`. Add a link to `Header.astro` only once the page exists.
