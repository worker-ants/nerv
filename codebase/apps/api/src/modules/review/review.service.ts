// 리뷰 수집(FR-09) — **리뷰를 파일이 아니라 레코드로.**
//
// clemvion 에서 리뷰 산출물은 `review/**` 에 markdown 으로 커밋됐다. 그 결과가 실측이다:
// md 13,777개 · 131MB, 리뷰 이력 blob 이 `.git` packed blob 바이트의 60%(60.7MB).
// 더 나쁜 것은 **자기증식 루프**다 — 리뷰가 코드와 같은 브랜치에 커밋되어 다음 리뷰의
// 입력이 되고, 한 changeset 이 8라운드를 도는 동안 마지막 라운드의 프롬프트는 94파일 중
// 86개가 앞선 리뷰 산출물이었다.
//
// 이 서비스가 그 고리를 끊는다: 리뷰는 저장소가 아니라 여기로 들어오고, 같은 지적은
// fingerprint 로 하나의 Finding 에 합쳐진다(data-model §5.2).
//
// **레코드 3층의 소유 관계**(database.md §2.7):
//   review_session   changeset 하나 = 세션 하나. 여러 리뷰어가 같은 세션에 들어간다.
//   reviewer_report  그 세션 안의 역할 하나. `(session, role)` 이 UNIQUE 다.
//   finding          라운드를 넘어 하나로 유지되는 지적. `(project, fingerprint)` 가 UNIQUE.

import { Injectable } from '@nestjs/common';
import { msg, newId, NERV_ERROR, NERV_EVENT, NERV_EVENT_PHASE2 } from '@nerv/schema';
import { changesetHash, findingFingerprint } from '@nerv/schema/keys';
import { sql } from 'drizzle-orm';
import { EventService } from '../event/event.service.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';

type Tx = Parameters<Parameters<NervDb['transaction']>[0]>[0];

/** 리뷰어가 보내는 발견 하나 — 계약은 agent-integration §2.3 이 정본이다. */
export interface SubmitFinding {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  body_md?: string | null;
  suggestion_md?: string | null;
  category?: string | null;
  file?: string | null;
  line?: number | null;
  symbol?: string | null;
  requirement_id?: string | null;
  spec_version_id?: string | null;
  /** `spec_drift` 등 — 필터의 축이다(screens.md §2.6a) */
  tags?: readonly string[];
}

export interface SubmitInput {
  projectId: string;
  userId: string;
  /** 에이전트 세션 — 감사 FK. REST 로 들어오면 없다 */
  sessionId?: string | null;
  /** PAT 로 들어온 호출인가(FR-16 감사의 축). 세션 유무와는 다른 축이다 */
  isAgent?: boolean;
  branch: string;
  baseSha: string;
  headSha: string;
  /** 검토 대상 파일 목록 — changeset 해시의 재료다(라운드 동일성) */
  changeset?: readonly string[];
  kind: 'code' | 'consistency' | 'spec_coverage' | 'merge';
  taskId?: string | null;
  reviewer: { role: string; risk?: 'low' | 'medium' | 'high' | null };
  summaryMd?: string | null;
  findings: readonly SubmitFinding[];
  /** 재생성 가능한 프롬프트 페이로드의 TTL 오브젝트 스토리지 위치(D-01·D-07) */
  payloadRef?: string | null;
  /**
   * 리뷰가 **실제로 돌던 시각**. 임포트가 쓴다 — 비워 두면 과거 리뷰 1,984건이 전부
   * "지금"으로 찍혀 타임라인이 한 점으로 뭉친다(그 순간 이력이 사라진다).
   */
  reviewedAt?: string | null;
}

export interface SubmitResult {
  review_session_id: string;
  round_no: number;
  merged_into_existing_session: boolean;
  findings_new: readonly string[];
  findings_merged: readonly string[];
  /** 이월된 미해결 — 이 리뷰가 아니라 **이 프로젝트**의 열린 발견이다 */
  carried_over: readonly { id: string; severity: string; title: string }[];
  block: boolean;
}

export interface IngestInput {
  projectId: string;
  userId: string;
  /** 원본 세션 경로 — 소급 적재의 식별자다(changesetHash 의 salt) */
  sourcePath: string;
  branch: string;
  baseSha: string;
  headSha: string;
  changeset?: readonly string[];
  kind: 'code' | 'consistency' | 'spec_coverage' | 'merge';
  reviewedAt?: string | null;
  block: boolean;
  reports: readonly { role: string; risk: 'low' | 'medium' | 'high'; bodyMd?: string | null }[];
  findings: readonly SubmitFinding[];
}

export type ResolutionKind = 'fixed' | 'deferred' | 'dismissed' | 'escalated' | 'spec_change';

