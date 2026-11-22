/**
 * Practice problems (pure). A note in the `practice` section documents one
 * problem and records its fixed facts in the Chinese frontmatter:
 *
 *   problem:
 *     platform: leetcode        # leetcode | nowcoder
 *     number: 15                # required on LeetCode, absent on Nowcoder
 *     url: "https://leetcode.cn/problems/3sum/"
 *     difficulty: medium        # easy | medium | hard
 *     exam: false               # true = met in a real written test (笔试真题)
 *     listed: true              # false = not in the reference problem lists; tags placed by the author
 *
 * Knowledge points are the note's `tags`; mastery and review history are
 * review records (src/data/reviews.json). None of these fields is part of the
 * translation source hash, so the English edition inherits them unchanged.
 */
import { z } from 'astro/zod';

export const PROBLEM_PLATFORMS = ['leetcode', 'nowcoder'] as const;
export type ProblemPlatform = (typeof PROBLEM_PLATFORMS)[number];

/** Nowcoder's 较难 maps to `hard`. Labels live in src/i18n/ui.ts. */
export const PROBLEM_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type ProblemDifficulty = (typeof PROBLEM_DIFFICULTIES)[number];

/** Hosts each platform's problem pages live on. */
export const PLATFORM_HOSTS: Record<ProblemPlatform, readonly string[]> = {
  leetcode: ['leetcode.cn', 'leetcode.com'],
  nowcoder: ['www.nowcoder.com', 'nowcoder.com', 'ac.nowcoder.com'],
};

export const problemSchema = z.strictObject({
  platform: z.enum(PROBLEM_PLATFORMS),
  number: z.number().int().positive().optional(),
  url: z.url({ protocol: /^https$/, message: 'must be an absolute https URL' }),
  difficulty: z.enum(PROBLEM_DIFFICULTIES),
  exam: z.boolean().default(false),
  /** false = not in the reference problem lists (灵茶山艾府); its knowledge-point tags are the author's own placement. */
  listed: z.boolean().default(true),
});

export type Problem = z.infer<typeof problemSchema>;

export interface ProblemNoteInput {
  id: string;
  /** For messages, e.g. src/content/notes/foo.md */
  file: string;
  section: string;
  problem?: Problem;
}

/** Display key of a problem, e.g. "LeetCode 15"; also its identity across notes. */
export function problemKey(p: Pick<Problem, 'platform' | 'number' | 'url'>): string {
  return p.platform === 'leetcode' ? `leetcode:${p.number}` : `nowcoder:${normalizeUrl(p.url)}`;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return url;
  }
}

/**
 * Cross-entry rules the schema cannot see: only practice notes describe a
 * problem, LeetCode problems carry their number, the URL belongs to the
 * platform, and one problem has one note.
 */
export function validateProblems(entries: readonly ProblemNoteInput[]): { errors: string[] } {
  const errors: string[] = [];
  const owners = new Map<string, string>();
  for (const note of entries) {
    const p = note.problem;
    if (!p) continue;
    const at = (field: string) => `${note.file}: problem.${field}`;
    if (note.section !== 'practice') {
      errors.push(`${note.file}: problem: only practice notes (category: practice) describe a problem`);
      continue;
    }
    if (p.platform === 'leetcode' && p.number === undefined) errors.push(`${at('number')}: required for LeetCode problems`);
    if (p.platform === 'nowcoder' && p.number !== undefined) errors.push(`${at('number')}: Nowcoder problems have no number; remove it`);
    let host = '';
    try {
      host = new URL(p.url).hostname;
    } catch {
      errors.push(`${at('url')}: "${p.url}" is not a valid URL`);
    }
    if (host && !PLATFORM_HOSTS[p.platform].includes(host)) {
      errors.push(`${at('url')}: host "${host}" is not a ${p.platform} host (${PLATFORM_HOSTS[p.platform].join(', ')})`);
    }
    const key = problemKey(p);
    const owner = owners.get(key);
    if (owner) errors.push(`${note.file}: problem: the same problem is already documented in ${owner}; one problem has one note`);
    else owners.set(key, note.file);
  }
  return { errors };
}
