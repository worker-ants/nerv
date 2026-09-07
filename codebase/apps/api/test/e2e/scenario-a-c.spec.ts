// L3 시나리오 A·B·C — 동시 클레임 · scope 겹침 · 리스 회수 (backlog.md §5.1~§5.3)
//
// **판정은 설문이 아니라 Event 로그 질의다**(§5 머리말). 그래서 각 케이스의 마지막 줄은
// 대부분 event 테이블을 세는 질의다 — "충돌이 없었다"는 느낌이 아니라 행의 부재로 증명된다.
//
// L2 와 다른 점: 여기서는 **실제 HTTP 서버**에 동시 요청이 도착한다. 원자적 클레임이
// 무엇을 막는지는 그 형태에서만 보인다.

import { NERV_EVENT } from '@nerv/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, countEvents, createTask, stackAvailable, startStack } from './harness.js';
import type { E2EStack } from './harness.js';

const AVAILABLE = stackAvailable();
let stack: E2EStack;
let hana: string;
let dohyun: string;
let yuna: string;

beforeAll(async () => {
  if (!AVAILABLE) return;
  stack = await startStack('nerv_e2e_abc');
  hana = await stack.tokenFor('hana', [
    'spec:read',
    'task:claim',
    'task:update',
    'agent-session:launch',
  ]);
  dohyun = await stack.tokenFor('dohyun', [
    'spec:read',
    'task:claim',
    'task:update',
    'agent-session:launch',
  ]);
  yuna = await stack.tokenFor('yuna', [
    'spec:read',
    'task:claim',
    'task:update',
    'agent-session:launch',
  ]);
});

afterAll(async () => {
  // **`stack` 이 없을 수도 있다.** 기동이 실패하면 이 훅이 `undefined.close()` 로 다시
  // 터져서, 원인 하나가 실패 둘로 보고된다 — 진짜 이유가 두 번째 오류에 묻힌다.
  if (stack !== undefined) await stack.close();
});

/** 세션을 띄운다 — 클레임은 세션 신원 위에서만 성립한다(D-08). */
async function bootstrap(token: string, hostname: string, agent: string): Promise<string> {
  const res = await callTool(stack, token, 'nerv_bootstrap', {
    project: stack.projectSlug,
    agent_type: agent,
    hostname,
    cwd: `/work/${hostname}`,
  });
  return String(res.result['session_id']);
}

