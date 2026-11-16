/**
 * Owner profile shown on the homepage.
 *
 * Anything wrapped in 【…】 / […] is a PLACEHOLDER: replace it with your own
 * words. Do not publish facts you have not written yourself.
 */
export const profile = {
  /** Display name. Currently the GitHub handle. */
  name: 'BoltzMamba',
  github: 'BoltzMamba',
  tagline: {
    zh: '【占位】用一句话介绍你自己，例如你在做什么、想成为怎样的工程师。',
    en: '[Placeholder] One sentence about yourself: what you work on and what kind of engineer you want to be.',
  },
  /** Topics currently being studied. */
  focus: {
    zh: ['AI Agent', '算法', '软件工程'],
    en: ['AI Agents', 'Algorithms', 'Software Engineering'],
  },
} as const;
