// 막다른 길 — REQ-WEB-207·208 · REQ-API-179 (2026-09-24 · UI/UX 검토 P06b)
//
// 스펙이 없는 프로젝트의 "첫 스펙 만들기" 는 만드는 문이 없는 목록으로 되돌아왔다. 토큰 발급 폼의 기본
// 권한에는 `agent-session:launch` 가 없어 그대로 발급하면 에이전트가 붙지 않았고, 원문 카드의 한 줄은
// 셸에 없는 이름을 불렀다. 세션 카드는 기다리는 질문도 회수된 작업도 말하지 않았고, 빈 상태 열여덟 중
// 열다섯은 다음 걸음이 없었다 — 받은 요청의 처리됨 탭은 비면 "기다리는 항목이 없습니다" 라고 적었다.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_RECOMMENDED_SCOPES } from '@nerv/schema';
import { LocaleProvider } from '../lib/i18n.js';
import { RealtimeProvider } from '../lib/realtime.js';
import { routeTree } from '../routeTree.gen';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

type Row = Record<string, unknown>;

const session = (over: Row): Row => ({
  id: 's-1',
  user_id: 'u-1',
  user_name: '지민',
  hostname: 'mac-01',
  agent_type: 'claude-code',
  state: 'active',
  branch: null,
  diff_added: 0,
  diff_removed: 0,
  last_heartbeat_at: '2026-09-24T00:00:00Z',
  started_at: '2026-09-24T00:00:00Z',
  task_id: null,
  task_key: null,
  task_title: null,
  claim_id: null,
  lease_remaining_seconds: null,
  scope_spec_ids: [],
  scope_file_globs: [],
  ...over,
});

let roles: string[];
let tokens: Row[];
let sessions: Row[];
let decided: Row[];
let posted: { url: string; body: Row }[];

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('nerv.last-org', 'default');
  roles = ['planner'];
  tokens = [];
  sessions = [];
  decided = [];
  posted = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url).replace(/^.*\/api\/v1/, '');
      if ((init?.method ?? 'GET') !== 'GET') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Row;
        posted.push({ url: u, body });
        if (u === '/me/tokens') {
          return ok({
            tokenId: 'tok-1',
            token: 'nerv_pat_abc',
            name: 'x',
            scopes: body['scopes'],
            expires_at: null,
            project: { slug: 'clemvion', name: 'Clemvion' },
          });
        }
        return ok({ ok: true });
      }
      if (u === '/me') {
        return ok({
          id: 'u-1',
          display_name: '지민',
          email: 'jimin@example.com',
          memberships: [
            { org_slug: 'default', org_name: 'Default', project_slug: 'clemvion', roles },
          ],
        });
      }
      if (/^\/orgs\/[^/]+\/projects/.test(u)) {
        return ok([{ id: 'p1', slug: 'clemvion', name: 'Clemvion' }]);
      }
      if (u.includes('/specs/tree')) return ok([]);
      if (u === '/me/tokens') return ok(tokens);
      if (/^\/projects\/clemvion\/sessions/.test(u)) {
        return ok({ items: sessions, next_cursor: null, summary: {} });
      }
      if (u.startsWith('/approvals?')) {
        const items = u.includes('state=decided') ? decided : [];
        return ok({ items, next_cursor: null, total: items.length });
      }
      return ok({ id: 'p1', items: [], next_cursor: null, total: 0, count: 0, summary: {} });
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

describe('스펙이 없는 프로젝트 — 시작하는 길을 말한다', () => {
  it('목록은 터미널 명령·에이전트 연결·임포터를 준다 — 같은 목록으로 되돌아가지 않는다', async () => {
    renderAt('/p/clemvion/specs');
    const card = await screen.findByTestId('spec-start');
    expect(within(card).getByTestId('spec-start-command').textContent).toBe(
      'claude "/nerv:spec new"',
    );
    expect(within(card).getByTestId('connect-agent')).toBeTruthy();
    expect(within(card).getByTestId('spec-start-import').getAttribute('href')).toBe('/help/agents');
  });

  it('스펙 상세의 트리 열은 한 줄로 목록의 시작 카드로 보낸다', async () => {
    // 트리는 스펙 상세에서만 서는 둘째 열이다(2026-09-25 · REQ-WEB-226) — 없는 문서의 주소로 들어와도 선다
    renderAt('/p/clemvion/specs/SPC-GONE-001');
    const link = await screen.findByTestId('spec-tree-start');
    expect(link.getAttribute('href')).toBe('/p/clemvion/specs');
  });

  it('초안을 쓸 수 없는 역할에게는 명령 대신 누가 쓰는지를 말한다', async () => {
    roles = ['viewer'];
    renderAt('/p/clemvion/specs');
    expect(await screen.findByTestId('spec-start-ask')).toBeTruthy();
    expect(screen.queryByTestId('spec-start-command')).toBeNull();
  });
});

