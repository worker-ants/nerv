// 형제 정렬 키 — 원본의 순서를 임포트 너머로 옮긴다.
//
// 이 파일이 있는 이유는 실측이다: clemvion 130편을 적재한 뒤 트리가 `2-navigation` ·
// `4-nodes` · `conventions` 순으로 나왔는데, 이것은 `sort_key` 가 전부 빈 문자열이라
// 키 알파벳으로 떨어진 결과였다. 원본의 `0-`·`1-` 접두는 저자가 적어 둔 읽는 순서인데
// 키·제목 어디에도 남지 않아 임포트를 지나면 사라진다.

import { describe, expect, it } from 'vitest';
import { sortKeyOf } from '../run.js';

describe('sortKeyOf — 숫자 접두를 정렬 가능한 키로', () => {
  it('두 자리가 한 자리 뒤에 온다 — 문자열 정렬의 함정', () => {
    // 접두를 그대로 두면 "10" < "9" 다. 폭을 고정하는 이유가 이것뿐이다.
    expect(sortKeyOf('9-x') < sortKeyOf('10-x')).toBe(true);
    expect('9-x' < '10-x').toBe(false); // 고정하지 않았을 때
  });

  it('0 이 1 앞에 온다', () => {
    expect(sortKeyOf('0-common.md') < sortKeyOf('1-logic')).toBe(true);
  });

  it('접두 없는 이름은 숫자 뒤로 간다 — `ls` 와 같은 순서', () => {
    expect(sortKeyOf('99-last') < sortKeyOf('conventions')).toBe(true);
    expect(sortKeyOf('0-first') < sortKeyOf('data-flow')).toBe(true);
  });

  it('접두 없는 이름끼리는 동률 — 동률은 트리 질의의 `ORDER BY sort_key, key` 가 푼다', () => {
    expect(sortKeyOf('conventions')).toBe(sortKeyOf('data-flow'));
  });

  it('clemvion 실측 디렉터리가 원본 순서로 정렬된다', () => {
    const dirs = ['7-channel-web-chat', '2-navigation', 'conventions', '5-system', '4-nodes'];
    const ordered = [...dirs].sort(
      (a, b) => sortKeyOf(a).localeCompare(sortKeyOf(b)) || a.localeCompare(b),
    );
    expect(ordered).toEqual([
      '2-navigation',
      '4-nodes',
      '5-system',
      '7-channel-web-chat',
      'conventions',
    ]);
  });
});
