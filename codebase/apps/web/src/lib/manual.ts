// 제품 매뉴얼의 정본 목차 — 화면과 문서를 잇는 유일한 표
//
// 본문은 `src/content/manual/<로케일>/<장>.md` 이고 **로케일마다 한 벌**이다. 장의 제목만
// 문구 카탈로그에서 온다: 제목은 사이드바·도움말 메뉴·문서 머리 세 곳에 나타나므로 본문
// 안에 두면 세 곳이 각자 다른 이름을 부르게 된다. 그래서 md 는 `##` 부터 시작한다.
//
// **화면이 바뀌면 이 표와 본문도 같이 바뀐다**(AGENTS.md "도움말 갱신"). 여기가 낡으면
// 매뉴얼은 없는 것보다 나쁘다 — 없는 문서는 사람을 헤매게 하지만, 틀린 문서는 확신을 준다.

import type { Locale, MessageKey } from '@nerv/schema';
import type { ManualChapterId } from './manual-chapters.js';

/**
 * 장 제목 키만 따로 좁힌다.
 *
 * `MessageKey` 전체로 두면 `t(chapter.titleKey)` 가 컴파일되지 않는다 — 번역기는 문구의
 * `{자리표시자}` 를 타입에서 뽑아 인자를 요구하는데, 키가 카탈로그 전체의 합집합이면
 * 자리표시자도 합집합이 되어 "인자 하나를 더 달라"가 된다. 접두사로 좁히면 그 아홉 개는
 * 전부 자리표시자가 없으므로 인자가 사라진다.
 */
type ManualTitleKey = Extract<MessageKey, `help.ch.${string}`>;

import agentsEn from '../content/manual/en/agents.md?raw';
import inboxEn from '../content/manual/en/inbox.md?raw';
import installEn from '../content/manual/en/install.md?raw';
import reviewsEn from '../content/manual/en/reviews.md?raw';
import sessionsEn from '../content/manual/en/sessions.md?raw';
import settingsEn from '../content/manual/en/settings.md?raw';
import shortcutsEn from '../content/manual/en/shortcuts.md?raw';
import specsEn from '../content/manual/en/specs.md?raw';
import startEn from '../content/manual/en/start.md?raw';
import tasksEn from '../content/manual/en/tasks.md?raw';

import agentsKo from '../content/manual/ko/agents.md?raw';
import inboxKo from '../content/manual/ko/inbox.md?raw';
import installKo from '../content/manual/ko/install.md?raw';
import reviewsKo from '../content/manual/ko/reviews.md?raw';
import sessionsKo from '../content/manual/ko/sessions.md?raw';
import settingsKo from '../content/manual/ko/settings.md?raw';
import shortcutsKo from '../content/manual/ko/shortcuts.md?raw';
import specsKo from '../content/manual/ko/specs.md?raw';
import startKo from '../content/manual/ko/start.md?raw';
import tasksKo from '../content/manual/ko/tasks.md?raw';

export interface ManualChapter {
  /** 주소의 한 조각 — `/help/tasks`. 로케일과 무관하고 **정본은 `manual-chapters.ts` 다** */
  readonly id: ManualChapterId;
  readonly titleKey: ManualTitleKey;
  readonly body: Readonly<Record<Locale, string>>;
}

/**
 * 목차 — 배열 순서가 곧 읽는 순서이고 이전·다음 링크의 순서다.
 *
 * **id 의 정본은 `manual-chapters.ts` 다**(2026-09-10 · REQ-WEB-161). 본문 없이 목록만
 * 필요한 자리가 생겨(증적이 가리키는 장) 그쪽으로 갈랐다 — 여기를 import 하면 매뉴얼 전문이
 * 딸려 온다. 타입이 두 목록을 묶으므로 한쪽만 늘면 컴파일이 막는다.
 */
export const MANUAL_CHAPTERS: readonly ManualChapter[] = [
  { id: 'start', titleKey: 'help.ch.start', body: { ko: startKo, en: startEn } },
  { id: 'specs', titleKey: 'help.ch.specs', body: { ko: specsKo, en: specsEn } },
  { id: 'tasks', titleKey: 'help.ch.tasks', body: { ko: tasksKo, en: tasksEn } },
  { id: 'sessions', titleKey: 'help.ch.sessions', body: { ko: sessionsKo, en: sessionsEn } },
  { id: 'reviews', titleKey: 'help.ch.reviews', body: { ko: reviewsKo, en: reviewsEn } },
  { id: 'inbox', titleKey: 'help.ch.inbox', body: { ko: inboxKo, en: inboxEn } },
  { id: 'agents', titleKey: 'help.ch.agents', body: { ko: agentsKo, en: agentsEn } },
  { id: 'install', titleKey: 'help.ch.install', body: { ko: installKo, en: installEn } },
  { id: 'settings', titleKey: 'help.ch.settings', body: { ko: settingsKo, en: settingsEn } },
  { id: 'shortcuts', titleKey: 'help.ch.shortcuts', body: { ko: shortcutsKo, en: shortcutsEn } },
];

/** `/help` 가 여는 첫 장 */
export const FIRST_CHAPTER = MANUAL_CHAPTERS[0]?.id ?? 'start';

export function findChapter(id: string): ManualChapter | undefined {
  return MANUAL_CHAPTERS.find((chapter) => chapter.id === id);
}

/** 이전·다음 — 목차 순서 그대로. 끝에서는 `undefined` 다(순환하지 않는다) */
export function chapterNeighbours(id: string): {
  previous: ManualChapter | undefined;
  next: ManualChapter | undefined;
} {
  const index = MANUAL_CHAPTERS.findIndex((chapter) => chapter.id === id);
  if (index < 0) return { previous: undefined, next: undefined };
  return { previous: MANUAL_CHAPTERS[index - 1], next: MANUAL_CHAPTERS[index + 1] };
}

/**
 * 지금 보는 화면 → 그 화면을 설명하는 장.
 *
 * 도움말 메뉴의 "이 화면 도움말"이 쓴다. **짚어 줄 장이 없으면 `null`** 이다 — 아무 데나
 * 보내느니 그 항목을 아예 안 보이는 편이 낫다. 홈처럼 첫 장이 곧 답인 화면은 "제품 매뉴얼"
 * 항목이 이미 같은 곳으로 간다.
 *
 * 위에서부터 먼저 맞는 것을 쓴다 — `/p/x/specs/y` 는 스펙 장이지 프로젝트 개요가 아니다.
 */
const ROUTE_CHAPTERS: readonly (readonly [RegExp, string])[] = [
  [/^\/p\/[^/]+\/specs(\/|$)/, 'specs'],
  [/^\/p\/[^/]+\/tasks(\/|$)/, 'tasks'],
  [/^\/p\/[^/]+\/sessions(\/|$)/, 'sessions'],
  [/^\/p\/[^/]+\/reviews(\/|$)/, 'reviews'],
  [/^\/(inbox|notifications)(\/|$)/, 'inbox'],
  [/^\/settings(\/|$)/, 'settings'],
  // 프로젝트 개요(`/p/:proj`)는 **맨 아래**다 — 위의 하위 화면들이 먼저 맞아야 한다.
  // 그 화면의 구현 현황 다섯 숫자(특히 `증적 결손`·`빈 약속`)를 설명하는 자리가
  // 스펙 장이라 거기로 보낸다. 대응이 없으면 "이 화면 도움말" 자체가 뜨지 않는다.
  [/^\/p\/[^/]+(\/|$)/, 'specs'],
];

export function chapterForRoute(pathname: string): string | null {
  return ROUTE_CHAPTERS.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}
