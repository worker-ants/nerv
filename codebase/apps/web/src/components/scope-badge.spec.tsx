// 범위 표기 — REQ-WEB-192 (2026-09-24 조직·프로젝트 경계 점검)
//
// 여러 조직에 걸친 목록이 줄마다 범위를 말하지 않았고, 말하더라도 slug 였다. 규칙 셋:
// 이름을 그린다 · 조직은 가를 필요가 있을 때만 · 지금 조직이 아니면 강조한다.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider, useT } from '../lib/i18n.js';
import { ScopeBadge } from './scope-badge.js';
import type { ScopeBadgeProps } from './scope-badge.js';
import { invitationSentence } from './invitation-cards.js';

const ONE_ORG = [
  { org_slug: 'default', org_name: 'Default', project_slug: null, roles: ['admin'] },
];
const TWO_ORGS = [
  ...ONE_ORG,
  { org_slug: 'acme', org_name: 'Acme', project_slug: null, roles: ['viewer'] },
];
let memberships: unknown[] = ONE_ORG;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('nerv.last-org', 'default');
  memberships = ONE_ORG;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).endsWith('/me')
          ? { id: 'u-1', display_name: '지민', memberships }
          : [{ id: 'p-1', slug: 'clemvion', name: 'Clemvion' }],
    })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderBadge(props: ScopeBadgeProps): void {
  render(
    <LocaleProvider locale="ko">
      <QueryClientProvider client={new QueryClient()}>
        <ScopeBadge {...props} />
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

const badge = () => screen.getByTestId('scope-badge');

describe('ScopeBadge', () => {
  it('이름을 그린다 — slug 는 주소의 것이다', async () => {
    renderBadge({
      orgSlug: 'default',
      orgName: 'Default',
      projectSlug: 'clemvion',
      projectName: 'Clemvion',
    });
    await waitFor(() => expect(badge().textContent).toBe('Clemvion'));
  });

  it('조직이 하나뿐이면 조직을 붙이지 않는다 — 줄마다 같은 말은 잡음이다', async () => {
    renderBadge({
      orgSlug: 'default',
      orgName: 'Default',
      projectSlug: 'clemvion',
      projectName: 'Clemvion',
    });
    await waitFor(() => expect(badge().textContent).not.toContain('Default'));
  });

  it('조직이 둘 이상이면 "조직 / 프로젝트"', async () => {
    memberships = TWO_ORGS;
    renderBadge({
      orgSlug: 'default',
      orgName: 'Default',
      projectSlug: 'clemvion',
      projectName: 'Clemvion',
    });
    await waitFor(() => expect(badge().textContent).toBe('Default/Clemvion'));
    expect(badge().getAttribute('data-elsewhere')).toBe('false');
  });

  it('지금 조직이 아니면 강조한다 — 다른 조직의 일이라는 사실이 정보다', async () => {
    memberships = TWO_ORGS;
    renderBadge({ orgSlug: 'acme', orgName: 'Acme', projectSlug: 'web', projectName: 'Acme 웹' });
    await waitFor(() => expect(badge().getAttribute('data-elsewhere')).toBe('true'));
    expect(badge().textContent).toBe('Acme/Acme 웹');
    expect(badge().getAttribute('title')).toContain('Acme');
  });

  it('프로젝트가 없으면 조직 전체다', async () => {
    renderBadge({ orgSlug: 'default', orgName: 'Default', projectSlug: null });
    await waitFor(() => expect(badge().textContent).toBe('조직 전체'));
  });

  it('slug 를 곁들이는 자리(토큰)에서는 흐린 보조로', async () => {
    renderBadge({ projectSlug: 'clemvion', projectName: 'Clemvion', withSlug: true });
    await waitFor(() => expect(badge().textContent).toBe('Clemvionclemvion'));
  });
});

describe('초대 문장 — 어디로 부르는지가 문장 안에 있다', () => {
  function Sentence({ invite }: { invite: Record<string, unknown> }): React.JSX.Element {
    const t = useT();
    return <p data-testid="sentence">{invitationSentence(t, invite)}</p>;
  }
  const renderSentence = (invite: Record<string, unknown>) =>
    render(
      <LocaleProvider locale="ko">
        <Sentence invite={invite} />
      </LocaleProvider>,
    );

  it('조직 전체 초대', () => {
    renderSentence({ org_name: 'Acme', role: 'planner', project_slug: null });
    expect(screen.getByTestId('sentence').textContent).toBe(
      'Acme 에서 조직 전체에 planner 역할로 초대했습니다.',
    );
  });

  it('프로젝트 초대는 프로젝트 이름으로 — 조직 전체 역할처럼 읽히지 않게', () => {
    renderSentence({
      org_name: 'Acme',
      role: 'developer',
      project_slug: 'web',
      project_name: 'Acme 웹',
    });
    expect(screen.getByTestId('sentence').textContent).toBe(
      'Acme 에서 Acme 웹 프로젝트에 developer 역할로 초대했습니다.',
    );
  });
});
