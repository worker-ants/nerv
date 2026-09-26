// 게이트 티어 판정 — spec-workflow §2.4 표를 그대로 고정한다.
//
// 이 표가 흔들리면 "저위험 자동 통과"(D-06)와 "고위험 2인 승인"이 동시에 무너진다.
// 자동 통과가 없으면 워터폴 비판을 실현하고, 강화 게이트가 없으면 승인이 형식이 된다.

import { describe, expect, it } from 'vitest';
import { GATE_AXES } from '@nerv/schema';
import { decideGate, escalate, gateEventPayload, inferAxes, scoreOf, tierOf } from './gate-tier.js';
import type { GateAxes } from './gate-tier.js';

const axes = (s: number, m: number, r: number, b: number): GateAxes => ({
  sideEffect: s as 0 | 1 | 2,
  sensitivity: m as 0 | 1 | 2,
  reversibility: r as 0 | 1 | 2,
  blastRadius: b as 0 | 1 | 2,
});

describe('4축 → 티어 (§2.4 표)', () => {
  it.each([
    [0, 'T0'],
    [1, 'T0'],
    [2, 'T1'],
    [3, 'T1'],
    [4, 'T2'],
    [5, 'T2'],
    [6, 'T3'],
    [8, 'T3'],
  ])('합계 %i → %s', (score, tier) => {
    expect(tierOf(score)).toBe(tier);
  });

  it('오탈자 정정은 T0 — 승인 없이 통과한다', () => {
    const decision = decideGate(axes(0, 0, 0, 0));
    expect(decision.tier).toBe('T0');
    expect(decision.autoPass).toBe(true);
    expect(decision.requiredApprovers).toBe(0);
  });

  // 2026-09-02 사람 결정: 이의제기 창은 두지 않는다. 구현이 없었고(값만 산출했다),
  // 신규 문서가 T2 로 올라간 뒤로 T1 에 남는 것은 기존 문서의 문구 수정 정도다.
  it('T1 도 승인 없이 통과한다 — T0 과 동작이 같고 등급만 남는다', () => {
    const decision = decideGate(axes(1, 1, 0, 0));
    expect(decision.tier).toBe('T1');
    expect(decision.autoPass).toBe(true);
    expect(decision.requiredApprovers).toBe(0);
    expect(decision).not.toHaveProperty('appealWindowHours');
  });

  it('T2 는 사전 승인 1인', () => {
    const decision = decideGate(axes(2, 1, 1, 0));
    expect(decision.tier).toBe('T2');
    expect(decision.autoPass).toBe(false);
    expect(decision.requiredApprovers).toBe(1);
  });

  it('T3 는 직군 교차 2인 — 규약 변경·승인 요구사항 삭제', () => {
    const decision = decideGate(axes(2, 2, 2, 2));
    expect(decision.tier).toBe('T3');
    expect(decision.requiredApprovers).toBe(2);
    expect(decision.autoPass).toBe(false);
  });
});

describe('첫 승인 버전은 티어를 올린다 (2026-09-02 사람 결정)', () => {
  // 새 feature 스펙: 부작용 2(요구사항 추가) + 민감도 1(feature) + 가역성 0 + 파급 0 = 3점.
  // 되돌릴 이전 버전이 없고 아직 아무도 참조하지 않아 두 축이 구조적으로 0 이다.
  const newFeatureSpec = (): ReturnType<typeof axes> => axes(2, 1, 0, 0);

  it('신호가 없으면 3점은 T1 — 사람 없이 통과한다', () => {
    const decision = decideGate(newFeatureSpec());
    expect(decision.tier).toBe('T1');
    expect(decision.autoPass).toBe(true);
  });

  it('첫 버전이면 T2 로 올라간다 — §2.4 표의 "신규 feature 스펙" 예시와 맞는다', () => {
    const decision = decideGate(newFeatureSpec(), { firstApprovedVersion: true });
    expect(decision.tier).toBe('T2');
    expect(decision.autoPass).toBe(false);
    expect(decision.requiredApprovers).toBe(1);
    expect(decision.rationale).toContain('첫 승인 버전');
  });

  it('둘째 버전부터는 올리지 않는다 — 문서당 한 번이다', () => {
    expect(decideGate(newFeatureSpec(), { firstApprovedVersion: false }).tier).toBe('T1');
  });
});