/** 발급 단추는 프로젝트 목록이 온 뒤에 켜진다 — 켜진 것을 누른다 */
async function issue(): Promise<void> {
  const button = (await screen.findByTestId('token-issue')) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
}

describe('토큰 — 기본은 권장 묶음, 발급 뒤에는 연결 3단계', () => {
  it('그대로 발급하면 권장 묶음이 나간다 — agent-session:launch 가 들어 있다', async () => {
    renderAt('/settings/tokens');
    await issue();
    await waitFor(() => expect(posted.some((p) => p.url === '/me/tokens')).toBe(true));
    const sent = posted.find((p) => p.url === '/me/tokens')?.body['scopes'];
    expect(sent).toEqual([...AGENT_RECOMMENDED_SCOPES]);
  });

  it('원문 카드는 토큰 · 플러그인 설치 · 설치 캐시 경로의 nerv-init 을 차례로 준다', async () => {
    renderAt('/settings/tokens');
    await issue();
    const card = await screen.findByTestId('issued-token');
    const plugin = within(card)
      .getAllByTestId('issued-plugin')
      .map((c) => c.textContent);
    expect(plugin.at(-1)).toBe('/plugin install nerv@nerv');
    const command = within(card).getByTestId('issued-command').textContent ?? '';
    // 맨 이름 nerv-init 은 셸 PATH 에 없다 — 설치 캐시에서 고른다(plugin.md §3.7)
    expect(
      command.startsWith('"$(ls -d "$HOME"/.claude/plugins/cache/*/nerv/*/bin/nerv-init'),
    ).toBe(true);
    expect(command).toContain('--project clemvion');
    expect(command).toContain('--token nerv_pat_abc');
    expect(within(card).getByTestId('issued-install-chapter').getAttribute('href')).toBe(
      '/help/install',
    );
  });

  it('그 토큰이 처음 쓰이면 "연결됨 · 기계" 로 바뀐다', async () => {
    tokens = [
      {
        id: 'tok-1',
        name: 'x',
        revoked_at: null,
        expires_at: null,
        last_used_at: '2026-09-24T01:00:00Z',
        last_used_hostname: 'mac-01',
        scopes: [],
        project_slug: 'clemvion',
      },
    ];
    renderAt('/settings/tokens');
    await issue();
    const status = await screen.findByTestId('issued-connection');
    await waitFor(() => expect(status.dataset['connected']).toBe('true'));
    expect(status.textContent).toContain('mac-01');
  });
});

describe('세션 카드 — 기다리는 것과 한 일', () => {
  it('입력을 기다리면 무엇을 기다리는지와 그 카드로 가는 링크를 준다', async () => {
    sessions = [
      session({
        state: 'awaiting_input',
        waiting_question_id: 'q-1',
        waiting_question_title: '어느 쪽으로?',
      }),
    ];
    renderAt('/p/clemvion/sessions');
    const line = await screen.findByTestId('session-waiting');
    expect(line.textContent).toContain('어느 쪽으로?');
    expect(within(line).getByTestId('session-waiting-link').getAttribute('href')).toBe(
      '/inbox?focus=q-1',
    );
  });

  it('회수된 세션은 무엇이 회수됐는지 키로 말한다', async () => {
    sessions = [
      session({
        state: 'stale',
        last_task_key: 'CLV-T-AAA',
        last_task_title: '위젯',
        last_claim_status: 'expired',
      }),
    ];
    renderAt('/p/clemvion/sessions');
    expect((await screen.findByTestId('session-last-task')).textContent).toContain('회수됨');
    expect(screen.getByText(/CLV-T-AAA 의 클레임은 회수됐습니다/)).toBeTruthy();
  });

  it('세션이 하나도 없으면 에이전트를 붙이는 길을 준다', async () => {
    renderAt('/p/clemvion/sessions');
    expect(await screen.findAllByTestId('connect-agent')).not.toHaveLength(0);
  });
});

describe('빈 상태는 다음 걸음을 싣는다', () => {
  it('받은 요청의 처리됨 탭은 비면 그 탭의 말을 한다', async () => {
    renderAt('/inbox?state=decided');
    expect(await screen.findByText('처리한 항목이 없습니다')).toBeTruthy();
    expect(screen.queryByText('지금 당신을 기다리는 항목이 없습니다')).toBeNull();
  });

  it('대기가 비면 최근 처리 셋을 붙인다', async () => {
    decided = [1, 2, 3, 4].map((n) => ({
      id: `d-${n}`,
      subject_type: 'spec_version',
      spec_title: `문서 ${n}`,
      decision: 'approve',
    }));
    renderAt('/inbox');
    const recent = await screen.findByTestId('inbox-recent-decided');
    await waitFor(() => expect(within(recent).getAllByRole('listitem')).toHaveLength(3));
    expect(recent.textContent).toContain('문서 1');
  });
});
