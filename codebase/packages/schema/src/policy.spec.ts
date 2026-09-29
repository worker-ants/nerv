// 게이트 정책 스키마 — done 게이트의 리뷰 조건 모양 (2026-09-28 · clemvion 요청 N6 · 사람 결정 D9 · REQ-API-250)

import { describe, expect, it } from 'vitest';
import { GatePolicySchema } from './zod/policy.js';

const coverage = (value: unknown): boolean =>
  GatePolicySchema.safeParse({ done_gate: { review_coverage: value } }).success;

describe('done_gate.review_coverage', () => {
  it('참거짓(처음 뜻 그대로)과 리뷰 종류 목록을 받는다', () => {
    expect(coverage(true)).toBe(true);
    expect(coverage(false)).toBe(true);
    expect(coverage(['code'])).toBe(true);
    expect(coverage(['code', 'consistency', 'spec_coverage', 'merge'])).toBe(true);
  });

  it('모르는 종류 · 빈 목록 · 다른 모양은 거절한다 — 오타가 조용히 조건을 끄지 않게', () => {
    expect(coverage(['codes'])).toBe(false);
    expect(coverage([])).toBe(false);
    expect(coverage('code')).toBe(false);
  });

  it('생략하면 꺼져 있다', () => {
    expect(GatePolicySchema.parse({}).done_gate.review_coverage).toBe(false);
  });
});

describe('review_roles', () => {
  const roles = (value: unknown): boolean =>
    GatePolicySchema.safeParse({ review_roles: value }).success;

  it('리뷰 종류마다 역할 목록을 받는다 — 생략하면 비어 있다', () => {
    expect(roles({ code: ['security', 'testing'] })).toBe(true);
    expect(roles({ code: ['security'], consistency: ['requirement'] })).toBe(true);
    expect(GatePolicySchema.parse({}).review_roles).toEqual({});
  });

  it('모르는 종류 · 빈 목록 · 빈 역할은 거절한다', () => {
    expect(roles({ codes: ['security'] })).toBe(false);
    expect(roles({ code: [] })).toBe(false);
    expect(roles({ code: [''] })).toBe(false);
  });
});
