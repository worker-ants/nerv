// 작업 상세의 증적 줄 — screens.md §2.5 (6) · REQ-WEB-159
//
// 명세는 처음부터 "Evidence — PR·커밋 링크" 라고 적었는데 화면은 종류와 위치를 **글자로만**
// 그렸다. 증적은 "보일 것을 붙였다" 는 약속이고, 그것을 확인하러 갈 길이 없으면 약속이 절반만
// 지켜진다. 데려갈 곳을 만드는 규칙 자체는 `lib/evidence.spec.ts` 가 태운다 — 여기서 보는
// 것은 **화면이 그것을 어떻게 그리는가**(새 탭·평문·설명) 다.
//
// **라우트째로 그린다.** 상세 패널은 `<Link>` 를 여럿 쥐고 있어 떼어 그리면 라우터를 못 찾는다.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVIDENCE_KINDS } from '@nerv/schema';
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

const FINDING_ID = '01990a66-4d3f-7c21-9f6a-1b2c3d4e5f60';

const EVIDENCE = [
  { id: 'e-1', kind: 'pr', locator: 'https://git.example.com/nerv/pull/481', source: 'human' },
  { id: 'e-2', kind: 'commit', locator: 'a1b2c3d', source: 'ci' },
  { id: 'e-3', kind: 'code_path', locator: 'apps/web/src/lib/evidence.ts:12', source: 'agent' },
  { id: 'e-4', kind: 'review', locator: FINDING_ID, source: 'agent' },
  { id: 'e-5', kind: 'test', locator: 'claim.spec.ts > 원자적 클레임', source: 'ci' },
  // 웹훅이 `repository.full_name` 을 적어 둔 증적 — 저장소가 프로젝트 것과 다르다
  { id: 'e-6', kind: 'commit', locator: 'f6e5d4c', repo: 'worker-ants/other', source: 'ci' },
];

/** 프로젝트에 저장소 주소가 있는가 — 커밋·코드 경로가 갈 곳을 갖는 조건이다 */
let repo: { repo_url: string | null; default_branch: string | null } = {
  repo_url: 'https://github.com/nerv/nerv',
  default_branch: 'main',
};

