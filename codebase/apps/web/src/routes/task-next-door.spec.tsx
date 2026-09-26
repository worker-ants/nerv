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
      if (u.includes('/tasks/')) return { ok: true, status: 200, json: async () => detail };
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'p1', slug: 'clemvion', items: [], memberships: [] }),
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
  it('4요소가 찬 backlog 는 [준비됨으로 올리기]로 큐에 올린다 — 완료 폼은 펼치지 않는다', async () => {
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

  it('내가 잡은 작업은 [진행 시작]으로 옮긴다 — claimed 에서 멈추지 않는다', async () => {
    detail = task({
      status: 'claimed',
      claims: [{ id: 'c-1', status: 'active', user_id: ME, lease_expires_at: LATER }],
    });
    await renderDetail();
    fireEvent.click(screen.getByTestId('next-start'));
    await waitFor(() => expect(transitions()).toEqual(['in_progress']));
  });

  it('backlog 에서는 [클레임]이 서지 않는다 — 누르면 not_ready 로 거절되던 단추', async () => {
    await renderDetail();
    expect(screen.queryByTestId('claim-task')).toBeNull();
  });

  it('viewer 에게 [클레임]은 잠기고, 누가 할 수 있는지 말한다', async () => {
    roles = ['viewer'];
    detail = task({ status: 'ready' });
    await renderDetail();
    const claim = screen.getByTestId('claim-task') as HTMLButtonElement;
    expect(isLocked(claim)).toBe(true);
    expect(reasonOf(claim)).toMatch(/^이 조작은 .*developer.* 만 할 수 있습니다$/);
  });
});

describe('완료 게이트 — 스펙 영향은 고르지 않은 채 시작한다 (REQ-WEB-202)', () => {
  it('고르기 전에는 완료가 잠기고, "있음" 이면 메모가 있어야 한다', async () => {
    roles = ['planner'];
    detail = task({ status: 'in_progress' });
    await renderDetail();
    const done = screen.getByTestId('to-done') as HTMLButtonElement;
    expect(isLocked(done)).toBe(true);
    expect(reasonOf(done)).toBe(ko['task.spec_impact_choose']);
    fireEvent.click(screen.getByTestId('spec-impact-some'));
    expect(isLocked(done)).toBe(true);
    fireEvent.change(screen.getByTestId('spec-impact-note'), {
      target: { value: 'SPC-A 의 경계 절' },
    });
    expect(done.disabled).toBe(false);
    // 붙은 증적이 없다는 것은 누르기 전에 말한다
    expect(screen.getByTestId('evidence-none-yet')).toBeDefined();
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

  it('designer 에게 [고치기]는 잠긴다 — 폼을 다 채운 뒤 403 을 받지 않게 (REQ-WEB-203)', async () => {
    roles = ['designer'];
    await renderDetail();
    const edit = screen.getByTestId('brief-edit') as HTMLButtonElement;
    expect(isLocked(edit)).toBe(true);
    expect(reasonOf(edit)).toBe('이 조작은 planner · developer · admin 만 할 수 있습니다');
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

  it('빈 카드에는 [채우기]만 — 절대 눌리지 않던 "ready 전이" 는 없다', async () => {
    lanes = { backlog: [{ ...task(), delegation_complete: false }] };
    renderAt('/p/clemvion/tasks');
    const card = (await screen.findByTestId('ready-blocked')).closest('article') as HTMLElement;
    expect(within(card).getByTestId('card-fill')).toBeDefined();
    expect(within(card).queryByText('ready 전이')).toBeNull();
  });

  it('designer 에게 [+ 새 작업]은 잠기고 qa 에게 [채우기]는 잠긴다 — 서버 가드와 같은 목록', async () => {
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
