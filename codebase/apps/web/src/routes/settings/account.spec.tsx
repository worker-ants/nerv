// 내 계정 — 이름·비밀번호 · 로그인 전 언어 (2026-09-25 — 사람 결정 D10 · UI/UX 검토 SET-13 · REQ-WEB-229 · 230)
//
// 가입할 때 적은 이름을 고칠 길이 없었고, 비밀번호를 바꾸는 화면이 없었다. 로그인·가입·초대 화면에는 언어를
// 바꿀 자리가 없어 브라우저 언어가 다르게 잡힌 사람은 로그인하기 전까지 읽을 수 없는 화면을 봤다.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../lib/i18n.js';
import { RealtimeProvider } from '../../lib/realtime.js';
import { routeTree } from '../../routeTree.gen';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

interface Sent {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

let sent: Sent[] = [];
let me: Record<string, unknown>;
/** 비밀번호 바꾸기에 서버가 돌려줄 것 */
let passwordReply: { status: number; json: unknown };

beforeEach(() => {
  localStorage.clear();
  sent = [];
  me = {
    id: 'u-1',
    email: 'jimin@example.com',
    display_name: '지민',
    memberships: [{ org_slug: 'nerv', org_name: 'NERV', project_slug: null, roles: ['developer'] }],
  };
  passwordReply = { status: 200, json: { token: 't', user: {} } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      if (method !== 'GET')
        sent.push({ url: u, method, body: JSON.parse(String(init?.body ?? '{}')) as never });
      if (u.includes('/api/auth/change-password'))
        return {
          ok: passwordReply.status < 400,
          status: passwordReply.status,
          json: async () => passwordReply.json,
        };
      if (u.endsWith('/me') && method === 'PATCH') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { display_name: string };
        me = { ...me, display_name: body.display_name };
        return { ok: true, status: 200, json: async () => me };
      }
      const json = u.endsWith('/me')
        ? me
        : /\/orgs\/[^/]+\/projects/.test(u)
          ? []
          : { items: [], summary: {}, next_cursor: null, memberships: [], count: 0 };
      return { ok: true, status: 200, json: async () => json };
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function mount(path: string, locale: 'ko' | 'en' = 'ko') {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <LocaleProvider locale={locale}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RealtimeProvider>
          <RouterProvider router={router as never} />
        </RealtimeProvider>
      </QueryClientProvider>
    </LocaleProvider>,
  );
  return router;
}

describe('표시 이름 (REQ-WEB-229)', () => {
  it('지금 이름으로 서고, 바꾸기 전에는 [저장]이 꺼져 있다', async () => {
    mount('/settings/account');
    const input = (await screen.findByTestId('account-name')) as HTMLInputElement;
    expect(input.value).toBe('지민');
    expect((screen.getByTestId('account-name-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: '   ' } });
    expect((screen.getByTestId('account-name-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('앞뒤 공백을 잘라 보내고, 셸의 이름이 곧바로 바뀐다', async () => {
    mount('/settings/account');
    const input = await screen.findByTestId('account-name');
    fireEvent.change(input, { target: { value: '  김지민 ' } });
    fireEvent.click(screen.getByTestId('account-name-save'));
    await waitFor(() => expect(sent.some((s) => s.method === 'PATCH')).toBe(true));
    expect(sent.find((s) => s.method === 'PATCH')).toMatchObject({
      body: { display_name: '김지민' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('user-menu').getAttribute('aria-label')).toBe('김지민'),
    );
    expect(await screen.findByText('이름을 바꿨습니다.')).toBeDefined();
  });

  it('이메일은 보이기만 한다 — 로그인 아이디다', async () => {
    mount('/settings/account');
    expect((await screen.findByTestId('account-email')).textContent).toBe('jimin@example.com');
    expect(screen.getByText('로그인 아이디라 여기서 바꾸지 않습니다.')).toBeDefined();
  });
});

describe('비밀번호 바꾸기 (REQ-WEB-229)', () => {
  const fill = (current: string, next: string, confirm: string): void => {
    fireEvent.change(screen.getByTestId('account-password-current'), {
      target: { value: current },
    });
    fireEvent.change(screen.getByTestId('account-password-new'), { target: { value: next } });
    fireEvent.change(screen.getByTestId('account-password-confirm'), {
      target: { value: confirm },
    });
  };

  it('두 칸이 다르면 보내기 전에 말하고, 짧으면 단추가 꺼져 있다', async () => {
    mount('/settings/account');
    await screen.findByTestId('account-password-form');
    fill('old-password', 'new-password', 'new-passwort');
    expect(screen.getByTestId('account-password-mismatch')).toBeDefined();
    expect((screen.getByTestId('account-password-submit') as HTMLButtonElement).disabled).toBe(
      true,
    );
    fill('old-password', 'short', 'short');
    expect((screen.getByTestId('account-password-submit') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('다른 기기의 로그인을 끊는 것이 기본이고, 바꾸면 칸을 비운다', async () => {
    mount('/settings/account');
    await screen.findByTestId('account-password-form');
    expect((screen.getByTestId('account-revoke-others') as HTMLInputElement).checked).toBe(true);
    fill('old-password', 'new-password', 'new-password');
    fireEvent.click(screen.getByTestId('account-password-submit'));
    await waitFor(() => expect(sent.some((s) => s.url.includes('/change-password'))).toBe(true));
    expect(sent.find((s) => s.url.includes('/change-password'))?.body).toEqual({
      currentPassword: 'old-password',
      newPassword: 'new-password',
      revokeOtherSessions: true,
    });
    expect(
      await screen.findByText('비밀번호를 바꾸고 다른 기기의 로그인을 끊었습니다.'),
    ).toBeDefined();
    expect((screen.getByTestId('account-password-current') as HTMLInputElement).value).toBe('');
  });

  it('지금 비밀번호가 틀리면 그 칸의 일이라고 말한다 — 전역 알림이 아니다', async () => {
    passwordReply = {
      status: 400,
      json: { code: 'INVALID_PASSWORD', message: 'Invalid password' },
    };
    mount('/settings/account');
    await screen.findByTestId('account-password-form');
    fill('wrong-password', 'new-password', 'new-password');
    fireEvent.click(screen.getByTestId('account-password-submit'));
    expect((await screen.findByTestId('account-password-error')).textContent).toContain(
      '지금 비밀번호가 맞지 않습니다.',
    );
  });
});

describe('어디서 가나', () => {
  it('사용자 메뉴의 [내 계정] — 이름 바로 아래다', async () => {
    mount('/inbox');
    fireEvent.click(await screen.findByTestId('user-menu'));
    const link = await screen.findByTestId('user-menu-account');
    expect(link.getAttribute('href')).toBe('/settings/account');
  });

  it('설정의 「나」 무리 맨 앞이다', async () => {
    mount('/settings/account');
    const nav = await within(await screen.findByTestId('nav-rail')).findByTestId('settings-nav');
    expect(within(nav).getByTestId('settings-nav-account').getAttribute('aria-current')).toBe(
      'page',
    );
  });
});

describe('로그인 전에도 언어를 바꾼다 (REQ-WEB-230)', () => {
  it.each(['/login', '/signup'])(
    '%s 에 언어 단추가 있고, 누르면 그 화면이 바뀐다',
    async (path) => {
      mount(path, 'en');
      const switcher = await screen.findByTestId('locale-switch');
      expect(within(switcher).getByTestId('locale-en').getAttribute('aria-pressed')).toBe('true');
      fireEvent.click(within(switcher).getByTestId('locale-ko'));
      await waitFor(() =>
        expect(within(switcher).getByTestId('locale-ko').getAttribute('aria-pressed')).toBe('true'),
      );
      expect(document.documentElement.lang).toBe('ko');
    },
  );
});
