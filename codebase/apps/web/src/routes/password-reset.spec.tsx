// 비밀번호를 잊었을 때 (2026-09-25 — 사람 결정 D10 · UI/UX 검토 SET-13 · REQ-WEB-231)
//
// 내 계정의 [비밀번호 바꾸기]는 지금 비밀번호를 아는 사람의 문이었다. 로그인 화면에는 잊은 사람의 길이 없었다 —
// 같은 주소로 다시 가입할 수도 없는 사람은 누군가에게 DB 를 고쳐 달라고 해야 했다.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NERV_ERROR } from '@nerv/schema';
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

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

let sent: Sent[] = [];
/** 인증 스택이 돌려줄 것 — 경로 끝으로 고른다 */
let replies: Record<string, { status: number; json: unknown }>;

beforeEach(() => {
  localStorage.clear();
  sent = [];
  replies = {
    '/request-password-reset': { status: 200, json: { status: true, message: 'If this email…' } },
    '/reset-password': { status: 200, json: { status: true } },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      const auth = /\/api\/auth(\/[a-z/-]+)$/.exec(u);
      if (auth !== null) {
        sent.push({
          url: u,
          headers: (init?.headers ?? {}) as Record<string, string>,
          body: JSON.parse(String(init?.body ?? '{}')) as never,
        });
        const reply = replies[auth[1]!] ?? { status: 404, json: {} };
        return { ok: reply.status < 400, status: reply.status, json: async () => reply.json };
      }
      // 로그인하지 않은 사람이다 — 셸 밖 화면은 이것을 보고 로그인으로 되돌려 보내지 않아야 한다
      return {
        ok: false,
        status: 401,
        json: async () => ({ code: NERV_ERROR.UNAUTHENTICATED, message: 'unauthenticated' }),
      };
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

describe('로그인에서 가는 길', () => {
  it('비밀번호 칸 아래의 [비밀번호를 잊었을 때] — 친 이메일을 들고 가되 주소에는 싣지 않는다', async () => {
    const router = mount('/login');
    fireEvent.change(await screen.findByLabelText('이메일'), {
      target: { value: 'jimin@example.com' },
    });
    fireEvent.click(screen.getByTestId('forgot-link'));
    const email = (await screen.findByTestId('forgot-email')) as HTMLInputElement;
    expect(email.value).toBe('jimin@example.com');
    // 주소는 경로뿐이다 — `?email=` 이면 방문 기록·접근 로그에 남는다
    expect(router.state.location.href).toBe('/forgot-password');
  });
});

describe('로그인 한도를 넘으면 우리 말로 — api.md §1.8 (2026-09-25 E2E 실측)', () => {
  it('인증 스택의 영어 문구가 아니라 카탈로그의 문장이다', async () => {
    replies['/sign-in/email'] = {
      status: 429,
      json: { message: 'Too many requests. Please try again later.' },
    };
    mount('/login');
    fireEvent.change(await screen.findByLabelText('이메일'), {
      target: { value: 'jimin@example.com' },
    });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'some-password' } });
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));
    expect((await screen.findByTestId('login-error')).textContent).toContain(
      '시도가 너무 잦습니다',
    );
  });
});

