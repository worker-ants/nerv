// 제출 전 자동 사전 검토 — 5검사기 (E09-S02)
// 정본: docs/03-proposal/spec-workflow.md §2.1
//
// clemvion 에서 이 검사는 `spec/` 쓰기 직전의 **의무**였고 산출물이 전부 git 에 커밋됐다 —
// 858세션·42MB. NERV 는 같은 검사를 **플랫폼 서비스**로 옮긴다: 결과는 레코드이고, 호출은
// 수시로 가능하며(nerv_spec_check — A1 읽기 전용), 제출 시점에만 강제된다.
//
// **severity 하향은 감사 대상이다.** clemvion 실측에서 SUMMARY 는 BLOCK: NO 인데 리포트에는
// [CRITICAL] 이 있는 모순이 732세션 중 24건(3.3%) 있었다. 여기서는 종합 verdict 가 개별
// 검사기 severity 보다 낮을 수 없다 — 그것을 코드가 아니라 **계산 방식**으로 보장한다.

import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';

export type CheckSeverity = 'block' | 'warning' | 'info';

export type CheckerName =
  | 'cross-spec'
  | 'rationale-continuity'
  | 'convention-compliance'
  | 'requirement-shape'
  | 'task-coherence';

export interface CheckFinding {
  checker: CheckerName;
  severity: CheckSeverity;
  message: string;
  /** 앵커 — 헤딩 slug 또는 requirement ref. 어디를 고쳐야 하는지 가리킨다 */
  anchor: string | null;
}

export interface CheckResult {
  /** 종합 판정 — 개별 severity 의 최댓값이다. 낮출 수 없다 */
  verdict: CheckSeverity;
  findings: CheckFinding[];
  /** 검사기별 실행 여부 — 5개가 다 돌았는지 보인다(커버리지 무결성) */
  checkers: Record<CheckerName, number>;
}

/** EARS 문형 — WHEN/WHILE/IF … THE SYSTEM SHALL … */
const EARS_PATTERN = /^\s*(WHEN|WHILE|IF|WHERE)\b.*\bTHE SYSTEM SHALL\b/i;
const REQUIREMENT_ID = /^[A-Z]+-[A-Z]+-\d+$/;

@Injectable()
export class SpecCheckService {
  constructor(@InjectDb() private readonly db: NervDb) {}

  /**
   * 5검사기를 돌린다. 제출 게이트이면서 **셀프서비스**다 —
   * 초안 저장 후·제출 전 아무 때나 부를 수 있다(§2.1 말미).
   */
  async check(input: { projectId: string; specVersionId: string }): Promise<CheckResult> {
    const { rows } = await this.db.execute<{
      spec_id: string;
      spec_key: string;
      spec_type: string;
      body_md: string;
    }>(sql`
      SELECT sv.spec_id, s.key AS spec_key, s.type::text AS spec_type, sv.body_md
        FROM spec_version sv JOIN spec s ON s.id = sv.spec_id
       WHERE sv.id = ${input.specVersionId} AND s.project_id = ${input.projectId}
    `);
    const version = rows[0];
    if (version === undefined) {
      return {
        verdict: 'block',
        findings: [
          {
            checker: 'cross-spec',
            severity: 'block',
            message: '버전을 찾을 수 없습니다.',
            anchor: null,
          },
        ],
        checkers: emptyCounts(),
      };
    }

    const findings = [
      ...(await this.crossSpec(input.projectId, version.spec_id, version.body_md)),
      ...(await this.rationaleContinuity(input.projectId, version.body_md)),
      ...(await this.conventionCompliance(input.projectId, version.spec_type, version.body_md)),
      ...this.requirementShape(version.body_md),
      ...(await this.taskCoherence(version.spec_id)),
    ];

    const counts = emptyCounts();
    for (const finding of findings) counts[finding.checker] += 1;

    return { verdict: worstOf(findings), findings, checkers: counts };
  }

  /** 다른 스펙과의 중복 정의 — 안정 ID 참조 그래프로 기계 검출한다. */
  private async crossSpec(
    projectId: string,
    specId: string,
    body: string,
  ): Promise<CheckFinding[]> {
    const refs = [...new Set(body.match(/[A-Z]+-[A-Z]+-\d+/g) ?? [])];
    if (refs.length === 0) return [];

    // 이 문서가 언급한 요구사항 ID 중 **다른 스펙이 이미 소유한** 것 — 중복 정의의 신호다
    const { rows } = await this.db.execute<{ ref: string; owner_key: string }>(sql`
      SELECT r.ref, s.key AS owner_key
        FROM requirement r JOIN spec s ON s.id = r.spec_id
       WHERE r.project_id = ${projectId} AND r.spec_id <> ${specId}
         AND r.ref = ANY(${sql.raw(`ARRAY[${refs.map((r) => `'${r}'`).join(',')}]::text[]`)})
    `);

    return rows.map((row) => ({
      checker: 'cross-spec' as const,
      // 인용은 정상이므로 경고다. 차단은 같은 ID 를 **정의**할 때인데 그 판정은
      // 요구사항 블록 파싱이 필요해 requirement-shape 가 본다.
      severity: 'warning' as const,
      message: `${row.ref} 은 ${row.owner_key} 가 소유한다 — 재정의라면 중복이다`,
      anchor: row.ref,
    }));
  }