describe('프로젝트 정책 — 경계와 동적 강화 스위치가 실제로 걸린다', () => {
  it('경계를 좁히면 같은 점수가 더 높은 티어가 된다', () => {
    const three = axes(2, 1, 0, 0);
    expect(decideGate(three).tier).toBe('T1');
    expect(decideGate(three, {}, { boundaries: [2, 3, 6] }).tier).toBe('T2');
  });

  it('동적 강화를 끄면 신호를 세지 않는다 — 껐다고 믿은 사람이 옳아야 한다', () => {
    const signals = { firstApprovedVersion: true, repeatedFailures: true };
    expect(decideGate(axes(2, 1, 0, 0), signals).tier).toBe('T2');
    expect(decideGate(axes(2, 1, 0, 0), signals, { dynamicEscalation: false }).tier).toBe('T1');
  });
});

describe('동적 강화 — 세션 신뢰도도 티어를 올린다', () => {
  it('같은 실패 3회 신고는 +1 (clemvion e2e-fail-3x 계승 · 2026-09-26)', () => {
    const base = decideGate(axes(0, 0, 0, 0));
    const escalated = decideGate(axes(0, 0, 0, 0), { repeatedFailures: true });
    expect(base.tier).toBe('T0');
    expect(escalated.tier).toBe('T1');
    expect(escalated.rationale).toContain('같은 실패 3회 신고 → 티어 +1');
  });

  it('신호가 여럿이어도 한 단계다 — 쌓으면 첫 버전 T1 문서가 신호 하나로 T3 까지 갔다 (2026-09-26 사람 결정)', () => {
    // 신호가 말하는 것은 "사람이 한 번 봐야 한다" 이지 "두 사람이" 가 아니다. T3 는 직군 교차
    // 2인과 파생 작업의 플랜 승인까지 부른다 — 묻는 횟수가 늘면 확인은 읽히지 않는다
    const both = decideGate(axes(2, 1, 0, 0), {
      firstApprovedVersion: true,
      repeatedFailures: true,
    });
    expect(both.tier).toBe('T2');
    expect(both.signals).toEqual(['first_version', 'retry_threshold']);
    // "+1" 은 끝에 한 번 — 둘 다 적고 한 단계만 올랐다고 말한다
    expect(both.rationale).toBe(
      '4축 합계 3점 · 이 문서의 첫 승인 버전 · 같은 실패 3회 신고 → 티어 +1',
    );
  });

  it('T3 위는 없다 — 강화가 무한히 올라가지 않는다', () => {
    expect(escalate('T3')).toBe('T3');
    expect(decideGate(axes(2, 2, 2, 2), { repeatedFailures: true }).tier).toBe('T3');
  });

  it('판정 근거를 항상 남긴다 — 승인 카드가 산출 근거를 보여야 한다(§6.4)', () => {
    expect(decideGate(axes(1, 1, 1, 1)).rationale).toContain('4축 합계 4점');
  });
});

