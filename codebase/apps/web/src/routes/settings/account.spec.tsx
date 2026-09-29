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
/** 로그인된 기기 — 서버가 돌려줄 세션 목록 */
let sessions: {
  id: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;
  last_active_at: string;
  current: boolean;
}[];

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
  const now = new Date().toISOString();
  sessions = [
    {
      id: 's-mac',
      user_agent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
      ip_address: '198.51.100.10',
      created_at: now,
      last_active_at: now,
      current: true,
    },
    {
      id: 's-phone',
      user_agent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1',
      ip_address: '203.0.113.20',
      created_at: now,
      last_active_at: now,
      current: false,
    },
    {
      id: 's-old',
      user_agent: null,
      ip_address: null,
      created_at: now,
      last_active_at: now,
      current: false,
    },
  ];
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
      if (u.includes('/me/sessions')) {
        if (method === 'GET')
          return { ok: true, status: 200, json: async () => ({ items: sessions }) };
        if (u.endsWith('/revoke-others')) {
          const n = sessions.filter((x) => !x.current).length;
          sessions = sessions.filter((x) => x.current);
          return { ok: true, status: 200, json: async () => ({ ok: true, revoked: n }) };
        }
        const id = u.split('/').pop();
        sessions = sessions.filter((x) => x.id !== id);
        return { ok: true, status: 200, json: async () => ({ ok: true, revoked: 1 }) };
      }
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
    expect(screen.getByText('로그인 아이디라서 바꿀 수 없습니다.')).toBeDefined();
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
    mount('/settings/account?tab=password');
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
    mount('/settings/account?tab=password');
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
    mount('/settings/account?tab=password');
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

// 내 계정의 탭과 로그인된 기기 (2026-09-28 · 사람 요청 · REQ-WEB-283 · 284)
describe('탭 — 한 화면에 이어 두지 않는다 (REQ-WEB-283)', () => {
  it('계정 탭이 기본이고 이름 · 이메일만 보인다 — 비밀번호 칸은 비밀번호 탭에 있다', async () => {
    mount('/settings/account');
    await screen.findByTestId('account-name');
    expect(screen.getByTestId('account-tab-account').getAttribute('aria-current')).toBe('page');
    expect(screen.queryByTestId('account-password-form')).toBeNull();
    expect(screen.queryByTestId('account-devices')).toBeNull();
  });

  it('주소의 탭으로 바로 연다 — 비밀번호 탭', async () => {
    mount('/settings/account?tab=password');
    await screen.findByTestId('account-password-form');
    expect(screen.getByTestId('account-tab-password').getAttribute('aria-current')).toBe('page');
    expect(screen.queryByTestId('account-name')).toBeNull();
  });
});

describe('로그인된 기기 (REQ-WEB-284)', () => {
  it('기기마다 브라우저 · 운영체제 · 주소를 보이고, 이 기기는 표시만 하고 끊는 단추가 없다', async () => {
    mount('/settings/account?tab=devices');
    const rows = await screen.findAllByTestId('account-device');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain('Chrome · macOS');
    expect(rows[0]?.textContent).toContain('이 기기');
    expect(within(rows[0]!).queryByTestId('account-device-revoke')).toBeNull();
    expect(rows[1]?.textContent).toContain('Safari · iOS');
    expect(rows[1]?.textContent).toContain('203.0.113.20');
    // 모르는 기기 · 모르는 주소도 빈칸이 아니라 말로 적는다
    expect(rows[2]?.textContent).toContain('알 수 없는 기기');
    expect(rows[2]?.textContent).toContain('주소 모름');
  });

  it('한 기기를 끊는 것은 한 번 묻고, 그 기기만 끊는다', async () => {
    mount('/settings/account?tab=devices');
    const rows = await screen.findAllByTestId('account-device');
    fireEvent.click(within(rows[1]!).getByTestId('account-device-revoke'));
    expect(sent).toHaveLength(0);
    fireEvent.click(screen.getByTestId('account-device-revoke-s-phone-confirm'));
    await waitFor(() => expect(sent.some((x) => x.method === 'DELETE')).toBe(true));
    expect(sent.find((x) => x.method === 'DELETE')?.url).toContain('/me/sessions/s-phone');
    await waitFor(() => expect(screen.getAllByTestId('account-device')).toHaveLength(2));
  });

  it('다른 기기 로그인 모두 끊기 — 몇 개인지 묻고, 이 기기만 남는다', async () => {
    mount('/settings/account?tab=devices');
    await screen.findAllByTestId('account-device');
    fireEvent.click(screen.getByTestId('account-devices-revoke-others'));
    expect(screen.getByTestId('account-devices-revoke-others-confirming').textContent).toContain(
      '2개 로그인',
    );
    fireEvent.click(screen.getByTestId('account-devices-revoke-others-confirm'));
    await waitFor(() =>
      expect(sent.some((x) => x.url.endsWith('/me/sessions/revoke-others'))).toBe(true),
    );
    await waitFor(() => expect(screen.getAllByTestId('account-device')).toHaveLength(1));
    expect(await screen.findByText('다른 기기의 로그인 2개를 끊었습니다.')).toBeDefined();
  });
});
