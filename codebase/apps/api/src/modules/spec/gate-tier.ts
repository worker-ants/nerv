import { text } from '@nerv/schema';
// 스펙 변경 게이트 티어 T0~T3 — 정본: docs/03-proposal/spec-workflow.md §2.4 (D-06)
//
// **자동 통과 경로는 필수 기능이다.** SDD 에 대한 대표적 비판이 "버그 하나 고치는 데 16개
// 인수 기준"이라는 워터폴 회귀 지적인데, T0/T1 이 없으면 NERV 는 그 비판을 그대로 실현하는
// 도구가 된다. 반대로 모든 것을 묻는 설계는 반사적 승인(consent fatigue)을 낳고 그것이
// OWASP ASI09 가 지목하는 취약점이다. 그래서 티어는 **양쪽을 다 피하는 장치**다.
//
// 이 티어는 도구 호출 위험도(A1~A4)와 **다른 축**이다 — 혼용하지 않는다.

/** 4축 점수 — 부작용 × 민감도 × 가역성 × 영향 범위 (각 0~2) */
export interface GateAxes {
  /** 0 서술 정정 · 1 기존 요구사항 수정 · 2 요구사항 추가/삭제·규약·ADR */
  sideEffect: 0 | 1 | 2;
  /** 0 내부 설명 · 1 외부 노출 사양 · 2 보안·권한·과금·개인정보 */
  sensitivity: 0 | 1 | 2;
  /** 0 파생 영향 없음 · 1 파생 Task 재계산 · 2 구현·배포된 요구사항 무효화 */
  reversibility: 0 | 1 | 2;
  /** 0 참조 0~1 · 1 참조 2~5 또는 Task 1~3 · 2 참조 6+ 또는 Task 4+ */
  blastRadius: 0 | 1 | 2;
}

export type GateTier = 'T0' | 'T1' | 'T2' | 'T3';

export interface GateDecision {
  tier: GateTier;
  score: number;
  /** 필수 승인자 수 — T3 는 직군 교차 2인 */
  requiredApprovers: number;
  /** 사전 승인 없이 approved 로 갈 수 있는가 */
  autoPass: boolean;
  /** 왜 이 티어인가 — 승인 카드가 산출 근거를 보여야 한다(§6.4) */
  rationale: string;
}

/** 동적 강화 사유 — 액션 위험도만이 아니라 세션의 신뢰도도 티어를 올린다(§2.4). */
export interface EscalationSignals {
  /** 같은 Task 재시도가 임계를 넘었다(clemvion 의 e2e-fail-3x 어휘 계승) */
  repeatedFailures?: boolean;
  /** 최근 30일 내 해당 영역의 승인 후 롤백 이력 */
  recentRollback?: boolean;
  /**
   * **이 문서의 첫 approved 버전이다**(2026-09-02 사람 결정).
   *
   * 4축은 변화의 크기를 재는데, 새 문서는 그 축들이 구조적으로 낮게 나온다: 되돌릴 이전
   * 버전이 없어 가역성 0, 아직 아무도 참조하지 않아 파급 0. 그래서 요구사항을 새로 세우는
   * feature 스펙이 3점(T1)으로 계산돼 **사람이 한 번도 보지 않고 approved** 로 갔다 —
   * §2.4 표는 같은 문서에서 "신규 feature 스펙"을 T2 의 예시로 들고 있는데도.
   *
   * 축을 만지지 않고 강화 신호로 두는 이유: 축은 변화의 크기를 재는 자이고, "처음 들어오는
   * 약속" 은 크기가 아니라 **성질**이다. 축에 가산점을 섞으면 그 자가 무엇을 재는지 흐려진다.
   */
  firstApprovedVersion?: boolean;
}

export function scoreOf(axes: GateAxes): number {
  return axes.sideEffect + axes.sensitivity + axes.reversibility + axes.blastRadius;
}

/**
 * 점수 → 티어. **경계는 프로젝트가 바꿀 수 있다**(api.md §2.1a `tier_boundaries`).
 *
 * 인자를 받기 전까지 이 함수는 상수를 썼고, 그래서 `gate_policy.tier_boundaries` 는
 * 화면에서 고칠 수는 있는데 아무 효과가 없는 값이었다(2026-09-02 정정).
 *
 * 경계 셋은 T1·T2·T3 의 **진입 점수**다: 기본 [2,4,6] 이면 0~1=T0 · 2~3=T1 · 4~5=T2 · 6+=T3.
 */
