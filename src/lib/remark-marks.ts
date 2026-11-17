/**
 * remark plugin: text colour and highlight marks for notes.
 *
 *   ==text==                     yellow highlight (shorthand)
 *   :hl[text]{color="red"}       highlight: red | yellow | blue | green | pink
 *   :ink[text]{color="blue"}     text colour: default | gray | blue | red | yellow
 *
 * Both are real Markdown syntax, parsed by micromark — never regex over HTML:
 *
 * - `==` is a micromark construct adapted from GFM strikethrough (`~~`), so it
 *   follows the same rules as emphasis: it only exists in text, never inside
 *   code, inline code or math (those are tokenised first), pairs like `**`,
 *   may contain emphasis, links and wikilinks, and an unpaired `==`, `===`, a
 *   spaced comparison (`a == b`) or an escaped `\==` stays literal text.
 * - `:hl` / `:ink` are *text* directives (micromark-extension-directive, text
 *   construct only — `::leaf` and `:::container` blocks are not enabled).
 *   Any other `:name` (e.g. "key:value" in prose) is restored to its source
 *   text, so enabling directives never changes existing content.
 *
 * Output is a fixed vocabulary of class names (`hl hl-<color>`, `ink
 * ink-<color>`); attributes are never passed through, so no CSS or HTML can be
 * injected. Invalid colours or attributes print a build warning and render the
 * text unstyled. Marks inside headings are unwrapped (with a warning) so
 * heading ids, the table of contents and the graph only ever see plain text.
 */
import { splice } from 'micromark-util-chunked';
import { classifyCharacter } from 'micromark-util-classify-character';
import { resolveAll } from 'micromark-util-resolve-all';
import { directive } from 'micromark-extension-directive';
import { directiveFromMarkdown } from 'mdast-util-directive';
import type { Code, Event, Extension, Resolver, State, Token, TokenizeContext, Tokenizer } from 'micromark-util-types';

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    mark: 'mark';
    markText: 'markText';
    markSequence: 'markSequence';
    markSequenceTemporary: 'markSequenceTemporary';
  }
}

export const HIGHLIGHT_COLORS =['red', 'yellow', 'blue', 'green', 'pink'] as const;
export const INK_COLORS = ['default', 'gray', 'blue', 'red', 'yellow'] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];
export type InkColor = (typeof INK_COLORS)[number];
/** Directive name → allowed colours and the colour used when none is given. */
export const MARK_DIRECTIVES = {
  hl: { colors: HIGHLIGHT_COLORS as readonly string[], fallback: 'yellow', tag: 'mark', prefix: 'hl' },
  ink: { colors: INK_COLORS as readonly string[], fallback: 'default', tag: 'span', prefix: 'ink' },
} as const;
type MarkDirective = keyof typeof MARK_DIRECTIVES;
/** Text directives owned by other plugins (src/lib/remark-concepts.ts); everything else is restored as text. */
export const OTHER_DIRECTIVES = ['concept', 'dfn'] as const;

// ------------------------------------------------------- `==` micromark syntax

const EQUALS = 61; // `=`
const ATTENTION_SIDE_AFTER = 2; // micromark constants.attentionSideAfter

type SequenceToken = Token & { _open?: boolean; _close?: boolean };

/** micromark extension: `==text==` → `mark` tokens (attention rules, exactly two markers). */
export function markSyntax(): Extension {
  const tokenizer = { name: 'mark', tokenize: tokenizeMark, resolveAll: resolveAllMark };
  return {
    text: { [EQUALS]: tokenizer },
    insideSpan: { null: [tokenizer] },
    attentionMarkers: { null: [EQUALS] },
  };
}

