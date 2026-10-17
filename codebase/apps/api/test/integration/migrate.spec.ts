// E02-S02 — 초기 스냅샷 마이그레이션 + 왕복 멱등.
//
//   WHEN 같은 마이그레이션을 2회 연속 실행하면,
//   THE SYSTEM SHALL 두 번째 실행을 스키마 변경 0으로 종료한다 (REQ-DB-001)
//
// 이 스위트가 지키는 것은 그 한 줄만이 아니다. 0000_init.sql 에는 drizzle 이 표현하지 못해
// **손으로 동봉한** raw SQL 이 들어 있다(확장·파티션·순환 FK·트리거 — database.md §1.2).
// 생성기가 만들어주지 않는 부분이라 조용히 사라져도 타입 검사에 걸리지 않는다 —
// 그래서 적용된 스키마의 사실을 직접 조회해 고정한다.

import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NERV_EVENT, PARTITION_MONTHS_AHEAD } from '@nerv/schema';
import {
  journalEntries,
  migrationsFolder,
  runMigrations,
  schemaStatus,
} from '@nerv/schema/migrate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createScratchDb, withClient } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;

beforeAll(async () => {
  db = await createScratchDb('nerv_migrate');
});

afterAll(async () => {
  await db.drop();
});

describe('초기 스냅샷 적용 (database.md §2)', () => {
  // 마이그레이션 수는 **디렉터리에서 센다.** 숫자를 박아 두면 파일이 하나 늘 때마다
  // "무엇이 틀렸는지 말해 주지 않는 실패"로 깨진다(실측: 0003_multi_role 을 더하며 깨졌다).
  // 이 테스트가 지키려는 것은 개수가 아니라 **전량 적용과 왕복 멱등**이다.
  const MIGRATIONS = readdirSync(migrationsFolder()).filter((f) => f.endsWith('.sql')).length;

  it('빈 DB 에 오류 없이 적용된다', async () => {
    const first = await runMigrations(db.url);
    expect(first.applied).toBe(MIGRATIONS);
  });

  it('2회 연속 실행해도 변경 0건이다 — 왕복 멱등 (REQ-DB-001)', async () => {
    const before = await snapshotSchema();
    const second = await runMigrations(db.url);
    const after = await snapshotSchema();

    expect(second.applied).toBe(MIGRATIONS); // 이력이 늘지 않는다 = 재적용하지 않았다
    expect(after).toEqual(before);
  });

  it('도메인 테이블 40종 + 인프라 6종이 존재한다', async () => {
    const names = await withClient(db.url, async (c) => {
      const { rows } = await c.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            AND table_name NOT LIKE 'event_y%' AND table_name NOT LIKE 'activity_y%'
          ORDER BY table_name`,
      );
      return rows.map((r) => r.table_name);
    });
    // 35 도메인 엔티티 + 인프라 5종(엔티티 아님):
    //   spec_chunk_embedding(§2.15) · auth_session·auth_account·auth_verification(§2.16)
    //   · email_outbox(§2.17 — 2026-09-22. 보내고 나면 치우는 발송 큐다)
    //   · slack_outbox(§2.18 — 2026-10-17. 메일과 같은 발송 큐다)
    // 30번째는 `invitation` 이다(2026-08-27 · 사람 결정 — 조직 초대)
    // 31번째는 `finding_comment` 다(2026-08-30 · 사람 결정 — 리뷰 피드백 흐름)
    // 32번째는 `attachment` 다(2026-09-01 · 사람 결정 — 디자인 시안 첨부)
    // 33번째는 `idempotency_key` 다(2026-09-02 — api.md §1.5 의 저장소. REST 헤더와 MCP
    //   입력이 같은 행을 본다)
    // 34번째는 `notification_preference` 다(2026-09-27 · 사람 결정 N3 — 프로젝트별 알림 수준 · 0035)
    // 35번째는 `notification_batch_event` 다(2026-09-27 · 사람 결정 G2 — 앱 안 묶음에 든 이벤트 · 0037)
    // 36번째는 `notification_digest_setting` 이다(2026-09-28 · 사람 결정 EM1~EM9 — 알림 메일 요약 · 0041)
    // 37 · 38번째는 `watch` · `pin` 이다(2026-10-16 · 사람 결정 D5 — 워치와 핀 · 0056)
    // 39번째는 `gate_verdict_comparison` 이다(2026-10-16 · 사람 결정 D6 — 게이트 판정 비교 · 0057)
    // 40번째는 `project_slack` 이다(2026-10-17 · 사람 결정 D1 · D2 — 프로젝트의 Slack 웹훅 · 0060)
    expect(names).toHaveLength(46);
    expect(names).toContain('project_slack');
    expect(names).toContain('slack_outbox');
    expect(names).toContain('gate_verdict_comparison');
    expect(names).toContain('watch');
    expect(names).toContain('pin');
    expect(names).toContain('idempotency_key');
    expect(names).toContain('notification_preference');
    expect(names).toContain('notification_batch_event');
    expect(names).toContain('notification_digest_setting');
    expect(names).toContain('spec_chunk_embedding');
    expect(names).toContain('email_outbox');
    expect(names).toEqual(
      expect.arrayContaining(['auth_session', 'auth_account', 'auth_verification']),
    );
  });

  // 41번째는 `email_kind` 다(2026-09-22 · §2.17) — 값 셋을 한 번에 만든다:
  // `ALTER TYPE … ADD VALUE` 는 트랜잭션 안에서 그 값을 곧바로 쓸 수 없다.
  // 42번째는 `notification_level` 이다(2026-09-27 · 0035 — all · important · none)
  // 43번째는 `claim_awaiting_kind` 다(2026-10-09 · 0046 — background · user · approval)
  // 44번째는 `task_archive_reason` 이다(2026-10-10 · 0047 — duplicate · superseded · obsolete · wont_do)
  // 45번째는 `impl_status_source` 다(2026-10-15 · 0051 — derived · import)
  // 46 · 47번째는 `watch_target` · `pin_target` 이다(2026-10-16 · 0056 — 워치와 핀의 대상)
  // 48번째는 `review_sot` 다(2026-10-16 · 0057 — 리뷰 컷오버 단계 git · dual · nerv)
  it('enum 48종이 생성된다 (§2.1)', async () => {
    const count = await scalar(`SELECT count(*)::int FROM pg_type WHERE typtype = 'e'`);
    expect(count).toBe(48);
  });
});

describe('동봉된 raw SQL — 생성기가 만들어주지 않는 부분 (§1.2)', () => {
  it('확장 4종이 설치된다 — 컬럼 타입보다 먼저 있어야 한다 (§2.1)', async () => {
    const names = await withClient(db.url, async (c) => {
      const { rows } = await c.query<{ extname: string }>(
        `SELECT extname FROM pg_extension
          WHERE extname IN ('citext','pgcrypto','pg_trgm','vector') ORDER BY extname`,
      );
      return rows.map((r) => r.extname);
    });
    expect(names).toEqual(['citext', 'pg_trgm', 'pgcrypto', 'vector']);
  });

  it('event · activity 가 RANGE 파티션 부모다 (§2.14)', async () => {
    const parents = await withClient(db.url, async (c) => {
      const { rows } = await c.query<{ relname: string }>(
        `SELECT relname FROM pg_class WHERE relkind = 'p' ORDER BY relname`,
      );
      return rows.map((r) => r.relname);
    });
    expect(parents).toEqual(['activity', 'event']);
  });

  it('마이그레이션이 앞으로 몇 달치 파티션까지 보장한다 (§2.14)', async () => {
    const count = await scalar(
      `SELECT count(*)::int FROM pg_class
        WHERE relkind = 'r' AND (relname LIKE 'event_y%' OR relname LIKE 'activity_y%')`,
    );
    // 0000 은 당월+익월만 만든다. 그 뒤를 잇는 것은 워커인데(§2.14) 워커가 뜨기 전에도
    // 서버는 이벤트를 쓰므로, 마이그레이터가 같은 함수로 창을 채운다.
    // 테이블 2종 × (오늘 ~ +PARTITION_MONTHS_AHEAD 개월)
    expect(count).toBe(2 * (PARTITION_MONTHS_AHEAD + 1));
  });

  it('activity 파티션마다 (session_id, seq) unique 가 붙는다 (§2.6)', async () => {
    const count = await scalar(
      `SELECT count(*)::int FROM pg_indexes
        WHERE schemaname = 'public' AND indexname LIKE 'activity_y%_session_seq_uq'`,
    );
    expect(count).toBe(PARTITION_MONTHS_AHEAD + 1);
  });

  it('순환 참조 FK 가 걸린다 (§2.11)', async () => {
    const names = await withClient(db.url, async (c) => {
      const { rows } = await c.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
          WHERE conname IN ('spec_current_version_fk','spec_version_change_request_fk','agent_session_current_task_fk')
          ORDER BY conname`,
      );
      return rows.map((r) => r.conname);
    });
    expect(names).toEqual([
      'agent_session_current_task_fk',
      'spec_current_version_fk',
      'spec_version_change_request_fk',
    ]);
  });

  it('nerv_* 함수 5종과 트리거 3종이 존재한다 (§2.13)', async () => {
    const fns = await withClient(db.url, async (c) => {
      const { rows } = await c.query<{ proname: string }>(
        `SELECT proname FROM pg_proc WHERE proname LIKE 'nerv\\_%' ORDER BY proname`,
      );
      return rows.map((r) => r.proname);
    });
    expect(fns).toEqual([
      'nerv_ensure_month_partitions',
      // 2026-09-07 — 감사 로그의 불변성을 DB 가 지킨다(REQ-DB-023)
      'nerv_event_immutable',
      'nerv_glob_overlap',
      'nerv_spec_version_freeze',
      'nerv_touch_updated_at',
    ]);

    const triggers = await withClient(db.url, async (c) => {
      const { rows } = await c.query<{ tgname: string }>(
        `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname`,
      );
      return rows.map((r) => r.tgname);
    });
    // `event_append_only` 는 파티션 부모에 걸리고 PG13+ 가 파티션에 복제한다 — 이름이
    // 여럿 나오므로 집합으로 본다
    expect(new Set(triggers)).toEqual(
      new Set(['event_append_only', 'spec_version_freeze', 'task_touch_updated_at']),
    );
  });
});

