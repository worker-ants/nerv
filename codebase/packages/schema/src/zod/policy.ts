// gate_policy · retention 키 스키마 — 정본: api.md §2.1a (REQ-API-023)
//
// 웹 폼(S8) · API 검증 · 워커 잡이 **같은 스키마**를 쓴다(REQ-CB-006). 셋이 각자 파싱하면
// 오타 정책이 어디선가 조용히 무시되고, 그 순간 게이트는 켜져 있다고 믿는 채로 꺼진다.
//
// `.strict()` 가 이 파일의 요점이다 — **알 수 없는 키는 거부한다**. 관대한 수용은
// `spec_gate.tier_boundries` 같은 오타를 소리 없이 삼키고 기본값으로 돌아간다.
//
// `t1_objection_hours` 는 2026-09-02 에 걷었다(사람 결정). 이의제기 창은 구현이 없었고 —
// 값을 산출만 하고 아무도 읽지 않았다 — 신규 문서가 T2 로 올라간 뒤로 T1 에 남는 것은
// 기존 문서의 문구 수정 정도라, 되돌리기 창을 만드는 값이 낮다고 판단했다. 저장된 값은
// 마이그레이션 0016 이 지운다(`.strict()` 라 남아 있으면 정책 저장이 400 이 된다).

import { z } from 'zod';

export const GatePolicySchema = z
  .object({
    version: z.number().int().min(1).default(1),
    spec_gate: z
      .object({
        /** 4축 합산 점수의 T1/T2/T3 진입 경계 — 기본 0~1=T0 · 2~3=T1 · 4~5=T2 · 6+=T3 */
        tier_boundaries: z.array(z.number().int().min(0)).length(3).default([2, 4, 6]),
        /** 재시도 임계·롤백 이력에 의한 티어 +1 (spec-workflow §2.4 동적 강화) */
        dynamic_escalation: z.boolean().default(true),
      })
      .strict()
      .default({ tier_boundaries: [2, 4, 6], dynamic_escalation: true }),
    failopen: z
      .object({
        /** 연속 fail-open 판정 격상 임계 — D-14 는 "허용하되 관측하고 격상한다"이다 */
        escalate_count: z.number().int().min(1).default(3),
        window_hours: z.number().int().min(1).default(24),
      })
      .strict()
      .default({ escalate_count: 3, window_hours: 24 }),
  })
  .strict();

export const RetentionSchema = z
  .object({
    /** Activity 원문 보존 — 요약은 영구다(spec-workflow §5.6) */
    activity_days: z.number().int().min(1).default(90),
    /** 리뷰 프롬프트 blob TTL — 상수의 프로젝트 오버라이드 */
    prompt_blob_ttl_days: z.number().int().min(1).default(30),
  })
  .strict();

export type GatePolicy = z.infer<typeof GatePolicySchema>;
export type Retention = z.infer<typeof RetentionSchema>;

/** 빈 정책도 유효하다 — 전 키가 선택이고 생략은 기본값이다(§2.1a). */
export function defaultGatePolicy(): GatePolicy {
  return GatePolicySchema.parse({});
}

export function defaultRetention(): Retention {
  return RetentionSchema.parse({});
}
