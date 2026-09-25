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
import {
  findingSeverity,
  findingStatus,
  implStatus,
  sessionState,
  specVersionStatus,
  taskStatus,
} from '../enums.js';
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
      '권한이 부족합니다: task:claim',
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
    ['finding', findingStatus.enumValues],
  ] as const)('%s 상태값 전부에 라벨이 있다', (entity, values) => {
    const missing = values.filter(
      (value) => ko[statusLabelKey(entity, value) as keyof typeof ko] === undefined,
    );
    expect(missing).toEqual([]);
  });

  it('심각도 전부에 라벨이 있다 — 색만으로 구분하지 않는다(REQ-WEB-033)', () => {
    const missing = findingSeverity.enumValues.filter(
      (value) => ko[`severity.${value}` as keyof typeof ko] === undefined,
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

// ── 말투 (docs/glossary.md §3.1 · 2026-09-25 사람 결정 D5 · UI/UX 검토 SYS-10) ─────────────
//
// 화면은 합쇼체다. 규칙은 적혀 있었지만(§3.1) 세는 곳이 없어서, 홈에서 가장 큰 글자가 "밀린 결정이 없어요" 였고
// 바로 아래 문장은 "기다리는 항목이 없습니다." 였다 — 한 카드 안에서 말투가 바뀌었다. 해요체 여덟 · 해라체 둘이
// 새 화면이 들어올 때마다 조용히 늘었다(그중 하나는 전날 들어온 로그인 화면이다). **요청형 "-세요" 는 허용한다**
// (D5 — "다시 시도하십시오" 는 화면에서 딱딱하다). 설계 문서의 말(결정 번호 · "MVP")도 화면에 새지 않는다.
describe('말투 — 사람이 보는 화면은 합쇼체다', () => {
  /** 에이전트·CLI 가 받는 것과 생성 문서 — 해라체다(§3.1). 여기서는 세지 않는다 */
  const AGENT_PREFIXES = ['mcp.', 'agent.', 'cli.', 'import.', 'export.'];
  /**
   * 해라체가 맞는 화면 문구 — **문구 자체가 해라체로 쓰는 형식의 견본**이다. 요구사항 문장의 모양
   * (`… THE SYSTEM SHALL <동작>한다`)을 보여 주는 자리라, 합쇼체로 바꾸면 틀린 견본이 된다.
   */
  const HAERA_SAMPLES = new Set(['spec.requirements.format']);
  const screen = Object.entries(ko).filter(
    ([key]) => !AGENT_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );

  it('해요체로 끝나는 문장이 없다 — "-세요" 는 허용이다', () => {
    const haeyo = /(?:어요|아요|해요|예요|에요|네요|나요|까요|려고요|죠)(?=[.?!,)\s]|$)/;
    expect(screen.filter(([, value]) => haeyo.test(value)).map(([key]) => key)).toEqual([]);
    // 허용한 요청형이 검사에 걸리지 않는다
    expect(haeyo.test('다시 시도하세요')).toBe(false);
    expect(haeyo.test('목표를 적어 주세요.')).toBe(false);
  });

  it('해라체로 끝나는 문장이 없다 — 문장 끝의 "다" 는 "니다" 다', () => {
    // 문장 끝: 마침표·물음표·괄호 앞 · 줄 끝 · 줄표 앞. 문장 중간의 "마다 " · "그리다 " 는 세지 않는다
    const haera = /(?<!니)다(?=[.!?(]|$|\s—|\n)/;
    expect(
      screen
        .filter(([key, value]) => !HAERA_SAMPLES.has(key) && haera.test(value))
        .map(([key]) => key),
    ).toEqual([]);
    expect(haera.test('먼저 클레임한다.')).toBe(true);
    expect(haera.test('반복되면 올린다(D-14).')).toBe(true);
    expect(haera.test('프로젝트마다 따로입니다')).toBe(false);
  });

  it('설계 문서의 말이 화면에 새지 않는다 — 결정 번호 · "MVP"', () => {
    // "(D-08)" 을 읽은 사람은 그 뜻을 찾을 곳이 없다 — 이유는 문장으로 말한다
    const leak = /\bD-\d{2}\b|\bMVP\b/;
    expect(screen.filter(([, value]) => leak.test(value)).map(([key]) => key)).toEqual([]);
  });

  it('예외로 둔 견본은 실제로 해라체다 — 고쳐지면 예외도 걷는다', () => {
    for (const key of HAERA_SAMPLES) {
      expect(ko[key as keyof typeof ko]).toMatch(/다$/);
    }
  });
});
