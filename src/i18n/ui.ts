/**
 * UI dictionary. Article content is NOT translated; only interface strings.
 * Add a key to `zh` first: `en` must satisfy the same shape.
 */
import categoryLabels from '../data/categories.json';

export const languages = { zh: '中文', en: 'English' } as const;
export type Lang = keyof typeof languages;
export const LANGS = Object.keys(languages) as Lang[];
export const DEFAULT_LANG: Lang = 'zh';

export const htmlLang: Record<Lang, string> = { zh: 'zh-CN', en: 'en' };
export const intlLocale: Record<Lang, string> = { zh: 'zh-CN', en: 'en-US' };

const zh = {
  'site.name': 'Learning Garden',
  'site.tagline': '一个安静的技术学习花园',
  'site.description': '记录学习、复习与提问的个人技术知识花园。',
  'nav.home': '首页',
  'nav.notes': '笔记',
  'nav.questions': '问答',
  'nav.main': '主导航',
  'nav.skip': '跳到正文',
  'lang.switch': '切换语言',
  'theme.toggle': '切换明暗主题',
  'theme.toDark': '切换到深色主题',
  'theme.toLight': '切换到浅色主题',

  'home.intro': '这里是我的学习花园：文章发布之后并没有结束，知识会在复习、修订、提问与回答中继续生长。',
  'home.focus': '最近在学',
  'home.avatarAlt': '{name} 的头像',
  'home.readNotes': '阅读笔记',
  'home.scroll': '学习日志',
  'home.oceanHint': '指针划过，水面会泛起微澜',
  'home.log': '学习日志',
  'home.calendar': '学习日历',
  'home.recent': '最近的笔记',
  'home.allNotes': '全部笔记 →',

  'cal.activities': '{n} 项学习活动',
  'cal.noActivity': '没有学习活动',
  'cal.activities.one': '1 项学习活动',
  'cal.yearTotal': '{year} 年：{n} 项学习活动 · 活跃 {days} 天',
  'cal.year': '年份',
  'cal.less': '少',
  'cal.more': '多',
  'cal.hint': '点击或用方向键选择日期，查看当天的学习活动。',
  'cal.gridLabel': '{year} 年学习活动日历',
  'cal.detailsEmpty': '这一天没有记录学习活动。',
  'cal.future': '（未来日期）',
  'cal.type.publish': '发布',
  'cal.type.revision': '修订',
  'cal.type.review': '复习',
  'cal.type.question': '解答问题',
  'cal.legend': '活动强度按当天有效事件数计算；同一篇笔记同一天的复习只计一次。',

  'notes.title': '笔记',
  'notes.intro': '按主题整理的技术笔记。每篇笔记都会随着复习与提问不断修订。',
  'notes.categories': '分类',
  'notes.all': '全部',
  'notes.tags': '标签',
  'notes.clearTag': '清除标签筛选',
  'notes.filteredByTag': '标签：{tag}',
  'notes.empty': '还没有笔记。使用 npm run garden -- new 创建第一篇。',
  'notes.count': '{n} 篇',
  'notes.inCategory': '分类：{category}',

  'note.published': '发布于',
  'note.category': '分类',
  'note.tags': '标签',
  'note.history': '在 GitHub 查看修改历史',
  'note.source': '查看 Markdown 源文件',
  'note.timeline': '知识时间线',
  'note.revisions': '有意义的修订',
  'note.noRevisions': '暂无修订记录',
  'note.reviews': '复习',
  'note.reviewCount': '已复习 {n} 次',
  'note.reviewCount.one': '已复习 1 次',
  'note.lastReviewed': '最近一次：{date}',
  'note.neverReviewed': '还没有复习记录',
  'note.questions': '相关问题',
  'note.noQuestions': '这篇笔记还没有公开的问题。',
  'note.ask': '对这篇笔记有疑问？在 GitHub 提问',
  'note.back': '← 返回笔记',

  'q.title': '问答',
  'q.intro': '学习中遇到的问题，以及它们的答案。问题和回答都会经过整理后再公开。',
  'q.open': '待解决',
  'q.resolved': '已解决',
  'q.status.open': '待解决',
  'q.status.resolved': '已解决',
  'q.relatedNote': '相关笔记',
  'q.created': '提出于',
  'q.resolvedOn': '解决于',
  'q.answer': '回答',
  'q.noAnswer': '还没有回答，欢迎通过 Pull Request 补充。',
  'q.sources': '参考资料',
  'q.empty': '暂无公开问题。',
  'q.ask': '在 GitHub Issues 提问',
  'q.contribute': '外部提问通过 GitHub Issues 提交，回答与勘误通过 Pull Request 提交；所有内容都由站主审阅后才会出现在这里。',

  'footer.built': '用 Astro 构建，托管于 GitHub Pages。',
  'footer.source': '源代码',
  'notFound.title': '页面不存在',
  'notFound.body': '这条小路还没有长出来。',
  'notFound.home': '回到首页',
} as const;

export type UiKey = keyof typeof zh;

