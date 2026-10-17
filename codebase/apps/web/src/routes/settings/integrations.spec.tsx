// S8 「연동」 탭 — 2026-10-17 · 사람 결정 D1 · D2 · D3 · E17-S03 · E16-S02 · REQ-WEB-333 ~ 335
//
// Slack 채널은 admin 이 사람으로만 잇고(서버가 판정한다 — REQ-API-355) 화면은 웹훅의 끝 네 글자만 본다. CI 레시피는 누구나
// 받아 간다 — 그 프로젝트의 값으로 채운 YAML 이다.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { NERV_EVENT } from '@nerv/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../lib/i18n.js';
import { RealtimeProvider } from '../../lib/realtime.js';
import { routeTree } from '../../routeTree.gen';
import { recipeKinds } from './integrations.js';
import type { SlackStatus } from './integrations.js';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

const membership = (roles: string[]): unknown => ({
  id: 'u-1',
  display_name: '관리자',
  memberships: [
    { org_slug: 'default', org_name: 'Default', project_slug: null, project_name: null, roles },
  ],
});

let me: unknown = membership(['admin']);
let slack: SlackStatus;
let gatePolicy: Record<string, unknown> = {};
let sent: { method: string; url: string; body: Record<string, unknown> }[] = [];

const disconnected = (): SlackStatus => ({
  enabled: true,
  webhook_prefix: 'https://hooks.slack.com/services/',
  connection: null,
  last_delivery: null,
  pending: 0,
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('nerv.last-org', 'default');
  localStorage.setItem('nerv.last-project.default', 'sudoku');
  sent = [];
  me = membership(['admin']);
  slack = disconnected();
  gatePolicy = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const path = String(url);
      const method = init?.method ?? 'GET';
      if (method !== 'GET') {
        sent.push({
          method,
          url: path,
          body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
        });
        return { ok: true, status: 200, json: async () => ({ slack }) };
      }
      const json = /\/orgs\/[^/]+\/projects/.test(path)
        ? [{ id: 'p-2', slug: 'sudoku', name: '스도쿠' }]
        : /\/projects\/sudoku\/integrations$/.test(path)
          ? { slack }
          : /\/projects\/sudoku$/.test(path)
            ? { id: 'p-2', slug: 'sudoku', name: '스도쿠', gate_policy: gatePolicy }
            : path.endsWith('/me')
              ? me
              : path.endsWith('/members')
                ? []
                : { items: [], memberships: [], count: 0, summary: {} };
      return { ok: true, status: 200, json: async () => json };
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderTab(): void {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/settings/integrations?project=sudoku'] }),
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

describe('Slack 채널 (REQ-WEB-333 · 334)', () => {
  it('연결 전에는 주소를 가린 칸으로 받고 [연결]이 그 주소만 보낸다', async () => {
    renderTab();
    expect((await screen.findByTestId('integrations-slack-state')).textContent).toContain(
      '연결되지 않았습니다',
    );
    const input = (await screen.findByTestId('integrations-webhook')) as HTMLInputElement;
    expect(input.type).toBe('password');
    const connect = (await screen.findByTestId('integrations-connect')) as HTMLButtonElement;
    expect(connect.disabled).toBe(true);
    fireEvent.change(input, { target: { value: ' https://hooks.slack.com/services/T0/B0/abcd ' } });
    expect(connect.disabled).toBe(false);
    fireEvent.click(connect);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      method: 'PUT',
      body: { webhook_url: 'https://hooks.slack.com/services/T0/B0/abcd' },
    });
    expect(sent[0]?.url).toContain('/projects/sudoku/integrations/slack');
  });

  it('연결돼 있으면 끝 네 글자 · 마지막 실패의 이유를 보이고 시험 · 끊기를 둔다', async () => {
    slack = {
      ...disconnected(),
      connection: { hint: 'abcd', connected_at: new Date().toISOString(), connected_by: '민서' },
      last_delivery: {
        event_type: NERV_EVENT.APPROVAL_REQUESTED,
        state: 'failed',
        at: new Date().toISOString(),
        error: 'HTTP 404 no_service',
      },
      pending: 2,
    };
    renderTab();
    const state = await screen.findByTestId('integrations-slack-state');
    expect(state.textContent).toContain('…abcd');
    expect(state.textContent).toContain('민서');
    const last = await screen.findByTestId('integrations-slack-last');
    expect(last.textContent).toContain('HTTP 404 no_service');
    expect(last.textContent).toContain('보낼 글 2건');
    fireEvent.click(await screen.findByTestId('integrations-test'));
    await waitFor(() => expect(sent.map((s) => s.method)).toEqual(['POST']));
    expect(await screen.findByTestId('integrations-disconnect')).toBeTruthy();
  });

  it('키가 없는 서버면 연결 칸 대신 운영자에게 부탁할 일을 말한다', async () => {
    slack = { ...disconnected(), enabled: false };
    renderTab();
    expect((await screen.findByTestId('integrations-slack-disabled')).textContent).toContain(
      'NERV_ENCRYPTION_KEY',
    );
    expect(screen.queryByTestId('integrations-webhook')).toBeNull();
  });

  it('admin 이 아니면 바꾸는 단추를 그리지 않는다', async () => {
    me = membership(['planner']);
    renderTab();
    await screen.findByTestId('integrations-slack-state');
    expect(screen.queryByTestId('integrations-webhook')).toBeNull();
    expect(screen.queryByTestId('integrations-connect')).toBeNull();
  });
});

describe('CI 게이트 레시피 (REQ-WEB-335)', () => {
  it('그 프로젝트의 값으로 채운 YAML 을 보인다', async () => {
    renderTab();
    const recipe = await screen.findByTestId('integrations-recipe');
    expect(recipe.textContent).toContain("NERV_PROJECT: 'sudoku'");
    expect(recipe.textContent).toContain("NERV_ORG: 'default'");
    expect(recipe.textContent).toContain("NERV_GATE_KINDS: 'code'");
    expect(recipe.textContent).toContain('name: nerv-gate');
  });

  it('done 게이트가 종류를 고르고 있으면 그 종류를 묻는다', () => {
    expect(recipeKinds({ done_gate: { review_coverage: ['code', 'consistency'] } })).toBe(
      'code,consistency',
    );
    expect(recipeKinds({ done_gate: { review_coverage: true } })).toBeUndefined();
    expect(recipeKinds(undefined)).toBeUndefined();
  });
});