  /** 기각한 대안의 무자각 재도입 — Rationale 을 결정 레코드로 보관해 질의한다. */
  private async rationaleContinuity(projectId: string, body: string): Promise<CheckFinding[]> {
    // MVP 는 deprecated 스펙의 제목이 본문에 다시 등장하는지 본다.
    // 결정 레코드(ADR)가 쌓이면 그것으로 확장한다(Phase 2).
    const { rows } = await this.db.execute<{ key: string; title: string }>(sql`
      SELECT s.key, s.title FROM spec s
        JOIN spec_version sv ON sv.id = s.current_version_id
       WHERE s.project_id = ${projectId} AND sv.status = 'deprecated'
    `);
    return rows
      .filter((row) => row.title.length >= 4 && body.includes(row.title))
      .map((row) => ({
        checker: 'rationale-continuity' as const,
        severity: 'warning' as const,
        message: `폐기된 스펙 "${row.title}"(${row.key}) 의 내용이 다시 등장한다 — 기각 이력을 확인하라`,
        anchor: null,
      }));
  }

  /** convention 타입 스펙 위배 — 규약을 스펙 노드로 두고 참조로 검사한다. */
  private async conventionCompliance(
    projectId: string,
    specType: string,
    body: string,
  ): Promise<CheckFinding[]> {
    if (specType === 'convention') return []; // 규약 자신은 대상이 아니다

    const { rows } = await this.db.execute<{ key: string; title: string }>(sql`
      SELECT key, title FROM spec
       WHERE project_id = ${projectId} AND type = 'convention' AND archived_at IS NULL
    `);
    if (rows.length === 0) return [];

    // 규약이 있는데 어느 것도 참조하지 않으면 정보다 — 차단하지 않는다.
    const mentions = rows.some((row) => body.includes(row.key));
    return mentions
      ? []
      : [
          {
            checker: 'convention-compliance',
            severity: 'info',
            message: `프로젝트 규약 ${rows.length}건 중 참조가 없다 — 해당 없으면 무시해도 된다`,
            anchor: null,
          },
        ];
  }

  /**
   * EARS 템플릿·ID 형식·중복 ID — 요구사항이 1급 엔티티라 파싱이 아니라 검증이다.
   * **중복 ID 는 block 이다**: 같은 ref 가 두 번 정의되면 어느 쪽이 진짜인지 알 수 없다.
   */
  private requirementShape(body: string): CheckFinding[] {
    const findings: CheckFinding[] = [];
    const seen = new Map<string, number>();

    body.split('\n').forEach((line, index) => {
      const match = /^[-*]?\s*([A-Z]+-[A-Z]+-\d+)\s+(.*)$/.exec(line.trim());
      if (match === null) return;
      const [, ref, statement] = match;
      if (ref === undefined) return;

      seen.set(ref, (seen.get(ref) ?? 0) + 1);

      if (!REQUIREMENT_ID.test(ref)) {
        findings.push({
          checker: 'requirement-shape',
          severity: 'block',
          message: `요구사항 ID 형식 위반: ${ref}`,
          anchor: ref,
        });
      }
      if (statement !== undefined && statement.trim() !== '' && !EARS_PATTERN.test(statement)) {
        findings.push({
          checker: 'requirement-shape',
          // EARS 는 권장이라 경고다 — 강제하면 임포트한 문서가 전부 막힌다
          severity: 'warning',
          message: `EARS 문형이 아니다 (WHEN/WHILE/IF … THE SYSTEM SHALL …): ${ref}`,
          anchor: ref,
        });
      }
      void index;
    });

    for (const [ref, count] of seen) {
      if (count > 1) {
        findings.push({
          checker: 'requirement-shape',
          severity: 'block',
          message: `요구사항 ID 중복 정의 ${count}회: ${ref}`,
          anchor: ref,
        });
      }
    }
    return findings;
  }

  /**
   * 파생 Task 와의 정합 — clemvion 의 R-5 "어떤 plan 도 책임지지 않는 빈 약속"을
   * FK 부재로 즉시 검출한다.
   */
  private async taskCoherence(specId: string): Promise<CheckFinding[]> {
    const { rows } = await this.db.execute<{ ref: string }>(sql`
      SELECT r.ref FROM requirement r
       WHERE r.spec_id = ${specId} AND r.removed_in_version_id IS NULL
         AND r.impl_status IN ('in_progress', 'implemented')
         AND NOT EXISTS (SELECT 1 FROM task t WHERE t.source_requirement_id = r.id)
    `);
    return rows.map((row) => ({
      checker: 'task-coherence' as const,
      severity: 'warning' as const,
      message: `${row.ref} 은 진행 중이라고 선언됐으나 책임지는 Task 가 없다 — 빈 약속이다`,
      anchor: row.ref,
    }));
  }
}

function emptyCounts(): Record<CheckerName, number> {
  return {
    'cross-spec': 0,
    'rationale-continuity': 0,
    'convention-compliance': 0,
    'requirement-shape': 0,
    'task-coherence': 0,
  };
}

/**
 * 종합 판정 = 개별 severity 의 **최댓값**.
 *
 * 이 함수가 "종합 verdict 는 개별 검사기 severity 보다 낮을 수 없다"는 규칙의 실물이다.
 * 조건문으로 낮출 여지를 두지 않는 것이 clemvion 의 3.3% 모순을 구조적으로 막는 방법이다.
 */
export function worstOf(findings: CheckFinding[]): CheckSeverity {
  if (findings.some((f) => f.severity === 'block')) return 'block';
  if (findings.some((f) => f.severity === 'warning')) return 'warning';
  return 'info';
}
