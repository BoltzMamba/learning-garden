/**
 * Owner profile shown in the homepage hero. Edit freely.
 * Keep it factual: do not add experience or achievements you have not written yourself.
 */
export const profile = {
  name: 'BoltzMamba',
  github: 'BoltzMamba',
  /** Stable GitHub avatar URL (by numeric user id, so it survives username changes). */
  avatar: 'https://avatars.githubusercontent.com/u/242442733?v=4&s=224',
  intro: {
    zh: '探索 AI Agent、算法与软件工程，在学习和实践中持续记录与积累。',
    en: 'Exploring AI agents, algorithms, and software engineering. Learning, building, and documenting along the way.',
  },
  /** Topics currently being studied. */
  focus: {
    zh: ['AI Agent', '算法', '软件工程'],
    en: ['AI Agents', 'Algorithms', 'Software Engineering'],
  },
} as const;