describe('무결성 규칙이 DB 에서 실제로 강제된다', () => {
  it('draft 가 아닌 SpecVersion 의 본문은 동결된다 — 규칙 1 (§2.13)', async () => {
    await withClient(db.url, async (c) => {
      const { orgId, userId, projectId } = await seedTenancy(c);
      const specId = randomUUID();
      const versionId = randomUUID();

      await c.query(
        `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'feature','x','X')`,
        [specId, projectId],
      );
      await c.query(
        `INSERT INTO spec_version (id, spec_id, version_no, status, body_md, content_hash, author_user_id)
         VALUES ($1,$2,1,'draft','원문', digest('원문','sha256'), $3)`,
        [versionId, specId, userId],
      );

      // draft 인 동안에는 고칠 수 있다 — 가변 구간은 draft 하나뿐이다
      await expect(
        c.query(`UPDATE spec_version SET body_md = '수정' WHERE id = $1`, [versionId]),
      ).resolves.toBeDefined();

      await c.query(`UPDATE spec_version SET status = 'approved' WHERE id = $1`, [versionId]);

      // approved 가 된 뒤에는 트리거가 막는다
      await expect(
        c.query(`UPDATE spec_version SET body_md = '몰래 수정' WHERE id = $1`, [versionId]),
      ).rejects.toThrow(/frozen/);

      void orgId;
    });
  });

  it('한 Task 에 활성 클레임은 하나뿐이다 — 규칙 2 (partial unique)', async () => {
    await withClient(db.url, async (c) => {
      const { userId, projectId } = await seedTenancy(c);
      const taskId = randomUUID();
      await c.query(
        `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md, tools_sources_md, boundaries_md)
         VALUES ($1,$2,'T-1','작업','ready','g','o','t','b')`,
        [taskId, projectId],
      );

      const insertClaim = (id: string) =>
        c.query(
          `INSERT INTO claim (id, project_id, task_id, user_id, status, lease_expires_at)
           VALUES ($1,$2,$3,$4,'active', now() + interval '30 minutes')`,
          [id, projectId, taskId, userId],
        );

      await insertClaim(randomUUID());
      await expect(insertClaim(randomUUID())).rejects.toThrow(/claim_task_active_uq/);

      // 해제되면 다시 잡을 수 있다 — 부분 unique 는 active 만 본다
      await c.query(`UPDATE claim SET status = 'released' WHERE task_id = $1`, [taskId]);
      await expect(insertClaim(randomUUID())).resolves.toBeDefined();
    });
  });

  it('위임 명세 4요소가 없으면 ready 로 갈 수 없다 — 규칙 3 (CHECK)', async () => {
    await withClient(db.url, async (c) => {
      const { projectId } = await seedTenancy(c);
      await expect(
        c.query(
          `INSERT INTO task (id, project_id, key, title, status, goal_md)
           VALUES ($1,$2,'T-2','미비','ready','목표만 있음')`,
          [randomUUID(), projectId],
        ),
      ).rejects.toThrow(/task_delegation_spec_ck/);
    });
  });

  it('nerv_glob_overlap 이 보수적으로 판정한다 (§2.13 · spec-workflow §4.4)', async () => {
    const cases: [string, string, boolean][] = [
      ['src/a/**', 'src/a/b.ts', true],
      ['src/a/**', 'src/b/c.ts', false],
      ['src/*/x.ts', 'src/a/x.ts', true],
      ['a/b/c.ts', 'a/b/c.ts', true],
      ['a/b.ts', 'c/d.ts', false],
    ];
    for (const [g1, g2, expected] of cases) {
      const got = await scalar<boolean>(`SELECT nerv_glob_overlap($1, $2)`, [g1, g2]);
      expect({ g1, g2, got }).toEqual({ g1, g2, got: expected });
    }
  });
});