const resolveAllMark: Resolver = (events, context) => {
  let index = -1;
  while (++index < events.length) {
    const closer = events[index][1] as SequenceToken;
    if (events[index][0] !== 'enter' || closer.type !== 'markSequenceTemporary' || !closer._close) continue;
    let open = index;
    while (open--) {
      const opener = events[open][1] as SequenceToken;
      if (
        events[open][0] === 'exit' &&
        opener.type === 'markSequenceTemporary' &&
        opener._open &&
        closer.end.offset - closer.start.offset === opener.end.offset - opener.start.offset
      ) {
        closer.type = 'markSequence';
        opener.type = 'markSequence';
        const mark: Token = { type: 'mark', start: { ...opener.start }, end: { ...closer.end } };
        const text: Token = { type: 'markText', start: { ...opener.end }, end: { ...closer.start } };
        const next: Event[] = [
          ['enter', mark, context],
          ['enter', opener, context],
          ['exit', opener, context],
          ['enter', text, context],
        ];
        const insideSpan = context.parser.constructs.insideSpan.null;
        if (insideSpan) splice(next, next.length, 0, resolveAll(insideSpan, events.slice(open + 1, index), context));
        splice(next, next.length, 0, [
          ['exit', text, context],
          ['enter', closer, context],
          ['exit', closer, context],
          ['exit', mark, context],
        ]);
        splice(events, open - 1, index - open + 3, next);
        index = open + next.length - 2;
        break;
      }
    }
  }
  // Unpaired markers are plain text.
  for (const event of events) if (event[1].type === 'markSequenceTemporary') event[1].type = 'data';
  return events;
};

const tokenizeMark: Tokenizer = function (this: TokenizeContext, effects, ok, nok) {
  const previous = this.previous;
  const events = this.events;
  let size = 0;

  const start: State = (code: Code) => {
    // Part of a longer run (`===`), unless the previous `=` was escaped.
    if (previous === EQUALS && events[events.length - 1][1].type !== 'characterEscape') return nok(code);
    effects.enter('markSequenceTemporary');
    return more(code);
  };

  const more: State = (code: Code) => {
    const before = classifyCharacter(previous);
    if (code === EQUALS) {
      if (size > 1) return nok(code); // three or more: not a mark
      effects.consume(code);
      size++;
      return more;
    }
    if (size < 2) return nok(code); // a single `=` is just text
    const token = effects.exit('markSequenceTemporary') as SequenceToken;
    const after = classifyCharacter(code);
    token._open = !after || (after === ATTENTION_SIDE_AFTER && Boolean(before));
    token._close = !before || (before === ATTENTION_SIDE_AFTER && Boolean(after));
    return ok(code);
  };

  return start;
};

// ----------------------------------------------------------- mdast + plugin

interface MdNode {
  type: string;
  name?: string;
  value?: string;
  attributes?: Record<string, string | null | undefined> | null;
  children?: MdNode[];
  data?: Record<string, unknown>;
  position?: { start: { offset?: number }; end: { offset?: number } };
}

const markFromMarkdown = {
  canContainEols: ['mark'],
  enter: {
    mark(this: { enter: (node: MdNode, token: Token) => void }, token: Token) {
      this.enter({ type: 'mark', children: [] }, token);
    },
  },
  exit: {
    mark(this: { exit: (token: Token) => void }, token: Token) {
      this.exit(token);
    },
  },
};

const plainText = (node: MdNode): string =>
  node.value ?? (node.children ?? []).map(plainText).join('');

export interface MarkWarning {
  file: string;
  message: string;
}

