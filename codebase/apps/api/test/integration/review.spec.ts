// E??-FR-09 — 리뷰 수집. **리뷰를 파일이 아니라 레코드로.**
//
//   WHEN 리뷰어가 한 라운드를 제출하면,
//   THE SYSTEM SHALL ReviewSession · ReviewerReport · Finding 을 한 트랜잭션으로 적재하고
//   같은 지적을 fingerprint 로 하나의 Finding 에 합친다
//   WHEN 에이전트가 critical 발견을 dismissed·wont_fix 로 옮기려 하면,
//   THE SYSTEM SHALL 승인 카드를 만들고 NERV_APPROVAL_REQUIRED 로 막는다
//
// **동시성·제약은 mock 으로 보지 않는다**(AGENTS.md 테스트 규약) — 실제 Postgres 다.
// dedup 이 진짜인지는 UNIQUE 제약과 SQL 이 함께 있어야만 답할 수 있다.

import { NERV_ERROR, NERV_EVENT_PHASE2, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { ReviewService } from '../../src/modules/review/review.service.js';
import { QuestionService } from '../../src/modules/approval/question.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let reviews: ReviewService;
let questions: QuestionService;
let projectId: string;
let userId: string;
let agentSessionId: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_review');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  await seed();

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  reviews = app.get(ReviewService);
  questions = app.get(QuestionService);
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  // 발견은 라운드를 넘어 남는 것이 설계다 — 그래서 케이스마다 지운다
  await pool.query('DELETE FROM resolution');
  await pool.query('DELETE FROM approval');
  await pool.query('DELETE FROM finding_occurrence');
  await pool.query('DELETE FROM finding_comment');
  // 발견이 Task 를 가리키므로 그 손을 먼저 놓아야 Task 를 지울 수 있다
  await pool.query('UPDATE finding SET promoted_task_id = NULL');
  await pool.query('DELETE FROM finding');
  await pool.query('DELETE FROM evidence');
  await pool.query('DELETE FROM task');
  await pool.query('DELETE FROM reviewer_report');
  await pool.query('UPDATE review_session SET previous_session_id = NULL');
  await pool.query('DELETE FROM review_session');
});

const BASE = {
  branch: 'feat/widget',
  baseSha: 'aaaa111',
  headSha: 'bbbb222',
  kind: 'code' as const,
  reviewer: { role: 'security', risk: 'medium' as const },
};

function submitInput(over: Record<string, unknown> = {}): Parameters<ReviewService['submit']>[0] {
  return {
    projectId,
    userId,
    sessionId: agentSessionId,
    isAgent: true,
    changeset: ['src/widget.ts', 'src/widget.spec.ts'],
    summaryMd: '위젯 렌더링 경로를 봤다.',
    findings: [],
    ...BASE,
    ...over,
  } as Parameters<ReviewService['submit']>[0];
}

const CRITICAL = {
  severity: 'critical' as const,
  title: '토큰이 로그에 남는다',
  // 제목만으로는 무엇을 말하는지 알 수 없다 — 화면도 승격도 이 둘을 옮긴다(REQ-WEB-111)
  body_md: '요청 로거가 Authorization 헤더를 통째로 찍는다.',
  suggestion_md: '헤더 화이트리스트를 두고 나머지는 마스킹한다.',
  file: 'src/widget.ts',
  line: 42,
  category: 'security',
};

describe('FR-09 제출 — 세 층이 한 트랜잭션으로 들어온다', () => {
  it('세션·리포트·발견을 적재하고 라운드 1을 준다', async () => {
    const result = await reviews.submit(submitInput({ findings: [CRITICAL] }));

    expect(result.round_no).toBe(1);
    expect(result.findings_new).toHaveLength(1);
    expect(result.block).toBe(true); // 열린 critical 이 있으면 BLOCK 이다

    const { rows } = await pool.query(
      `SELECT state::text, risk::text AS risk, block, file_count, round_no,
              encode(changeset_hash,'hex') AS hash FROM review_session`,
    );
    expect(rows[0]).toMatchObject({ state: 'complete', risk: 'medium', block: true });
    expect(rows[0].file_count).toBe(2);
    expect(rows[0].hash).toHaveLength(64);
  });

  it('head_sha 없이는 받지 않는다 — 무엇을 봤는지 답할 수 없는 리뷰다', async () => {
    await expect(reviews.submit(submitInput({ headSha: '  ' }))).rejects.toMatchObject({
      code: NERV_ERROR.PRECONDITION,
    });
  });

  it('발견 0건도 라운드다 — "본 결과 없음"은 게이트에서 통과로 읽혀야 한다', async () => {
    const result = await reviews.submit(submitInput());
    expect(result.block).toBe(false);
    const { rows } = await pool.query(`SELECT has_report FROM reviewer_report`);
    expect(rows).toHaveLength(1);
    expect(rows[0].has_report).toBe(true);
  });
});