beforeEach(() => {
  localStorage.clear();
  repo = { repo_url: 'https://github.com/nerv/nerv', default_branch: 'main' };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const path = String(url);
      const json = path.includes('/tasks/CLV-T-1KTDCK')
        ? {
            id: 't-1',
            key: 'CLV-T-1KTDCK',
            title: '위젯 상태별 렌더링',
            status: 'in_progress',
            evidence: EVIDENCE,
            claims: [],
            dependencies: [],
            reviews: [],
          }
        : path.includes('/me')
          ? {
              id: 'u-1',
              display_name: '규아',
              memberships: [
                {
                  org_slug: 'nerv',
                  project_slug: 'clemvion',
                  roles: ['planner'],
                  project_id: 'p-1',
                },
              ],
            }
          : path.includes('/projects/clemvion')
            ? {
                id: 'p-1',
                slug: 'clemvion',
                key: 'CLV',
                name: 'clemvion',
                org_slug: 'nerv',
                ...repo,
              }
            : { items: [], memberships: [], count: 0, summary: {} };
      return { ok: true, status: 200, json: async () => json };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

async function renderTask(): Promise<void> {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/p/clemvion/tasks/CLV-T-1KTDCK'] }),
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
  await waitFor(() => expect(screen.getAllByTestId('task-evidence').length).toBe(EVIDENCE.length));
}

function hrefOf(locator: string): string | null {
  const link = screen.getAllByTestId('evidence-link').find((a) => a.textContent === locator) as
    HTMLAnchorElement | undefined;
  return link?.getAttribute('href') ?? null;
}

describe('증적은 보러 갈 수 있다 (REQ-WEB-159)', () => {
  it('갈 곳이 있는 넷은 링크가 되고, 짐작할 수 없는 것은 글자로 남는다', async () => {
    await renderTask();
    expect(hrefOf('https://git.example.com/nerv/pull/481')).toBe(
      'https://git.example.com/nerv/pull/481',
    );
    expect(hrefOf('a1b2c3d')).toBe('https://github.com/nerv/nerv/commit/a1b2c3d');
    expect(hrefOf('apps/web/src/lib/evidence.ts:12')).toBe(
      'https://github.com/nerv/nerv/blob/main/apps/web/src/lib/evidence.ts#L12',
    );
    expect(hrefOf(FINDING_ID)).toBe(`/p/clemvion/reviews?finding=${FINDING_ID}`);
    // 테스트 이름은 저장소마다 모양이 달라 데려갈 곳이 없다 — 누를 수 없는 링크를 그리지 않는다
    expect(hrefOf('claim.spec.ts > 원자적 클레임')).toBeNull();
    expect(screen.getAllByTestId('evidence-link')).toHaveLength(5);
  });

  it('새 탭으로 연다 — 이 화면에서 done 전이를 채우는 중이다', async () => {
    await renderTask();
    for (const link of screen.getAllByTestId('evidence-link')) {
      expect(link.getAttribute('target')).toBe('_blank');
      // `noreferrer` 는 `noopener` 를 함께 뜻한다 — 연 창이 이 탭을 건드리지 못한다
      expect(link.getAttribute('rel')).toBe('noreferrer');
    }
  });

  it('저장소 주소가 없으면 커밋·코드 경로는 글자로 남고, 화면이 그 이유를 말한다', async () => {
    repo = { repo_url: null, default_branch: null };
    await renderTask();
    expect(hrefOf('a1b2c3d')).toBeNull();
    expect(hrefOf('apps/web/src/lib/evidence.ts:12')).toBeNull();
    // PR·리뷰는 저장소 주소와 무관하다 — 한쪽이 비었다고 나머지를 잠그지 않는다
    expect(hrefOf('https://git.example.com/nerv/pull/481')).not.toBeNull();
    expect(hrefOf(FINDING_ID)).not.toBeNull();
    // 빈칸은 "링크 없는 증적" 으로 읽힌다 — 고칠 수 있는 것은 화면이 말한다(§1.5)
    expect(screen.getByTestId('evidence-no-repo').textContent).toContain('저장소 주소');
  });

  it('저장소 주소가 있으면 없는 문제를 말하지 않는다', async () => {
    await renderTask();
    expect(screen.queryByTestId('evidence-no-repo')).toBeNull();
  });
});

/**
 * **증적이 선 저장소가 프로젝트 것을 이긴다**(2026-09-10 · REQ-WEB-160 · REQ-API-157).
 * `evidence.repo` 는 처음부터 있던 열이고 웹훅이 채우는데 상세가 그것을 싣지 않아, 화면은
 * 증적 전부를 프로젝트의 저장소 하나로 읽었다 — 저장소가 둘 이상인 프로젝트에서 커밋 링크가
 * 조용히 남의 저장소를 가리킨다.
 */
describe('증적이 선 저장소 (REQ-WEB-160)', () => {
  it('자기 저장소를 단 증적은 그쪽으로 간다 — 호스트는 프로젝트 주소에서 빌린다', async () => {
    await renderTask();
    expect(hrefOf('f6e5d4c')).toBe('https://github.com/worker-ants/other/commit/f6e5d4c');
    // 저장소를 달지 않은 증적은 그대로 프로젝트 것을 본다
    expect(hrefOf('a1b2c3d')).toBe('https://github.com/nerv/nerv/commit/a1b2c3d');
  });
});

/**
 * **어휘의 정본은 `@nerv/schema` 다**(REQ-CB-006). 폼이 여섯 중 넷을 손으로 적어 두어
 * `review`·`user_guide` 증적은 웹에서 붙일 길이 없었다 — 서버는 처음부터 여섯을 받는데.
 */
describe('증적 종류 셀렉트 (REQ-WEB-160)', () => {
  it('어휘 여섯을 전부 고를 수 있고, 화면이 목록을 다시 적지 않는다', async () => {
    await renderTask();
    const select = screen.getByDisplayValue('pr') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([...EVIDENCE_KINDS]);
  });
});
