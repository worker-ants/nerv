import { describe, expect, it } from 'vitest';
import { scrollEdges } from './scroll-edges.js';

describe('가로 스크롤 줄의 양 끝 (REQ-WEB-154)', () => {
  it('넘치지 않으면 어느 쪽도 흐리지 않는다', () => {
    expect(scrollEdges(0, 200, 200)).toBe('none');
    // 내용이 상자보다 좁을 수도 있다(음수) — 그것도 끝이 없는 것이다
    expect(scrollEdges(0, 150, 200)).toBe('none');
  });

  it('처음에는 오른쪽만, 끝에서는 왼쪽만, 가운데서는 양쪽', () => {
    expect(scrollEdges(0, 400, 200)).toBe('end');
    expect(scrollEdges(200, 400, 200)).toBe('start');
    expect(scrollEdges(100, 400, 200)).toBe('both');
  });

  it('끝에 닿으면 그쪽 페이드가 사라진다 — 남으면 "더 있다" 는 거짓말이 된다', () => {
    // 브라우저가 소수 폭에서 남기는 0.5px 로는 아직 끝이다
    expect(scrollEdges(199.5, 400, 200)).toBe('start');
    expect(scrollEdges(0.5, 400, 200)).toBe('end');
    // 2px 이 남으면 진짜로 더 있다
    expect(scrollEdges(198, 400, 200)).toBe('both');
  });
});
