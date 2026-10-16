// 플러그인 활성화 현황 — REQ-WEB-189 (2026-09-24 · E12-S03)
//
// 배포하는 사람이 묻는 것은 하나 — 어느 기계가 아직 꺼져 있는가. 요약이 먼저이고,
// 펼치면 꺼진 기계가 위다(순서는 서버가 정한다 · EP-SES-06). 2026-10-16 부터 Codex 도 세고 펼친 목록을
// 에이전트 종류마다 묶는다 — 꺼짐의 까닭이 종류마다 다르다(사람 결정 B).

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

const host = (hostname: string, version: string | null, agent = 'claude-code') => ({
  user_id: `u-${hostname}`,
  user_name: '하나',
  hostname,
  agent_type: agent,
  last_seen_at: new Date().toISOString(),
  plugin_version: version,
  active: version !== null,
});

/** 서버처럼 종류별 수를 만든다 — 0 인 종류도 담는다 */
const coverage = (hosts: ReturnType<typeof host>[]) => ({
  window_days: 30,
  total: hosts.length,
  active: hosts.filter((h) => h.active).length,
  by_agent: ['claude-code', 'codex'].map((agent) => {
    const mine = hosts.filter((h) => h.agent_type === agent);
    return { agent_type: agent, total: mine.length, active: mine.filter((h) => h.active).length };
  }),
  hosts,
});

describe('플러그인 활성화 현황 (REQ-WEB-189)', () => {
  it('요약 한 줄이 먼저다 — 켜진 수 / 전체 수', async () => {
    body = coverage([host('mac-01', null), host('mac-02', '0.3.2')]);
    renderIt();
    expect((await screen.findByTestId('plugin-coverage')).textContent).toContain(
      '플러그인 켜짐 1 / 2대',
    );
    expect(screen.queryAllByTestId('plugin-host')).toHaveLength(0);
  });

  it('펼치면 기계마다 켜짐(버전)·꺼짐을 보이고, 꺼진 기계에서 무엇이 빠지는지 적는다', async () => {
    body = coverage([host('mac-01', null), host('mac-02', '0.3.2')]);
    renderIt();
    fireEvent.click(await screen.findByTestId('plugin-coverage-toggle'));
    const rows = screen.getAllByTestId('plugin-host');
    expect(within(rows[0]!).getByText('꺼짐')).toBeDefined();
    expect(within(rows[1]!).getByText('켜짐 · v0.3.2')).toBeDefined();
    expect(screen.getByText(/훅이 없어서 활동과 브랜치가/)).toBeDefined();
  });

  it('모두 켜져 있으면 빠지는 것을 적지 않는다', async () => {
    body = coverage([host('mac-02', '0.3.2')]);
    renderIt();
    fireEvent.click(await screen.findByTestId('plugin-coverage-toggle'));
    expect(screen.queryByText(/훅이 없으니/)).toBeNull();
  });

  it('기계가 없으면 없다고 말한다 — 빈 목록이 아니라 문장이다', async () => {
    body = coverage([]);
    renderIt();
    fireEvent.click(await screen.findByTestId('plugin-coverage-toggle'));
    expect(
      screen.getByText('최근 30일 동안 Claude Code나 Codex 세션을 연 머신이 없습니다.'),
    ).toBeDefined();
    expect(screen.queryAllByTestId('plugin-agent')).toHaveLength(0);
  });

  it('펼치면 에이전트 종류마다 수와 기계를 묶고 그 종류의 꺼짐 까닭을 적는다 — 줄이 없는 종류는 그리지 않는다', async () => {
    body = coverage([
      host('linux-02', null, 'codex'),
      host('mac-01', '0.3.33'),
      host('linux-01', '0.3.33', 'codex'),
    ]);
    renderIt();
    expect((await screen.findByTestId('plugin-coverage')).textContent).toContain(
      '플러그인 켜짐 2 / 3대',
    );
    fireEvent.click(screen.getByTestId('plugin-coverage-toggle'));
    const groups = screen.getAllByTestId('plugin-agent');
    expect(groups.map((g) => g.getAttribute('data-agent'))).toEqual(['claude-code', 'codex']);
    expect(groups[0]!.textContent).toContain('Claude Code · 켜짐 1 / 1대');
    expect(within(groups[0]!).getAllByTestId('plugin-host')).toHaveLength(1);
    // 다 켜진 종류에는 까닭을 적지 않는다
    expect(within(groups[0]!).queryByText(/훅이 없어서/)).toBeNull();
    expect(groups[1]!.textContent).toContain('Codex · 켜짐 1 / 2대');
    expect(within(groups[1]!).getAllByTestId('plugin-host')).toHaveLength(2);
    expect(within(groups[1]!).getByText(/\/hooks에서 신뢰 처리하지 않았습니다/)).toBeDefined();

    // Codex 만 있으면 Claude Code 묶음은 없다
    cleanup();
    body = coverage([host('linux-01', '0.3.33', 'codex')]);
    renderIt();
    fireEvent.click(await screen.findByTestId('plugin-coverage-toggle'));
    expect(screen.getAllByTestId('plugin-agent').map((g) => g.getAttribute('data-agent'))).toEqual([
      'codex',
    ]);
  });
});
