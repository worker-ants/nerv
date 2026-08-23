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

import { NERV_ERROR, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { ReviewService } from '../../src/modules/review/review.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let reviews: ReviewService;
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
  await pool.query('DELETE FROM finding');
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

  it('모르는 필터 값은 조용히 버린다 — enum 캐스트가 터지지 않는다', async () => {
    const { items } = await reviews.findings({ projectId, severity: ['bogus'], status: ['open'] });
    expect(items).toHaveLength(3);
  });

  it('게이트 현황은 브랜치마다 판정을 준다 — 열린 것이 남으면 pending', async () => {
    const rows = await reviews.gateCoverage(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ branch: 'feat/widget', verdict: 'pending', total: 3 });
    expect(rows[0]!['bypasses']).toEqual([]);
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
    const rows = await reviews.gateCoverage(projectId);
    expect(rows[0]).toMatchObject({ verdict: 'passed', resolved: 3, total: 3 });
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
    const rows = await reviews.gateCoverage(projectId);
    const bypasses = rows[0]!['bypasses'] as Record<string, unknown>[];
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
