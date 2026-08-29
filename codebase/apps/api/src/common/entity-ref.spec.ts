// 참조는 키든 UUID 든 받는다 — 도구마다 기준이 다르던 것의 회귀 방지 (api.md §1.4b)
//
// 이 규칙이 틀리면 조용히 나쁘다: UUID 를 키로 읽으면 "없는 스펙"이 되고, 키를 UUID 로 읽으면
// `::uuid` 캐스팅에서 22P02 가 나 **사용자 잘못이 500 으로** 보고된다.

import { describe, expect, it } from 'vitest';
import { entityRef, looksLikeUuid } from './entity-ref.js';

describe('참조 읽기', () => {
  it('UUID 는 id 로 읽는다', () => {
    expect(entityRef('01a04d4b-16d0-7293-919c-40025a7313b1')).toEqual({
      id: '01a04d4b-16d0-7293-919c-40025a7313b1',
      key: null,
    });
  });

  it('안정 키는 key 로 읽는다 — 사람과 화면이 쓰는 것이 이쪽이다', () => {
    expect(entityRef('SPC-CWC-007')).toEqual({ id: null, key: 'SPC-CWC-007' });
    expect(entityRef('CLV-T-0CFQC2')).toEqual({ id: null, key: 'CLV-T-0CFQC2' });
    expect(entityRef('sudoku-area-play')).toEqual({ id: null, key: 'sudoku-area-play' });
  });

  it('앞뒤 공백은 벗긴다 — 복사·붙여넣기가 실패 이유가 되지 않게', () => {
    expect(entityRef('  SPC-CWC-007 ')).toEqual({ id: null, key: 'SPC-CWC-007' });
  });

  it('빈 값은 "안 준 것"이다 — 필수 여부는 부르는 쪽이 정한다', () => {
    for (const value of ['', '   ', undefined, null]) {
      expect(entityRef(value)).toEqual({ id: null, key: null });
    }
  });

  it('UUID 판별은 형태로 한다 — 판(v4·v7)을 가리지 않는다', () => {
    expect(looksLikeUuid('01a04d4b-16d0-7293-919c-40025a7313b1')).toBe(true); // v7
    expect(looksLikeUuid('9f8d4a2e-1c3b-4f5a-8e7d-6b5c4a3d2e1f')).toBe(true); // v4
    expect(looksLikeUuid('01A04D4B-16D0-7293-919C-40025A7313B1')).toBe(true); // 대문자
    expect(looksLikeUuid('SPC-CWC-007')).toBe(false);
    expect(looksLikeUuid('01a04d4b16d07293919c40025a7313b1')).toBe(false); // 하이픈 없음
    expect(looksLikeUuid('01a04d4b-16d0-7293-919c')).toBe(false); // 짧다
  });
});