describe('산출 근거를 구조로 남긴다 (2026-09-26 · REQ-API-188)', () => {
  // 근거는 한 줄 문자열뿐이었고 저장되지 않았다 — 카드는 배지만 그렸고, 첫 승인 버전 가산으로
  // T2 가 된 문서도 사람에게는 이유 없이 T2 였다. 축별 점수와 발동한 신호를 판정이 들고 나온다.
  it('축별 점수와 발동한 신호를 판정 순서대로 싣는다', () => {
    const decision = decideGate(axes(2, 1, 0, 0), { firstApprovedVersion: true });
    expect(decision.axes).toEqual(axes(2, 1, 0, 0));
    expect(decision.signals).toEqual(['first_version']);
    const both = decideGate(axes(0, 0, 0, 0), {
      firstApprovedVersion: true,
      repeatedFailures: true,
    });
    expect(both.signals).toEqual(['first_version', 'retry_threshold']);
  });

  it('끈 프로젝트에서는 신호가 없다 — 올리지 않은 것을 올렸다고 적지 않는다', () => {
    const off = decideGate(
      axes(2, 1, 0, 0),
      { firstApprovedVersion: true },
      { dynamicEscalation: false },
    );
    expect(off.signals).toEqual([]);
  });

  it('이벤트에 싣는 모양 — 키는 GATE_AXES · GATE_SIGNALS 다', () => {
    const payload = gateEventPayload(decideGate(axes(2, 1, 0, 1), { firstApprovedVersion: true }));
    expect(payload).toEqual({
      gate_tier: 'T3',
      gate_score: 4,
      gate_axes: { side_effect: 2, sensitivity: 1, reversibility: 0, blast_radius: 1 },
      gate_signals: ['first_version'],
    });
    expect(Object.keys(payload.gate_axes)).toEqual([...GATE_AXES]);
  });

  it('근거는 있을 때만 싣는다 — 재시도 신호가 가리키는 에스컬레이션 (REQ-API-189)', () => {
    const evidence = {
      signal: 'retry_threshold' as const,
      kind: 'question' as const,
      id: 'q-1',
      title: 'e2e 가 세 번 같은 자리에서 깨진다',
      task_key: 'CLV-T-1',
      session_id: 's-1',
      at: '2026-09-26T00:00:00.000Z',
    };
    const decision = decideGate(axes(2, 1, 0, 0), { repeatedFailures: true });
    expect(gateEventPayload({ ...decision, evidence: [evidence] }).gate_evidence).toEqual([
      evidence,
    ]);
    expect(gateEventPayload(decision)).not.toHaveProperty('gate_evidence');
  });
});

describe('본문 변화에서 4축 추정', () => {
  it('요구사항 추가·삭제는 부작용 2점', () => {
    expect(
      inferAxes({
        specType: 'feature',
        requirementsAdded: 1,
        requirementsRemoved: 0,
        requirementsModified: 0,
        bodyChanged: true,
        referencingSpecs: 0,
        derivedTasks: 0,
      }).sideEffect,
    ).toBe(2);
  });

  it('규약·ADR 은 요구사항 변화가 없어도 부작용 2점 — 규약 변경은 T3 다', () => {
    const decision = decideGate(
      inferAxes({
        specType: 'convention',
        requirementsAdded: 0,
        requirementsRemoved: 0,
        requirementsModified: 0,
        bodyChanged: true,
        referencingSpecs: 6,
        derivedTasks: 0,
      }),
    );
    expect(decision.tier).toBe('T3');
  });

  it('오탈자(본문만 변경·참조 없음)는 T0 로 떨어진다', () => {
    const decision = decideGate(
      inferAxes({
        specType: 'vision',
        requirementsAdded: 0,
        requirementsRemoved: 0,
        requirementsModified: 0,
        bodyChanged: true,
        referencingSpecs: 0,
        derivedTasks: 0,
      }),
    );
    expect(decision.tier).toBe('T0');
  });

  it('승인된 요구사항 삭제는 가역성 2점 — 되돌릴 수 없는 변경이다', () => {
    expect(
      inferAxes({
        specType: 'feature',
        requirementsAdded: 0,
        requirementsRemoved: 1,
        requirementsModified: 0,
        bodyChanged: true,
        referencingSpecs: 0,
        derivedTasks: 0,
        approvedRequirementsRemoved: true,
      }).reversibility,
    ).toBe(2);
  });

  it('참조 6+ 또는 파생 Task 4+ 는 영향 범위 2점', () => {
    expect(
      scoreOf(
        inferAxes({
          specType: 'vision',
          requirementsAdded: 0,
          requirementsRemoved: 0,
          requirementsModified: 0,
          bodyChanged: true,
          referencingSpecs: 6,
          derivedTasks: 0,
        }),
      ),
    ).toBeGreaterThanOrEqual(2);
  });
});
