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
