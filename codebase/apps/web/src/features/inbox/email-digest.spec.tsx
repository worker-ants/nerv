// 알림 메일 요약 — 내 계정의 칸 (2026-09-28 · 사람 결정 EM1~EM9 · REQ-WEB-269)
//
// 켤 때 브라우저의 시간대와 지금 화면 언어를 보내는지(EM5), 메일을 보내지 않는 서버에서는 잠기는지를 본다.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../lib/i18n.js';
import { RealtimeProvider } from '../../lib/realtime.js';
import { EmailDigestSection } from './email-digest.js';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function renderWith(setting: Record<string, unknown>): { puts: Record<string, unknown>[] } {
  const puts: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
    const path = String(url);
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      puts.push(body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ...setting,
          ...body,
          enabled: body['enabled'],
          timezone: body['timezone'] ?? setting['timezone'],
        }),
      };
    }
    const json = path.includes('/me/notifications/digest') ? setting : {};
    return { ok: true, status: 200, json: async () => json };
  });
  render(
    <LocaleProvider locale="ko">
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RealtimeProvider>
          <EmailDigestSection />
        </RealtimeProvider>
      </QueryClientProvider>
    </LocaleProvider>,
  );
  return { puts };
}

const OFF = {
  enabled: false,
  hour: 9,
  timezone: null,
  locale: null,
  last_sent_at: null,
  mail_enabled: true,
};

describe('메일 요약 칸 (REQ-WEB-269)', () => {
  it('메일을 보내지 않는 서버에서는 켜는 단추가 없고 까닭을 말한다', async () => {
    renderWith({ ...OFF, mail_enabled: false });
    await screen.findByTestId('digest-mail-off');
    expect(screen.queryByTestId('digest-enable')).toBeNull();
  });

  it('켜면 이 브라우저의 시간대와 지금 화면 언어를 보낸다 — 따로 입력하지 않는다', async () => {
    const { puts } = renderWith(OFF);
    fireEvent.click(await screen.findByTestId('digest-enable'));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ enabled: true, timezone: BROWSER_TZ, locale: 'ko' });
  });

  it('켠 뒤에는 시각 · 언어를 고치고, 브라우저의 시간대가 다르면 한 번에 맞춘다', async () => {
    const { puts } = renderWith({
      ...OFF,
      enabled: true,
      timezone: BROWSER_TZ === 'Pacific/Chatham' ? 'Asia/Seoul' : 'Pacific/Chatham',
      locale: 'ko',
    });
    fireEvent.change(await screen.findByTestId('digest-hour'), { target: { value: '7' } });
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ enabled: true, hour: 7 });

    fireEvent.click(screen.getByTestId('digest-use-browser'));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1]).toEqual({ enabled: true, timezone: BROWSER_TZ });
  });

  it('끄면 enabled: false 하나만 보낸다', async () => {
    const { puts } = renderWith({ ...OFF, enabled: true, timezone: BROWSER_TZ, locale: 'ko' });
    expect(screen.queryByTestId('digest-use-browser')).toBeNull();
    fireEvent.click(await screen.findByTestId('digest-disable'));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ enabled: false });
  });
});
