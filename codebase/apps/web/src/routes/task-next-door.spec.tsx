// 작업이 다음 상태로 가는 문 — REQ-WEB-202 · 203 (2026-09-24 · UI/UX 검토 P04)
//
// 웹에서 4요소를 다 채워 만든 작업이 backlog 를 나갈 문이 없었고, 막힘을 풀 단추도, 클레임한
// 작업을 진행·검토로 옮길 단추도 없었다. 완료 폼은 "스펙 영향 없음" 이 미리 체크돼 선언하지
// 않아도 통과했다. 위임 명세는 읽기 전용이었고, 단추는 역할을 보지 않아 폼을 다 채운 뒤에야
// 403 을 알았다. 상태는 화면마다 코드값(`in_progress`)과 라벨("진행 중")로 갈렸다.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ko } from '@nerv/schema';
import { LocaleProvider } from '../lib/i18n.js';
import { RealtimeProvider } from '../lib/realtime.js';
import { routeTree } from '../routeTree.gen';

/** 못 쓰는 단추인가 — 사유가 있으면 포커스가 남는 잠금(`aria-disabled`)이다(REQ-WEB-235) */
const isLocked = (b: Element | null | undefined): boolean =>
  b != null && ((b as HTMLButtonElement).disabled || b.getAttribute('aria-disabled') === 'true');
/** 잠긴 단추의 사유 — hover·포커스의 말풍선과 aria-describedby 가 같은 값을 읽는다 */
const reasonOf = (b: Element | null | undefined): string | null =>
  b?.getAttribute('data-reason') ?? null;

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

const ME = '01a00000-0000-7000-8000-00000000me01';
const LATER = '2099-01-01T00:00:00Z';
let roles: string[] = ['developer'];
let detail: Record<string, unknown> = {};
let lanes: Record<string, Record<string, unknown>[]> = {};
let posted: { method: string; url: string; body: Record<string, unknown> }[] = [];
/** 쓰기의 응답 — 검사마다 갈아 끼운다 */
let reply: Record<string, unknown> = { status: 'ready' };
/** 프로젝트의 게이트 정책 — 리뷰 면제가 읽는다 */
let gatePolicy: Record<string, unknown> = {};

function task(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'task-1',
    key: 'CLV-T-AAAAAA',
    title: '다음 문',
    status: 'backlog',
    priority: 'P2',
    goal_md: '목표',
    output_format_md: 'PR 1건',
    tools_sources_md: 'nerv_spec_get',
    boundaries_md: '경계',
    claims: [],
    evidence: [],
    reviews: [],
    dependencies: [],
    ...over,
  };
}

