// URL 로 건넬 수 있는 상태 — 스펙 검색어 · 보드 필터 · 조직 전환 (screens.md §2.4(3))
//
// 셋 다 2026-09-06 까지 컴포넌트 state 였다: **"이 스펙의 작업만" 을 링크로 건넬 수 없었고**
// 새로고침 한 번에 필터가 풀렸으며, 조직이 둘인 사용자가 두 번째를 고르면 아무 일 없이
// 원래 조직 홈으로 돌아왔다. 여기서는 그 셋의 **파싱 규칙**을 본다 — 라우트가 주소를
// 어떻게 읽는지가 링크가 통하는지를 정한다.

import { describe, expect, it } from 'vitest';
import { Route as SpecList } from '../routes/p.$proj/specs.index.js';
import { Route as TaskBoard } from '../routes/p.$proj/tasks.index.js';

const parseSpecs = SpecList.options.validateSearch as (
  s: Record<string, unknown>,
) => Record<string, unknown>;
const parseBoard = TaskBoard.options.validateSearch as (
  s: Record<string, unknown>,
) => Record<string, unknown>;

describe('스펙 목록의 주소', () => {
  it('검색어를 주소에서 읽는다 — 결과를 링크로 건넨다', () => {
    expect(parseSpecs({ q: '위젯' })).toMatchObject({ q: '위젯' });
  });

  it('빈 검색어는 주소에 남기지 않는다 — `?q=` 만 붙은 주소를 만들지 않는다', () => {
    expect(parseSpecs({ q: '' })).not.toHaveProperty('q');
    expect(parseSpecs({})).not.toHaveProperty('q');
  });

  it('검색어와 필터가 함께 산다 — 하나가 나머지를 지우지 않는다', () => {
    expect(parseSpecs({ q: '위젯', status: 'draft', type: 'feature', archived: '1' })).toEqual({
      q: '위젯',
      status: 'draft',
      type: 'feature',
      archived: true,
    });
  });
});

describe('작업 보드의 주소', () => {
  it('`?spec=` 을 읽는다 — 서버는 이 인자를 처음부터 받고 있었다', () => {
    expect(parseBoard({ spec: 'SPC-CWC-007' })).toMatchObject({ spec: 'SPC-CWC-007' });
  });

  it('`?assignee=` 를 읽는다', () => {
    expect(parseBoard({ assignee: 'u-1' })).toMatchObject({ assignee: 'u-1' });
  });

  it('보기 토글도 주소에 남는다 — 새로고침이 필터를 풀지 않는다', () => {
    expect(parseBoard({ backlog: '1', archived: '1' })).toMatchObject({
      backlog: true,
      archived: true,
    });
  });

  it('빈 값은 무시한다 — 서버에 빈 필터를 보내 아무것도 없다고 말하지 않는다', () => {
    expect(parseBoard({ spec: '', assignee: '' })).toEqual({});
  });
});
