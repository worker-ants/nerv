// /settings/workspace — 조직·프로젝트 관리 (EP-ORG-03~05 · EP-PRJ-02·04·05)
//
// 검사하는 것은 두 가지다: **권한 판정이 겸직을 합치는가**, 그리고 **되돌릴 수 없는
// 일 앞에 확인이 서는가**.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../lib/i18n.js';
import { RealtimeProvider } from '../../lib/realtime.js';
import { rolesInOrg } from '../../lib/session.js';
import { routeTree } from '../../routeTree.gen';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

/** 조직 admin 이면서 프로젝트에서는 planner — 겸직의 흔한 형태다 */
const ME = {
  id: 'u-1',
  display_name: '지민',
  memberships: [
    { org_slug: 'default', org_name: 'default', project_slug: 'clemvion', roles: ['planner'] },
    { org_slug: 'default', org_name: 'default', project_slug: null, roles: ['admin'] },
  ],
};

function stub(projects: unknown[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const path = String(url);
      const json = path.includes('/projects')
        ? projects
        : path.includes('/me')
          ? ME
          : { items: [], memberships: [], count: 0, summary: {} };
      return { ok: true, status: 200, json: async () => json };
    }),
  );
}

async function renderTab(expectRows = true): Promise<void> {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/settings/workspace'] }),
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
  await waitFor(() => expect(screen.getByTestId('org-name')).toBeDefined());
  // 프로젝트 목록은 me 보다 늦게 온다 — 줄을 기다리지 않으면 아직 빈 상태를 검사하게 된다
  if (expectRows) await waitFor(() => expect(screen.getByTestId('project-row')).toBeDefined());
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});
beforeEach(() => localStorage.clear());

describe('권한 — 겸직은 합집합이다', () => {
  it('프로젝트에서 planner 여도 조직 admin 이면 고칠 수 있다', () => {
    // `primaryMembership` 은 프로젝트 소속을 먼저 고른다 — 그 한 행만 보면 조직
    // admin 인 사람이 조직 설정에서 잠긴다(실측 2026-08-24).
    expect(rolesInOrg(ME as never, 'default')).toContain('admin');
    expect(rolesInOrg(ME as never, 'other')).toEqual([]);
  });

  it('admin 이면 안내 배너를 띄우지 않는다', async () => {
    stub([{ id: 'p-1', slug: 'clemvion', key: 'CLV', name: 'clemvion', archived_at: null }]);
    await renderTab();
    expect(screen.queryByText(/admin 만 바꿀 수 있습니다/)).toBeNull();
  });
});

describe('되돌릴 수 없는 일에는 확인이 선다', () => {
  it('조직 삭제는 한 번 더 묻고, 왜 막힐 수 있는지 미리 말한다', async () => {
    stub([{ id: 'p-1', slug: 'clemvion', key: 'CLV', name: 'clemvion', archived_at: null }]);
    await renderTab();

    // 규칙을 눌러 보기 전에 읽을 수 있어야 한다 — 거절당하고 나서 아는 것보다 낫다
    expect(screen.getByText(/프로젝트가 남아 있으면 지울 수 없습니다/)).toBeDefined();
    fireEvent.click(screen.getByTestId('org-delete'));
    expect(screen.getByTestId('org-delete-confirm')).toBeDefined();
  });

  it('프로젝트는 삭제가 아니라 보관이다 — 그 아래 감사 기록이 달려 있다', async () => {
    stub([{ id: 'p-1', slug: 'clemvion', key: 'CLV', name: 'clemvion', archived_at: null }]);
    await renderTab();
    expect(screen.getByTestId('project-archive').textContent).toBe('보관');
  });

  it('보관된 프로젝트는 복구로 되돌린다', async () => {
    stub([
      {
        id: 'p-1',
        slug: 'old',
        key: 'OLD',
        name: '옛 프로젝트',
        archived_at: '2026-08-01T00:00:00Z',
      },
    ]);
    await renderTab();
    expect(screen.getByTestId('project-row').getAttribute('data-archived')).toBe('true');
    expect(screen.getByTestId('project-archive').textContent).toBe('복구');
  });
});

// 2026-09-07 — 이 탭만 `primaryMembership()` 으로 조직을 따로 골랐다. 그 함수는
// **프로젝트 소속 행을 먼저** 집으므로, 헤더에서 두 번째 조직을 골라도 여기는 첫 조직을
// 그렸다 — 한 화면이 두 조직을 가리키면 이름을 바꾼 사람은 자기가 무엇을 바꿨는지 모른다.
describe('지금 조직은 한 곳에서 정한다 (REQ-WEB-076)', () => {
  /** 조직 둘 — 첫 행이 프로젝트 소속이라 `primaryMembership()` 은 늘 이쪽을 집는다 */
  const TWO_ORGS = {
    id: 'u-1',
    display_name: '지민',
    memberships: [
      { org_slug: 'default', org_name: 'default', project_slug: 'clemvion', roles: ['admin'] },
      { org_slug: 'acme', org_name: 'Acme', project_slug: null, roles: ['admin'] },
    ],
  };

  it('헤더가 고른 조직을 그린다 — 멤버십 행에서 따로 고르지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        const path = String(url);
        const json = path.includes('/projects')
          ? []
          : path.includes('/me')
            ? TWO_ORGS
            : { items: [], memberships: [], count: 0, summary: {} };
        return { ok: true, status: 200, json: async () => json };
      }),
    );
    // 헤더의 조직 select 가 남기는 것과 같은 자리다(`lib/scope.ts`)
    localStorage.setItem('nerv.last-org', 'acme');
    await renderTab(false);

    await waitFor(() =>
      expect((screen.getByTestId('org-name') as HTMLInputElement).value).toBe('Acme'),
    );
    expect(screen.getByText('acme')).toBeDefined();
  });
});

