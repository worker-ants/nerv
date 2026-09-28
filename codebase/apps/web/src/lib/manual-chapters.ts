// 매뉴얼 장의 **id 만** — 본문 없이 목록이 필요한 곳을 위한 자리 (screens.md §2.10)
//
// `manual.ts` 는 장마다 md 본문을 `?raw` 로 물고 있다(로케일 둘 × 열 장). 그래서 그 파일을
// import 하는 것은 **매뉴얼 전문을 그 청크로 끌고 오는 일**이다 — `/help` 라우트에는 맞는
// 값이지만, "이 문자열이 장 id 인가" 하나를 묻는 자리에는 너무 비싸다.
//
// 목록을 여기 두고 `manual.ts` 가 그것을 쓰면 **정본은 하나인 채로** 본문 없이 물을 수 있다.
// 순서도 여기가 정한다 — 읽는 순서이자 이전·다음 링크의 순서다.

export const MANUAL_CHAPTER_IDS = [
  'start',
  'specs',
  'tasks',
  'sessions',
  'reviews',
  'inbox',
  'agents',
  'install',
  'settings',
  'shortcuts',
] as const;

export type ManualChapterId = (typeof MANUAL_CHAPTER_IDS)[number];

/**
 * 이 문자열이 매뉴얼의 장인가 — `user_guide` 증적이 갈 곳을 정할 때 쓴다(REQ-WEB-161).
 *
 * **짐작이 아니라 대조다.** 저장소마다 모양이 다른 테스트 이름과 달리 장 이름은 이 목록이
 * 정본이므로, 맞는 것만 링크로 만들고 나머지는 글자로 둔다.
 */
export function isManualChapter(value: string): value is ManualChapterId {
  return (MANUAL_CHAPTER_IDS as readonly string[]).includes(value);
}

/**
 * 장마다 **절 이름**(2026-09-28 · 사람 결정 · REQ-WEB-268) — 본문의 `{#이름}` 을 문서 순서대로 적은
 * 사본이다. 정본은 md 이고, 매뉴얼 검사가 "ko 의 이름 열 = en 의 이름 열 = 이 목록" 을 본다.
 *
 * 사본을 두는 이유는 둘이다. 화면의 도움말 링크가 장과 절의 짝을 **타입으로** 검사하게 하고,
 * `user_guide` 증적처럼 본문을 불러오지 않는 자리가 "이 절이 있는가" 를 물을 수 있게 한다.
 * `##` 는 모두 이름을 갖고, `###` 는 링크할 까닭이 있는 것만 갖는다.
 */
export const MANUAL_SECTION_IDS = {
  start: [
    'loop',
    'screens',
    'left-column',
    'narrow-screens',
    'roles',
    'signup',
    'forgot-password',
    'first-five-minutes',
    'toasts',
    'load-failures',
    'confirmations',
  ],
  specs: [
    'tree',
    'all-specs',
    'versions',
    'version-basis',
    'baselines',
    'compare',
    'attachments',
    'diagrams',
    'writing',
    'navigation',
    'body-views',
    'checks',
    'comments',
    'requirements',
    'relations',
    'archive',
  ],
  tasks: [
    'board',
    'task-sheet',
    'next-step',
    'brief',
    'claims',
    'done-archive',
    'evidence',
    'requirement-links',
    'stale-base',
    'baseline-tasks',
  ],
  sessions: ['monitor', 'plugin-machines', 'statuses', 'activity', 'steer-stop', 'questions'],
  reviews: ['review-sessions', 'severity', 'targets', 'filters', 'gate-coverage', 'badge'],
  inbox: [
    'cards',
    'card-contents',
    'card-scope',
    'questions',
    'deciding',
    'bulk',
    'keyboard',
    'card-links',
    'notifications',
  ],
  agents: ['components', 'tokens', 'skills', 'tool-tiers', 'import'],
  install: [
    'before',
    'token',
    'env',
    'env-settings-local',
    'env-nerv-env',
    'env-single-project',
    'claude-code',
    'ko-style',
    'codex',
    'verify',
    'first-task',
    'troubleshooting',
  ],
  settings: ['org', 'projects', 'members', 'invitations', 'account', 'tokens', 'gates'],
  shortcuts: ['quick-switcher', 'keyboard', 'dialogs', 'inbox', 'task-sheet', 'language', 'theme'],
} as const satisfies Record<ManualChapterId, readonly string[]>;

/** 그 장의 절 이름 — 화면 링크가 없는 절을 가리키면 컴파일이 멈춘다 */
export type ManualSectionId<C extends ManualChapterId> = (typeof MANUAL_SECTION_IDS)[C][number];

/** 이 장에 이 절이 있는가 — `user_guide` 증적이 절까지 갈지 정할 때 쓴다 */
export function isManualSection(chapter: ManualChapterId, section: string): boolean {
  return (MANUAL_SECTION_IDS[chapter] as readonly string[]).includes(section);
}

/**
 * 도움말이 가는 곳 — 장, 그리고 있으면 그 장의 절(2026-09-28 · 사람 결정 · REQ-WEB-268).
 * 절 이름은 아래 목록에서만 고를 수 있다 — 없는 절을 적으면 컴파일이 멈춘다.
 */
export interface HelpTarget {
  readonly chapter: ManualChapterId;
  readonly section?: string;
}

/** 장과 절의 짝을 타입이 본다 — `help('settings', 'gates')` */
export function help<C extends ManualChapterId>(chapter: C, section?: ManualSectionId<C>): HelpTarget {
  return section === undefined ? { chapter } : { chapter, section };
}

/** 링크 주소 — `/help/<장>` 또는 `/help/<장>#<절>` */
export function helpHref(target: HelpTarget): string {
  return `/help/${target.chapter}${target.section === undefined ? '' : `#${target.section}`}`;
}

/**
 * `<Link>` 에 펼쳐 넣는 도움말 링크 — `<Link {...helpLink('specs', 'requirements')}>`. 장과 절의 짝을
 * 타입이 보므로, 매뉴얼에서 절 이름이 바뀌면 그 링크가 있는 화면이 컴파일에서 멈춘다.
 */
export function helpLink<C extends ManualChapterId>(
  chapter: C,
  section?: ManualSectionId<C>,
): { to: '/help/$chapter'; params: { chapter: C }; hash?: string } {
  return {
    to: '/help/$chapter',
    params: { chapter },
    ...(section === undefined ? {} : { hash: section }),
  };
}
