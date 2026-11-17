# Agent guide — Learning Garden

Static Astro site. `npm run verify` is the full local gate (tests, type check, strict build, link check). Push, merge and deploy only when the owner asks.

## Translating notes

Chinese is the source of truth. Each note `src/content/notes/<id>.md` has an English edition `src/content/notes-en/<id>.md` with the same `<id>`. The English file holds only `title`, `description`, the body and a `translation` block. Section, tags, series, order, related and dates stay in the Chinese file; the site merges them in. You write the English text. `scripts/translate.ts` computes every hash and writes every file, so hashes are never typed by hand or by a model.

### Steps

1. `npm run translate:check` lists each note's status and reason.
2. Work on every `MISSING` and `AUTO_STALE` note. For each one:
   1. Read the Chinese file and the notes it links to, for context.
   2. Write the candidate `.translations/<id>.md` (gitignored). It has frontmatter with only `title` and `description`, then the English body.
   3. Run `npm run translate -- apply --note <id>`. This installs the candidate as `mode: auto` with computed hashes. It refuses to touch manual, edited or invalid files. If the candidate drops content it rolls back and keeps the candidate, so you can fix it and re-run.
3. Report `AUTO_MODIFIED`, `MANUAL_STALE`, `INVALID` and `ORPHAN` notes to the owner. Each one needs an author decision:
   - `AUTO_MODIFIED`: keep the edits with `translate -- adopt` (the file becomes manual), or regenerate with `apply --discard-edits`.
   - `MANUAL_STALE`: the author reviews the English, then runs `translate -- confirm`.
   - Only the owner may pass `--discard-edits` or `--replace-invalid`.
4. Done when `npm run translate:check -- --strict` exits 0 and `npm run build && npm run check:links` pass. Then open `/en/notes/<id>/` in the dev server and confirm the title, body, code, formulas, links and images render in English.

A file with `translation.mode: manual` belongs to the author. Read it, report on it, and leave its bytes unchanged.

### Translation rules (version 1)

The rules version is `TRANSLATION_RULES_VERSION` in `src/lib/translation.ts`. Bump it only when these rules change enough that every auto translation should be redone.

- **Technical fidelity first.** Keep every concept, number, formula, derivation, result and conclusion exactly. Write natural, professional English; translate meaning, not word order. Cover all of the Chinese content and add no facts, claims or links of your own.
- **Kept verbatim:**
  - code blocks and inline code (Chinese comments inside code may be translated)
  - math
  - URLs, image paths, note ids, `[[wikilink]]` targets, file paths, commands, and frontmatter or field names
- **Translated:** prose, headings, link text, image alt text, and table cells.
- **Links:** keep note links as `[[id]]`, `[[id|label]]` or `../id/` so readers stay in English. Same-page anchors follow the English heading slugs: lowercase, punctuation removed, spaces turned into `-`. `npm run check:links` verifies them after a build.
- **Problem sets (practice):** keep the problem conditions, algorithm, code behaviour, and time and space complexity exactly as written.
- **Projects:** frame the text as problem, ownership, technical approach, results and impact. State the owner's personal scope exactly as the Chinese does. Present unverified outcomes as unverified, and use only the numbers the source gives.
- **Garden guide:** write in technical-documentation English. Keep real commands, paths, button labels and steps. Name UI elements by the labels the English UI shows (`src/i18n/ui.ts`).
- **Terminology:** use the English topic names in `src/data/topics.json`, and keep one English term per concept across all notes.

The checker enforces what can be checked deterministically. In auto files it rejects dropped links, images, code blocks and display formulas, and in all files it rejects broken links. A passing check does not prove the translation is semantically correct.