export interface ResolveInput {
  projectId: string;
  findingId: string;
  userId: string;
  sessionId?: string | null;
  /**
   * **A3 게이트가 보는 축.** 막는 것은 "에이전트가 자기 리뷰의 심각도를 스스로 낮추는
   * 것"이지 사람의 판단이 아니다(agent-integration §2.3). 세션 유무가 아니라 주체가
   * 에이전트인지가 기준이다 — PAT 는 에이전트 세션 없이도 온다.
   */
  isAgent?: boolean;
  /** 도구 계약의 `resolution` 값(fixed·dismissed·wont_fix)은 표면이 여기로 번역한다 */
  kind: ResolutionKind;
  status: 'fixed' | 'dismissed' | 'wont_fix';
  rationale: string;
  commitSha?: string | null;
  changeRequestId?: string | null;
}

export interface ResolveResult {
  finding_id: string;
  status: string;
  resolution_id: string;
  open_remaining: number;
}

/** 리뷰어 위험도 → 세션 위험도. 가장 높은 것이 세션의 값이다. */
const RISK_ORDER = ['low', 'medium', 'high'] as const;

@Injectable()
export class ReviewService {
  constructor(
    private readonly events: EventService,
    @InjectDb() private readonly db: NervDb,
  ) {}

  /**
   * EP-REV-01 · `nerv_review_submit` — 한 리뷰어의 한 라운드를 통째로 받는다.
   *
   * **한 트랜잭션이다.** 세션·리포트·발견이 따로 커밋되면 중간 실패가 "리포트는 있는데
   * 발견이 없는 라운드"를 남기고, 그 라운드는 게이트 판정에서 통과로 읽힌다.
   */
  async submit(input: SubmitInput): Promise<SubmitResult> {
    if (input.headSha.trim() === '' || input.baseSha.trim() === '') {
      // 입력 스냅샷이 없는 리뷰는 나중에 "무엇을 봤는지" 답할 수 없다(FR-09 필수 조건).
      // clemvion meta.json 에는 이 필드 자체가 없어 표본 SUMMARY 200개 중 47개만
      // 산문에 해시를 남겼다 — 스키마의 NOT NULL 이 가장 값싼 개선인 이유다.
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.review.head_required'), {
        kind: 'missing_head_sha',
      });
    }
    if (input.reviewer.role.trim() === '') {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.review.role_required'), {
        kind: 'missing_reviewer_role',
      });
    }

    const hash = changesetHash({
      baseSha: input.baseSha,
      headSha: input.headSha,
      changeset: input.changeset ?? [],
    }).toString('hex');

    return this.events.transact(async (tx, emit) => {
      const session = await this.sessionFor(tx, input, hash);
      const reportId = await this.upsertReport(tx, session.id, input);

      const created: string[] = [];
      const mergedIds: string[] = [];
      for (const [index, finding] of input.findings.entries()) {
        const opened = await this.upsertFinding(tx, input, finding, {
          sessionId: session.id,
          reportId,
          roundNo: session.roundNo,
          displayNo: index + 1,
        });
        if (opened.created) created.push(opened.findingId);
        else mergedIds.push(opened.findingId);
      }

      // BLOCK 은 **열린 critical 이 있는가**로 정한다 — consistency 리뷰의 `BLOCK: YES/NO`
      // 를 계승한 필드이고(database.md §2.7), 판정은 리뷰어의 주장이 아니라 데이터다.
      const carried = await this.openFindings(tx, input.projectId);
      const block = carried.some((f) => f.severity === 'critical');
      await tx.execute(sql`
        UPDATE review_session
           SET state = 'complete',
               completed_at = coalesce(${input.reviewedAt ?? null}::timestamptz, now()),
               risk = ${await this.sessionRisk(tx, session.id)}::review_risk,
               block = ${block},
               file_count = ${(input.changeset ?? []).length}
         WHERE id = ${session.id}
      `);

      for (const findingId of created) {
        // **이벤트는 새로 열린 발견에만.** 같은 지적이 라운드마다 다시 울리면 알림이
        // 소음이 되고, 그 소음 때문에 사람이 알림을 끈다 — dedup 이 여기서도 값을 한다.
        // 이름은 카탈로그가 정본이다(spec-workflow §6.3): `review.submitted` 는 없다.
        await emit({
          type: NERV_EVENT_PHASE2.FINDING_OPENED,
          projectId: input.projectId,
          actorUserId: input.userId,
          actorSessionId: input.sessionId ?? null,
          isAgent: input.isAgent ?? input.sessionId != null,
          subjectType: 'finding',
          subjectId: findingId,
        });
      }

      return {
        review_session_id: session.id,
        round_no: session.roundNo,
        merged_into_existing_session: !session.fresh,
        findings_new: created,
        findings_merged: mergedIds,
        carried_over: carried,
        block,
      };
    });
  }

  /**
   * EP-IMP-06 — **임포트 전용**. 원본 한 세션에는 리뷰어가 여럿이라(역할별 md) 도구
   * 경로(`submit`)의 "리뷰어 하나" 계약으로는 담기지 않는다.
   *
   * 이벤트를 내지 않는 것이 도구 경로와의 두 번째 차이다: 과거 리뷰 1,984건을 적재하며
   * `finding.opened` 를 3만 번 방송하면 알림이 소음이 되고, 그 소음이 알림을 끄게 만든다.
   * 임포트는 **이미 일어난 일**을 옮기는 것이지 지금 일어나는 일이 아니다.
   */
  async ingest(input: IngestInput): Promise<{ session_id: string; findings: number }> {
    if (input.headSha.trim() === '' || input.baseSha.trim() === '') {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.review.head_required'), {
        kind: 'missing_head_sha',
      });
    }
    const hash = changesetHash({
      baseSha: input.baseSha,
      headSha: input.headSha,
      changeset: input.changeset ?? [],
      // 원본 세션 하나 = 우리 세션 하나. 소금이 없으면 한 커밋에 함께 담긴 리뷰들이
      // 한 세션으로 뭉치고, 그때 리포트는 마지막 것만 남는다(실측 2026-08-24).
      salt: input.sourcePath,
    }).toString('hex');

    return this.db.transaction(async (tx) => {
      const base: SubmitInput = {
        projectId: input.projectId,
        userId: input.userId,
        branch: input.branch,
        baseSha: input.baseSha,
        headSha: input.headSha,
        changeset: input.changeset ?? [],
        kind: input.kind,
        reviewer: { role: 'import' },
        findings: [],
        reviewedAt: input.reviewedAt ?? null,
      };
      const session = await this.sessionFor(tx, base, hash);

      let displayNo = 0;
      let worst = 0;
      for (const report of input.reports) {
        worst = Math.max(worst, RISK_ORDER.indexOf(report.risk));
        const reportId = await this.upsertReport(tx, session.id, {
          ...base,
          reviewer: { role: report.role, risk: report.risk },
          summaryMd: report.bodyMd ?? null,
        });
        // 발견은 **세션에 하나씩**이지 리포트마다가 아니다 — 원본 SUMMARY 가 이미
        // 역할을 가로질러 합쳐 놓은 표라, 첫 리포트에 달아 출처만 남긴다.
        if (report !== input.reports[0]) continue;
        for (const finding of input.findings) {
          displayNo += 1;
          await this.upsertFinding(tx, base, finding, {
            sessionId: session.id,
            reportId,
            roundNo: session.roundNo,
            displayNo,
          });
        }
      }

      await tx.execute(sql`
        UPDATE review_session
           SET state = 'complete',
               completed_at = coalesce(${input.reviewedAt ?? null}::timestamptz, now()),
               risk = ${RISK_ORDER[worst] ?? 'low'}::review_risk,
               block = ${input.block},
               file_count = ${(input.changeset ?? []).length}
         WHERE id = ${session.id}
      `);
      return { session_id: session.id, findings: input.findings.length };
    });
  }

  /**
   * changeset 하나에 세션 하나. **같은 커밋·같은 파일 집합의 재제출은 라운드를 늘리지
   * 않는다**(agent-integration §2.3 멱등 열). 두 리뷰어가 같은 changeset 을 보면 같은
   * 세션의 서로 다른 `reviewer_report` 가 된다 — 그래야 "이 라운드의 커버리지"를 물을 수 있다.
   *
   * 라운드는 **브랜치 위에서 센다.** 코드가 나아가면 changeset 이 바뀌고, 그때가 다음
   * 라운드다. 리뷰어가 보내는 번호를 믿으면 같은 커밋의 두 리뷰어가 서로 다른 번호를
   * 주장하고, 그때 "몇 바퀴 돌았나"는 아무도 답할 수 없다.
   */
  private async sessionFor(
    tx: Tx,
    input: SubmitInput,
    hash: string,
  ): Promise<{ id: string; roundNo: number; fresh: boolean }> {
    const { rows: same } = await tx.execute<{ id: string; round_no: number }>(sql`
      SELECT id, round_no FROM review_session
       WHERE project_id = ${input.projectId} AND changeset_hash = decode(${hash}, 'hex')
         AND kind = ${input.kind}::review_kind
       ORDER BY round_no DESC LIMIT 1
    `);
    const existing = same[0];
    if (existing !== undefined) {
      return { id: existing.id, roundNo: existing.round_no, fresh: false };
    }

    const { rows: prior } = await tx.execute<{ id: string; round_no: number }>(sql`
      SELECT id, round_no FROM review_session
       WHERE project_id = ${input.projectId} AND branch = ${input.branch}
         AND kind = ${input.kind}::review_kind
       ORDER BY round_no DESC, created_at DESC LIMIT 1
    `);
    const previous = prior[0];
    const sessionId = newId();
    const roundNo = (previous?.round_no ?? 0) + 1;
    await tx.execute(sql`
      INSERT INTO review_session (id, project_id, kind, "trigger", agent_session_id, task_id,
                                  branch, head_sha, base_sha, changeset_hash, round_no,
                                  previous_session_id, state, prompt_blob_uri, prompt_expires_at,
                                  started_at)
      VALUES (${sessionId}, ${input.projectId}, ${input.kind}::review_kind,
              ${input.sessionId != null ? 'auto' : 'manual'}::review_trigger,
              ${input.sessionId ?? null}, ${input.taskId ?? null},
              ${input.branch}, ${input.headSha}, ${input.baseSha}, decode(${hash}, 'hex'),
              ${roundNo}, ${previous?.id ?? null}, 'running'::review_state,
              ${input.payloadRef ?? null},
              ${input.payloadRef == null ? null : sql`now() + interval '30 days'`},
              coalesce(${input.reviewedAt ?? null}::timestamptz, now()))
    `);
    return { id: sessionId, roundNo, fresh: true };
  }

  /**
   * 역할 하나에 리포트 하나(`reviewer_report_role_uq`). 같은 역할이 다시 제출하면 **덮어쓴다** —
   * 리뷰어가 자기 소견을 고쳐 보내는 것이지 새 리뷰어가 온 것이 아니다.
   */
  private async upsertReport(tx: Tx, sessionId: string, input: SubmitInput): Promise<string> {
    const risk = input.reviewer.risk ?? 'low';
    const { rows } = await tx.execute<{ id: string }>(sql`
      INSERT INTO reviewer_report (id, review_session_id, role, risk, body_md, has_report)
      VALUES (${newId()}, ${sessionId}, ${input.reviewer.role}, ${risk}::review_risk,
              ${input.summaryMd ?? null}, true)
      ON CONFLICT (review_session_id, role) DO UPDATE
         SET risk = EXCLUDED.risk, body_md = EXCLUDED.body_md, has_report = true,
             recovered = true
      RETURNING id
    `);
    return rows[0]!.id;
  }

  /** 세션 위험도 = 리포트 중 가장 높은 것. 한 리뷰어의 low 가 다른 리뷰어의 high 를 지우지 않는다. */
  private async sessionRisk(tx: Tx, sessionId: string): Promise<string> {
    const { rows } = await tx.execute<{ risk: string }>(sql`
      SELECT risk::text AS risk FROM reviewer_report WHERE review_session_id = ${sessionId}
    `);
    let worst = 0;
    for (const row of rows) worst = Math.max(worst, RISK_ORDER.indexOf(row.risk as 'low'));
    return RISK_ORDER[worst] ?? 'low';
  }

  private async openFindings(
    tx: Tx,
    projectId: string,
  ): Promise<{ id: string; severity: string; title: string }[]> {
    const { rows } = await tx.execute<{ id: string; severity: string; title: string }>(sql`
      SELECT id, severity::text AS severity, title FROM finding
       WHERE project_id = ${projectId} AND status = 'open'
       ORDER BY severity, created_at
    `);
    return rows;
  }

  /** 새로 열었는가(created), 그리고 그 finding id. */
  private async upsertFinding(
    tx: Tx,
    input: SubmitInput,
    finding: SubmitFinding,
    round: { sessionId: string; reportId: string; roundNo: number; displayNo: number },
  ): Promise<{ findingId: string; created: boolean }> {
    const category = finding.category ?? input.reviewer.role;
    const hex = findingFingerprint({
      projectId: input.projectId,
      category,
      filePath: finding.file ?? null,
      symbol: finding.symbol ?? null,
      title: finding.title,
    }).toString('hex');

    const { rows: existing } = await tx.execute<{ id: string }>(sql`
      SELECT id FROM finding
       WHERE project_id = ${input.projectId} AND fingerprint = decode(${hex}, 'hex')
       FOR UPDATE
    `);
    const hit = existing[0];
    let findingId: string;

    if (hit === undefined) {
      findingId = newId();
      await tx.execute(sql`
        INSERT INTO finding (id, project_id, fingerprint, severity, category, title, detail_md,
                             suggestion_md, tags, file_path, line_start, symbol, spec_version_id,
                             requirement_id, status, first_session_id, last_session_id,
                             occurrence_count, created_at)
        VALUES (${findingId}, ${input.projectId}, decode(${hex}, 'hex'),
                ${finding.severity}::finding_severity, ${category}, ${finding.title},
                ${finding.body_md ?? null}, ${finding.suggestion_md ?? null},
                ${sql.raw(pgTextArray(finding.tags ?? []))},
                ${finding.file ?? null}, ${finding.line ?? null}, ${finding.symbol ?? null},
                ${finding.spec_version_id ?? null}, ${finding.requirement_id ?? null},
                'open'::finding_status, ${round.sessionId}, ${round.sessionId}, 1,
                coalesce(${input.reviewedAt ?? null}::timestamptz, now()))
      `);
    } else {
      findingId = hit.id;
      // **위치만 갱신한다.** 줄이 밀린 것은 새 사실이 아니라 같은 사실의 최신 좌표다.
      // 처분(status)은 건드리지 않는다 — 다시 지적됐다고 fixed 가 open 으로 돌아가면
      // 사람이 내린 판단을 리뷰어가 덮는 것이 된다.
      await tx.execute(sql`
        UPDATE finding
           SET line_start = coalesce(${finding.line ?? null}, line_start),
               last_session_id = ${round.sessionId},
               occurrence_count = occurrence_count + 1
         WHERE id = ${findingId}
      `);
    }

    // **원래 심각도를 그대로 남긴다**(§2.7 raw_severity). finding.severity 와 이 값이
    // 갈리는 순간이 곧 하향이고, 그 대조가 감사의 유일한 근거다(clemvion 실측 24/732).
    //
    // 같은 세션에 같은 발견이 두 번 오면(같은 리뷰어의 재제출) 출현은 하나다 —
    // `finding_occurrence_uq` 가 그것을 강제하고, 여기서는 최신 값으로 덮는다.
    await tx.execute(sql`
      INSERT INTO finding_occurrence (id, finding_id, review_session_id, reviewer_report_id,
                                      round_no, display_no, raw_severity)
      VALUES (${newId()}, ${findingId}, ${round.sessionId}, ${round.reportId},
              ${round.roundNo}, ${round.displayNo}, ${finding.severity}::finding_severity)
      ON CONFLICT (finding_id, review_session_id) DO UPDATE
         SET display_no = EXCLUDED.display_no, raw_severity = EXCLUDED.raw_severity,
             reviewer_report_id = EXCLUDED.reviewer_report_id
    `);
    return { findingId, created: hit === undefined };
  }

  /**
   * EP-REV-02 · `nerv_finding_resolve` — 발견 하나를 처분한다.
   *
   * **하향 조정이 A3 인 이유**(agent-integration §2.3): clemvion 실측에서 checker 의
   * CRITICAL 을 `BLOCK: NO` 로 하향한 모순이 732건 중 24건(3.3%) 관측됐다. 에이전트가
   * 자기 리뷰의 심각도를 스스로 낮출 수 있으면 게이트는 형식이 된다. 그래서 `critical`
   * 을 `dismissed`/`wont_fix` 로 옮기는 **에이전트의** 호출만 승인 큐를 거친다.
   * `fixed` + `commit_sha` 는 검증 가능한 사실이라 A2 다.
   */
  async resolve(input: ResolveInput): Promise<ResolveResult> {
    if (input.rationale.trim() === '') {
      // 유예 근거는 1급 데이터다(database.md §2.7 `rationale_md` NOT NULL).
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.review.rationale_required'), {
        kind: 'missing_rationale',
      });
    }
    if (input.kind === 'fixed' && (input.commitSha ?? '').trim() === '') {
      // CHECK 가 어차피 막지만, 여기서 막아야 **무엇이 잘못됐는지**가 응답에 남는다.
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.review.commit_required'), {
        kind: 'missing_commit_sha',
      });
    }

    // **게이트는 트랜잭션 밖이다.** 승인 카드를 만들고 같은 트랜잭션에서 막으면 그 카드도
    // 함께 롤백된다 — 사람의 승인함에는 아무것도 뜨지 않고 에이전트만 재시도한다(실측).
    const preflight = await this.loadFinding(input);
    const downgrade =
      preflight.severity === 'critical' &&
      (input.status === 'dismissed' || input.status === 'wont_fix');
    if (downgrade && (input.isAgent ?? input.sessionId != null)) {
      await this.requireDowngradeApproval(input);
    }

    return this.events.transact(async (tx, emit) => {
      const { rows } = await tx.execute<{ severity: string; status: string }>(sql`
        SELECT severity::text AS severity, status::text AS status FROM finding
         WHERE id = ${input.findingId} AND project_id = ${input.projectId}
         FOR UPDATE
      `);
      const finding = rows[0]!;

      // **멱등은 같은 처분에만.** 이미 fixed 인 것을 다시 fixed 로 부르면 그대로 통과하고,
      // 다른 처분으로 부르면 막는다 — 처분을 뒤집는 것은 재호출이 아니라 새 판단이다.
      if (finding.status !== 'open' && finding.status !== input.status) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.review.already_resolved'), {
          kind: 'already_resolved',
          status: finding.status,
        });
      }

      const resolutionId = newId();
      await tx.execute(sql`
        INSERT INTO resolution (id, finding_id, kind, commit_sha, change_request_id,
                                rationale_md, actor_user_id, actor_session_id)
        VALUES (${resolutionId}, ${input.findingId}, ${input.kind}::resolution_kind,
                ${input.commitSha ?? null}, ${input.changeRequestId ?? null},
                ${input.rationale}, ${input.userId}, ${input.sessionId ?? null})
      `);
      await tx.execute(sql`
        UPDATE finding SET status = ${input.status}::finding_status WHERE id = ${input.findingId}
      `);

      await emit({
        type: NERV_EVENT_PHASE2.FINDING_RESOLVED,
        projectId: input.projectId,
        actorUserId: input.userId,
        actorSessionId: input.sessionId ?? null,
        isAgent: input.isAgent ?? input.sessionId != null,
        subjectType: 'finding',
        subjectId: input.findingId,
        fromState: finding.status,
        toState: input.status,
        payload: { kind: input.kind, severity: finding.severity, downgrade },
      });

      const { rows: remaining } = await tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM finding
         WHERE project_id = ${input.projectId} AND status = 'open'
      `);
      return {
        finding_id: input.findingId,
        status: input.status,
        resolution_id: resolutionId,
        open_remaining: remaining[0]?.n ?? 0,
      };
    });
  }

  /** 처분 전 확인 — 없는 발견에 처분을 남기지 않는다. */
  private async loadFinding(input: ResolveInput): Promise<{ severity: string; status: string }> {
    const { rows } = await this.db.execute<{ severity: string; status: string }>(sql`
      SELECT severity::text AS severity, status::text AS status FROM finding
       WHERE id = ${input.findingId} AND project_id = ${input.projectId}
    `);
    const finding = rows[0];
    if (finding === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.review.finding_not_found'), {
        kind: 'not_found',
        finding_id: input.findingId,
      });
    }
    return finding;
  }

  /**
   * A3 게이트 — 승인된 카드가 있으면 돌아오고, 없으면 **카드를 만들고 막는다**.
   *
   * 카드를 만들어 두는 것이 핵심이다: 막기만 하면 에이전트는 사람에게 무엇을 부탁해야
   * 하는지 모른 채 재시도만 하고, 사람의 승인함에는 아무것도 뜨지 않는다.
   */
  private async requireDowngradeApproval(input: ResolveInput): Promise<void> {
    const card = await this.events.transact(async (tx, emit) => {
      const { rows } = await tx.execute<{ id: string; decision: string | null }>(sql`
        SELECT id, decision::text AS decision FROM approval
         WHERE project_id = ${input.projectId} AND subject_type = 'finding'
           AND subject_id = ${input.findingId}
         ORDER BY requested_at DESC LIMIT 1
      `);
      const existing = rows[0];
      if (existing?.decision === 'approve') return { approved: true, id: existing.id };
      // 이미 대기 중인 카드가 있으면 그것을 가리킨다 — 재호출이 카드를 늘리지 않는다(§2.5)
      if (existing !== undefined && existing.decision === null) {
        return { approved: false, id: existing.id };
      }

      const approvalId = newId();
      await tx.execute(sql`
        INSERT INTO approval (id, project_id, subject_type, subject_id,
                              requested_by_user_id, requested_by_session_id)
        VALUES (${approvalId}, ${input.projectId}, 'finding'::approval_subject_type,
                ${input.findingId}, ${input.userId}, ${input.sessionId ?? null})
      `);
      await emit({
        type: NERV_EVENT.APPROVAL_REQUESTED,
        projectId: input.projectId,
        actorUserId: input.userId,
        actorSessionId: input.sessionId ?? null,
        isAgent: true,
        subjectType: 'approval',
        subjectId: approvalId,
        payload: { subject_type: 'finding', reason: 'critical_downgrade' },
      });
      return { approved: false, id: approvalId };
    });

    if (card.approved) return;
    throw new NervError(NERV_ERROR.APPROVAL_REQUIRED, msg('error.review.downgrade_needs_human'), {
      kind: 'critical_downgrade',
      approval_id: card.id,
      finding_id: input.findingId,
    });
  }

  /**
   * EP-REV-03 — 발견 큐. **facet 을 같은 응답에 싣는다**(REQ-WEB-061).
   *
   * 필터 칸의 숫자를 따로 받게 하면 목록과 숫자가 어긋나는 순간이 생기고(두 요청 사이에
   * 새 발견이 들어온다), QA 는 "3건이라더니 4건"을 보게 된다. 한 번에 답하면 그 틈이 없다.
   *
   * facet 의 뜻은 **"이것을 켜면 몇 건이 보이는가"** 다 — 그래서 각 차원은 자기 자신의
   * 선택을 무시하고 나머지 필터만 적용해서 센다. 자기 선택까지 반영하면 켜져 있는 것만
   * 숫자가 남아 필터가 스스로를 가둔다.
   */
  async findings(input: {
    projectId: string;
    severity?: readonly string[];
    status?: readonly string[];
    tag?: readonly string[];
    limit?: number;
  }): Promise<{ items: Record<string, unknown>[]; facets: FindingFacets; limit: number }> {
    const severity = normalizeFilter(input.severity, FINDING_SEVERITIES);
    const status = normalizeFilter(input.status, FINDING_STATUSES);
    const tags = (input.tag ?? []).filter((t) => t.trim() !== '');
    // 상한은 계약이 정한다 — clemvion 실측 18,650 발견을 한 응답에 담으면 화면이
    // 3만 픽셀이 된다(실측 2026-08-24). 잘린 사실은 facet 총계가 말한다.
    const limit = Math.min(Math.max(input.limit ?? FINDING_PAGE, 1), FINDING_PAGE_MAX);

    const { rows: items } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT f.id, f.severity::text AS severity, f.status::text AS status, f.category, f.title,
             f.detail_md, f.suggestion_md, f.tags, f.file_path, f.line_start, f.symbol,
             f.occurrence_count, f.created_at,
             rs.head_sha, rs.branch, rs.round_no, rs.completed_at AS reviewed_at,
             s.key AS spec_key, s.title AS spec_title, r.ref AS requirement_ref
        FROM finding f
        JOIN review_session rs ON rs.id = f.last_session_id
        LEFT JOIN spec_version sv ON sv.id = f.spec_version_id
        LEFT JOIN spec s ON s.id = sv.spec_id
        LEFT JOIN requirement r ON r.id = f.requirement_id
       WHERE f.project_id = ${input.projectId}
         ${this.filter('f.severity', severity, 'finding_severity')}
         ${this.filter('f.status', status, 'finding_status')}
         ${tags.length === 0 ? sql`` : sql`AND f.tags && ${sql.raw(pgTextArray(tags))}`}
       ORDER BY f.severity, f.created_at DESC
       LIMIT ${limit}
    `);

    return {
      items,
      limit,
      facets: {
        // 각 차원은 **자기 선택을 뺀** 나머지 필터로 센다
        severity: await this.facet(input.projectId, 'severity', {
          status,
          tags,
          severity: [],
        }),
        status: await this.facet(input.projectId, 'status', { severity, tags, status: [] }),
        tag: await this.facetTags(input.projectId, severity, status),
      },
    };
  }

  /** `IN (...)` 를 만들되 빈 목록이면 조건 자체를 내지 않는다 — 빈 IN 은 전량 배제다. */
  private filter(column: string, values: readonly string[], enumType: string) {
    if (values.length === 0) return sql``;
    const list = sql.join(
      values.map((v) => sql`${v}::${sql.raw(enumType)}`),
      sql`, `,
    );
    return sql`AND ${sql.raw(column)} IN (${list})`;
  }

  private async facet(
    projectId: string,
    dimension: 'severity' | 'status',
    filters: { severity: readonly string[]; status: readonly string[]; tags: readonly string[] },
  ): Promise<Record<string, number>> {
    const { rows } = await this.db.execute<{ k: string; n: number }>(sql`
      SELECT ${sql.raw(`f.${dimension}`)}::text AS k, count(*)::int AS n
        FROM finding f
       WHERE f.project_id = ${projectId}
         ${this.filter('f.severity', filters.severity, 'finding_severity')}
         ${this.filter('f.status', filters.status, 'finding_status')}
         ${filters.tags.length === 0 ? sql`` : sql`AND f.tags && ${sql.raw(pgTextArray(filters.tags))}`}
       GROUP BY 1
    `);
    return Object.fromEntries(rows.map((r) => [r.k, r.n]));
  }

  private async facetTags(
    projectId: string,
    severity: readonly string[],
    status: readonly string[],
  ): Promise<Record<string, number>> {
    const { rows } = await this.db.execute<{ k: string; n: number }>(sql`
      SELECT tag AS k, count(*)::int AS n
        FROM finding f, unnest(f.tags) AS tag
       WHERE f.project_id = ${projectId}
         ${this.filter('f.severity', severity, 'finding_severity')}
         ${this.filter('f.status', status, 'finding_status')}
       GROUP BY 1
    `);
    return Object.fromEntries(rows.map((r) => [r.k, r.n]));
  }

  /**
   * EP-REV-04 — 브랜치별 게이트 현황. **표시일 뿐 집행이 아니다**(api.md §2.6a).
   *
   * "이 브랜치를 커버하는 해소된 리뷰가 있는가"를 한 번에 답한다. 판정 3종:
   *   uncovered  리뷰 세션이 없다 — 아무도 보지 않았다
   *   pending    봤지만 열린 발견이 남았다
   *   passed     봤고 남은 것이 없다
   *
   * 면제는 **같은 줄에 펼친다**(REQ-WEB-065). 면제한 사람·시각·사유가 목록 어딘가가 아니라
   * 그 브랜치 옆에 있어야 한다 — 면제가 조용히 일어나지 않는 것 자체가 기능이다(FR-10·FR-16).
   */
  async gateCoverage(
    projectId: string,
    limit = GATE_BRANCH_LIMIT,
  ): Promise<{ items: Record<string, unknown>[]; total: number }> {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      WITH latest AS (
        SELECT DISTINCT ON (branch) branch, id, head_sha, round_no, completed_at
          FROM review_session
         WHERE project_id = ${projectId}
         ORDER BY branch, round_no DESC, created_at DESC
      ),
      counts AS (
        SELECT rs.branch,
               count(DISTINCT f.id)::int AS total,
               count(DISTINCT f.id) FILTER (WHERE f.status <> 'open')::int AS resolved
          FROM review_session rs
          JOIN finding f ON f.last_session_id = rs.id
         WHERE rs.project_id = ${projectId}
         GROUP BY rs.branch
      )
      SELECT l.branch, l.head_sha, l.round_no, l.completed_at,
             coalesce(c.total, 0) AS total, coalesce(c.resolved, 0) AS resolved,
             CASE WHEN coalesce(c.total, 0) = coalesce(c.resolved, 0) THEN 'passed'
                  ELSE 'pending' END AS verdict
        FROM latest l LEFT JOIN counts c ON c.branch = l.branch
       ORDER BY l.completed_at DESC NULLS LAST
       LIMIT ${Math.min(limit, GATE_BRANCH_LIMIT_MAX)}
    `);

    // **전체 수를 함께 준다.** clemvion 실측 441 브랜치 — 잘라 놓고 잘랐다고 말하지
    // 않으면 화면은 "브랜치가 20개뿐"이라고 거짓말한다(REQ-WEB-067).
    const { rows: totals } = await this.db.execute<{ n: number }>(sql`
      SELECT count(DISTINCT branch)::int AS n FROM review_session WHERE project_id = ${projectId}
    `);

    // 면제는 **결재 레코드**다(FR-10) — `approval.is_bypass` 가 정본이고 여기서 붙인다.
    //
    // **리뷰 세션을 통해서만 붙는다.** `approval.subject_id` 는 uuid 이고 브랜치는 문자열이라
    // 면제가 브랜치를 직접 가리킬 길이 없다(database.md §2.8). 그래서 리뷰 세션을 면제한
    // 결재만 그 세션의 브랜치 줄에 실린다 — **리뷰가 아예 없는 브랜치의 면제는 여기 뜨지
    // 않는다**(와이어프레임 §2.6 ⑧의 `미커버 + BYPASS 1` 줄). 그 경우를 담으려면 결재에
    // 브랜치를 적을 자리가 필요한데, 그것은 스키마 결정이라 사람 확인 없이 하지 않는다.
    const { rows: bypasses } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT rs.branch, a.bypass_reason, a.decided_at, u.display_name
        FROM approval a
        JOIN review_session rs ON rs.id = a.subject_id
        JOIN "user" u ON u.id = a.requested_by_user_id
       WHERE a.project_id = ${projectId} AND a.is_bypass
       ORDER BY a.decided_at DESC
    `);
    const byBranch = new Map<string, Record<string, unknown>[]>();
    for (const b of bypasses) {
      const key = String(b['branch']);
      byBranch.set(key, [...(byBranch.get(key) ?? []), b]);
    }
    return {
      items: rows.map((r) => ({ ...r, bypasses: byBranch.get(String(r['branch'])) ?? [] })),
      total: totals[0]?.n ?? rows.length,
    };
  }
}