describe('새 프로젝트 — 이름에서 slug·key 를 만들어 준다', () => {
  it('셋을 손으로 채우게 하지 않는다', async () => {
    stub([]);
    await renderTab(false);
    fireEvent.click(screen.getByTestId('project-new'));
    fireEvent.change(screen.getByTestId('project-name'), { target: { value: 'Acme Console' } });
    expect((screen.getByTestId('project-slug') as HTMLInputElement).value).toBe('acme-console');
    expect((screen.getByTestId('project-key') as HTMLInputElement).value).toBe('ACM');
  });
});

// 설정 탭 줄도 S3 곁레일과 같은 모양이다 — 좁은 칸에서 넘칠 수 있고, 그때 밀려야 하는
// 것은 페이지가 아니라 줄 자신이다(REQ-WEB-151). 지금 넷은 대개 한 줄에 들어가지만
// 탭이 늘거나 로케일이 길어지면 넘치고, 그 순간을 잡을 계기가 없으면 아무도 모른다.
describe('설정 탭 줄의 가로 (REQ-WEB-151)', () => {
  it('줄이 자기 안에서 밀고, 탭은 줄지도 접히지도 않는다', async () => {
    stub([{ id: 'p-1', slug: 'clemvion', key: 'CLV', name: 'clemvion', archived_at: null }]);
    await renderTab();

    const nav = screen.getByTestId('settings-tabs');
    expect(nav.className).toContain('overflow-x-auto');
    for (const tab of nav.querySelectorAll('a')) {
      expect(tab.className).toContain('shrink-0');
      expect(tab.className).toContain('whitespace-nowrap');
    }
  });
});

/**
 * **저장소 주소를 넣을 자리가 화면에 없었다**(2026-09-10 — 사람 보고 · REQ-WEB-160).
 *
 * 두 열은 처음부터 있었고 `PATCH /projects/{slug}` 도 처음부터 받았는데 채울 문이 API 뿐이라,
 * 작업 상세의 증적 링크가 "저장소 주소가 없습니다" 라고 말해 놓고 **고칠 곳을 알려 주지
 * 못했다**(§1.5 가 금지하는 막다른 길이다).
 */
describe('프로젝트의 저장소 주소 (REQ-WEB-160)', () => {
  /** PATCH 본문을 잡아 둔다 — 무엇을 보냈는가가 검사 대상이다 */
  function stubWithPatch(project: Record<string, unknown>): { sent: unknown[] } {
    const sent: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
        const path = String(url);
        if (init?.method === 'PATCH') {
          sent.push(JSON.parse(init.body ?? '{}'));
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        const json = path.includes('/projects') ? [project] : path.includes('/me') ? ME : {};
        return { ok: true, status: 200, json: async () => json };
      }),
    );
    return { sent };
  }

  const PROJECT = {
    id: 'p-1',
    slug: 'clemvion',
    key: 'CLV',
    name: 'clemvion',
    archived_at: null,
    repo_url: 'https://github.com/nerv/nerv',
    default_branch: 'main',
  };

  it('고치기를 열면 지금 값이 칸에 있고, 저장하면 함께 나간다', async () => {
    const { sent } = stubWithPatch(PROJECT);
    await renderTab();
    fireEvent.click(screen.getByTestId('project-edit'));

    expect((screen.getByTestId('project-repo-url') as HTMLInputElement).value).toBe(
      'https://github.com/nerv/nerv',
    );
    expect((screen.getByTestId('project-default-branch') as HTMLInputElement).value).toBe('main');

    fireEvent.change(screen.getByTestId('project-repo-url'), {
      target: { value: 'https://git.example.com/team/svc' },
    });
    fireEvent.change(screen.getByTestId('project-default-branch'), { target: { value: 'trunk' } });
    fireEvent.click(screen.getByTestId('project-save'));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      name: 'clemvion',
      repo_url: 'https://git.example.com/team/svc',
      default_branch: 'trunk',
    });
  });

  it('비어 있던 값도 칸에 `null` 이라고 적히지 않는다', async () => {
    stubWithPatch({ ...PROJECT, repo_url: null, default_branch: null });
    await renderTab();
    fireEvent.click(screen.getByTestId('project-edit'));

    expect((screen.getByTestId('project-repo-url') as HTMLInputElement).value).toBe('');
    expect((screen.getByTestId('project-default-branch') as HTMLInputElement).value).toBe('');
  });

  it('지운 값은 빈 문자열로 나간다 — 서버가 그것을 "비운다" 로 읽는다(REQ-API-157)', async () => {
    const { sent } = stubWithPatch(PROJECT);
    await renderTab();
    fireEvent.click(screen.getByTestId('project-edit'));
    fireEvent.change(screen.getByTestId('project-repo-url'), { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('project-save'));

    await waitFor(() => expect(sent).toHaveLength(1));
    // null 을 보내면 서버의 `coalesce` 가 "안 건드림" 으로 읽어 옛 주소가 살아남는다
    expect(sent[0]).toMatchObject({ repo_url: '' });
  });

  it('권한이 없으면 고치기 자체가 잠긴다 — 숨기지 않고 사유를 붙인다(REQ-WEB-003)', async () => {
    const viewer = {
      ...ME,
      memberships: [
        { org_slug: 'default', org_name: 'default', project_slug: null, roles: ['viewer'] },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        const path = String(url);
        const json = path.includes('/projects') ? [PROJECT] : path.includes('/me') ? viewer : {};
        return { ok: true, status: 200, json: async () => json };
      }),
    );
    await renderTab();
    const edit = screen.getByTestId('project-edit');
    expect(edit.hasAttribute('disabled')).toBe(true);
    expect(edit.getAttribute('title')).not.toBeNull();
  });
});
