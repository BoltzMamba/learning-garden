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
- **Colour marks:** `==text==`, `:hl[text]{color="…"}` and `:ink[text]{color="…"}` keep their exact form, count and colour; translate only the text inside the brackets or between the `==`. Example: `:hl[工具调用失败需要处理]{color="red"}` → `:hl[Tool execution failures must be handled]{color="red"}`. The checker counts marks per colour.
- **Concepts:** keep every `:concept[…]{id="…"}` and `:dfn[…]{#anchor}` with the same id, in the same places; translate only the visible label (`:concept[上下文]{id="llm-context"}` → `:concept[context]{id="llm-context"}`). The checker counts them per id.
- **Links:** keep note links as `[[id]]`, `[[id|label]]` or `../id/` so readers stay in English. Same-page anchors follow the English heading slugs: lowercase, punctuation removed, spaces turned into `-`. `npm run check:links` verifies them after a build.
- **Problem sets (practice):** keep the problem conditions, algorithm, code behaviour, and time and space complexity exactly as written.
- **Projects:** frame the text as problem, ownership, technical approach, results and impact. State the owner's personal scope exactly as the Chinese does. Present unverified outcomes as unverified, and use only the numbers the source gives.
- **Garden guide:** write in technical-documentation English. Keep real commands, paths, button labels and steps. Name UI elements by the labels the English UI shows (`src/i18n/ui.ts`).
- **Terminology:** use the English topic names in `src/data/topics.json`, and keep one English term per concept across all notes.

The checker enforces what can be checked deterministically. In auto files it rejects dropped links, images, code blocks, display formulas, colour marks and concept markup, and in all files it rejects broken links. A passing check does not prove the translation is semantically correct.

## Concept Registry

`src/data/concepts.json` is a small dictionary of terms that several notes use, so a note can reference a term instead of re-explaining it. Readers see a short definition in Concept Mode and can jump to the source note, where the full explanation lives. A concept is a term with an inline definition; a topic (`topics.json`) groups notes. Concepts are never graph nodes or edges.

Entry shape: `"<id>": { "zh": { "term", "aliases"?, "definition" }, "en": { … }, "source": { "note": "<note id>", "anchor": "<anchor>" } }`. The source note marks the defining sentence with `:dfn[term]{#anchor}`, in its Chinese file and its English file.

### Steps, whenever you write, revise or tidy a note

1. Read the note, then `npm run concepts:check -- --list` to see the registry.
2. For each existing concept the note genuinely uses **in the same sense**, reference its first significant occurrence: `:concept[visible text]{id="…"}`. Leave later repeats plain.
3. A shared name is not a shared concept. React's Context is not `llm-context`; when the sense differs or is unclear, leave the text plain.
4. New concept worth adding: propose a candidate to the owner (id, zh/en term, zh/en definition, source note and anchor) and wait for confirmation. Add it to the registry only after the owner confirms.
5. A candidate qualifies when it has a clear technical meaning, will recur across notes, readers may need to look it up, a source note explains it, and no existing entry covers it. Everyday words such as 参数, 输出 or 结果 do not qualify.
6. Definitions: answer "what is it" in context. Chinese is usually 20–60 characters, English one or two sentences. Keep the qualifiers whose absence would mislead ("information available in the current inference", not "the whole conversation"); leave tutorials, examples and edge cases to the source note.
7. Done when `npm run concepts:check` exits 0 and every reference id and source anchor is the same in both languages.

Moving a definition: move the `:dfn[…]{#anchor}` with it and keep the anchor id. To re-source a concept, add the anchor in the new note (both languages) and update `source`. A manual English edition belongs to the author: report missing anchors or references in it and leave the file unchanged.

## Learning Experiments

An experiment is a small, optional hands-on task (about 30 minutes to 2 hours) registered in a knowledge note's Chinese frontmatter under `experiments`. Its purpose is to test the note's understanding. The field reference, examples and display rules are in `README.md` → "Learning experiments". The schema and cross-checks are in `src/lib/experiments.ts`.

### Steps

1. **Propose.** When the owner asks, read the note and the notes it links to. If an experiment would not clearly deepen understanding, say so and stop. Otherwise propose 2–3 candidates. For each, give: name, the core concept it tests, goal, rough effort, core requirements, acceptance criteria, likely sticking points, and why it builds understanding. Keep each one scoped to the note's concept (an agent-loop note gets a minimal loop, not a multi-agent platform). Give no reference code at this stage.
2. **Wait for the owner's choice.** The owner picks a candidate and may edit its goal, scope and acceptance criteria. Write nothing to any file until they confirm.
3. **Register.** Add the confirmed experiment to the Chinese note with `status: planned`, `public` as the owner says, and the `zh` and `en` text for the title, description and requirements. This changes the note's translation source hash, so then follow "Translating notes": for an auto edition, copy its current title, description and body into `.translations/<id>.md` and run `apply`; for a manual one, report a manual one as `MANUAL_STALE`. Done when `npm run translate:check -- --strict` and `npm run build` pass.
4. **Coach in levels.** While the owner builds it, give the lowest level that unblocks them, and escalate only when asked: (1) hints about the approach, (2) pseudocode or key logic, (3) a reference implementation. Code review and help with tests are always fine.
5. **Complete.** Update `status`, add the `links` the owner gives you, and create a project article (`projectTier: experiment`, `experimentId`, `sourceNote`) only when the owner asks for one. The article stays an unpublished draft until the experiment is `completed`; at that point, set its `published` date and make sure its English edition is current. Record only results the owner actually produced. Done when the build passes and the experiment shows under Projects → More Experiments.