describe('FR-09 dedup — 같은 지적은 라운드를 넘어 하나다', () => {
  it('같은 커밋의 두 리뷰어는 **같은 세션**의 두 리포트다', async () => {
    await reviews.submit(submitInput({ findings: [CRITICAL] }));
    const second = await reviews.submit(
      submitInput({ reviewer: { role: 'requirement', risk: 'high' }, findings: [] }),
    );

    expect(second.merged_into_existing_session).toBe(true);
    expect(second.round_no).toBe(1);
    const { rows: sessions } = await pool.query(
      'SELECT id, risk::text AS risk FROM review_session',
    );
    expect(sessions).toHaveLength(1);
    // 세션 위험도는 가장 높은 리포트를 따른다 — low 가 high 를 지우지 않는다
    expect(sessions[0].risk).toBe('high');
    const { rows: reports } = await pool.query('SELECT role FROM reviewer_report ORDER BY role');
    expect(reports.map((r) => r.role)).toEqual(['requirement', 'security']);
  });

  it('파일 순서를 바꿔 보내도 같은 changeset 이다', async () => {
    await reviews.submit(submitInput());
    const second = await reviews.submit(
      submitInput({ changeset: ['src/widget.spec.ts', 'src/widget.ts'] }),
    );
    expect(second.merged_into_existing_session).toBe(true);
  });

  it('코드가 나아가면 다음 라운드다 — 앞 세션이 체인으로 남는다', async () => {
    await reviews.submit(submitInput({ findings: [CRITICAL] }));
    const next = await reviews.submit(submitInput({ headSha: 'cccc333', findings: [CRITICAL] }));

    expect(next.round_no).toBe(2);
    expect(next.findings_new).toHaveLength(0);
    expect(next.findings_merged).toHaveLength(1); // 같은 지적 — 새 발견이 아니다
    const { rows } = await pool.query(`SELECT occurrence_count FROM finding WHERE title = $1`, [
      CRITICAL.title,
    ]);
    expect(rows[0].occurrence_count).toBe(2);
    const { rows: chain } = await pool.query(
      'SELECT previous_session_id FROM review_session WHERE round_no = 2',
    );
    expect(chain[0].previous_session_id).not.toBeNull();
  });

  it('줄이 밀려도 같은 발견이다 — 위치만 갱신한다(fingerprint 에 줄 번호가 없다)', async () => {
    await reviews.submit(submitInput({ findings: [CRITICAL] }));
    await reviews.submit(
      submitInput({ headSha: 'cccc333', findings: [{ ...CRITICAL, line: 117 }] }),
    );
    const { rows } = await pool.query('SELECT line_start FROM finding');
    expect(rows).toHaveLength(1);
    expect(rows[0].line_start).toBe(117);
  });

  it('심각도를 낮춰 보내도 새 발견이 되지 않는다 — 하향이 감춰지면 감사가 불가능하다', async () => {
    await reviews.submit(submitInput({ findings: [CRITICAL] }));
    await reviews.submit(
      submitInput({ headSha: 'cccc333', findings: [{ ...CRITICAL, severity: 'info' as const }] }),
    );

    const { rows: findings } = await pool.query(
      'SELECT id, severity::text AS severity FROM finding',
    );
    expect(findings).toHaveLength(1);
    // finding 의 severity 는 처음 값을 지킨다 — 리뷰어가 자기 지적을 조용히 낮추지 못한다
    expect(findings[0].severity).toBe('critical');
    // 원값 대조가 감사의 근거다(raw_severity — clemvion 실측 24/732)
    const { rows: occ } = await pool.query(
      'SELECT raw_severity::text AS raw FROM finding_occurrence ORDER BY round_no',
    );
    expect(occ.map((o) => o.raw)).toEqual(['critical', 'info']);
  });

  it('수치만 바뀐 재서술도 같은 지적이다 — 제목 어간으로 본다', async () => {
    await reviews.submit(submitInput({ findings: [{ ...CRITICAL, title: '3곳에서 토큰 노출' }] }));
    const again = await reviews.submit(
      submitInput({ headSha: 'cccc333', findings: [{ ...CRITICAL, title: '5곳에서 토큰 노출' }] }),
    );
    expect(again.findings_new).toHaveLength(0);
  });
});

