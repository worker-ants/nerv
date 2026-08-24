// 관계 방향 탭 — 두 화면이 **같은 것**을 쓴다는 것이 이 컴포넌트의 존재 이유다.
//
// 스펙 상세의 우측 레일과 관계 그래프의 선택 패널이 각자 그리면 라벨·건수 표기·활성
// 표시가 조금씩 갈라지고, 그때 사람은 그 둘이 같은 것인지부터 의심하게 된다.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../lib/i18n.js';
import { RelationTabs } from './relation-tabs.js';
import type { RelationDirection } from './relation-tabs.js';

afterEach(cleanup);

function renderTabs(value: RelationDirection, onChange = vi.fn()) {
  render(
    <LocaleProvider locale="ko">
      <RelationTabs value={value} onChange={onChange} counts={{ all: 7, in: 3, out: 4 }} />
    </LocaleProvider>,
  );
  return onChange;
}

describe('RelationTabs', () => {
  it('세 방향과 건수를 **누르기 전에** 적는다 — 빈 탭을 열어 보게 하지 않는다', () => {
    renderTabs('all');
    expect(screen.getByTestId('rel-tab-all').textContent).toBe('전체7');
    expect(screen.getByTestId('rel-tab-in').textContent).toBe('역참조3');
    expect(screen.getByTestId('rel-tab-out').textContent).toBe('레퍼런스4');
  });

  it('고른 것을 aria-pressed 로 말한다 — 색만으로 구분하지 않는다(REQ-WEB-033)', () => {
    renderTabs('in');
    expect(screen.getByTestId('rel-tab-in').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('rel-tab-all').getAttribute('aria-pressed')).toBe('false');
  });

  it('누르면 그 방향을 돌려준다', () => {
    const onChange = renderTabs('all');
    fireEvent.click(screen.getByTestId('rel-tab-out'));
    expect(onChange).toHaveBeenCalledWith('out');
  });

  it('로케일을 탄다 — 두 화면이 같은 문구를 쓴다는 것이 요점이다', () => {
    render(
      <LocaleProvider locale="en">
        <RelationTabs value="all" onChange={vi.fn()} counts={{ all: 0, in: 0, out: 0 }} />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('rel-tab-in').textContent).toBe('Backlinks0');
  });
});