// ── 도우미 ─────────────────────────────────────────────────────────────────

async function scalar<T = number>(sql: string, params: unknown[] = []): Promise<T> {
  return withClient(db.url, async (c) => {
    const { rows } = await c.query<Record<string, T>>(sql, params);
    return Object.values(rows[0] ?? {})[0] as T;
  });
}

/** 스키마 비교용 — 테이블·컬럼·제약·인덱스의 지문 */
async function snapshotSchema(): Promise<string[]> {
  return withClient(db.url, async (c) => {
    const { rows } = await c.query<{ fingerprint: string }>(
      `SELECT table_name || '.' || column_name || ':' || data_type AS fingerprint
         FROM information_schema.columns WHERE table_schema = 'public'
       UNION ALL
       SELECT 'idx:' || indexname FROM pg_indexes WHERE schemaname = 'public'
       UNION ALL
       SELECT 'con:' || conname FROM pg_constraint
       ORDER BY 1`,
    );
    return rows.map((r) => r.fingerprint);
  });
}

async function seedTenancy(c: import('pg').Client): Promise<{
  orgId: string;
  userId: string;
  projectId: string;
}> {
  const orgId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const suffix = projectId.slice(0, 8);
  await c.query(`INSERT INTO organization (id, slug, name) VALUES ($1,$2,'조직')`, [
    orgId,
    `org-${suffix}`,
  ]);
  await c.query(`INSERT INTO "user" (id, email, display_name) VALUES ($1,$2,'사람')`, [
    userId,
    `u-${suffix}@example.com`,
  ]);
  await c.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,$3,$4,'프로젝트')`,
    [projectId, orgId, `p-${suffix}`, `K${suffix.slice(0, 4).toUpperCase()}`],
  );
  return { orgId, userId, projectId };
}

/**
 * **0025 는 데이터 마이그레이션이다** — 스키마가 아니라 사실을 고친다(2026-09-07 · 사람 결정).
 *
 * 임포트가 만든 `claimed`/`in_progress` 24건에 활성 클레임이 없었다. 그 Task 들은
 * **아무 데도 없다**: 큐에도 안 보이고, 활성 클레임이 없으니 리스 만료로 회수되지도
 * 않으며, 세션 보드에도 뜨지 않는다 — 상태만 "진행 중" 이라 사람은 누군가 하고 있다고
 * 읽는다. 스키마 스냅샷 대조로는 이런 마이그레이션이 무엇을 했는지 알 수 없어 여기서 태운다.
 */
describe('0025 — 임포트가 만든 고아 진행 중을 backlog 로 (사람 결정)', () => {
  const PLACEHOLDER = '(임포트 — 원본에 위임 명세 없음)';

  async function seedTask(
    client: Parameters<Parameters<typeof withClient>[1]>[0],
    key: string,
    status: string,
    goal: string,
  ): Promise<string> {
    const id = randomUUID();
    await client.query(
      `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md,
                         tools_sources_md, boundaries_md)
       VALUES ($1, (SELECT id FROM project LIMIT 1), $2, $2, $3::task_status, $4, $4, $4, $4)`,
      [id, key, status, goal],
    );
    return id;
  }

  it('클레임 없는 placeholder 진행 중만 되돌린다 — 나머지는 손대지 않는다', async () => {
    const fresh = await createScratchDb('nerv_orphan');
    try {
      await runMigrations(fresh.url);
      const result = await withClient(fresh.url, async (client) => {
        await client.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'o','O')`, [
          randomUUID(),
        ]);
        await client.query(
          `INSERT INTO project (id, org_id, slug, key, name)
           VALUES ($1,(SELECT id FROM organization LIMIT 1),'p','P','P')`,
          [randomUUID()],
        );
        const orphan = await seedTask(client, 'P-T-ORPHAN', 'in_progress', PLACEHOLDER);
        // 사람이 쓴 브리프를 가진 진행 중 — 임포트가 만든 것이 아니다
        const authored = await seedTask(client, 'P-T-REAL', 'in_progress', '진짜 목표');

        // 0025 를 손으로 다시 돌린다(마이그레이션은 이미 적용됐고, 멱등을 함께 본다)
        const sql = readFileSync(
          join(migrationsFolder(), '0025_orphan_imported_tasks.sql'),
          'utf8',
        );
        await client.query(sql);
        await client.query(sql); // 두 번째는 0건이어야 한다

        const { rows } = await client.query<{ id: string; status: string }>(
          `SELECT id, status::text AS status FROM task WHERE id = ANY($1)`,
          [[orphan, authored]],
        );
        return { orphan, authored, rows };
      });

      const statusOf = (id: string): string => result.rows.find((r) => r.id === id)?.status ?? '';
      expect(statusOf(result.orphan)).toBe('backlog');
      // 사람이 쓴 것은 건드리지 않는다 — 이 마이그레이션의 대상은 placeholder 뿐이다
      expect(statusOf(result.authored)).toBe('in_progress');
    } finally {
      await fresh.drop();
    }
  });
});

