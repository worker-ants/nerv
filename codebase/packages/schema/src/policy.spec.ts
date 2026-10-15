// 게이트 정책 스키마 — done 게이트의 리뷰 조건 모양 (2026-09-28 · clemvion 요청 N6 · 사람 결정 D9 · REQ-API-250)

import { describe, expect, it } from 'vitest';
import { POLICY_FINGERPRINT_LENGTH } from './constants.js';
import { policyFingerprint } from './keys.js';
import {
  canonicalPolicyJson,
  defaultGatePolicy,
  effectiveGatePolicy,
  GatePolicySchema,
} from './zod/policy.js';

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

// 적용 정책 지문 (2026-10-15 · 사람 결정 · REQ-API-303) — 판정 이벤트가 남기고, 정책을 고칠 때의 감사가 본문과 함께 남긴다
describe('적용 정책 지문', () => {
  const fingerprintOf = (stored: unknown): string =>
    policyFingerprint(effectiveGatePolicy(stored).policy);

  it('기본값까지 채운 정책의 것이다 — 빈 정책과 기본값을 다 적은 정책은 같은 지문이다', () => {
    const empty = fingerprintOf({});
    expect(empty).toMatch(new RegExp(`^[0-9a-f]{${POLICY_FINGERPRINT_LENGTH}}$`));
    expect(fingerprintOf(defaultGatePolicy())).toBe(empty);
    expect(fingerprintOf({ spec_gate: { tier_boundaries: [2, 4, 6] } })).toBe(empty);
  });

  it('저장된 키 순서와 상관없다 — 정규형 JSON 은 키를 정렬한다', () => {
    const a = { spec_gate: { dynamic_escalation: false, tier_boundaries: [2, 3, 6] }, version: 1 };
    const b = { version: 1, spec_gate: { tier_boundaries: [2, 3, 6], dynamic_escalation: false } };
    expect(fingerprintOf(a)).toBe(fingerprintOf(b));
    const json = canonicalPolicyJson(GatePolicySchema.parse(a));
    expect(json.indexOf('"done_gate"')).toBeLessThan(json.indexOf('"spec_gate"'));
  });

  it('판정을 바꾸는 값이 바뀌면 지문도 바뀐다 — 배열의 순서도 뜻이다', () => {
    const base = fingerprintOf({});
    expect(fingerprintOf({ done_gate: { evidence_source: 'ci_or_human' } })).not.toBe(base);
    expect(fingerprintOf({ spec_gate: { tier_boundaries: [2, 4, 7] } })).not.toBe(base);
    expect(fingerprintOf({ review_roles: { code: ['security'] } })).not.toBe(base);
    expect(fingerprintOf({ spec_gate: { tier_boundaries: [2, 4, 6] } })).toBe(base);
  });

  it('스키마에 맞지 않는 정책은 기본 정책으로 판정하고 그 사실을 돌려준다 — 지문도 기본 정책의 것이다', () => {
    const broken = effectiveGatePolicy({ spec_gate: { tier_boundries: [1, 2, 3] } });
    expect(broken.valid).toBe(false);
    expect(broken.policy).toEqual(defaultGatePolicy());
    expect(policyFingerprint(broken.policy)).toBe(fingerprintOf({}));
    expect(effectiveGatePolicy(null).valid).toBe(true);
  });
});
