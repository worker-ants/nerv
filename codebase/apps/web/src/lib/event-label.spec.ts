// 이벤트 문구 — 카탈로그 전수를 덮는가
//
// 몇 개만 옮기면 활동 피드에 한국어와 점 표기가 섞여 나온다. 카탈로그에 이벤트가 추가되면
// 이 테스트가 먼저 깨져서 문구를 같이 넣으라고 말해준다.

import { NERV_EVENT_NAMES } from '@nerv/schema';
import { describe, expect, it } from 'vitest';
import { EVENT_LABEL, eventLabel } from './event-label.js';

describe('EVENT_LABEL', () => {
  it('MVP 카탈로그의 모든 이벤트에 문구가 있다', () => {
    const missing = NERV_EVENT_NAMES.filter((name) => EVENT_LABEL[name] === undefined);
    expect(missing).toEqual([]);
  });

  it('모르는 이벤트는 원래 이름을 그대로 돌려준다 — 빈칸보다 낫다', () => {
    expect(eventLabel('phase2.something')).toBe('phase2.something');
  });
});