/**
 * **0031 도 데이터 마이그레이션이다** — 이미 닫힌 요청의 알림을 닫는다(2026-09-24 · REQ-API-176).
 *
 * 결정·답변·취소가 그 요청의 알림을 닫게 된 것은 이 변경부터라, 그 전에 처리된 요청의
 * 알림은 안 읽은 채로 남아 배지를 올린다. 열린 요청의 알림까지 닫으면 사람이 요청을 놓친다 —
 * 그래서 닫힌 것만 닫는지를 태운다.
 */
describe('0031 — 이미 닫힌 요청의 알림을 닫는다', () => {
  it('결정된 결재 · 끝난 질문의 알림만 읽음이 되고, 열린 요청과 다른 알림은 그대로다', async () => {
    const fresh = await createScratchDb('nerv_close_requests');
    try {
      await runMigrations(fresh.url);
      const states = await withClient(fresh.url, async (client) => {
        const { userId, projectId } = await seedTenancy(client);
        const sessionId = randomUUID();
        await client.query(
          `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname)
           VALUES ($1,$2,$3,'claude-code','mac')`,
          [sessionId, projectId, userId],
        );
        const approval = async (decided: boolean): Promise<string> => {
          const id = randomUUID();
          await client.query(
            `INSERT INTO approval (id, project_id, subject_type, subject_id, requested_by_user_id,
                                   decision, decided_by_user_id, decided_at)
             VALUES ($1,$2,'spec_version',$3,$4,$5::approval_decision,$6,$7)`,
            [
              id,
              projectId,
              randomUUID(),
              userId,
              decided ? 'approve' : null,
              decided ? userId : null,
              decided ? new Date() : null,
            ],
          );
          return id;
        };
        const question = async (status: string): Promise<string> => {
          const id = randomUUID();
          await client.query(
            `INSERT INTO question (id, project_id, agent_session_id, title, status)
             VALUES ($1,$2,$3,'어느 쪽?',$4::question_status)`,
            [id, projectId, sessionId, status],
          );
          return id;
        };
        // 요청을 연 이벤트와 그 알림 한 줄 — 알림 id 를 돌려준다
        const notify = async (type: string, subjectType: string, subjectId: string) => {
          const eventId = randomUUID();
          await client.query(
            `INSERT INTO event (id, project_id, type, subject_type, subject_id)
             VALUES ($1,$2,$3,$4,$5)`,
            [eventId, projectId, type, subjectType, subjectId],
          );
          const id = randomUUID();
          await client.query(
            `INSERT INTO notification (id, project_id, user_id, event_id, importance)
             VALUES ($1,$2,$3,$4,'immediate')`,
            [id, projectId, userId, eventId],
          );
          return id;
        };

        const ids = {
          decided: await notify(NERV_EVENT.APPROVAL_REQUESTED, 'approval', await approval(true)),
          pending: await notify(NERV_EVENT.APPROVAL_REQUESTED, 'approval', await approval(false)),
          answered: await notify(
            NERV_EVENT.QUESTION_CREATED,
            'question',
            await question('answered'),
          ),
          expired: await notify(NERV_EVENT.QUESTION_CREATED, 'question', await question('expired')),
          open: await notify(NERV_EVENT.QUESTION_CREATED, 'question', await question('open')),
          // 요청이 아닌 알림 — 결정된 결재를 가리켜도 요청을 연 이벤트가 아니면 건드리지 않는다
          other: await notify(NERV_EVENT.APPROVAL_DECIDED, 'approval', await approval(true)),
        };

        const sql = readFileSync(
          join(migrationsFolder(), '0031_close_request_notifications.sql'),
          'utf8',
        );
        await client.query(sql);
        await client.query(sql); // 멱등 — 두 번째는 0건이다

        const { rows } = await client.query<{ id: string; state: string; read: boolean }>(
          `SELECT id, state::text AS state, read_at IS NOT NULL AS read
             FROM notification WHERE id = ANY($1)`,
          [Object.values(ids)],
        );
        const byId = new Map(rows.map((r) => [r.id, r.read ? r.state : `${r.state}(no read_at)`]));
        return Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, byId.get(id)]));
      });

      expect(states).toEqual({
        decided: 'read',
        pending: 'unread(no read_at)',
        answered: 'read',
        expired: 'read',
        open: 'unread(no read_at)',
        other: 'unread(no read_at)',
      });
    } finally {
      await fresh.drop();
    }
  });
});

