// 스펙 목록의 [상태 ▾]·[종류 ▾] — 걸린 문서와 **그 조상**만 (REQ-WEB-138)
//
// 와이어프레임(§2.4)은 처음부터 `[타입 ▾] [상태 ▾]` 를 그리고 있었는데 화면에는 없었다.
// 141편짜리 프로젝트에서 "아직 초안인 것"을 보려면 배지를 눈으로 훑는 수밖에 없었다.
//
// **조상을 함께 남기는 것이 이 필터의 요점이다.** 실측(clemvion): `draft` 26건 중 17건의
// 부모가 draft 가 아니다 — 부모를 빼면 그 17줄이 자리를 잃고 목록의 위아래가 뒤섞인다.
// 서버(EP-SPEC-01 `?status=` · REQ-API-092)와 **같은 규칙**이라는 것을 여기서 지킨다.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

//  뿌리(approved) ─ 가지(approved) ─ 잎(draft)     ← 부모가 draft 가 아닌 자리
//                 └ 형제(draft)
//  외딴(approved)                                   ← 걸리는 것이 아래에 하나도 없는 가지
const NODES = [
  {
    id: 'r',
    key: 'root',
    title: '뿌리',
    type: 'area',
    parent_id: null,
    doc_status: 'approved',
    version_no: 1,
  },
  {
    id: 'b',
    key: 'branch',
    title: '가지',
    type: 'feature',
    parent_id: 'r',
    doc_status: 'approved',
    version_no: 1,
  },
  {
    id: 's',
    key: 'sib',
    title: '형제',
    type: 'feature',
    parent_id: 'r',
    doc_status: 'draft',
    version_no: 1,
  },
  {
    id: 'l',
    key: 'leaf',
    title: '잎',
    type: 'feature',
    parent_id: 'b',
    doc_status: 'draft',
    version_no: 1,
  },
  {
    id: 'o',
    key: 'other',
    title: '외딴',
    type: 'area',
    parent_id: null,
    doc_status: 'approved',
    version_no: 1,
  },
];

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).includes('/specs/tree')
          ? NODES
          : { items: [], memberships: [], count: 0, summary: {} },
    })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

async function renderList(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
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
  await screen.findAllByText('뿌리');
  // 이 라우트는 트리를 둘 그린다 — 사이드바(rail)가 앞, 전수 목록(full)이 뒤다
  const trees = screen.getAllByTestId('spec-tree');
  return { full: within(trees[1]!), router };
}

describe('REQ-WEB-138 상태 필터 — 걸린 것과 그 조상', () => {
  it('필터가 없으면 전부 보인다', async () => {
    const { full } = await renderList('/p/demo/specs');
    for (const title of ['뿌리', '가지', '형제', '잎', '외딴']) {
      expect(full.queryByText(title)).not.toBeNull();
    }
  });

  it('draft 를 고르면 걸린 둘과 그 조상만 남는다', async () => {
    const { full } = await renderList('/p/demo/specs?status=draft');
    expect(full.queryByText('형제')).not.toBeNull();
    expect(full.queryByText('잎')).not.toBeNull();
    // 조상은 자리를 지키러 온다 — 이것을 빼면 '잎' 의 부모가 사라진다
    expect(full.queryByText('뿌리')).not.toBeNull();
    expect(full.queryByText('가지')).not.toBeNull();
  });

  it('아래에 걸린 것이 없는 가지는 빈 채로 남지 않는다', async () => {
    const { full } = await renderList('/p/demo/specs?status=draft');
    expect(full.queryByText('외딴')).toBeNull();
  });

  it('접혀 있어도 걸린 것은 보인다 — 접힌 가지에 숨기면 필터가 무의미하다', async () => {
    const { full } = await renderList('/p/demo/specs?status=draft');
    fireEvent.click(full.getAllByRole('button', { name: '접기' })[0]!);
    expect(full.queryByText('잎')).not.toBeNull();
  });

  it('전체 수는 필터와 무관하다 — "표시 N / 전체 M" 의 M 은 프로젝트의 수다', async () => {
    const { full } = await renderList('/p/demo/specs?status=draft');
    expect(full.getByTestId('tree-count').textContent).toContain('5');
  });

  it('쉼표로 여럿을 받는다 — 서버 질의와 같은 모양이다', async () => {
    const { full } = await renderList('/p/demo/specs?status=draft,approved');
    expect(full.queryByText('외딴')).not.toBeNull();
  });

  it('고르면 주소에 남는다 — 링크로 건네면 상대도 같은 목록을 본다', async () => {
    const { router } = await renderList('/p/demo/specs');
    fireEvent.change(screen.getByTestId('status-filter'), { target: { value: 'draft' } });
    await vi.waitFor(() => {
      expect(router.state.location.searchStr).toContain('status=draft');
    });
  });

  it('보관 보기를 켜도 고른 상태가 날아가지 않는다 — 뷰 상태는 서로를 지운다', async () => {
    const { router } = await renderList('/p/demo/specs?status=draft');
    fireEvent.click(screen.getByTestId('show-archived'));
    await vi.waitFor(() => {
      expect(router.state.location.searchStr).toContain('status=draft');
      expect(router.state.location.searchStr).toContain('archived');
    });
  });
});