const en: Record<UiKey, string> = {
  'site.name': 'Learning Garden',
  'site.tagline': 'A quiet garden for technical learning',
  'site.description': 'A personal technical knowledge garden for learning, reviewing and asking questions.',
  'nav.home': 'Home',
  'nav.notes': 'Notes',
  'nav.questions': 'Questions',
  'nav.main': 'Main navigation',
  'nav.skip': 'Skip to content',
  'lang.switch': 'Switch language',
  'theme.toggle': 'Toggle colour theme',
  'theme.toDark': 'Switch to dark theme',
  'theme.toLight': 'Switch to light theme',

  'home.intro':
    'This is my learning garden. An article is not finished when it is published: knowledge keeps growing through review, revision, questions and answers.',
  'home.focus': 'Currently learning',
  'home.avatarAlt': 'Avatar of {name}',
  'home.readNotes': 'Read notes',
  'home.scroll': 'learning log',
  'home.oceanHint': 'your cursor stirs the water',
  'home.log': 'Learning log',
  'home.calendar': 'Learning calendar',
  'home.recent': 'Recent notes',
  'home.allNotes': 'All notes →',

  'cal.activities': '{n} learning activities',
  'cal.noActivity': 'No learning activity',
  'cal.activities.one': '1 learning activity',
  'cal.yearTotal': '{year} · activities: {n} · active days: {days}',
  'cal.year': 'Year',
  'cal.less': 'Less',
  'cal.more': 'More',
  'cal.hint': 'Click a day, or use the arrow keys, to see its activities.',
  'cal.gridLabel': 'Learning activity calendar for {year}',
  'cal.detailsEmpty': 'No learning activity was recorded on this day.',
  'cal.future': '(future date)',
  'cal.type.publish': 'Published',
  'cal.type.revision': 'Revised',
  'cal.type.review': 'Reviewed',
  'cal.type.question': 'Answered',
  'cal.legend': 'Intensity counts valid events per day; reviewing the same note twice on one day counts once.',

  'notes.title': 'Notes',
  'notes.intro': 'Technical notes grouped by topic. Each note keeps evolving through review and questions.',
  'notes.categories': 'Categories',
  'notes.all': 'All',
  'notes.tags': 'Tags',
  'notes.clearTag': 'Clear tag filter',
  'notes.filteredByTag': 'Tag: {tag}',
  'notes.empty': 'No notes yet. Run npm run garden -- new to create the first one.',
  'notes.count': '{n} notes',
  'notes.inCategory': 'Category: {category}',

  'note.published': 'Published',
  'note.category': 'Category',
  'note.tags': 'Tags',
  'note.history': 'View change history on GitHub',
  'note.source': 'View Markdown source',
  'note.timeline': 'Knowledge timeline',
  'note.revisions': 'Meaningful revisions',
  'note.noRevisions': 'No revisions recorded yet',
  'note.reviews': 'Reviews',
  'note.reviewCount': 'Reviewed {n} times',
  'note.reviewCount.one': 'Reviewed once',
  'note.lastReviewed': 'Last: {date}',
  'note.neverReviewed': 'Not reviewed yet',
  'note.questions': 'Related questions',
  'note.noQuestions': 'No public questions about this note yet.',
  'note.ask': 'Have a question about this note? Ask on GitHub',
  'note.back': '← Back to notes',

  'q.title': 'Questions',
  'q.intro': 'Questions that came up while learning, and their answers. Everything is curated before it appears here.',
  'q.open': 'Open',
  'q.resolved': 'Resolved',
  'q.status.open': 'Open',
  'q.status.resolved': 'Resolved',
  'q.relatedNote': 'Related note',
  'q.created': 'Asked',
  'q.resolvedOn': 'Resolved',
  'q.answer': 'Answer',
  'q.noAnswer': 'No answer yet. Contributions via Pull Request are welcome.',
  'q.sources': 'Sources',
  'q.empty': 'No public questions yet.',
  'q.ask': 'Ask on GitHub Issues',
  'q.contribute':
    'External questions are submitted through GitHub Issues, and answers or corrections through Pull Requests. Everything is reviewed by the owner before it appears here.',

  'footer.built': 'Built with Astro, hosted on GitHub Pages.',
  'footer.source': 'Source',
  'notFound.title': 'Page not found',
  'notFound.body': 'This path has not grown yet.',
  'notFound.home': 'Back home',
};

export const ui: Record<Lang, Record<UiKey, string>> = { zh, en };

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && value in languages;
}

export function useTranslations(lang: Lang) {
  return (key: UiKey, vars: Record<string, string | number> = {}): string => {
    // Singular form: use `<key>.one` when it exists and n === 1.
    const one = `${key}.one` as UiKey;
    const template = vars.n === 1 && one in ui[lang] ? ui[lang][one] : ui[lang][key];
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
  };
}

/** Category display names; unknown categories fall back to a title-cased slug. */
export function categoryLabel(category: string, lang: Lang): string {
  const labels = (categoryLabels as Record<string, Partial<Record<Lang, string>>>)[category];
  return labels?.[lang] ?? category.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