/**
 * **쌓여 있는 안 읽은 보통 알림을 묶음으로 접는다**(2026-09-27 · 사람 결정 G2 · REQ-DB-031).
 *
 * 앱 안 묶음(0037)은 앞으로 올 알림부터 묶어서, 그 전에 쌓인 안 읽은 알림은 한 건이 한 줄인 채로
 * 남았다. 같은 규칙으로 접되 **지우지 않는다** — 나머지 줄은 `archived` 로 목록에서 빠지고, 그 이벤트는
 * 남긴 줄의 묶음에 든다. 이미 열린 묶음이 있으면 거기로 모인다(열린 묶음은 키마다 하나다).
 */
describe('0038 — 쌓여 있는 안 읽은 보통 알림을 묶음으로 접는다', () => {
  it('같은 대상의 안 읽은 줄은 한 줄로 모이고 나머지는 지우지 않고 뺀다 — 읽은 · 중요 알림은 그대로다', async () => {
    const fresh = await createScratchDb('nerv_fold');
    try {
      await runMigrations(fresh.url);
      const result = await withClient(fresh.url, async (client) => {
        const { userId, projectId } = await seedTenancy(client);
        const [specA, specB, specC] = [randomUUID(), randomUUID(), randomUUID()];
        let minute = 0;
        const notify = async (
          type: string,
          subjectId: string,
          opts: { state?: 'unread' | 'read'; importance?: 'digest' | 'immediate' } = {},
        ): Promise<string> => {
          minute += 1;
          const eventId = randomUUID();
          await client.query(
            `INSERT INTO event (id, project_id, type, subject_type, subject_id, occurred_at)
             VALUES ($1,$2,$3,'spec',$4, now() - interval '1 day' + ($5 || ' minutes')::interval)`,
            [eventId, projectId, type, subjectId, String(minute)],
          );
          const id = randomUUID();
          await client.query(
            `INSERT INTO notification (id, project_id, user_id, event_id, importance, state,
                                       created_at, last_at)
             VALUES ($1,$2,$3,$4,$5::notification_importance,$6::notification_state,
                     now() - interval '1 day' + ($7 || ' minutes')::interval,
                     now() - interval '1 day' + ($7 || ' minutes')::interval)`,
            [
              id,
              projectId,
              userId,
              eventId,
              opts.importance ?? 'digest',
              opts.state ?? 'unread',
              String(minute),
            ],
          );
          return id;
        };
        const R = NERV_EVENT.SPEC_RECHECK_REQUESTED;
        const a = [await notify(R, specA), await notify(R, specA), await notify(R, specA)];
        const readA = await notify(R, specA, { state: 'read' });
        const b = await notify(R, specB);
        const approved = await notify(NERV_EVENT.SPEC_APPROVED, specA, { importance: 'immediate' });
        const c = [await notify(R, specC), await notify(R, specC)];
        // 0037 뒤의 파생이 이미 연 묶음 — 접을 줄은 여기로 모인다
        const openC = await notify(R, specC);
        await client.query(
          `UPDATE notification SET batch_key = $2, batch_open = true WHERE id = $1`,
          [openC, `spec:${specC}:recheck`],
        );
        await client.query(
          `INSERT INTO notification_batch_event (notification_id, event_id, user_id)
           SELECT id, event_id, user_id FROM notification WHERE id = $1`,
          [openC],
        );

        const sql = readFileSync(join(migrationsFolder(), '0038_notification_fold.sql'), 'utf8');
        await client.query(sql);
        await client.query(sql); // 멱등 — 두 번째는 0건이다

        const { rows } = await client.query<{
          id: string;
          state: string;
          batch_key: string | null;
          batch_size: number;
          batch_open: boolean;
          first: boolean;
        }>(
          `SELECT n.id, n.state::text AS state, n.batch_key, n.batch_size, n.batch_open,
                  n.created_at = (SELECT min(created_at) FROM notification WHERE id = ANY($2)) AS first
             FROM notification n WHERE n.id = ANY($1)`,
          [[...a, readA, b, approved, ...c, openC], a],
        );
        const at = (id: string) => {
          const r = rows.find((row) => row.id === id);
          return r === undefined
            ? undefined
            : `${r.state}${r.batch_key === null ? '' : ` ×${String(r.batch_size)}`}${r.batch_open ? ' open' : ''}`;
        };
        return {
          a: a.map(at),
          aFirst: rows.find((r) => r.id === a[2])?.first,
          readA: at(readA),
          b: at(b),
          approved: at(approved),
          c: c.map(at),
          openC: at(openC),
        };
      });

      expect(result).toEqual({
        // 가장 최근 줄이 묶음이 되고, 처음 시각은 가장 오래된 줄의 것이다
        a: ['archived', 'archived', 'unread ×3 open'],
        aFirst: true,
        readA: 'read',
        b: 'unread ×1 open',
        approved: 'unread',
        c: ['archived', 'archived'],
        openC: 'unread ×3 open',
      });
    } finally {
      await fresh.drop();
    }
  });
});