export interface FindingFacets {
  severity: Record<string, number>;
  status: Record<string, number>;
  tag: Record<string, number>;
}

/** 한 화면에 담기는 발견 수. 넘는 것은 필터로 좁힌다 — 무한 스크롤은 답이 아니다 */
const FINDING_PAGE = 50;
const FINDING_PAGE_MAX = 200;
/** 게이트 표의 브랜치 수 — 최근 리뷰 순. clemvion 실측 441개다 */
const GATE_BRANCH_LIMIT = 20;
const GATE_BRANCH_LIMIT_MAX = 200;

const FINDING_SEVERITIES = ['critical', 'warning', 'info'] as const;
const FINDING_STATUSES = ['open', 'fixed', 'dismissed', 'wont_fix'] as const;

/** 모르는 값은 조용히 버린다 — 표면이 보낸 오타로 enum 캐스트가 터지지 않게. */
function normalizeFilter(
  values: readonly string[] | undefined,
  allowed: readonly string[],
): string[] {
  return (values ?? []).filter((v) => allowed.includes(v));
}

/** `ARRAY['a','b']::text[]` — 태그는 자유 문자열이라 리터럴을 직접 만든다(작은따옴표 이스케이프). */
function pgTextArray(values: readonly string[]): string {
  const quoted = values.map((v) => `'${v.replaceAll("'", "''")}'`).join(', ');
  return `ARRAY[${quoted}]::text[]`;
}