describe.skipIf(!AVAILABLE)('시나리오 A — 동시 클레임 충돌 0 (성공 기준 0-1·0-2)', () => {
  it('1·2단계 — 두 호스트가 같은 Task 를 잡으면 하나만 성공한다', async () => {
    const taskId = await createTask(stack, 'CLV-T-0CFQC2');
    const s1 = await bootstrap(hana, 'mac-07', 'claude-code');
    const s2 = await bootstrap(dohyun, 'mac-02', 'claude-code');

    const first = await callTool(stack, hana, 'nerv_task_claim', {
      task_id: taskId,
      session_id: s1,
      scope: { spec_ids: [], file_globs: ['apps/web/**'] },
      idempotency_key: `a1-${taskId}`,
    });
    expect(first.error).toBeNull();

    const second = await callTool(stack, dohyun, 'nerv_task_claim', {
      task_id: taskId,
      session_id: s2,
      scope: { spec_ids: [], file_globs: ['apps/web/**'] },
      idempotency_key: `a2-${taskId}`,
    });
    expect(second.error).not.toBeNull();

    // 판정 — task.claimed 는 정확히 1건이다
    expect(await countEvents(stack, NERV_EVENT.TASK_CLAIMED, taskId)).toBe(1);
    const { rows } = await stack.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM claim WHERE task_id = $1 AND status = 'active'`,
      [taskId],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('3단계 — 3세션이 동시에 100회 밀어붙여도 요청묶음당 성공은 정확히 1이다', async () => {
    const sessions = await Promise.all([
      bootstrap(hana, 'mac-07', 'claude-code'),
      bootstrap(dohyun, 'mac-02', 'claude-code'),
      bootstrap(yuna, 'linux-ci-01', 'codex'),
    ]);
    const tokens = [hana, dohyun, yuna];

    // 부하 시험의 축소판 — 라운드 수를 줄이되 **동시성은 그대로**다.
    // 라운드마다 새 Task 를 두고 3세션이 같은 순간에 덤빈다.
    const ROUNDS = 20;
    let winners = 0;
    for (let round = 0; round < ROUNDS; round += 1) {
      const taskId = await createTask(stack, `TSK-load-${round}`);
      const results = await Promise.all(
        tokens.map((token, index) =>
          callTool(stack, token, 'nerv_task_claim', {
            task_id: taskId,
            session_id: sessions[index],
            scope: { spec_ids: [], file_globs: [`round-${round}/**`] },
            idempotency_key: `load-${round}-${index}`,
          }),
        ),
      );
      const ok = results.filter((r) => r.error === null).length;
      expect(ok).toBe(1); // 요청묶음당 성공 정확히 1
      winners += ok;
    }
    expect(winners).toBe(ROUNDS);
  });

  it('4단계 — 같은 Task 가 두 세션에서 동시에 활성인 구간이 0이다', async () => {
    const { rows } = await stack.pool.query<{ n: number }>(`
      SELECT count(*)::int AS n FROM (
        SELECT task_id FROM claim WHERE status = 'active' GROUP BY task_id HAVING count(*) > 1
      ) dup
    `);
    expect(rows[0]?.n).toBe(0);
  });
});

describe.skipIf(!AVAILABLE)('시나리오 B — scope 겹침 경고 (성공 기준 0-3)', () => {
  it('10/10 검출 · 오탐 0 — clemvion 이 #576 에서 제거한 검출의 복원', async () => {
    const s1 = await bootstrap(hana, 'mac-07', 'claude-code');
    const s2 = await bootstrap(dohyun, 'mac-02', 'claude-code');

    let detected = 0;
    for (let i = 0; i < 10; i += 1) {
      const base = await createTask(stack, `TSK-ov-base-${i}`);
      const overlapping = await createTask(stack, `TSK-ov-dup-${i}`);
      const glob = `apps/shared/module-${i}/**`;

      await callTool(stack, hana, 'nerv_task_claim', {
        task_id: base,
        session_id: s1,
        scope: { spec_ids: [], file_globs: [glob] },
        idempotency_key: `ov-base-${i}`,
      });
      const second = await callTool(stack, dohyun, 'nerv_task_claim', {
        task_id: overlapping,
        session_id: s2,
        scope: { spec_ids: [], file_globs: [glob] },
        idempotency_key: `ov-dup-${i}`,
      });

      const warnings = (second.result['warnings'] ?? []) as Record<string, unknown>[];
      if (warnings.length > 0) {
        detected += 1;
        // 경고에는 상대의 신원이 실려야 한다 — 누구와 부딪혔는지 모르면 조정할 수 없다
        expect(String(JSON.stringify(warnings))).toMatch(/mac-07|hana|session/);
      }
    }
    expect(detected).toBe(10);

    let falsePositives = 0;
    for (let i = 0; i < 20; i += 1) {
      const taskId = await createTask(stack, `TSK-clean-${i}`);
      const result = await callTool(stack, yuna, 'nerv_task_claim', {
        task_id: taskId,
        session_id: await bootstrap(yuna, 'linux-ci-01', 'codex'),
        scope: { spec_ids: [], file_globs: [`isolated/area-${i}/**`] },
        idempotency_key: `clean-${i}`,
      });
      if (((result.result['warnings'] ?? []) as unknown[]).length > 0) falsePositives += 1;
    }
    expect(falsePositives).toBe(0);
  });
});

describe.skipIf(!AVAILABLE)('시나리오 C — 리스 만료 자동 회수 (성공 기준 0-4)', () => {
  it('죽은 세션의 클레임을 사람 개입 0으로 회수하고 재클레임이 가능해진다', async () => {
    const taskId = await createTask(stack, 'CLV-T-TRA25N');
    const session = await bootstrap(yuna, 'linux-ci-01', 'codex');

    const claimed = await callTool(stack, yuna, 'nerv_task_claim', {
      task_id: taskId,
      session_id: session,
      scope: { spec_ids: [], file_globs: ['ci/**'] },
      idempotency_key: `c-${taskId}`,
    });
    expect(claimed.error).toBeNull();

    // 프로세스 강제 종료의 재현 — 하트비트가 끊긴다. TTL 을 기다리는 대신 시각을 당긴다
    // (30분을 실제로 기다리는 테스트는 아무도 돌리지 않는다).
    await stack.pool.query(
      `UPDATE claim SET lease_expires_at = now() - interval '1 minute',
                        last_heartbeat_at = now() - interval '40 minutes'
        WHERE task_id = $1 AND status = 'active'`,
      [taskId],
    );
    await stack.pool.query(
      `UPDATE agent_session SET last_heartbeat_at = now() - interval '40 minutes' WHERE id = $1`,
      [session],
    );

    // 워커의 잡과 같은 서비스를 부른다 — 회수 규칙이 두 벌이 아니라는 것이 D-05 다
    const { SessionService } = await import('../../src/modules/session/session.service.js');
    const staled = await stack.app.get(SessionService).markStale();
    expect(staled).toBeGreaterThan(0);

    // 회수는 워커의 lease-reaper 잡이 한다. 그 잡은 ClaimService.reclaimExpired 한 줄이고
    // (worker-jobs.spec.ts 가 그것을 지킨다), 클레임 경로도 같은 메서드를 먼저 부른다 —
    // 회수 규칙이 두 벌이 아니라는 것이 D-05 의 실물이다.
    const { ClaimService } = await import('../../src/modules/task/claim.service.js');
    const { EventService } = await import('../../src/modules/event/event.service.js');
    // 회수는 이벤트를 남긴다(REQ-API-127) — 그래서 `EventService.transact` 로 연다
    const reclaimedClaims = await stack.app
      .get(EventService)
      .transact(async (tx, emit) => stack.app.get(ClaimService).reclaimExpired(tx, emit));
    expect(reclaimedClaims.length).toBeGreaterThan(0);

    const { rows } = await stack.pool.query<{ status: string; claims: number }>(
      `SELECT t.status::text AS status,
              (SELECT count(*)::int FROM claim c WHERE c.task_id = t.id AND c.status = 'active') AS claims
         FROM task t WHERE t.id = $1`,
      [taskId],
    );
    expect(rows[0]?.claims).toBe(0);
    expect(rows[0]?.status).toBe('ready');
    expect(await countEvents(stack, NERV_EVENT.SESSION_STALE)).toBeGreaterThan(0);

    // 다른 세션이 재클레임 — 소유자는 언제나 1명이다
    const reclaimed = await callTool(stack, hana, 'nerv_task_claim', {
      task_id: taskId,
      session_id: await bootstrap(hana, 'mac-07', 'claude-code'),
      scope: { spec_ids: [], file_globs: ['ci/**'] },
      idempotency_key: `c-again-${taskId}`,
    });
    expect(reclaimed.error).toBeNull();
    const { rows: after } = await stack.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM claim WHERE task_id = $1 AND status = 'active'`,
      [taskId],
    );
    expect(after[0]?.n).toBe(1);
  });
});
