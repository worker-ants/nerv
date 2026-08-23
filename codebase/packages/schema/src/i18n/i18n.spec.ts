// i18n 코어 — 타입이 못 지키는 것을 여기서 지킨다.
//
// 키 집합은 `Catalog<typeof ko>` 가 컴파일 시점에 강제한다. 타입이 볼 수 없는 것이 둘 남는데,
// 그 둘이 실제로 화면을 깨뜨리는 것들이다:
//   ① **자리표시자 불일치** — en 이 `{key}` 를 빠뜨리면 문장에서 정보가 사라진다
//   ② **협상 규칙** — 웹이 `ko-KR` 을 보내는데 API 가 못 알아들으면 화면 절반이 영어로 남는다

import { describe, expect, it } from 'vitest';
import { en } from './en.js';
import { ko } from './ko.js';
import { NERV_EVENT_NAMES } from '../events.js';
import { implStatus, sessionState, specVersionStatus, taskStatus } from '../enums.js';
import { eventLabelKey, statusLabelKey } from './domain.js';
import { LOCALES, negotiateLocale } from './locale.js';
import { createTranslator, msg, renderMessage } from './index.js';

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
}

describe('카탈로그', () => {
  it('en 은 ko 와 키 집합이 같다 — 타입이 이미 막지만 값으로도 확인한다', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ko).sort());
  });

  it('모든 로케일의 자리표시자가 일치한다', () => {
    const mismatched = Object.keys(ko).filter(
      (key) =>
        placeholders(ko[key as keyof typeof ko]).join(',') !==
        placeholders(en[key as keyof typeof en]).join(','),
    );
    expect(mismatched).toEqual([]);
  });

  it('빈 문구가 없다 — 빈 값은 화면에 구멍을 낸다', () => {
    const empty = Object.entries({ ...ko, ...en }).filter(([, v]) => v.trim() === '');
    expect(empty).toEqual([]);
  });

  it('키에 자리표시자 문법이 새지 않았다 — `${}` 는 카탈로그에 들어오면 안 된다', () => {
    const leaked = Object.entries(ko).filter(([, v]) => v.includes('${'));
    expect(leaked).toEqual([]);
  });

  it('중괄호는 자리표시자일 때만 쓴다', () => {
    // 문장 안의 리터럴 `{ ... }` 는 타입 수준에서도 자리표시자로 읽힌다 —
    // JSON 모양을 예시로 적었다가 인자를 요구받는 사고가 실제로 났다.
    const bad = Object.entries({ ...ko, ...en }).filter(([, v]) =>
      [...v.matchAll(/\{([^}]*)\}/g)].some((m) => !/^\w+$/.test(m[1] ?? '')),
    );
    expect(bad).toEqual([]);
  });
});

describe('번역', () => {
  it('로케일별로 다른 문장을 준다', () => {
    expect(createTranslator('ko')('error.auth.missing')).toBe('자격증명이 없습니다.');
    expect(createTranslator('en')('error.auth.missing')).toBe('Not signed in.');
  });

  it('자리표시자를 값으로 채운다', () => {
    expect(createTranslator('ko')('error.auth.scope_missing', { scope: 'task:claim' })).toBe(
      '스코프가 부족합니다: task:claim',
    );
  });

  it('모르는 키는 키 자체를 돌려준다 — 빈 문자열은 원인을 감춘다', () => {
    const t = createTranslator('en') as (key: string) => string;
    expect(t('no.such.key')).toBe('no.such.key');
  });

  it('Message 는 로케일을 나중에 정한다 — 던질 때가 아니라 응답할 때', () => {
    const m = msg('error.task.not_ready', { status: 'backlog' });
    expect(renderMessage(m, 'ko')).toBe('작업이 ready 가 아닙니다(backlog).');
    expect(renderMessage(m, 'en')).toBe('The task is not ready (backlog).');
  });
});

describe('Accept-Language 협상', () => {
  it.each([
    ['ko', 'ko'],
    ['ko-KR', 'ko'],
    ['en-US,en;q=0.9', 'en'],
    ['en;q=0.9, ko;q=0.8', 'en'],
    ['ko;q=0.8, en;q=0.9', 'en'],
    ['fr-FR,fr;q=0.9', 'ko'],
    ['*', 'ko'],
    ['', 'ko'],
  ])('%s → %s', (header, expected) => {
    expect(negotiateLocale(header)).toBe(expected);
  });

  it('없거나 깨진 헤더도 기본 로케일로 떨어진다 — 협상 실패가 500 이 되면 안 된다', () => {
    expect(negotiateLocale(null)).toBe('ko');
    expect(negotiateLocale(undefined)).toBe('ko');
    expect(negotiateLocale(';;;q=')).toBe('ko');
  });

  it('로케일 목록의 첫 값이 기본값이다', () => {
    expect(LOCALES[0]).toBe('ko');
  });
});

describe('도메인 값 전수 커버', () => {
  // 라벨 표를 손으로 두 벌 관리하면 새 상태값이 조용히 식별자 그대로 화면에 뜬다.
  // 키를 식별자에서 기계적으로 얻는 대신, 그 키가 실재하는지는 여기서 본다.
  it('MVP 이벤트 카탈로그 전부에 문구가 있다', () => {
    const missing = NERV_EVENT_NAMES.filter((name) => ko[eventLabelKey(name)] === undefined);
    expect(missing).toEqual([]);
  });

  it.each([
    ['spec', specVersionStatus.enumValues],
    ['requirement', implStatus.enumValues],
    ['task', taskStatus.enumValues],
    ['session', sessionState.enumValues],
  ] as const)('%s 상태값 전부에 라벨이 있다', (entity, values) => {
    const missing = values.filter(
      (value) => ko[statusLabelKey(entity, value) as keyof typeof ko] === undefined,
    );
    expect(missing).toEqual([]);
  });
});

describe('키 이름 규약', () => {
  it('이벤트 이름 모양의 키를 쓰지 않는다 — lint 가 하드코딩으로 오인한다', () => {
    // `spec.submitted` 같은 키는 REQ-CB-006 규칙(이벤트 이름 하드코딩 금지)에 그대로 걸린다.
    // 실제로 걸렸고, 그래서 `spec.badge_superseded` 처럼 비켜 간다.
    const eventShaped = Object.keys(ko).filter(
      (key) => !key.startsWith('event.') && NERV_EVENT_NAMES.includes(key as never),
    );
    expect(eventShaped).toEqual([]);
  });
});