/** Decide what a `mark` node or a text directive becomes. */
function classify(node: MdNode): { kind: 'style'; tag: string; className: string[] } | { kind: 'unwrap'; why?: string } | { kind: 'restore' } | { kind: 'other' } {
  if (node.type === 'mark') return { kind: 'style', tag: 'mark', className: ['hl', 'hl-yellow'] };
  if (node.type !== 'textDirective') return { kind: 'other' };
  // Handled by remark-concepts (runs next).
  if (node.name !== undefined && (OTHER_DIRECTIVES as readonly string[]).includes(node.name)) return { kind: 'other' };
  const spec =MARK_DIRECTIVES[node.name as MarkDirective];
  if (!spec || !Object.hasOwn(MARK_DIRECTIVES, node.name!)) return { kind: 'restore' };
  const attrs = node.attributes ?? {};
  const extra = Object.keys(attrs).filter((k) => k !== 'color');
  const color = attrs.color ?? spec.fallback;
  if (!spec.colors.includes(color)) {
    return { kind: 'unwrap', why: `:${node.name} color "${color}" is not one of ${spec.colors.join(', ')}; rendered without colour` };
  }
  if (extra.length) {
    return { kind: 'unwrap', why: `:${node.name} only accepts color="…" (got ${extra.join(', ')}); rendered without colour` };
  }
  return { kind: 'style', tag: spec.tag, className: [spec.prefix, `${spec.prefix}-${color}`] };
}

/**
 * The transform, exported for tests: styles marks, restores unknown
 * directives, unwraps invalid ones and anything inside headings.
 */
export function transformMarks(tree: MdNode, source: string | undefined, warn: (message: string) => void): void {
  const visit = (node: MdNode, inHeading: boolean) => {
    if (!node.children) return;
    const out: MdNode[] = [];
    for (const child of node.children) {
      const decision = classify(child);
      if (decision.kind === 'other') {
        visit(child, inHeading || child.type === 'heading');
        out.push(child);
        continue;
      }
      if (decision.kind === 'restore') {
        // Not ours (e.g. "key:value"): put the original characters back.
        const { start, end } = child.position ?? { start: {}, end: {} };
        const raw =
          source !== undefined && start.offset !== undefined && end.offset !== undefined
            ? source.slice(start.offset, end.offset)
            : `:${child.name ?? ''}${child.children?.length ? `[${plainText(child)}]` : ''}`;
        out.push({ type: 'text', value: raw });
        continue;
      }
      visit(child, inHeading);
      const empty = plainText(child).trim() === '' && !(child.children ?? []).some((c) => c.type !== 'text');
      if (empty) {
        warn(`empty ${child.type === 'mark' ? '==…==' : `:${child.name}[…]`} ignored`);
        continue;
      }
      if (decision.kind === 'unwrap' || inHeading) {
        if (decision.kind === 'unwrap') warn(decision.why!);
        else warn(`colour marks are not supported in headings; "${plainText(child)}" is rendered as plain heading text`);
        out.push(...(child.children ?? []));
        continue;
      }
      child.data = { ...child.data, hName: decision.tag, hProperties: { className: decision.className } };
      out.push(child);
    }
    node.children = mergeText(out);
  };
  visit(tree, tree.type === 'heading');
}

/** Restored/unwrapped text sits next to other text: merge so later plugins (wikilinks) see whole runs. */
function mergeText(nodes: MdNode[]): MdNode[] {
  const out: MdNode[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (n.type === 'text' && last?.type === 'text') out[out.length - 1] = { ...last, value: (last.value ?? '') + (n.value ?? ''), position: undefined };
    else out.push(n);
  }
  return out;
}

interface Processor {
  data(): Record<string, unknown[] | undefined>;
}

export default function remarkMarks(this: Processor) {
  const data = this.data();
  const textDirectives = directive();
  delete (textDirectives as { flow?: unknown }).flow; // text directives only
  (data.micromarkExtensions ??= []).push(markSyntax(), textDirectives);
  (data.fromMarkdownExtensions ??= []).push(markFromMarkdown, directiveFromMarkdown());

  return (tree: unknown, file: { path?: string; history?: string[]; value?: unknown }) => {
    const name = (file.path ?? file.history?.[0] ?? '').replace(/\\/g, '/').split('/').slice(-2).join('/');
    const source = typeof file.value === 'string' ? file.value : file.value instanceof Uint8Array ? new TextDecoder().decode(file.value) : undefined;
    transformMarks(tree as MdNode, source, (message) => console.warn(`[marks] ${name}: ${message}`));
  };
}