// 2026-08-30 사람 물음 — "피드백을 하면 이후 흐름이 어떻게 흘러가나".
// 예전 답은 "아무 데로도" 였다: 처분 3종 말고는 적을 자리가 없었고, 무엇을 적든
// 지적한 에이전트는 듣지 못했으며, "나중에 하자" 가 갈 곳도 없었다.
// 2026-08-30 사람 보고 — "리뷰 상태가 바뀌어도 새로고침해야 보인다".
// `finding.opened` 는 **새** 발견에만 나므로, 재리뷰가 기존 발견에 합쳐지거나 발견이
// 0건이면 게이트 현황만 조용히 바뀌었다.
describe('라운드가 들어온 사실을 알린다 (REQ-API-061)', () => {
  async function eventsOf(type: string): Promise<Record<string, unknown>[]> {
    const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM event WHERE type = $1 ORDER BY occurred_at`,
      [type],
    );
    return rows.map((r) => r.payload);
  }

  it('발견이 0건이어도 난다 — "봤고 문제가 없었다" 도 라운드다', async () => {
    await pool.query('DELETE FROM event');
    await reviews.submit(submitInput({ findings: [] }));
    const events = await eventsOf(NERV_EVENT_PHASE2.REVIEW_SUBMITTED);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ round_no: 1, findings_new: 0, findings_merged: 0 });
    // 새 발견이 없으니 finding.opened 는 나지 않는다 — 그래서 이 이벤트가 필요했다
    expect(await eventsOf(NERV_EVENT_PHASE2.FINDING_OPENED)).toHaveLength(0);
  });

  it('같은 지적이 합쳐진 라운드도 난다 — 관측 횟수와 라운드가 바뀐다', async () => {
    await reviews.submit(submitInput({ findings: [CRITICAL] }));
    await pool.query('DELETE FROM event');
    await reviews.submit(submitInput({ headSha: 'bbbb222', findings: [CRITICAL] }));

    const events = await eventsOf(NERV_EVENT_PHASE2.REVIEW_SUBMITTED);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ findings_new: 0, findings_merged: 1 });
    expect(await eventsOf(NERV_EVENT_PHASE2.FINDING_OPENED)).toHaveLength(0);
  });
});

describe('발견의 피드백 흐름 (2026-08-30 신설)', () => {
  async function openOne(): Promise<string> {
    const result = await reviews.submit(submitInput({ findings: [CRITICAL] }));
    return result.findings_new[0]!;
  }

  it('사람이 말을 남기고, 그 말이 대화로 쌓인다', async () => {
    const findingId = await openOne();
    await reviews.comment({ projectId, findingId, userId, bodyMd: '이건 이래서 오탐이다' });
    await reviews.comment({ projectId, findingId, userId, bodyMd: '아니다, 다시 보니 맞다' });
    const listed = await reviews.comments({ projectId, findingId });
    expect(listed.items.map((c) => c['body_md'])).toEqual([
      '이건 이래서 오탐이다',
      '아니다, 다시 보니 맞다',
    ]);
  });

  it('빈 코멘트는 남기지 않는다 — 빈 줄은 대화가 아니다', async () => {
    const findingId = await openOne();
    await expect(
      reviews.comment({ projectId, findingId, userId, bodyMd: '   ' }),
    ).rejects.toMatchObject({ code: NERV_ERROR.PRECONDITION });
  });

  it('발견을 Task 로 올린다 — "나중에 하자" 가 갈 곳이다', async () => {
    const findingId = await openOne();
    const promoted = await reviews.promote({ projectId, findingId, userId });
    expect(promoted['created']).toBe(true);
    // 만들자마자 누가 집어 가지 않는다 — 위임 명세 4요소를 사람이 채워야 ready 다(D-09)
    expect(promoted['status']).toBe('backlog');

    const { rows } = await pool.query<{ title: string; body_md: string; priority: string }>(
      `SELECT title, body_md, priority::text AS priority FROM task WHERE id = $1`,
      [promoted['task_id']],
    );
    expect(rows[0]?.title).toBe(CRITICAL.title);
    // critical 은 큐의 맨 앞이다 — 막아야 하는 것이라 critical 인 것이다
    expect(rows[0]?.priority).toBe('P0');
    expect(rows[0]?.body_md).toContain(CRITICAL.body_md ?? '');
  });

  it('두 번 올리면 이미 만든 것을 돌려준다 — Task 둘은 서로를 모른 채 각자 done 이 된다', async () => {
    const findingId = await openOne();
    const first = await reviews.promote({ projectId, findingId, userId });
    const second = await reviews.promote({ projectId, findingId, userId });
    expect(second['created']).toBe(false);
    expect(second['task_id']).toBe(first['task_id']);
  });

  it('지적한 세션이 하트비트로 그 말을 받는다 — 역채널이 질문 하나뿐이었다', async () => {
    const findingId = await openOne();
    await reviews.comment({ projectId, findingId, userId, bodyMd: '여기는 의도된 동작이다' });

    const pending = await questions.pendingFor(agentSessionId);
    const commented = pending.filter((p) => p['kind'] === 'finding_commented');
    expect(commented).toHaveLength(1);
    expect(commented[0]?.['body_md']).toBe('여기는 의도된 동작이다');
    expect(commented[0]?.['finding_id']).toBe(findingId);
  });

  it('내가 쓴 코멘트는 나에게 돌아오지 않는다', async () => {
    const findingId = await openOne();
    await reviews.comment({
      projectId,
      findingId,
      userId,
      sessionId: agentSessionId,
      bodyMd: '에이전트가 스스로 남긴 메모',
    });
    const pending = await questions.pendingFor(agentSessionId);
    expect(pending.filter((p) => p['kind'] === 'finding_commented')).toHaveLength(0);
  });
});

/** 스펙 한 편 + 승인본 하나 — `spec_change` 처분의 증거가 될 자리다 */
async function makeSpecVersion(key: string): Promise<string> {
  const specId = newId();
  const versionId = newId();
  await pool.query(
    `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'feature',$3,$3)
     ON CONFLICT (project_id, key) DO NOTHING`,
    [specId, projectId, key],
  );
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM spec WHERE project_id = $1 AND key = $2`,
    [projectId, key],
  );
  await pool.query(
    `INSERT INTO spec_version (id, spec_id, version_no, status, body_md, content_hash, author_user_id)
     VALUES ($1,$2,(SELECT coalesce(max(version_no),0)+1 FROM spec_version WHERE spec_id = $2),
             'approved','# 정정한 스펙', digest('x','sha256'), $3)`,
    [versionId, rows[0]!.id, userId],
  );
  return versionId;
}

