// REQ-WEB-033 — 색 단독 인코딩 금지. 배지는 항상 텍스트 라벨을 병기한다.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusBadge } from './status-badge.js';

afterEach(cleanup);

describe('StatusBadge', () => {
  it('라벨 텍스트를 항상 렌더한다', () => {
    render(<StatusBadge token="agent" label="claimed" />);
    expect(screen.getByText('claimed')).toBeDefined();
  });

  it('토큰마다 §4.2 의 클래스를 붙인다 — 임의 색을 만들지 않는다', () => {
    const { container } = render(<StatusBadge token="danger" label="blocked" />);
    const el = container.querySelector('span');
    expect(el?.className).toContain('bg-status-danger-soft');
    expect(el?.className).toContain('text-status-danger');
  });

  it('상태 dot 은 장식이라 스크린리더에서 감춘다 — 의미는 라벨이 진다', () => {
    const { container } = render(<StatusBadge token="ok" label="approved" />);
    const dot = container.querySelector('[aria-hidden="true"]');
    // 글자 ● 가 아니라 원이다(2026-09-26) — 색은 배지 글자색을 그대로 받는다
    expect(dot?.getAttribute('data-dot')).toBe('');
    expect(dot?.className).toContain('rounded-full');
    expect(dot?.className).toContain('bg-current');
    expect(dot?.textContent).toBe('');
    expect(container.querySelector('span')?.textContent).toBe('approved');
  });
});