export function tierOf(score: number, boundaries: readonly number[] = [2, 4, 6]): GateTier {
  const [t1 = 2, t2 = 4, t3 = 6] = boundaries;
  if (score >= t3) return 'T3';
  if (score >= t2) return 'T2';
  if (score >= t1) return 'T1';
  return 'T0';
}

/** 티어를 한 단계 올린다. T3 위는 없다. */
export function escalate(tier: GateTier): GateTier {
  const order: GateTier[] = ['T0', 'T1', 'T2', 'T3'];
  const index = order.indexOf(tier);
  return order[Math.min(index + 1, order.length - 1)] ?? tier;
}

export function decideGate(
  axes: GateAxes,
  signals: EscalationSignals = {},
  policy: { boundaries?: readonly number[]; dynamicEscalation?: boolean } = {},
): GateDecision {
  const score = scoreOf(axes);
  let tier = tierOf(score, policy.boundaries);

  const reasons: string[] = [`4축 합계 ${score}점`];
  // 동적 강화를 끈 프로젝트에서는 신호를 세지 않는다(`gate_policy.dynamic_escalation`).
  // 끄는 선택지를 화면에 두고 값은 무시하면, 끈 사람은 껐다고 믿는다.
  if (policy.dynamicEscalation !== false) {
    if (signals.repeatedFailures === true) {
      tier = escalate(tier);
      reasons.push(text('gate.reason.retry_threshold'));
    }
    if (signals.recentRollback === true) {
      tier = escalate(tier);
      reasons.push(text('gate.reason.recent_rollback'));
    }
    if (signals.firstApprovedVersion === true) {
      tier = escalate(tier);
      reasons.push(text('gate.reason.first_version'));
    }
  }

  return {
    tier,
    score,
    requiredApprovers: tier === 'T3' ? 2 : tier === 'T2' ? 1 : 0,
    // T0·T1 은 사전 승인 없이 approved 로 간다. **둘의 동작은 같다** — 티어는 감사 기록에
    // 남는 등급이고, 되돌리기 창은 두지 않는다(2026-09-02 사람 결정 · §2.4).
    autoPass: tier === 'T0' || tier === 'T1',
    rationale: reasons.join(' · '),
  };
}

/**
 * 본문 변화에서 4축을 추정한다 — MVP 의 기본 판정기.
 *
 * 요구사항 집합의 변화가 부작용 축의 주된 신호다: 추가·삭제는 2점, 문구 수정은 1점,
 * 본문만 바뀌었으면 0점. 나머지 축은 스펙 타입·참조 수로 근사한다.
 * **추정이 확정을 대신하지 않는다** — 사람이 승인 카드에서 티어를 올릴 수 있어야 하고,
 * 그 UI 는 S8 게이트 정책 탭(E08-S08)이 소유한다.
 */
export function inferAxes(input: {
  specType: string;
  requirementsAdded: number;
  requirementsRemoved: number;
  requirementsModified: number;
  bodyChanged: boolean;
  referencingSpecs: number;
  derivedTasks: number;
  approvedRequirementsRemoved?: boolean;
}): GateAxes {
  const sideEffect: 0 | 1 | 2 =
    input.requirementsAdded > 0 || input.requirementsRemoved > 0
      ? 2
      : input.specType === 'convention' || input.specType === 'adr'
        ? 2
        : input.requirementsModified > 0
          ? 1
          : 0;

  const sensitivity: 0 | 1 | 2 =
    input.specType === 'convention' || input.specType === 'adr'
      ? 1
      : input.specType === 'feature' || input.specType === 'design'
        ? 1
        : 0;

  const reversibility: 0 | 1 | 2 =
    input.approvedRequirementsRemoved === true
      ? 2
      : // 규약·ADR 변경은 파생 Task 가 0건이어도 되돌릴 때 재계산이 필요하다 —
        // 이미 그 규약에 맞춰 쓰인 코드·문서가 있기 때문이다. 이 1점이 있어야
        // §2.4 가 예시로 든 "규약 변경 = T3" 가 성립한다(참조 6+ 기준).
        input.specType === 'convention' || input.specType === 'adr'
        ? 1
        : input.derivedTasks > 0
          ? 1
          : 0;

  const blastRadius: 0 | 1 | 2 =
    input.referencingSpecs >= 6 || input.derivedTasks >= 4
      ? 2
      : input.referencingSpecs >= 2 || input.derivedTasks >= 1
        ? 1
        : 0;

  return { sideEffect, sensitivity, reversibility, blastRadius };
}