describe('REQ-WEB-138 종류 필터 — 뼈대만 보기', () => {
  it('area 만 고르면 뼈대가 남는다 — 본문 있는 문서는 빠진다', async () => {
    const { full } = await renderList('/p/demo/specs?type=area');
    expect(full.queryByText('뿌리')).not.toBeNull();
    expect(full.queryByText('외딴')).not.toBeNull();
    expect(full.queryByText('형제')).toBeNull();
    expect(full.queryByText('잎')).toBeNull();
  });

  it('feature 를 고르면 그 조상(area)이 따라온다', async () => {
    const { full } = await renderList('/p/demo/specs?type=feature');
    expect(full.queryByText('잎')).not.toBeNull();
    expect(full.queryByText('가지')).not.toBeNull();
    // 아래에 feature 가 하나도 없는 '외딴' 은 빠진다
    expect(full.queryByText('외딴')).toBeNull();
  });

  it('상태와 함께 걸면 둘 다 맞는 것만 남는다', async () => {
    const { full } = await renderList('/p/demo/specs?type=area&status=draft');
    // area 이면서 draft 인 것은 없다 — 조상으로 남을 이유도 없다
    expect(full.queryByText('뿌리')).toBeNull();
    expect(full.queryByText('외딴')).toBeNull();
  });

  it('고르면 주소에 남고 상태를 지우지 않는다 — 넷이 서로를 지우지 않는다', async () => {
    const { router } = await renderList('/p/demo/specs?status=draft');
    fireEvent.change(screen.getByTestId('type-filter'), { target: { value: 'feature' } });
    await vi.waitFor(() => {
      expect(router.state.location.searchStr).toContain('type=feature');
      expect(router.state.location.searchStr).toContain('status=draft');
    });
  });

  it('되돌리면 필터가 주소에서 빠진다 — 빈 값이 남으면 링크가 거짓말을 한다', async () => {
    const { router } = await renderList('/p/demo/specs?type=area');
    fireEvent.change(screen.getByTestId('type-filter'), { target: { value: '' } });
    await vi.waitFor(() => {
      expect(router.state.location.searchStr).not.toContain('type=');
    });
  });
});

/**
 * **상단 배치는 세 탭이 같아야 한다**(REQ-WEB-140 · 2026-09-05 사람 지적).
 *
 * 상태·종류 선택기가 화면 머리의 동작 줄에 있던 동안 칸이 둘 더 붙어 줄이 넘쳤고,
 * **트리 탭만 표·그래프와 다른 모양**이 됐다. 트리에만 듣는 조작이니 트리의 조작 줄이
 * 그 자리다 — 그러면 머리의 동작 줄은 어느 탭에서나 같다.
 */
describe('REQ-WEB-140 상단 배치 — 트리도 표·그래프와 같다', () => {
  it('두 선택기는 트리의 조작 줄 안에 있다 — 머리의 동작 줄이 아니다', async () => {
    const { full } = await renderList('/p/demo/specs');
    // 트리 컨테이너 안에서 찾을 수 있어야 한다
    expect(full.getByTestId('status-filter')).toBeDefined();
    expect(full.getByTestId('type-filter')).toBeDefined();
    // 그리고 트리 자신의 조작들과 같은 줄에 산다
    const row = full.getByTestId('status-filter').closest('div');
    expect(row?.contains(full.getByTestId('tree-expand-all'))).toBe(true);
    expect(row?.contains(full.getByTestId('tree-count'))).toBe(true);
  });

  it('머리의 동작 줄에는 세 탭에 공통인 것만 남는다', async () => {
    await renderList('/p/demo/specs');
    const actions = screen.getByTestId('new-spec').closest('form');
    expect(actions).not.toBeNull();
    for (const id of ['freeze-baseline', 'show-archived']) {
      expect(actions?.querySelector(`[data-testid="${id}"]`)).not.toBeNull();
    }
    // 트리 전용 조작은 그 줄에 없다
    for (const id of ['status-filter', 'type-filter']) {
      expect(actions?.querySelector(`[data-testid="${id}"]`)).toBeNull();
    }
  });

  it('기준선 선택기의 기본값은 "기준선 없음" 이다 — "현재" 는 목록을 거른다는 인상을 줬다', async () => {
    // 선택기는 기준선이 하나라도 있어야 그려진다(고를 것이 없는 드롭다운은 자리만 먹는다)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => ({
        ok: true,
        status: 200,
        json: async () =>
          String(url).includes('/baselines')
            ? [{ id: 'b-1', name: 'R1', item_count: 3 }]
            : String(url).includes('/specs/tree')
              ? NODES
              : { items: [], memberships: [], count: 0, summary: {} },
      })),
    );
    await renderList('/p/demo/specs');
    await vi.waitFor(() => {
      expect(screen.getByTestId('baseline-select').textContent).toContain('기준선 없음');
    });
  });

  it('기준선을 고르면 성질 필터를 그리지 않는다 — 그 세트는 전부 승인본이다', async () => {
    const { full } = await renderList('/p/demo/specs?baseline=R1');
    expect(full.queryByTestId('status-filter')).toBeNull();
    expect(full.queryByTestId('type-filter')).toBeNull();
  });

  it('기준선을 고르면 목록 질의가 그 세트를 묻는다 — 목록도 그 시점이어야 한다', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        seen.push(String(url));
        return {
          ok: true,
          status: 200,
          json: async () =>
            String(url).includes('/specs/tree')
              ? NODES
              : { items: [], memberships: [], count: 0, summary: {} },
        };
      }),
    );
    await renderList('/p/demo/specs?baseline=R1');
    await vi.waitFor(() => {
      expect(seen.some((u) => u.includes('/specs/tree') && u.includes('baseline=R1'))).toBe(true);
    });
  });

  it('기준선 생성 단추의 이름이 바뀌었다 — "동결" 은 화면에서 사라졌다', async () => {
    await renderList('/p/demo/specs');
    expect(screen.getByTestId('freeze-baseline').textContent).toBe('기준선 생성…');
    expect(screen.queryByText(/동결/)).toBeNull();
  });
});