/**
 * **0051 의 있던 행 채우기**(2026-10-15 · 사람 결정 · REQ-DB-044). 임포터가 만들었고 살아 있는 작업이 없는 요구사항만
 * `import` 다 — 살아 있는 작업이 있으면 파생이 이미 값을 썼다고 보고, NERV 에서 생긴 요구사항은 처음 값이라 `derived` 다.
 * 보관한 작업만 남은 요구사항은 작업이 없는 요구사항과 같다(REQ-API-286).
 */
describe('0051 — 임포트 값의 출처를 채운다', () => {
  it('임포터가 만들었고 살아 있는 작업이 없는 행만 import 다 — 두 번 돌려도 같다', async () => {
    const fresh = await createScratchDb('nerv_impl_source');
    try {
      await runMigrations(fresh.url);
      const sources = await withClient(fresh.url, async (client) => {
        const { userId, projectId } = await seedTenancy(client);
        const specId = randomUUID();
        const versionId = randomUUID();
        await client.query(
          `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'feature','SPC-S','S')`,
          [specId, projectId],
        );
        await client.query(
          `INSERT INTO spec_version (id, spec_id, version_no, status, body_md, content_hash, author_user_id)
           VALUES ($1,$2,1,'approved','본문',decode(md5('s'),'hex'),$3)`,
          [versionId, specId, userId],
        );
        /** 요구사항 하나 — `imported` 면 임포터처럼 들어온 버전에 `added` 줄을 남긴다 */
        const requirement = async (ref: string, imported: boolean): Promise<string> => {
          const id = randomUUID();
          await client.query(
            `INSERT INTO requirement (id, project_id, spec_id, ref, statement_md, impl_status,
                                      introduced_in_version_id, current_version_id)
             VALUES ($1,$2,$3,$4,'문장','implemented',$5,$5)`,
            [id, projectId, specId, ref, versionId],
          );
          if (imported) {
            await client.query(
              `INSERT INTO requirement_version (requirement_id, spec_version_id, change_kind, statement_md, ordinal)
               VALUES ($1,$2,'added','문장',1)`,
              [id, versionId],
            );
          }
          return id;
        };
        const task = async (requirementId: string, archived: boolean): Promise<void> => {
          const id = randomUUID();
          await client.query(
            `INSERT INTO task (id, project_id, key, title, status, source_requirement_id)
             VALUES ($1,$2,$3,'작업','backlog',$4)`,
            [id, projectId, `S-T-${id.slice(0, 6)}`, requirementId],
          );
          if (archived) {
            await client.query(
              `UPDATE task SET archived_at = now(), archive_reason = 'obsolete', archived_by_user_id = $2
                WHERE id = $1`,
              [id, userId],
            );
          }
        };
        const ids = {
          bare: await requirement('REQ-S-001', true),
          withTask: await requirement('REQ-S-002', true),
          archivedOnly: await requirement('REQ-S-003', true),
          authored: await requirement('REQ-S-004', false),
        };
        await task(ids.withTask, false);
        await task(ids.archivedOnly, true);

        // 마이그레이션은 이미 적용됐다 — 채우는 문장(마지막 조각)만 손으로 다시 돌리고 멱등을 함께 본다
        const statements = readFileSync(
          join(migrationsFolder(), '0051_impl_status_source.sql'),
          'utf8',
        ).split('--> statement-breakpoint');
        const backfill = statements[statements.length - 1] ?? '';
        await client.query(backfill);
        await client.query(backfill);

        const { rows } = await client.query<{ id: string; source: string }>(
          `SELECT id, impl_status_source::text AS source FROM requirement WHERE project_id = $1`,
          [projectId],
        );
        const of = (id: string): string => rows.find((r) => r.id === id)?.source ?? '';
        return {
          bare: of(ids.bare),
          withTask: of(ids.withTask),
          archivedOnly: of(ids.archivedOnly),
          authored: of(ids.authored),
        };
      });
      expect(sources).toEqual({
        bare: 'import',
        withTask: 'derived',
        archivedOnly: 'import',
        authored: 'derived',
      });
    } finally {
      await fresh.drop();
    }
  });
});

