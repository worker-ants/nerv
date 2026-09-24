// 플러그인 활성화 현황 — REQ-WEB-189 (2026-09-24 · E12-S03)
//
// 배포하는 사람이 묻는 것은 하나 — 어느 기계가 아직 꺼져 있는가. 요약이 먼저 서고,
// 펼치면 꺼진 기계가 위다(순서는 서버가 정한다 · EP-SES-06).

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../lib/i18n.js';
import { asProjectId } from '../../lib/query-keys.js';
import { PluginCoverage } from './plugin-coverage.js';

let body: unknown;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => body })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderIt(): void {
  render(
    <LocaleProvider locale="ko">
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <PluginCoverage projectSlug="clemvion" projectId={asProjectId('p-1')} />
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

const host = (hostname: string, version: string | null) => ({
  user_id: `u-${hostname}`,
  user_name: '하나',
  hostname,
  last_seen_at: new Date().toISOString(),
  plugin_version: version,
  active: version !== null,
});

describe('플러그인 활성화 현황 (REQ-WEB-189)', () => {
  it('요약 한 줄이 먼저다 — 켜진 수 / 전체 수', async () => {
    body = {
      window_days: 30,
      total: 2,
      active: 1,
      hosts: [host('mac-01', null), host('mac-02', '0.3.2')],
    };
    renderIt();
    expect((await screen.findByTestId('plugin-coverage')).textContent).toContain(
      '플러그인 켜짐 1 / 2 호스트',
    );
    expect(screen.queryAllByTestId('plugin-host')).toHaveLength(0);
  });

  it('펼치면 기계마다 켜짐(버전)·꺼짐을 보이고, 꺼진 기계에서 무엇이 빠지는지 적는다', async () => {
    body = {
      window_days: 30,
      total: 2,
      active: 1,
      hosts: [host('mac-01', null), host('mac-02', '0.3.2')],
    };
    renderIt();
    fireEvent.click(await screen.findByTestId('plugin-coverage-toggle'));
    const rows = screen.getAllByTestId('plugin-host');
    expect(within(rows[0]!).getByText('꺼짐')).toBeDefined();
    expect(within(rows[1]!).getByText('켜짐 · v0.3.2')).toBeDefined();
    expect(screen.getByText(/훅이 없으니 활동·브랜치가/)).toBeDefined();
  });

  it('모두 켜져 있으면 빠지는 것을 적지 않는다', async () => {
    body = { window_days: 30, total: 1, active: 1, hosts: [host('mac-02', '0.3.2')] };
    renderIt();
    fireEvent.click(await screen.findByTestId('plugin-coverage-toggle'));
    expect(screen.queryByText(/훅이 없으니/)).toBeNull();
  });

  it('기계가 없으면 없다고 말한다 — 빈 목록이 아니라 문장이다', async () => {
    body = { window_days: 30, total: 0, active: 0, hosts: [] };
    renderIt();
    fireEvent.click(await screen.findByTestId('plugin-coverage-toggle'));
    expect(screen.getByText('최근 30일 안에 Claude Code 세션을 연 기계가 없습니다.')).toBeDefined();
  });
});
