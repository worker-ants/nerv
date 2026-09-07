// L3 시나리오 F — tools-only 완주 (backlog.md §5.6 · roadmap.md 0-8)
//
// **클레임까지만 태우고 있었다**(2026-09-07 실측). 시나리오 A~C 는 `nerv_bootstrap` 과
// `nerv_task_claim` 만 부르고, 웹 e2e 는 보드·세션·받은 요청을 열지 않는다 — 클레임 **이후**
// 의 계약(하트비트가 답을 되돌려 주는가 · done 게이트가 증적을 요구하는가 · SessionEnd 가
// 클레임을 회수하는가)은 L2 조각들만 보고 있었고, 그 조각들이 **한 세션 안에서 이어지는지**
// 는 아무도 보지 않았다. 로드맵 0-8("에이전트가 도구만으로 완주")의 판정 기록이 없던 이유다.
//
// 두 에이전트 종류를 각각 걷는다 — 계약이 `claude-code` 에만 맞아 있으면 그것은 계약이
// 아니라 한 클라이언트의 습관이다.
//
// 판정은 설문이 아니라 **이벤트 로그와 DB 상태**다(backlog.md §5 머리말).

import { NERV_EVENT } from '@nerv/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, countEvents, createTask, stackAvailable, startStack } from './harness.js';
import type { E2EStack } from './harness.js';

const AVAILABLE = stackAvailable();
let stack: E2EStack;

/** 도구만으로 걷는 세션의 주체 — 에이전트 권한 전부를 준다(사람 전용은 여전히 막힌다) */
const AGENT_SCOPES = [
  'agent-session:launch',
  'spec:read',
  'task:claim',
  'task:update',
  'review:submit',
];

beforeAll(async () => {
  if (!AVAILABLE) return;
  stack = await startStack('nerv_e2e_f');
});

afterAll(async () => {
  if (stack !== undefined) await stack.close();
});

async function stateOf(sessionId: string): Promise<string> {
  const { rows } = await stack.pool.query<{ state: string }>(
    `SELECT state::text AS state FROM agent_session WHERE id = $1`,
    [sessionId],
  );
  return rows[0]?.state ?? '';
}

