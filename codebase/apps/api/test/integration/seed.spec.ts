// E02-S04 — 개발 시드 한 벌.
//
//   WHEN 시드 스크립트를 실행하면, THE SYSTEM SHALL 예시 데이터 한 벌을 멱등하게 적재한다
//   (재실행 시 신규 레코드 0) — REQ-DB-002
//
// 시드는 화면 개발의 "데이터 있음" 경로를 즉시 확인하게 해주는 물건이라(database.md §4 말미),
// 무엇이 몇 건인지가 곧 계약이다. 여기서 그 계약을 고정한다.

import { SEED_ORG_SLUG } from '@nerv/schema';
import { runMigrations, runSeed } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;

beforeAll(async () => {
  db = await createScratchDb('nerv_seed');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

async function count(table: string, where = ''): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} ${where}`,
  );
  return rows[0]?.n ?? 0;
}

describe('개발 시드 (database.md §4)', () => {
  it('빈 DB 에 한 벌을 적재한다', async () => {
    const result = await runSeed(db.url);
    expect(result).toEqual({
      organizations: 1,
      projects: 1,
      specs: 20,
      tasks: 3,
      claims: 3,
      sessions: 3,
      events: 3,
    });
  });

  it('시드 계정은 **확인된 상태**다 — 아니면 심어 놓고 아무도 못 들어간다 (2026-09-22)', async () => {
    // 가입 이메일 인증을 강제하기로 한 뒤로 `email_verified` 가 거짓인 계정은 로그인할 수
    // 없다. 시드는 화면을 열어 보라고 있는 것이라, 이 한 줄이 빠지면 개발 환경 전체가
    // 로그인 화면에서 멈춘다(실측: e2e 전역 셋업이 거기서 30초를 기다리다 죽었다).
    expect(await count('"user"', `WHERE NOT email_verified`)).toBe(0);
  });

  it('시드가 심는 조직 slug 가 안전장치가 보는 값과 같다', async () => {
    // 값이 두 곳(SQL · 안전장치)에 있으면 한쪽만 바뀐다 — 실제로 그랬다(2026-08-24):
    // 조직명을 바꾸자 안전장치가 **자기 시드의 조직**을 남의 것으로 보고 재적재를 막았다.
    const { rows } = await pool.query<{ slug: string }>(`SELECT slug FROM organization`);
    expect(rows.map((r) => r.slug)).toEqual([SEED_ORG_SLUG]);
  });

  it('2회 연속 실행해도 상태가 같다 — 멱등 (REQ-DB-002)', async () => {
    const first = await snapshot();
    const result = await runSeed(db.url);
    const second = await snapshot();

    expect(result.projects).toBe(1);
    expect(second).toEqual(first);
  });

  it('문서 세트가 쓰는 표시 ID 가 그대로 심긴다', async () => {
    // DB 콜레이션에 기대지 않는다 — en_US 로케일은 대소문자를 섞어 정렬한다. JS 에서 정렬한다.
    const specKeys = (await rows<{ key: string }>(`SELECT key FROM spec`)).map((r) => r.key).sort();
    expect(specKeys).toEqual([
      'ADR-CWC-003',
      'ADR-OPS-001',
      'ADR-SRC-002',
      'SPC-ACC-002',
      'SPC-ACC-007',
      'SPC-ACC-011',
      'SPC-CWC-007',
      'SPC-CWC-012',
      'SPC-CWC-015',
      'SPC-OPS-004',
      'SPC-OPS-006',
      'SPC-OPS-009',
      'SPC-SRC-003',
      'SPC-SRC-005',
      'SPC-SRC-008',
      'SPC-VIS-001',
      'account-access',
      'channel-web-chat',
      'ops-observability',
      'search-index',
    ]);

    const taskKeys = (await rows<{ key: string }>(`SELECT key FROM task`)).map((r) => r.key).sort();
    expect(taskKeys).toEqual(['CLV-T-0CFQC2', 'CLV-T-1KTDCK', 'CLV-T-TRA25N']);

    const sessions = (
      await rows<{ external_session_id: string }>(`SELECT external_session_id FROM agent_session`)
    )
      .map((r) => r.external_session_id)
      .sort();
    expect(sessions).toEqual(['S-2d04', 'S-8f31', 'S-b7e9']);

    expect(await count('requirement', `WHERE ref = 'REQ-CWC-031'`)).toBe(1);
  });

  it('화면마다 "데이터 있음" 경로가 뜬다 (§4 말미)', async () => {
    // S4 작업 보드 — in_progress 2 · blocked 1
    expect(await count('task', `WHERE status = 'in_progress'`)).toBe(2);
    expect(await count('task', `WHERE status = 'blocked'`)).toBe(1);
    // S5 세션 모니터 — active 2 · awaiting_input 1
    expect(await count('agent_session', `WHERE state = 'active'`)).toBe(2);
    expect(await count('agent_session', `WHERE state = 'awaiting_input'`)).toBe(1);
    // S5 세션 **상세** — Activity 타임라인. 이 줄이 없어서 시드가 `activity` 를 비운 채로
    // 지나갔고, 화면의 중심이 늘 빈 목록이었다(실측 2026-08-23). 세션마다 있어야 한다 —
    // 하나만 채우면 나머지를 눌렀을 때 다시 빈 화면이다.
    expect(await count('activity')).toBeGreaterThan(0);
    const { rows: perSession } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM agent_session s
        WHERE NOT EXISTS (SELECT 1 FROM activity a WHERE a.session_id = s.id)`,
    );
    expect(perSession[0]?.n).toBe('0');
    // S7 받은 요청 — 열린 질문 1
    expect(await count('question', `WHERE status = 'open'`)).toBe(1);
    // S1 홈 — 읽지 않은 알림 1
    expect(await count('notification', `WHERE state = 'unread'`)).toBe(1);
    // S3 스펙 상세 — SPC-CWC-007 은 v3 superseded → v4 approved (diff 재료)
    expect(await count('spec_version', `WHERE status = 'superseded'`)).toBe(1);
    // 승인본 열여섯 = 기존 둘 + 2026-09-22 에 넓힌 트리의 열넷. **영역(area) 넷만 본문이
    // 없다** — 임포터의 골격 배치와 같다. 트리는 차는데 누르면 빈 문서인 상태를 만들지
    // 않으려고 나머지 전부에 승인본 하나씩을 준다.
    expect(await count('spec_version', `WHERE status = 'approved'`)).toBe(16);
    const { rows: bodyless } = await pool.query<{ type: string }>(`
      SELECT DISTINCT s.type::text AS type FROM spec s
       WHERE NOT EXISTS (SELECT 1 FROM spec_version v WHERE v.spec_id = s.id)
    `);
    expect(bodyless.map((r) => r.type)).toEqual(['area']);
    // S6 리뷰 센터(2026-08-23) — 열린 발견 3(severity 3종) · 브랜치 2 · 면제 1.
    // 세션 상세와 같은 이유로 여기 넣는다: 비어 있으면 "정리된 finding" 이라는 이
    // 화면의 값어치가 개발 환경에서 한 번도 보이지 않는다.
    expect(await count('finding', `WHERE status = 'open'`)).toBe(3);
    expect(await count('finding', `WHERE status = 'open' AND severity = 'critical'`)).toBe(1);
    expect(await count('approval', `WHERE is_bypass`)).toBe(1);
    const { rows: branches } = await pool.query<{ n: string }>(
      `SELECT count(DISTINCT branch)::text AS n FROM review_session`,
    );
    expect(branches[0]?.n).toBe('2');
    // S4 작업 상세의 증적(2026-09-10) — 이 표만 비어 있어서, 증적 카드에 붙은 링크가
    // 시드로는 한 번도 그려진 적이 없었다. 종류 여섯을 전부 쓴다: 링크가 되는 넷과
    // 매뉴얼로 가는 하나, 그리고 **링크가 되지 않는 하나**(test).
    expect(await count('evidence')).toBe(7);
    const { rows: kinds } = await pool.query<{ kind: string }>(
      `SELECT DISTINCT kind::text AS kind FROM evidence ORDER BY kind`,
    );
    expect(kinds.map((k) => k.kind)).toEqual([
      'code_path',
      'commit',
      'pr',
      'review',
      'test',
      'user_guide',
    ]);
    // 하나는 다른 저장소에 선다 — 그 경로가 화면에 실제로 그려지는 유일한 자리다
    expect(await count('evidence', `WHERE repo IS NOT NULL`)).toBe(1);
    // 요구사항에도 하나 매달아 둔다 — S3 요구사항 탭의 증적 수가 0 이 아니게 된다(FR-13)
    expect(await count('evidence', `WHERE requirement_id IS NOT NULL`)).toBe(1);
  });

  it('관계 그래프가 그릴 것이 있다 — 영역 4 · 종류 6 · 관계 28 (2026-09-22)', async () => {
    // **이 표가 비어 있던 동안 그래프 탭은 언제나 빈 상태였다.** `spec_relation` 이
    // 0건이라 캔버스가 아예 마운트되지 않았고, 그래서 밀도가 유일한 설계 문제인 그
    // 화면이 디자인 확인용 스크린샷에 한 번도 들어간 적이 없다([4.5](screens.md) §2.4a).
    // Activity·증적에서 겪은 것과 같은 형태다 — 화면에 길을 내고도 그 길을 지나가는
    // 데이터가 없으면 L3 도 스크린샷도 그 길을 보지 못한다.
    expect(await count('spec_relation')).toBe(28);
    expect(await count('spec', `WHERE type = 'area'`)).toBe(4);

    // 종류 여섯을 전부 쓴다 — 하나라도 비면 범례의 그 색은 개발 환경에서 한 번도
    // 그려지지 않는다(REQ-WEB-176: 범례는 **그려진 것만** 적는다)
    const types = await rows<{ type: string }>(`SELECT DISTINCT type::text AS type FROM spec`);
    expect(types.map((t) => t.type).sort()).toEqual([
      'adr',
      'area',
      'convention',
      'design',
      'feature',
      'vision',
    ]);

    // 관계 종류도 한 낱말만 반복하지 않는다 — 패널이 줄마다 적는 것이 그 값이다
    const kinds = await rows<{ kind: string }>(
      `SELECT DISTINCT kind::text AS kind FROM spec_relation ORDER BY kind`,
    );
    expect(kinds.map((k) => k.kind)).toEqual(['depends_on', 'references', 'refines']);

    // 영역을 **건너는** 간선이 있어야 상자끼리 밀어내는 정리 패스가 할 일이 생긴다
    // (REQ-WEB-174·175). 같은 영역 안에서만 이으면 상자 넷은 서로를 만나지 않는다.
    const { rows: crossing } = await pool.query<{ n: number }>(`
      SELECT count(*)::int AS n FROM spec_relation r
        JOIN spec f ON f.id = r.from_spec_id
        JOIN spec t ON t.id = r.to_spec_id
       WHERE coalesce(f.parent_id, f.id) <> coalesce(t.parent_id, t.id)
    `);
    expect(crossing[0]?.n).toBe(17);

    // 피참조 수가 갈려야 차수 기반 크기가 눈에 띈다 — 고르면 노드가 전부 같은 크기다
    const { rows: hub } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM spec_relation GROUP BY to_spec_id ORDER BY n DESC LIMIT 1`,
    );
    expect(hub[0]?.n).toBeGreaterThanOrEqual(5);
  });

  it('같은 지적이 두 라운드에 걸쳐 하나로 남는다 — 화면의 dedup 표기가 시드에서 보인다', async () => {
    // 라운드 체인(1→2)과 occurrence_count 2 가 함께 있어야 "3회 관측" 같은 표기가
    // 개발 환경에서 실제로 뜬다. 한 라운드만 심으면 그 표기는 코드에만 있는 것이 된다.
    const { rows } = await pool.query<{ occurrence_count: number; severity: string }>(
      `SELECT occurrence_count, severity::text AS severity FROM finding WHERE occurrence_count > 1`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.occurrence_count).toBe(2);
    // **원값 대조가 감사의 근거다** — 2라운드에서 warning 으로 내려왔지만 finding 은
    // critical 을 지킨다. 이 어긋남이 시드에 있어야 감사 화면이 만들 것이 생긴다.
    expect(rows[0]?.severity).toBe('critical');
    const { rows: raw } = await pool.query<{ raw_severity: string }>(
      `SELECT raw_severity::text AS raw_severity FROM finding_occurrence o
        JOIN finding f ON f.id = o.finding_id
       WHERE f.occurrence_count > 1 ORDER BY o.round_no`,
    );
    expect(raw.map((r) => r.raw_severity)).toEqual(['critical', 'warning']);
  });

  it('Activity 타임라인이 5종 어휘를 전부 보여 준다 — 화면이 무엇을 그리는지 시드가 증명한다', async () => {
    // `thought/action/elicitation/response/error` 는 화면의 아이콘 5종과 1:1이다
    // (ui-wireframes §2.5 주석 11). 한 종류라도 비면 그 아이콘 경로는 아무도 못 본다.
    const { rows } = await pool.query<{ type: string }>(`SELECT DISTINCT type::text FROM activity`);
    expect(rows.map((r) => r.type).sort()).toEqual([
      'action',
      'elicitation',
      'error',
      'response',
      'thought',
    ]);
  });

  it('사람의 개입이 에이전트의 행동 **사이에** 있다 — 이 섞임이 화면의 값어치다', async () => {
    // 개입이 맨 앞이나 맨 뒤에만 있으면 "왜 방향을 틀었나"가 위아래로 읽히지 않는다.
    // 앞뒤로 action 이 있는 elicitation·response 가 최소 하나는 있어야 한다.
    const { rows } = await pool.query<{ n: string }>(`
      SELECT count(*)::text AS n FROM activity a
       WHERE a.type IN ('elicitation', 'response')
         AND EXISTS (SELECT 1 FROM activity b
                      WHERE b.session_id = a.session_id AND b.seq < a.seq AND b.type = 'action')
         AND EXISTS (SELECT 1 FROM activity c
                      WHERE c.session_id = a.session_id AND c.seq > a.seq AND c.type = 'action')
    `);
    expect(Number(rows[0]?.n ?? 0)).toBeGreaterThan(0);
  });

  it('활성 클레임 3건이 부분 unique 를 위반하지 않는다 — Task 당 하나씩이다', async () => {
    expect(await count('claim', `WHERE status = 'active'`)).toBe(3);
    const dup = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM claim WHERE status='active' GROUP BY task_id HAVING count(*) > 1`,
    );
    expect(dup).toEqual([]);
  });

  it('시드가 심지 않은 조직이 있으면 멈춘다 — 운영 DB TRUNCATE 사고 방지', async () => {
    await pool.query(
      `INSERT INTO organization (id, slug, name) VALUES (gen_random_uuid(), 'other-org', '다른 조직')`,
    );
    await expect(runSeed(db.url)).rejects.toThrow(/시드가 심지 않은 조직/);

    // force 로는 지나간다 — 그리고 그 TRUNCATE 가 남의 조직도 지운다는 게 경고의 이유다
    await expect(runSeed(db.url, true)).resolves.toMatchObject({ organizations: 1 });
  });
});

async function rows<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
  const { rows: r } = await pool.query<T>(sql);
  return r;
}

/** 시드 결과의 지문 — 테이블별 건수 + 표시 키 목록 */
async function snapshot(): Promise<Record<string, unknown>> {
  const tables = [
    'organization',
    '"user"',
    'project',
    'membership',
    'api_token',
    'agent_session',
    'spec',
    'spec_version',
    'spec_relation',
    'requirement',
    'requirement_version',
    'task',
    'claim',
    'question',
    'event',
    'notification',
  ];
  const counts: Record<string, number> = {};
  for (const t of tables) counts[t] = await count(t);
  return counts;
}