describe('0059 — 이미 만든 재검증 작업이 다시 보는 완료 작업을 채운다', () => {
  it('task.created 의 kind 가 reverify 인 작업만 — 그보다 먼저 끝난 완료 작업 가운데 가장 나중 것이고, 두 번 돌려도 같다', async () => {
    const fresh = await createScratchDb('nerv_reverifies');
    try {
      await runMigrations(fresh.url);
      const filled = await withClient(fresh.url, async (client) => {
        const { userId, projectId } = await seedTenancy(client);
        const specId = randomUUID();
        const versionId = randomUUID();
        await client.query(
          `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'feature','SPC-R','R')`,
          [specId, projectId],
        );
        await client.query(
          `INSERT INTO spec_version (id, spec_id, version_no, status, body_md, content_hash, author_user_id)
           VALUES ($1,$2,1,'approved','본문',decode(md5('r'),'hex'),$3)`,
          [versionId, specId, userId],
        );
        const requirement = async (ref: string): Promise<string> => {
          const id = randomUUID();
          await client.query(
            `INSERT INTO requirement (id, project_id, spec_id, ref, statement_md, introduced_in_version_id,
                                      current_version_id)
             VALUES ($1,$2,$3,$4,'문장',$5,$5)`,
            [id, projectId, specId, ref, versionId],
          );
          return id;
        };
        /** `doneAgo` 면 그 시간 전에 끝난 완료 작업, `kind` 면 CR 승인이 만든 것처럼 `task.created` 를 남긴다 */
        const task = async (
          requirementId: string,
          opts: { doneAgo?: string; createdAgo?: string; kind?: 'reverify' | 'derive' },
        ): Promise<string> => {
          const id = randomUUID();
          const done = opts.doneAgo !== undefined;
          await client.query(
            `INSERT INTO task (id, project_id, key, title, status, source_requirement_id, goal_md, output_format_md,
                               tools_sources_md, boundaries_md, spec_impact, done_at, created_at)
             VALUES ($1,$2,$3,'작업',$4::task_status,$5,'g','o','t','b',
                     CASE WHEN $6 THEN '{"none": true}'::jsonb END,
                     CASE WHEN $6 THEN now() - $7::interval END,
                     now() - $8::interval)`,
            [
              id,
              projectId,
              `R-T-${id.slice(0, 6)}`,
              done ? 'done' : 'backlog',
              requirementId,
              done,
              opts.doneAgo ?? '0',
              opts.createdAgo ?? '0',
            ],
          );
          if (opts.kind !== undefined) {
            await client.query(
              `INSERT INTO event (id, project_id, type, subject_type, subject_id, payload)
               VALUES ($1,$2,$3,'task',$4,$5::jsonb)`,
              [
                randomUUID(),
                projectId,
                NERV_EVENT.TASK_CREATED,
                id,
                JSON.stringify({
                  change_request_key: 'K-C-1',
                  kind: opts.kind,
                  requirement_ref: 'REQ-R-001',
                }),
              ],
            );
          }
          return id;
        };
        const r1 = await requirement('REQ-R-001');
        const r2 = await requirement('REQ-R-002');
        await task(r1, { doneAgo: '3 hours' });
        const latest = await task(r1, { doneAgo: '2 hours' });
        const reverify = await task(r1, { kind: 'reverify', createdAgo: '1 hour' });
        // 재검증 작업이 생긴 뒤에 끝난 완료 작업은 그 작업이 다시 보는 것이 아니다
        await task(r1, { doneAgo: '30 minutes' });
        const derive = await task(r1, { kind: 'derive' });
        const plain = await task(r1, {});
        // 같은 요구사항에 완료 작업이 없으면 채우지 않는다
        const orphan = await task(r2, { kind: 'reverify' });

        // 마이그레이션은 이미 적용됐다 — 채우는 문장(마지막 조각)만 손으로 다시 돌리고 멱등을 함께 본다
        await client.query(`UPDATE task SET reverifies_task_id = NULL WHERE project_id = $1`, [
          projectId,
        ]);
        const statements = readFileSync(
          join(migrationsFolder(), '0059_task_reverifies.sql'),
          'utf8',
        ).split('--> statement-breakpoint');
        const backfill = statements[statements.length - 1] ?? '';
        await client.query(backfill);
        await client.query(backfill);

        const { rows } = await client.query<{ id: string; target: string | null }>(
          `SELECT id, reverifies_task_id AS target FROM task WHERE project_id = $1`,
          [projectId],
        );
        const of = (id: string): string | null => rows.find((r) => r.id === id)?.target ?? null;
        return {
          reverify: of(reverify) === latest,
          derive: of(derive),
          plain: of(plain),
          orphan: of(orphan),
          filled: rows.filter((r) => r.target !== null).length,
        };
      });
      expect(filled).toEqual({
        reverify: true,
        derive: null,
        plain: null,
        orphan: null,
        filled: 1,
      });
    } finally {
      await fresh.drop();
    }
  });
});