describe.skipIf(!AVAILABLE)('시나리오 F — 도구만으로 완주한다 (로드맵 0-8)', () => {
  it.each([
    ['claude-code', 'mac-07', 'hana'],
    ['codex', 'linux-ci-01', 'dohyun'],
  ])('%s 세션이 부트스트랩→클레임→질문→리뷰→완료→종료를 걷는다', async (agent, host, who) => {
    const token = await stack.tokenFor(who, AGENT_SCOPES);
    const taskId = await createTask(stack, `CLV-T-F${host.slice(-2).toUpperCase()}`);
    // 훅이 세션을 찾는 키다 — bootstrap 이 심지 않으면 SessionEnd 가 조용히 버려진다
    const external = `ext-${host}`;

    // ① 부트스트랩 — 세션 신원이 없으면 클레임 자체가 성립하지 않는다(D-08)
    const boot = await callTool(stack, token, 'nerv_bootstrap', {
      project: stack.projectSlug,
      agent_type: agent,
      hostname: host,
      cwd: `/work/${host}`,
      external_session_id: external,
    });
    expect(boot.error).toBeNull();
    const sessionId = String(boot.result['session_id']);
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);

    // ② 다음 할 일 — 목록이 아니라 **후보**다(무엇을 왜 고르는지가 응답에 있다)
    const next = await callTool(stack, token, 'nerv_task_next', { project: stack.projectSlug });
    expect(next.error).toBeNull();
    const candidates = next.result['candidates'] as { id: string }[];
    expect(candidates.some((c) => c.id === taskId)).toBe(true);

    // ③ 클레임
    const claim = await callTool(stack, token, 'nerv_task_claim', {
      task_id: taskId,
      session_id: sessionId,
      scope: { spec_ids: [], file_globs: [`apps/${host}/**`] },
      idempotency_key: `f-${taskId}`,
    });
    expect(claim.error).toBeNull();
    const claimId = String(claim.result['claim_id']);
    expect(claimId).not.toBe('');

    // ④ 하트비트 — 아직 받을 것이 없다. 빈 배열이지 없는 필드가 아니다
    const beat = await callTool(stack, token, 'nerv_task_heartbeat', { claim_id: claimId });
    expect(beat.error).toBeNull();
    expect(beat.result['pending']).toEqual([]);

    // ⑤ 질문 — blocking 이면 세션이 답을 기다리는 상태로 바뀐다(사람이 보드에서 그것을 본다)
    const asked = await callTool(stack, token, 'nerv_question_create', {
      question: '위젯 상태를 어디에 저장할까요?',
      options: ['localStorage', '서버'],
      urgency: 'blocking',
      session_id: sessionId,
      context: { task_id: taskId },
      idempotency_key: `f-q-${taskId}`,
    });
    const questionId = String(asked.result['question_id']);
    expect(await stateOf(sessionId)).toBe('awaiting_input');

    // ⑥ 사람이 답한다 — **PAT 로는 부를 수 없는 경로다**(D-08). 웹 절반을 서비스로 근사한다
    const { QuestionService } = await import('../../src/modules/approval/question.service.js');
    const jimin = stack.users['jimin'] ?? '';
    await stack.app.get(QuestionService).answer({
      projectId: stack.projectId,
      questionId,
      userId: jimin,
      actor: { userId: jimin, isAgent: false },
      answerKey: 'localStorage',
    });
    expect(await stateOf(sessionId)).toBe('active');

    // ⑦ 답은 **하트비트로 돌아온다** — 이 역채널이 없으면 에이전트는 영영 기다린다
    const woken = await callTool(stack, token, 'nerv_task_heartbeat', { claim_id: claimId });
    const pending = woken.result['pending'] as { kind: string }[];
    expect(pending.some((p) => p.kind === 'question_answered')).toBe(true);
    // **다음 하트비트에도 남아 있다**(1시간 창). 한 번 주고 지우면 그 사이 끊긴 세션은
    // 답을 영영 못 받는다 — 역채널은 배달 확인이 없으므로 되풀이가 안전한 쪽이다.
    const again = await callTool(stack, token, 'nerv_task_heartbeat', { claim_id: claimId });
    expect(
      (again.result['pending'] as { kind: string }[]).some((p) => p.kind === 'question_answered'),
    ).toBe(true);

    // ⑧ 리뷰 제출 — 활성 클레임이 있으면 그 Task 로 이어진다(REQ-API-148)
    const review = await callTool(stack, token, 'nerv_review_submit', {
      branch: `feat/${host}`,
      base_sha: 'b'.repeat(40),
      head_sha: 'c'.repeat(40),
      kind: 'code',
      task_id: taskId,
      reviewer: { role: 'developer', risk: 'low' },
      summary: '변경 없음',
      findings: [],
    });
    expect(review.error).toBeNull();

    // ⑨ 완료 — 증적과 스펙 영향 선언이 없으면 게이트가 막는다
    const done = await callTool(stack, token, 'nerv_task_update', {
      task_id: taskId,
      status: 'done',
      evidence: [{ kind: 'commit', locator: 'a'.repeat(40) }],
      spec_impact: { none: true },
    });
    expect(done.error).toBeNull();
    expect(done.result['status']).toBe('done');

    // ⑩ 세션 종료 — 훅이 external id 로 세션을 찾아 정리한다
    const ended = await fetch(`${stack.baseUrl}/ingest/hooks/session-end`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ session_id: external, reason: 'complete' }),
    });
    expect(ended.status).toBe(202);
    expect(await stateOf(sessionId)).toBe('complete');

    // 판정 — 로그가 그 여정을 그대로 담고 있는가
    expect(await countEvents(stack, NERV_EVENT.TASK_CLAIMED, taskId)).toBe(1);
    expect(await countEvents(stack, NERV_EVENT.QUESTION_CREATED, questionId)).toBe(1);
    expect(await countEvents(stack, NERV_EVENT.QUESTION_ANSWERED, questionId)).toBe(1);
    expect(await countEvents(stack, NERV_EVENT.TASK_DONE, taskId)).toBe(1);
    expect(await countEvents(stack, NERV_EVENT.SESSION_COMPLETE, sessionId)).toBe(1);

    // 끝난 세션이 클레임을 쥔 채로 남지 않는다 — 남으면 그 Task 는 리스 만료까지 잠긴다
    const { rows } = await stack.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM claim WHERE agent_session_id = $1 AND status = 'active'`,
      [sessionId],
    );
    expect(rows[0]?.n).toBe(0);
  });
});