describe('FR-09 처분 — 하향은 사람의 승인을 거친다(A3)', () => {
  async function openCritical(): Promise<string> {
    const result = await reviews.submit(submitInput({ findings: [CRITICAL] }));
    return result.findings_new[0]!;
  }

  it('fixed 는 커밋과 함께면 통과한다(A2)', async () => {
    const findingId = await openCritical();
    const out = await reviews.resolve({
      projectId,
      findingId,
      userId,
      sessionId: agentSessionId,
      isAgent: true,
      kind: 'fixed',
      status: 'fixed',
      rationale: '로거에서 토큰 필드를 지웠다',
      commitSha: 'dddd444',
    });
    expect(out.status).toBe('fixed');
    expect(out.open_remaining).toBe(0);
  });

  // 2026-08-30 — 처분 근거가 목록 응답에 없어서 화면이 그것을 보일 수 없었다.
  // 근거가 없으면 dismissed 는 **삭제와 구별되지 않는다**.
  it('처분한 발견은 목록이 근거와 처분자를 함께 준다', async () => {
    const findingId = await openCritical();
    await reviews.resolve({
      projectId,
      findingId,
      userId,
      sessionId: agentSessionId,
      isAgent: true,
      kind: 'fixed',
      status: 'fixed',
      rationale: '로거에서 토큰 필드를 지웠다',
      commitSha: 'dddd444',
    });
    const listed = await reviews.findings({ projectId, status: ['fixed'] });
    const row = listed.items.find((f) => f['id'] === findingId);
    expect(row?.['resolution_rationale']).toBe('로거에서 토큰 필드를 지웠다');
    expect(row?.['resolution_kind']).toBe('fixed');
    expect(row?.['resolution_commit']).toBe('dddd444');
    expect(row?.['resolved_by_name']).not.toBeNull();
  });

  // 2026-08-30 사람 보고 — 에이전트가 **스펙을 고쳐** 해결했는데 남은 선택지가 전부
  // 거짓말이었다: `fixed` 는 커밋이 없어 막히고, `dismissed` 는 오탐이 아니었고,
  // `wont_fix` 는 고쳤기 때문이다. `spec_change` 는 열거에 있었지만 CHECK 가 CR 을
  // 요구했고 CR 을 만드는 코드가 없어 **닿을 수 없는 값**이었다.
  it('스펙을 고쳐 해결하면 spec_change 로 닫는다 — 증거는 그 버전이다', async () => {
    const findingId = await openCritical();
    const versionId = await makeSpecVersion('SPC-DRIFT');
    const out = await reviews.resolve({
      projectId,
      findingId,
      userId,
      sessionId: agentSessionId,
      isAgent: true,
      kind: 'spec_change',
      status: 'fixed',
      rationale: '구현이 맞고 스펙이 틀렸다 — 스펙을 정정했다',
      specVersionId: versionId,
    });
    // critical 이지만 **하향이 아니다** — 지적이 옳았다는 인정이라 A2 로 통과한다
    expect(out.status).toBe('fixed');

    const listed = await reviews.findings({ projectId, status: ['fixed'] });
    const row = listed.items.find((f) => f['id'] === findingId);
    // 무엇으로 해결했는지가 남는다 — spec_drift 지적이 코드 커밋으로 닫혔다면 이상 신호다
    expect(row?.['resolution_kind']).toBe('spec_change');
    expect(row?.['resolution_spec_version_id']).toBe(versionId);
    expect(row?.['resolution_commit']).toBeNull();
  });

  it('spec_change 인데 버전이 없으면 막는다 — "다 했습니다" 는 증거가 아니다', async () => {
    const findingId = await openCritical();
    await expect(
      reviews.resolve({
        projectId,
        findingId,
        userId,
        isAgent: true,
        kind: 'spec_change',
        status: 'fixed',
        rationale: '스펙을 고쳤다',
      }),
    ).rejects.toMatchObject({ details: { kind: 'missing_spec_version' } });
  });

  it('남의 프로젝트 버전은 증거가 아니다', async () => {
    const findingId = await openCritical();
    await expect(
      reviews.resolve({
        projectId,
        findingId,
        userId,
        isAgent: true,
        kind: 'spec_change',
        status: 'fixed',
        rationale: '스펙을 고쳤다',
        specVersionId: newId(),
      }),
    ).rejects.toMatchObject({ details: { kind: 'not_found', field: 'spec_version_id' } });
  });

  it('커밋 없는 fixed 는 다른 길을 알려준다 — 막다른 길에 세우지 않는다', async () => {
    const findingId = await openCritical();
    await expect(
      reviews.resolve({
        projectId,
        findingId,
        userId,
        isAgent: true,
        kind: 'fixed',
        status: 'fixed',
        rationale: '고쳤다',
      }),
    ).rejects.toMatchObject({
      details: { kind: 'missing_commit_sha', alternatives: ['spec_change'] },
    });
  });

  it('fixed 인데 커밋이 없으면 막는다 — 검증 가능한 사실이라 A2 인 것이다', async () => {
    const findingId = await openCritical();
    await expect(
      reviews.resolve({
        projectId,
        findingId,
        userId,
        isAgent: true,
        kind: 'fixed',
        status: 'fixed',
        rationale: '고쳤다',
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.PRECONDITION });
  });

  it('에이전트의 critical → wont_fix 는 승인 카드를 만들고 막는다(A3)', async () => {
    const findingId = await openCritical();
    await expect(
      reviews.resolve({
        projectId,
        findingId,
        userId,
        sessionId: agentSessionId,
        isAgent: true,
        kind: 'deferred',
        status: 'wont_fix',
        rationale: '다음 스프린트에 본다',
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.APPROVAL_REQUIRED });

    const { rows } = await pool.query(
      `SELECT subject_type::text AS t, decision FROM approval WHERE subject_id = $1`,
      [findingId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ t: 'finding', decision: null });
    // 막혔으므로 발견은 그대로 열려 있다
    const { rows: f } = await pool.query('SELECT status::text AS s FROM finding');
    expect(f[0].s).toBe('open');
  });

  it('재호출이 카드를 늘리지 않는다', async () => {
    const findingId = await openCritical();
    const call = {
      projectId,
      findingId,
      userId,
      sessionId: agentSessionId,
      isAgent: true,
      kind: 'dismissed' as const,
      status: 'dismissed' as const,
      rationale: '오탐',
    };
    await expect(reviews.resolve(call)).rejects.toMatchObject({
      code: NERV_ERROR.APPROVAL_REQUIRED,
    });
    await expect(reviews.resolve(call)).rejects.toMatchObject({
      code: NERV_ERROR.APPROVAL_REQUIRED,
    });
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM approval');
    expect(rows[0].n).toBe(1);
  });

  it('승인된 카드가 있으면 통과한다', async () => {
    const findingId = await openCritical();
    await expect(
      reviews.resolve({
        projectId,
        findingId,
        userId,
        sessionId: agentSessionId,
        isAgent: true,
        kind: 'dismissed',
        status: 'dismissed',
        rationale: '오탐',
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.APPROVAL_REQUIRED });

    await pool.query(
      `UPDATE approval SET decision = 'approve', decided_at = now() WHERE subject_id = $1`,
      [findingId],
    );
    const out = await reviews.resolve({
      projectId,
      findingId,
      userId,
      sessionId: agentSessionId,
      isAgent: true,
      kind: 'dismissed',
      status: 'dismissed',
      rationale: '오탐',
    });
    expect(out.status).toBe('dismissed');
  });

  it('사람이 부르면 게이트가 걸리지 않는다 — 막는 것은 에이전트의 자기 하향이다', async () => {
    const findingId = await openCritical();
    const out = await reviews.resolve({
      projectId,
      findingId,
      userId,
      isAgent: false,
      kind: 'dismissed',
      status: 'dismissed',
      rationale: '설계 의도다 — 로거는 마스킹한다',
    });
    expect(out.status).toBe('dismissed');
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM approval');
    expect(rows[0].n).toBe(0);
  });

  it('근거 없는 처분은 없다 — 유예 근거는 1급 데이터다', async () => {
    const findingId = await openCritical();
    await expect(
      reviews.resolve({
        projectId,
        findingId,
        userId,
        isAgent: false,
        kind: 'dismissed',
        status: 'dismissed',
        rationale: '   ',
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.PRECONDITION });
  });

  it('처분된 발견은 다시 지적돼도 열리지 않는다 — 사람의 판단을 리뷰어가 덮지 못한다', async () => {
    const findingId = await openCritical();
    await reviews.resolve({
      projectId,
      findingId,
      userId,
      isAgent: false,
      kind: 'fixed',
      status: 'fixed',
      rationale: '고쳤다',
      commitSha: 'dddd444',
    });
    const again = await reviews.submit(submitInput({ headSha: 'cccc333', findings: [CRITICAL] }));
    expect(again.findings_new).toHaveLength(0);
    expect(again.block).toBe(false);
    const { rows } = await pool.query('SELECT status::text AS s FROM finding');
    expect(rows[0].s).toBe('fixed');
  });

  it('다른 처분으로 뒤집는 것은 재호출이 아니다', async () => {
    const findingId = await openCritical();
    await reviews.resolve({
      projectId,
      findingId,
      userId,
      isAgent: false,
      kind: 'fixed',
      status: 'fixed',
      rationale: '고쳤다',
      commitSha: 'dddd444',
    });
    await expect(
      reviews.resolve({
        projectId,
        findingId,
        userId,
        isAgent: false,
        kind: 'dismissed',
        status: 'dismissed',
        rationale: '역시 오탐이었다',
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.PRECONDITION });
  });
});

describe('FR-09 큐·게이트 현황 — S6 가 읽는 것 (REQ-WEB-061·065)', () => {
  beforeEach(async () => {
    await reviews.submit(
      submitInput({
        findings: [
          CRITICAL,
          { severity: 'warning', title: '캐시 헤더 TTL 미지정', file: 'src/loader.ts', line: 9 },
          { severity: 'info', title: '주석 오타', file: 'src/loader.ts' },
        ],
      }),
    );
  });

  it('facet 은 "이것을 켜면 몇 건인가"다 — 자기 선택은 세지 않는다', async () => {
    const all = await reviews.findings({ projectId, status: ['open'] });
    expect(all.items).toHaveLength(3);
    expect(all.facets.severity).toEqual({ critical: 1, warning: 1, info: 1 });

    // critical 만 켠 상태에서도 warning·info 의 숫자는 그대로여야 한다 —
    // 자기 선택까지 반영하면 켜져 있는 것만 남아 필터가 스스로를 가둔다
    const narrowed = await reviews.findings({
      projectId,
      status: ['open'],
      severity: ['critical'],
    });
    expect(narrowed.items).toHaveLength(1);
    expect(narrowed.facets.severity).toEqual({ critical: 1, warning: 1, info: 1 });
    // 반대로 status facet 은 severity 선택을 반영한다(다른 차원이므로)
    expect(narrowed.facets.status).toEqual({ open: 1 });
  });

  it('처분하면 큐에서 빠지고 facet 이 따라 움직인다', async () => {
    const open = await reviews.findings({ projectId, status: ['open'] });
    const info = open.items.find((i) => i['severity'] === 'info')!;
    await reviews.resolve({
      projectId,
      findingId: String(info['id']),
      userId,
      isAgent: false,
      kind: 'dismissed',
      status: 'dismissed',
      rationale: '오타는 리뷰 대상이 아니다',
    });

    const after = await reviews.findings({ projectId, status: ['open'] });
    expect(after.items).toHaveLength(2);
    expect(after.facets.status).toEqual({ open: 2, dismissed: 1 });
  });

  it('provenance 세 출처를 함께 준다 — 없으면 null 로 밝힌다 (REQ-WEB-062)', async () => {
    const { items } = await reviews.findings({ projectId, status: ['open'] });
    const first = items[0]!;
    expect(first['file_path']).toBe('src/widget.ts');
    expect(first['head_sha']).toBe('bbbb222');
    expect(first['round_no']).toBe(1);
    // 이 발견에는 유래 스펙이 없다 — 화면이 "없음"이라고 적을 수 있어야 한다
    expect(first['spec_key']).toBeNull();
  });

  // **2026-09-03 정정 — 이 단언은 뒤집혔다.** 예전에는 어휘 밖의 값을 조용히 버려서
  // `?severity=HIGH`(대문자 오타)가 200 과 **걸러지지 않은 목록**을 받았다. 그러면 사람은
  // critical 만 남은 화면이라 믿으면서 전량을 읽는다 — 조용한 무시는 500 보다 나쁘다.
  // 정본이 이미 그렇게 적고 있었다(§1.4j · REQ-API-074): "모르는 값은 거절이지 무시가 아니다".
  it('모르는 필터 값은 거절한다 — 조용히 버리면 필터가 거짓말을 한다', async () => {
    await expect(
      reviews.findings({ projectId, severity: ['bogus'], status: ['open'] }),
    ).rejects.toMatchObject({ code: NERV_ERROR.PRECONDITION });

    // 어휘 안의 값은 그대로 돈다 — 거절이 넓어지지 않았다는 대조군이다
    const { items } = await reviews.findings({ projectId, status: ['open'] });
    expect(items).toHaveLength(3);
  });

  it('게이트 현황은 브랜치마다 판정을 준다 — 열린 것이 남으면 pending', async () => {
    const gate = await reviews.gateCoverage(projectId);
    expect(gate.items).toHaveLength(1);
    expect(gate.total).toBe(1);
    expect(gate.items[0]).toMatchObject({ branch: 'feat/widget', verdict: 'pending', total: 3 });
    expect(gate.items[0]!['bypasses']).toEqual([]);
  });

  it('전부 처분되면 passed 다', async () => {
    const { items } = await reviews.findings({ projectId, status: ['open'] });
    for (const item of items) {
      await reviews.resolve({
        projectId,
        findingId: String(item['id']),
        userId,
        isAgent: false,
        kind: 'fixed',
        status: 'fixed',
        rationale: '고쳤다',
        commitSha: 'dddd444',
      });
    }
    const gate = await reviews.gateCoverage(projectId);
    expect(gate.items[0]).toMatchObject({ verdict: 'passed', resolved: 3, total: 3 });
  });

  it('면제는 같은 줄에 사람·시각·사유로 펼쳐진다 (REQ-WEB-065)', async () => {
    // 면제는 **리뷰 세션을 주체로** 붙는다 — `approval.subject_id` 가 uuid 라 브랜치
    // 문자열을 직접 가리킬 수 없다. 브랜치는 그 세션에서 나온다.
    const { rows: session } = await pool.query('SELECT id FROM review_session LIMIT 1');
    await pool.query(
      `INSERT INTO approval (id, project_id, subject_type, subject_id, requested_by_user_id,
                             decision, decided_at, is_bypass, bypass_reason)
       VALUES ($1,$2,'gate_bypass',$3,$4,'approve',now(),true,$5)`,
      [newId(), projectId, session[0].id, userId, '핫픽스 배포, 사후 리뷰 예약'],
    );
    const gate = await reviews.gateCoverage(projectId);
    const bypasses = gate.items[0]!['bypasses'] as Record<string, unknown>[];
    expect(bypasses).toHaveLength(1);
    expect(bypasses[0]).toMatchObject({
      bypass_reason: '핫픽스 배포, 사후 리뷰 예약',
      display_name: '규아',
    });
  });
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  userId = newId();
  agentSessionId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'qa@example.com','규아','active')`,
    [userId],
  );
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'qa')`,
    [newId(), orgId, projectId, userId],
  );
  await pool.query(
    `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state)
     VALUES ($1,$2,$3,'claude-code','mac-02','active')`,
    [agentSessionId, projectId, userId],
  );
}

// 2026-09-01 사람 요청 — "리뷰에서 어느 부분에 관련된 리뷰인지 필터".
// `category` 는 "무슨 종류인가"(보안·테스트) 이고 이 축은 **"무엇을 고쳐야 하는가"** 다 —
// 사람이 발견을 보고 다음에 할 행동이 넷으로 갈린다.
describe('발견의 대상 축 (REQ-API-073)', () => {
  it.each([
    [{ file: 'src/a.ts' }, 'codebase'],
    [{ file: 'src/a.ts', tags: ['spec_drift'] }, 'spec'],
    // 짚을 파일이 없는 지적은 코드가 아니라 **일하는 방식**에 대한 말이다
    [{ file: null }, 'process'],
  ])('%o → %s', async (extra, expected) => {
    await pool.query('DELETE FROM finding_occurrence');
    await pool.query('DELETE FROM finding');
    const out = await reviews.submit(
      submitInput({ findings: [{ ...CRITICAL, ...extra } as never] }),
    );
    const { rows } = await pool.query<{ area: string; area_inferred: boolean }>(
      `SELECT area::text AS area, area_inferred FROM finding WHERE id = $1`,
      [out.findings_new[0]!],
    );
    expect(rows[0]?.area).toBe(expected);
    // 서버가 유추했으면 그 사실이 남는다 — 나중에 규칙을 고칠 근거다
    expect(rows[0]?.area_inferred).toBe(true);
  });

  it('스펙 근거가 있으면 파일이 함께 있어도 spec 이다 — spec_drift 는 코드가 아니라 문서다', async () => {
    await pool.query('DELETE FROM finding_occurrence');
    await pool.query('DELETE FROM finding');
    const out = await reviews.submit(
      submitInput({
        findings: [{ ...CRITICAL, file: 'src/a.ts', tags: ['spec_drift'] } as never],
      }),
    );
    const { rows } = await pool.query<{ area: string }>(
      `SELECT area::text AS area FROM finding WHERE id = $1`,
      [out.findings_new[0]!],
    );
    expect(rows[0]?.area).toBe('spec');
  });

  it('에이전트가 선언하면 그것이 이긴다 — 추론은 안 준 값을 채우는 것이다', async () => {
    await pool.query('DELETE FROM finding_occurrence');
    await pool.query('DELETE FROM finding');
    const out = await reviews.submit(
      submitInput({ findings: [{ ...CRITICAL, file: 'src/a.ts', area: 'task' } as never] }),
    );
    const { rows } = await pool.query<{ area: string; area_inferred: boolean }>(
      `SELECT area::text AS area, area_inferred FROM finding WHERE id = $1`,
      [out.findings_new[0]!],
    );
    expect(rows[0]?.area).toBe('task');
    expect(rows[0]?.area_inferred).toBe(false);
  });

  it('필터와 facet 이 같은 응답에서 온다 — 목록과 숫자가 어긋나지 않는다', async () => {
    await pool.query('DELETE FROM finding_occurrence');
    await pool.query('DELETE FROM finding');
    await reviews.submit(
      submitInput({
        findings: [
          { ...CRITICAL, title: '코드', file: 'src/a.ts' } as never,
          { ...CRITICAL, title: '문서', tags: ['spec_drift'] } as never,
        ],
      }),
    );
    const all = await reviews.findings({ projectId, status: ['open'] });
    expect(all.facets.area).toMatchObject({ codebase: 1, spec: 1 });

    const onlySpec = await reviews.findings({ projectId, status: ['open'], area: ['spec'] });
    expect(onlySpec.items.map((f) => f['title'])).toEqual(['문서']);
  });
});