describe('/forgot-password', () => {
  it('보내면 계정이 있든 없든 같은 안내 — 폼을 치우고 링크의 수명을 말한다', async () => {
    mount('/forgot-password');
    fireEvent.change(await screen.findByTestId('forgot-email'), {
      target: { value: '  jimin@example.com ' },
    });
    fireEvent.click(screen.getByTestId('forgot-submit'));
    const panel = await screen.findByTestId('forgot-sent');
    expect(panel.textContent).toContain('jimin@example.com 로 가입한 계정이 있으면');
    expect(panel.textContent).toContain('60분');
    expect(screen.queryByTestId('forgot-email')).toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toMatch(/\/api\/auth\/request-password-reset$/);
    expect(sent[0]!.body).toEqual({ email: 'jimin@example.com' });
  });

  it('요청은 화면의 언어를 싣는다 — 메일이 그 말로 온다', async () => {
    mount('/forgot-password', 'en');
    fireEvent.change(await screen.findByTestId('forgot-email'), {
      target: { value: 'jimin@example.com' },
    });
    fireEvent.click(screen.getByTestId('forgot-submit'));
    await screen.findByTestId('forgot-sent');
    expect(sent[0]!.headers['accept-language']).toMatch(/^en/);
  });

  it('메일을 보내지 않는 서버면 기다리게 하지 않는다 — 운영자에게', async () => {
    replies['/request-password-reset'] = {
      status: 400,
      json: { code: 'RESET_PASSWORD_DISABLED', message: "Reset password isn't enabled" },
    };
    mount('/forgot-password');
    fireEvent.change(await screen.findByTestId('forgot-email'), {
      target: { value: 'jimin@example.com' },
    });
    fireEvent.click(screen.getByTestId('forgot-submit'));
    expect((await screen.findByTestId('forgot-disabled')).textContent).toContain(
      '서버 운영자에게 문의해 주세요',
    );
  });

  it('한도에 걸리면 폼 안에서 말한다', async () => {
    replies['/request-password-reset'] = { status: 429, json: {} };
    mount('/forgot-password');
    fireEvent.change(await screen.findByTestId('forgot-email'), {
      target: { value: 'jimin@example.com' },
    });
    fireEvent.click(screen.getByTestId('forgot-submit'));
    expect((await screen.findByTestId('forgot-error')).textContent).toContain(
      '시도가 너무 잦습니다',
    );
    expect(screen.getByTestId('forgot-email')).toBeDefined();
  });
});

describe('/reset-password', () => {
  const fill = (next: string, confirm: string): void => {
    fireEvent.change(screen.getByTestId('reset-new'), { target: { value: next } });
    fireEvent.change(screen.getByTestId('reset-confirm'), { target: { value: confirm } });
  };

  it('링크의 토큰으로 새 비밀번호를 정하고, 로그인으로 보낸다', async () => {
    mount('/reset-password?token=tok_1');
    await screen.findByTestId('reset-form');
    const submit = screen.getByTestId('reset-submit') as HTMLButtonElement;
    fill('short', 'short');
    expect(submit.disabled).toBe(true);
    fill('new-password', 'new-passwort');
    expect(screen.getByText('새 비밀번호 두 칸이 다릅니다.')).toBeDefined();
    expect(submit.disabled).toBe(true);
    fill('new-password', 'new-password');
    fireEvent.click(submit);
    const done = await screen.findByTestId('reset-done');
    expect(done.textContent).toContain('모든 기기의 로그인을 끊었습니다');
    expect(screen.getByTestId('reset-to-login').getAttribute('href')).toBe('/login');
    expect(sent[0]!.body).toEqual({ token: 'tok_1', newPassword: 'new-password' });
  });

  it('만료된 링크로 왔으면 폼 없이 새 링크로 — 비밀번호를 두 번 치기 전에 안다', async () => {
    mount('/reset-password?error=INVALID_TOKEN');
    const panel = await screen.findByTestId('reset-invalid');
    expect(panel.textContent).toContain('60분');
    expect(screen.queryByTestId('reset-form')).toBeNull();
    expect(screen.getByTestId('reset-request-again').getAttribute('href')).toBe('/forgot-password');
  });

  it('토큰 없이 오면 같다', async () => {
    mount('/reset-password');
    expect(await screen.findByTestId('reset-invalid')).toBeDefined();
  });

  it('그 사이 링크가 닳았으면(만료·이미 씀) 폼을 치우고 새 링크로', async () => {
    replies['/reset-password'] = {
      status: 400,
      json: { code: 'INVALID_TOKEN', message: 'Invalid token' },
    };
    mount('/reset-password?token=used');
    await screen.findByTestId('reset-form');
    fill('new-password', 'new-password');
    fireEvent.click(screen.getByTestId('reset-submit'));
    expect(await screen.findByTestId('reset-invalid')).toBeDefined();
    expect(screen.queryByTestId('reset-form')).toBeNull();
  });
});

describe('셸 밖 화면이다', () => {
  it.each(['/forgot-password', '/reset-password?token=t'])(
    '%s — 로그인하지 않았어도 로그인으로 되돌려 보내지 않고, 셸을 두르지 않는다',
    async (path) => {
      const router = mount(path);
      await screen.findByTestId('locale-switch');
      // /me 가 401 로 돌아온 뒤에도 그 자리다
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      await waitFor(() => expect(router.state.location.pathname).toBe(path.split('?')[0]));
      expect(screen.queryByTestId('nav-rail')).toBeNull();
    },
  );
});
