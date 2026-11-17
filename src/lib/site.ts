/** Repository-level settings shared by pages and tests. */
export const GITHUB_OWNER = 'BoltzMamba';
export const GITHUB_REPO = 'learning-garden';
export const GITHUB_BRANCH = 'main';
export const REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;
/** GitHub Pages base path (must match `base` in astro.config.mjs). */
export const SITE_BASE = '/learning-garden';

/** A user's GitHub activity overview for one day. */
export function githubDayUrl(date: string): string {
  return `https://github.com/${GITHUB_OWNER}?tab=overview&from=${date}&to=${date}`;
}

/** Encode each path segment separately so `/` separators survive. */
export function encodeRepoPath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/');
}

/** Commit history of one file on GitHub. */
export function githubHistoryUrl(filePath: string): string {
  return `${REPO_URL}/commits/${GITHUB_BRANCH}/${encodeRepoPath(filePath)}`;
}

export function githubSourceUrl(filePath: string): string {
  return `${REPO_URL}/blob/${GITHUB_BRANCH}/${encodeRepoPath(filePath)}`;
}

/** Prefilled GitHub issue form for asking a question. */
export function newQuestionIssueUrl(noteId?: string, noteTitle?: string): string {
  const params = new URLSearchParams({ template: 'question.yml' });
  if (noteId) params.set('note', noteId);
  if (noteTitle) params.set('title', `[Question] ${noteTitle}: `);
  return `${REPO_URL}/issues/new?${params.toString()}`;
}