beforeEach(() => {
  roles = ['developer'];
  detail = task();
  lanes = {};
  posted = [];
  reply = { status: 'ready' };
  gatePolicy = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      if (method !== 'GET') {
        posted.push({ method, url: u, body: JSON.parse(String(init?.body ?? '{}')) });
        return { ok: true, status: 200, json: async () => reply };
      }
      if (/\/me(\?|$)/.test(u)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: ME,
            email: 'me@example.com',
            display_name: '나',
            memberships: [
              { org_slug: 'default', org_name: 'NERV', project_slug: 'clemvion', roles },
            ],
          }),
        };
      }
      if (u.includes('/tasks?')) {
        const status = new URL(u, 'http://x').searchParams.get('status') ?? '';
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: lanes[status] ?? [], next_cursor: null }),
        };
      }
      if (u.includes('/baselines')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { id: 'b1', name: 'R1', item_count: 3 },
              { id: 'b2', name: 'R2', item_count: 4 },
            ],
            total: 2,
          }),
        };
      }
      if (u.includes('/tasks/')) return { ok: true, status: 200, json: async () => detail };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'p1',
          slug: 'clemvion',
          items: [],
          memberships: [],
          gate_policy: gatePolicy,
        }),
      };
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderAt(path: string): void {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <LocaleProvider locale="ko">
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RealtimeProvider>
          <RouterProvider router={router as never} />
        </RealtimeProvider>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

async function renderDetail(): Promise<void> {
  renderAt('/p/clemvion/tasks/CLV-T-AAAAAA');
  await screen.findByText(String(detail['title']));
  // 역할은 내 멤버십이 와야 정해진다 — 그 전의 단추는 잠겨 있는 것이 맞다
  await waitFor(() => expect(screen.getByTestId('next-actions')).toBeDefined());
}

const transitions = (): unknown[] =>
  posted.filter((p) => p.url.endsWith('/transition')).map((p) => p.body['status']);

describe('작업 상세 — 상태가 머리의 단추를 정한다 (REQ-WEB-202)', () => {
  it('4요소가 찬 backlog는 [준비됨으로 올리기]로 큐에 올린다 — 완료 폼은 펼치지 않는다', async () => {
    await renderDetail();
    expect(screen.queryByTestId('done-gate')).toBeNull();
    const toReady = await screen.findByTestId('next-to_ready');
    await waitFor(() => expect((toReady as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(toReady);
    await waitFor(() => expect(transitions()).toEqual(['ready']));
  });

  it('풀린 막힘은 [막힘 풀기]로 푼다 — 배지만 서고 누를 곳이 없던 자리', async () => {
    detail = task({
      status: 'blocked',
      blocked_reason: 'dependency',
      blocked_resolution: { reason: 'dependency', satisfied: true, pending: [] },
    });
    await renderDetail();
    const unblock = screen.getByTestId('next-unblock');
    await waitFor(() => expect((unblock as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(unblock);
    await waitFor(() => expect(transitions()).toEqual(['ready']));
  });

  it('내가 잡은 작업은 [진행 시작]으로 옮긴다 — claimed에서 멈추지 않는다', async () => {
    detail = task({
      status: 'claimed',
      claims: [{ id: 'c-1', status: 'active', user_id: ME, lease_expires_at: LATER }],
    });
    await renderDetail();
    fireEvent.click(screen.getByTestId('next-start'));
    await waitFor(() => expect(transitions()).toEqual(['in_progress']));
  });

  it('backlog에서는 [클레임]이 서지 않는다 — 누르면 not_ready로 거절되던 단추', async () => {
    await renderDetail();
    expect(screen.queryByTestId('claim-task')).toBeNull();
  });

  it('viewer에게 [클레임]은 잠기고, 누가 할 수 있는지 말한다', async () => {
    roles = ['viewer'];
    detail = task({ status: 'ready' });
    await renderDetail();
    const claim = screen.getByTestId('claim-task') as HTMLButtonElement;
    expect(isLocked(claim)).toBe(true);
    expect(reasonOf(claim)).toMatch(/^이 조작은 .*developer.*만 할 수 있습니다$/);
  });
});

describe('완료 게이트 — 스펙 영향은 고르지 않은 채 시작한다 (REQ-WEB-202)', () => {
  it('고르기 전에는 완료가 잠기고, "있음"이면 메모가 있어야 한다', async () => {
    roles = ['planner'];
    detail = task({ status: 'in_progress' });
    await renderDetail();
    const done = screen.getByTestId('to-done') as HTMLButtonElement;
    expect(isLocked(done)).toBe(true);
    expect(reasonOf(done)).toBe(ko['task.spec_impact_choose']);
    fireEvent.click(screen.getByTestId('spec-impact-some'));
    expect(isLocked(done)).toBe(true);
    fireEvent.change(screen.getByTestId('spec-impact-note'), {
      target: { value: 'SPC-A의 경계 절' },
    });
    expect(done.disabled).toBe(false);
    // 붙은 증적이 없다는 것은 누르기 전에 말한다
    expect(screen.getByTestId('evidence-none-yet')).toBeDefined();
  });
});

/**
 * **증적 설명은 따로 적는다**(2026-09-28 · 사람 결정 · REQ-WEB-264 · api.md REQ-API-229). 위치 칸은 가리키는 것만
 * 받는다 — 커밋 해시 뒤에 설명을 붙이면 형식 오류였다.
 */
describe('증적 설명 (REQ-WEB-264)', () => {
  it('완료 폼의 설명 칸이 증적과 함께 간다 — 비워 두면 보내지 않는다', async () => {
    roles = ['planner'];
    detail = task({ status: 'in_progress' });
    await renderDetail();
    fireEvent.click(screen.getByTestId('spec-impact-none'));
    fireEvent.change(screen.getByPlaceholderText(ko['task.evidence_placeholder']), {
      target: { value: 'a1b2c3d' },
    });
    const note = screen.getByTestId('evidence-note-input') as HTMLInputElement;
    expect(note.maxLength).toBe(500);
    fireEvent.change(note, { target: { value: '  로그인 오류 수정  ' } });
    fireEvent.click(screen.getByTestId('to-done'));
    await waitFor(() => expect(posted.some((p) => p.body['status'] === 'done')).toBe(true));
    const sent = posted.find((p) => p.body['status'] === 'done');
    expect(sent?.body['evidence']).toEqual([
      { kind: 'pr', locator: 'a1b2c3d', note: '로그인 오류 수정' },
    ]);
  });
});

describe('위임 명세는 그 자리에서 고친다 (REQ-WEB-202)', () => {
  it('임포트 자리표시자는 ❌ 로 그리고 [고치기]가 폼을 연다', async () => {
    detail = task({ status: 'backlog', goal_md: ko['import.delegation_missing'] });
    await renderDetail();
    expect(screen.getByTestId('brief-missing').textContent).toContain('원본에 없음');
    // 4요소가 비었으니 주 행동은 채우기다
    fireEvent.click(screen.getByTestId('next-fill_brief'));
    expect(await screen.findByTestId('delegation-form')).toBeDefined();
  });

  it('designer에게 [고치기]는 잠긴다 — 폼을 다 채운 뒤 403을 받지 않게 (REQ-WEB-203)', async () => {
    roles = ['designer'];
    await renderDetail();
    const edit = screen.getByTestId('brief-edit') as HTMLButtonElement;
    expect(isLocked(edit)).toBe(true);
    expect(reasonOf(edit)).toBe('이 조작은 planner · developer · admin만 할 수 있습니다');
  });
});

describe('코드값이 아니라 사람 말 (REQ-WEB-202)', () => {
  it('의존 상태·클레임 상태·리뷰 종류가 라벨로 보인다', async () => {
    detail = task({
      status: 'in_progress',
      dependencies: [{ key: 'CLV-T-BBBBBB', status: 'in_progress' }],
      claims: [{ id: 'c-0', status: 'released', user_id: ME, lease_expires_at: LATER }],
      reviews: [
        { id: 'r-1', branch: 'feat/x', kind: 'spec_coverage', round_no: 1, state: 'complete' },
      ],
    });
    await renderDetail();
    const body = document.body.textContent ?? '';
    expect(body).toContain('진행 중');
    expect(body).toContain('해제됨');
    expect(body).toContain('스펙 커버리지');
    expect(body).not.toContain('in_progress');
    expect(body).not.toContain('spec_coverage');
  });
});

describe('작업 보드 — 문과 역할 (REQ-WEB-202 · 203)', () => {
  it('4요소가 찬 backlog 카드에 [준비됨으로 올리기]가 선다 — 누르면 서버가 판정한다', async () => {
    lanes = { backlog: [{ ...task(), delegation_complete: true }] };
    renderAt('/p/clemvion/tasks');
    const up = await screen.findByTestId('card-to-ready');
    await waitFor(() => expect((up as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(up);
    await waitFor(() => expect(transitions()).toEqual(['ready']));
    expect(posted[0]?.url).toMatch(/\/tasks\/task-1\/transition$/);
  });

  it('빈 카드에는 [채우기]만 — 절대 눌리지 않던 "ready 전이"는 없다', async () => {
    lanes = { backlog: [{ ...task(), delegation_complete: false }] };
    renderAt('/p/clemvion/tasks');
    const card = (await screen.findByTestId('ready-blocked')).closest('article') as HTMLElement;
    expect(within(card).getByTestId('card-fill')).toBeDefined();
    expect(within(card).queryByText('ready 전이')).toBeNull();
  });

  it('designer에게 [+ 새 작업]은 잠기고 qa에게 [채우기]는 잠긴다 — 서버 가드와 같은 목록', async () => {
    roles = ['designer'];
    renderAt('/p/clemvion/tasks');
    const create = (await screen.findByTestId('task-new')) as HTMLButtonElement;
    await waitFor(() => expect(reasonOf(create)).not.toBeNull());
    expect(isLocked(create)).toBe(true);
    cleanup();

    roles = ['qa'];
    lanes = { backlog: [{ ...task(), delegation_complete: false }] };
    renderAt('/p/clemvion/tasks');
    const fill = (await screen.findByTestId('card-fill')) as HTMLButtonElement;
    await waitFor(() => expect(fill.disabled).toBe(true));
    // qa 는 작업을 만들 수는 있다(발견을 올린다) — 위임 명세는 쓰지 않는다
    expect(isLocked(screen.getByTestId('task-new'))).toBe(false);
  });
});

/**
 * **비어 있던 칸은 빈 칸으로 연다**(REQ-WEB-202 · 2026-09-24 사람 결정 — 안 C).
 *
 * 임포트 자리표시자를 값으로 채워 폼을 열던 동안, 한 칸을 빠뜨려도 저장이 통과했고(서버는 그 칸을
 * 빈 것으로 봐 backlog 에 남는데 사람은 다 채웠다고 믿었다), 자리표시자를 조금만 고쳐도 찬 칸으로
 * 세어져 뜻 없는 지시문으로 ready 에 오를 수 있었다.
 */
describe('수정 폼 — 비어 있던 칸 (REQ-WEB-202 · 안 C)', () => {
  const PLACEHOLDER = ko['import.delegation_missing'];
  const imported = (): Record<string, unknown> =>
    task({
      goal_md: PLACEHOLDER,
      output_format_md: PLACEHOLDER,
      tools_sources_md: PLACEHOLDER,
      boundaries_md: PLACEHOLDER,
    });
  const patches = (): Record<string, unknown>[] =>
    posted.filter((p) => p.method === 'PATCH').map((p) => p.body);
  const save = (): void => {
    const form = screen.getByTestId('delegation-form');
    fireEvent.click(within(form).getByRole('button', { name: ko['common.save'] }));
  };

  it('자리표시자는 값이 아니라 빈 칸과 안내로 열린다', async () => {
    detail = imported();
    await renderDetail();
    fireEvent.click(screen.getByTestId('next-fill_brief'));
    await screen.findByTestId('delegation-form');
    for (const field of ['goal_md', 'output_format_md', 'tools_sources_md', 'boundaries_md']) {
      const input = screen.getByTestId(`brief-${field}`) as HTMLInputElement;
      await waitFor(() => expect(input.placeholder).toBe(ko['task.brief.placeholder']));
      expect(input.value).toBe('');
    }
  });

  it('한 칸만 채우면 그 칸만 보내고, 아직 비어 있는 칸을 이름으로 말한다', async () => {
    detail = imported();
    reply = { status: 'backlog', delegation_complete: false };
    await renderDetail();
    fireEvent.click(screen.getByTestId('next-fill_brief'));
    const goal = (await screen.findByTestId('brief-goal_md')) as HTMLTextAreaElement;
    await waitFor(() => expect(goal.placeholder).not.toBe(''));
    fireEvent.change(goal, { target: { value: '로그인 화면의 오류 문구를 고친다' } });
    save();
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]).toMatchObject({ goal_md: '로그인 화면의 오류 문구를 고친다' });
    // 비워 둔 칸은 보내지 않는다 — 서버는 오지 않은 칸을 그대로 둔다(자리표시자로 남는다)
    expect(patches()[0]).not.toHaveProperty('output_format_md');
    expect(patches()[0]).not.toHaveProperty('boundaries_md');
    expect(
      await screen.findByText(/아직 비어 있는 칸: ② 산출물 형식 · ③ 도구·출처 · ④ 경계/),
    ).toBeDefined();
  });

  it('제목만 고칠 수 있다 — 네 칸을 채우라고 막지 않는다', async () => {
    detail = imported();
    reply = { status: 'backlog', delegation_complete: false };
    await renderDetail();
    fireEvent.click(screen.getByTestId('next-fill_brief'));
    const form = await screen.findByTestId('delegation-form');
    const title = within(form).getAllByRole('textbox')[0] as HTMLInputElement;
    await waitFor(() => expect(title.value).toBe('다음 문'));
    fireEvent.change(title, { target: { value: '다음 문 — 이름만 고침' } });
    save();
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]).toMatchObject({ title: '다음 문 — 이름만 고침' });
    expect(Object.keys(patches()[0] ?? {}).filter((k) => k.endsWith('_md'))).toEqual([]);
  });

  it('원래 내용이 있던 칸은 비울 수 없다', async () => {
    await renderDetail();
    fireEvent.click(screen.getByTestId('brief-edit'));
    const goal = (await screen.findByTestId('brief-goal_md')) as HTMLTextAreaElement;
    await waitFor(() => expect(goal.value).toBe('목표'));
    fireEvent.change(goal, { target: { value: '' } });
    save();
    expect(await screen.findByText(ko['task.form.err.goal'])).toBeDefined();
    expect(patches()).toHaveLength(0);
  });
});

/**
 * **기준선 작업은 재브리핑 대신 기준선을 바꾼다**(2026-09-27 사람 결정 M9 · REQ-WEB-252). 재브리핑은
 * 기준 버전만 최신 승인본으로 옮겨, 대상 문서는 지금 것이고 주변 문서는 옛 세트가 됐다.
 */
describe('기준선 작업 — 세트째 옮긴다 (REQ-WEB-252)', () => {
  it('근거 칸에 기준선이 보이고, 편집할 수 있으면 다른 기준선으로 옮긴다', async () => {
    roles = ['planner'];
    detail = task({ baseline: 'R1', spec_key: 'SPC-A', basis_version_no: 1 });
    await renderDetail();
    expect(screen.getByTestId('task-baseline').textContent).toBe('R1');
    const select = (await screen.findByTestId('task-baseline-move')) as HTMLSelectElement;
    await waitFor(() => expect(select.textContent).toContain('R2'));
    fireEvent.change(select, { target: { value: 'R2' } });
    await waitFor(() =>
      expect(posted).toContainEqual(
        expect.objectContaining({ method: 'PATCH', body: { baseline: 'R2' } }),
      ),
    );
  });

  it('기준선 풀기는 null 을 보낸다 — 그다음부터는 재브리핑을 받는다', async () => {
    roles = ['planner'];
    detail = task({ baseline: 'R1' });
    await renderDetail();
    fireEvent.change(await screen.findByTestId('task-baseline-move'), { target: { value: '' } });
    await waitFor(() =>
      expect(posted).toContainEqual(
        expect.objectContaining({ method: 'PATCH', body: { baseline: null } }),
      ),
    );
  });

  it('재브리핑 표시가 남은 기준선 작업은 [기준 갱신] 대신 기준선을 바꾸라고 알린다', async () => {
    roles = ['planner'];
    detail = task({ baseline: 'R1', rebrief_required_at: '2026-09-27T00:00:00Z' });
    await renderDetail();
    expect(screen.getByTestId('rebrief-required')).toBeTruthy();
    expect(screen.queryByTestId('rebrief')).toBeNull();
    expect(screen.getByTestId('rebrief-use-baseline').textContent).toBe(
      ko['task.basis.rebrief_use_baseline'],
    );
  });

  it('기준선이 없는 작업은 "없음" 이고 바꾸는 선택기가 없다', async () => {
    roles = ['planner'];
    await renderDetail();
    expect(screen.getByTestId('task-baseline').textContent).toBe(ko['common.none']);
    expect(screen.queryByTestId('task-baseline-move')).toBeNull();
  });
});

/**
 * 리뷰 면제 (2026-10-09 · REQ-WEB-299 · clemvion CLE-T-2NVZA4). 코드를 내지 않은 작업은 code 리뷰를 받을 길이 없는데
 * 면제는 API 에만 있어 화면에서 닫지 못했다. 역할마다 면제할 수 있는 종류가 다르고(spec-workflow §1.6), 코드를 낸
 * 작업의 코드 리뷰는 면제하지 못한다.
 */
describe('리뷰 면제 (REQ-WEB-299)', () => {
  const requireKinds = (): void => {
    gatePolicy = { done_gate: { review_coverage: ['code', 'consistency'] } };
  };

  it('developer 는 code 만 고를 수 있고, 사유와 함께 그 작업에 면제를 기록한다', async () => {
    requireKinds();
    detail = task({
      status: 'in_progress',
      evidence: [{ id: 'e1', kind: 'review', locator: 'r1' }],
    });
    reply = { approval_id: 'a1', task_key: 'CLV-T-AAAAAA', kinds: ['code'] };
    renderAt('/p/clemvion/tasks/CLV-T-AAAAAA');
    fireEvent.click(await screen.findByTestId('review-waiver-open'));
    expect(screen.getByTestId('review-waiver-kind-code')).toBeTruthy();
    expect(screen.queryByTestId('review-waiver-kind-consistency')).toBeNull();
    // 고르기 전 · 사유 전에는 기록하지 않는다
    expect(isLocked(screen.getByTestId('review-waiver-submit'))).toBe(true);
    fireEvent.click(screen.getByTestId('review-waiver-kind-code'));
    fireEvent.change(screen.getByTestId('review-waiver-reason'), {
      target: { value: '코드 변경 없이 승인된 스펙을 다시 검토했다' },
    });
    fireEvent.click(screen.getByTestId('review-waiver-submit'));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      method: 'POST',
      body: {
        subject_id: 'task-1',
        kinds: ['code'],
        reason: '코드 변경 없이 승인된 스펙을 다시 검토했다',
      },
    });
    expect(posted[0]?.url).toContain('/projects/clemvion/gates/bypass');
  });

  it('planner 는 consistency 만, 면제할 수 있는 종류가 없는 역할은 안내만 본다', async () => {
    requireKinds();
    roles = ['planner'];
    detail = task({ status: 'in_progress' });
    renderAt('/p/clemvion/tasks/CLV-T-AAAAAA');
    fireEvent.click(await screen.findByTestId('review-waiver-open'));
    expect(screen.getByTestId('review-waiver-kind-consistency')).toBeTruthy();
    expect(screen.queryByTestId('review-waiver-kind-code')).toBeNull();
    cleanup();
    roles = ['qa'];
    renderAt('/p/clemvion/tasks/CLV-T-AAAAAA');
    expect((await screen.findByTestId('review-waiver-no-role')).textContent).toBe(
      ko['task.waiver.no_role'],
    );
  });

  it('코드 증적이 붙은 작업은 code 를 고르지 못하고 그 까닭을 말한다', async () => {
    requireKinds();
    detail = task({
      status: 'in_progress',
      evidence: [{ id: 'e1', kind: 'commit', locator: 'a1b2c3d' }],
    });
    renderAt('/p/clemvion/tasks/CLV-T-AAAAAA');
    fireEvent.click(await screen.findByTestId('review-waiver-open'));
    expect((screen.getByTestId('review-waiver-kind-code') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId('review-waiver-code').textContent).toBe(
      ko['task.waiver.code_evidence'],
    );
  });

  it('면제 기록은 리뷰 목록 아래에 누가 · 왜와 함께 남고, 이미 면제한 종류는 다시 고르지 않는다', async () => {
    requireKinds();
    detail = task({
      status: 'in_progress',
      review_waivers: [
        {
          id: 'w1',
          kinds: ['code'],
          reason: '코드 산출물 없음',
          at: '2026-10-09T01:00:00Z',
          by_name: '지민',
          void_kinds: [],
        },
      ],
    });
    renderAt('/p/clemvion/tasks/CLV-T-AAAAAA');
    const line = await screen.findByTestId('review-waiver');
    expect(line.textContent).toContain('지민');
    expect(line.textContent).toContain('코드 산출물 없음');
    // developer 가 면제할 수 있는 code 는 이미 면제됐다 — 남은 consistency 는 developer 의 몫이 아니다
    expect(await screen.findByTestId('review-waiver-no-role')).toBeTruthy();
  });

  it('범위 없는 면제가 이미 있으면 더 고를 종류가 없다', async () => {
    requireKinds();
    detail = task({
      status: 'in_progress',
      review_waivers: [
        {
          id: 'w0',
          kinds: null,
          reason: '릴리스 임박',
          at: '2026-10-09T01:00:00Z',
          by_name: '지민',
          void_kinds: [],
        },
      ],
    });
    renderAt('/p/clemvion/tasks/CLV-T-AAAAAA');
    expect((await screen.findByTestId('review-waiver')).textContent).toContain(
      ko['task.waiver.all'],
    );
    expect(screen.queryByTestId('review-waiver-form')).toBeNull();
    expect(screen.queryByTestId('review-waiver-no-role')).toBeNull();
  });

  it('완료 조건이 종류 목록이 아니면 면제 입력을 그리지 않는다', async () => {
    detail = task({ status: 'in_progress' });
    renderAt('/p/clemvion/tasks/CLV-T-AAAAAA');
    await screen.findByTestId('done-gate');
    expect(screen.queryByTestId('review-waiver-form')).toBeNull();
    expect(screen.queryByTestId('review-waiver-no-role')).toBeNull();
  });
});

describe('작업 보관 (REQ-WEB-301 · 302)', () => {
  it('보관한 작업은 다음 행동 없이 사유 · 대신할 작업 · [복원]을 보인다', async () => {
    detail = task({
      status: 'ready',
      archived_at: '2026-10-10T01:00:00Z',
      archive_reason: 'duplicate',
      superseded_by: 'CLV-T-BBBBBB',
      archived_by_name: '도현',
    });
    renderAt('/p/clemvion/tasks/CLV-T-AAAAAA');
    const notice = await screen.findByTestId('task-archived');
    expect(notice.textContent).toContain(ko['task.archive.reason.duplicate']);
    expect(notice.textContent).toContain('도현');
    expect(screen.getByTestId('task-archived-replacement').textContent).toBe('CLV-T-BBBBBB');
    // 잡거나 옮길 단추가 없다 — 보관도 두 번 하지 않는다
    expect(screen.queryByTestId('claim-task')).toBeNull();
    expect(screen.queryByTestId('task-archive-open')).toBeNull();
    fireEvent.click(screen.getByTestId('task-restore'));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.url).toContain('/projects/clemvion/tasks/CLV-T-AAAAAA/restore');
  });

  it('[보관]은 사유마다 필요한 칸을 받고 그 작업의 보관 경로로 보낸다', async () => {
    detail = task({ status: 'backlog' });
    renderAt('/p/clemvion/tasks/CLV-T-AAAAAA');
    fireEvent.click(await screen.findByTestId('task-archive-open'));
    // 중복이 기본이고 대신할 작업이 있어야 보낸다
    expect(isLocked(screen.getByTestId('task-archive-submit'))).toBe(true);
    fireEvent.change(screen.getByTestId('task-archive-replacement'), {
      target: { value: 'CLV-T-BBBBBB' },
    });
    // 필요 없어짐은 대신할 작업 대신 이유 한 줄이다
    fireEvent.click(screen.getByTestId('task-archive-reason-obsolete'));
    expect(screen.queryByTestId('task-archive-replacement')).toBeNull();
    expect(isLocked(screen.getByTestId('task-archive-submit'))).toBe(true);
    fireEvent.click(screen.getByTestId('task-archive-reason-duplicate'));
    fireEvent.click(screen.getByTestId('task-archive-submit'));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      method: 'POST',
      body: { reason: 'duplicate', superseded_by: 'CLV-T-BBBBBB' },
    });
    expect(posted[0]?.url).toContain('/projects/clemvion/tasks/CLV-T-AAAAAA/archive');
  });

  it('남이 쥔 작업 · 역할이 없는 사람에게는 [보관]이 잠긴다', async () => {
    detail = task({
      status: 'in_progress',
      claims: [
        {
          id: 'c1',
          status: 'active',
          user_id: 'someone-else',
          agent_session_id: 's1',
          lease_expires_at: '2099-01-01T00:00:00Z',
        },
      ],
    });
    renderAt('/p/clemvion/tasks/CLV-T-AAAAAA');
    expect(isLocked(await screen.findByTestId('task-archive-open'))).toBe(true);
    cleanup();
    roles = ['qa'];
    detail = task({ status: 'backlog' });
    renderAt('/p/clemvion/tasks/CLV-T-AAAAAA');
    expect(isLocked(await screen.findByTestId('task-archive-open'))).toBe(true);
  });

  it('보드의 「보관 보기」는 보관함 칸을 따로 연다', async () => {
    lanes[''] = [
      {
        id: 't9',
        key: 'CLV-T-OLD999',
        title: '옛 중복',
        status: 'backlog',
        archived_at: '2026-10-10T01:00:00Z',
        archive_reason: 'duplicate',
        superseded_by: 'CLV-T-NEW999',
      },
    ];
    renderAt('/p/clemvion/tasks?archived_tasks=1');
    const lane = await screen.findByTestId('column-archived');
    expect(await within(lane).findByText('옛 중복')).toBeDefined();
    expect(lane.textContent).toContain('CLV-T-NEW999');
    expect(screen.getByTestId('filter-archived').textContent).toBe(ko['tasks.filter.archived']);
  });
});