/**
 * **뒤처진 스키마를 이름으로 말한다**(REQ-CB-056 · 2026-09-24 실측).
 *
 * 개발 DB 가 31건 중 27건에서 멈춘 채 api 가 떠 있었고, 없는 칸을 읽는 질의마다 500 이
 * 흩어졌다. 기동 검사는 이 함수 하나를 본다 — 그래서 실제 적용 이력으로 잰다.
 */
describe('schemaStatus — 기동 검사가 보는 값', () => {
  it('빈 DB 는 전부가 남은 것이다', async () => {
    const fresh = await createScratchDb('nerv_schema_empty');
    try {
      const status = await schemaStatus(fresh.url);
      expect(status.applied).toBe(0);
      expect(status.pending).toEqual(journalEntries().map((e) => e.tag));
    } finally {
      await fresh.drop();
    }
  });

  it('다 적용하면 남은 것이 없고, 마지막 하나를 지우면 그 이름을 말한다', async () => {
    const fresh = await createScratchDb('nerv_schema_behind');
    try {
      await runMigrations(fresh.url);
      const current = await schemaStatus(fresh.url);
      expect(current.pending).toEqual([]);
      expect(current.applied).toBe(current.expected);

      // 이력에서 가장 늦은 한 줄을 뺀다 — 그 파일이 적용되지 않은 DB 와 같은 판정이다
      await withClient(fresh.url, (client) =>
        client.query(
          `DELETE FROM drizzle.__drizzle_migrations
            WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations)`,
        ),
      );
      const behind = await schemaStatus(fresh.url);
      const last = journalEntries().at(-1)?.tag;
      expect(behind.pending).toEqual([last]);
      expect(behind.applied).toBe(behind.expected - 1);
    } finally {
      await fresh.drop();
    }
  });
});
