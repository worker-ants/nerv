// 구현 현황 드릴다운 — REQ-WEB-315 · 316 · 317 (2026-10-15 · E15-S01 · E15-S02 · 사람 결정 ④)
//
// 개요 카드는 몇 건인지만 보여 준다. 드릴다운은 영역 → 문서 → 요구사항으로 내려가 어느 약속이 비었는지 보이고, 요구사항을
// 펼치면 파생 작업 · 증적 · 발견 · 최근 리뷰와 [검증 작업 만들기]가 한자리에 있다. 거르기는 서버가 준 수와 행의 표시만 읽고,
// 작업이 없어 파생하지 않은 값에는 「출처: 임포트」를 표시한다.

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

type Row = Record<string, unknown>;
const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

let coverage: Row | null;
let requirements: Row[];
let roles: string[];
let calls: string[];

const AREA_CHAT = {
  area_key: 'area-chat',
  area_title: '웹챗',
  total: 3,
  implemented: 1,
  verified: 0,
  in_progress: 1,
  evidence_missing: 1,
  empty_promises: 1,
  reverify_required: 0,
  imported_values: 2,
};
const AREA_NONE = {
  area_key: null,
  area_title: null,
  total: 1,
  implemented: 0,
  verified: 0,
  in_progress: 0,
  evidence_missing: 0,
  empty_promises: 0,
  reverify_required: 0,
  imported_values: 0,
};

const DETAIL: Row = {
  id: 'r-1',
  ref: 'REQ-CWC-031',
  impl_status: 'implemented',
  impl_status_source: 'import',
  verification_evidence: false,
  approved_version: { id: 'v-4', version_no: 4 },
  tasks: [
    { id: 't-1', key: 'CLV-T-1KTDCK', title: '위젯 렌더링', status: 'done', archived_at: null },
  ],
  evidence: [
    { id: 'e-1', kind: 'commit', locator: '7b22ce90aa', signed: false, stale: false, repo: null },
  ],
  findings: [
    { id: 'f-1', title: '토큰이 평문이다', severity: 'critical', status: 'open' },
    { id: 'f-2', title: '재시도 횟수가 없다', severity: 'warning', status: 'fixed' },
  ],
  reviews: [
    {
      id: 'rs-1',
      branch: 'feature/widget-v2',
      round_no: 2,
      finding_count: 2,
      open_critical: 1,
    },
  ],
};

beforeEach(() => {
  localStorage.clear();
  calls = [];
  roles = ['planner'];
  coverage = {
    totals: {
      total: 4,
      implemented: 1,
      verified: 0,
      in_progress: 1,
      evidence_missing: 1,
      empty_promises: 1,
      reverify_required: 0,
      imported_values: 2,
      derived_ratio: 0.5,
    },
    areas: [AREA_CHAT, AREA_NONE],
    specs: [
      { ...AREA_CHAT, key: 'SPC-CWC-007', title: '위젯 임베드' },
      { key: 'SPC-LOOSE', title: '느슨한 문서', ...AREA_NONE, area_key: null },
    ],
  };
  requirements = [
    {
      id: 'r-1',
      ref: 'REQ-CWC-031',
      statement_md: 'WHEN 방문자가 위젯을 열면 THE SYSTEM SHALL 대화를 복원한다',
      impl_status: 'implemented',
      impl_status_source: 'import',
      evidence_missing: true,
      empty_promise: false,
      reverify_required: false,
      task_count: 1,
      evidence_count: 1,
    },
    {
      id: 'r-2',
      ref: 'REQ-CWC-032',
      statement_md: 'WHEN 연결이 끊기면 THE SYSTEM SHALL 메시지를 모은다',
      impl_status: 'unimplemented',
      impl_status_source: 'import',
      evidence_missing: false,
      empty_promise: true,
      reverify_required: false,
      task_count: 0,
      evidence_count: 0,
    },
    {
      id: 'r-3',
      ref: 'REQ-CWC-033',
      statement_md: 'WHEN 오래되면 THE SYSTEM SHALL 새로 시작한다',
      impl_status: 'in_progress',
      impl_status_source: 'derived',
      evidence_missing: false,
      empty_promise: false,
      reverify_required: false,
      task_count: 1,
      evidence_count: 0,
    },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const full = String(url).replace(/^.*\/api\/v1/, '');
      calls.push(full);
      const path = full.split('?')[0]!;
      if (path === '/me') {
        return ok({
          id: 'u-1',
          display_name: '지민',
          memberships: [
            { org_slug: 'default', org_name: 'Default', project_slug: 'clemvion', roles },
          ],
        });
      }
      if (/^\/orgs\/[^/]+\/projects$/.test(path))
        return ok([{ id: 'p-1', slug: 'clemvion', name: 'Clemvion' }]);
      if (path === '/projects/clemvion')
        return ok({
          id: 'p-1',
          slug: 'clemvion',
          name: 'Clemvion',
          repo_url: 'https://git.example.com/nerv/clemvion',
        });
      if (path === '/projects/clemvion/coverage') {
        if (coverage === null) {
          return { ok: false, status: 500, json: async () => ({ code: 'NERV_INTERNAL' }) };
        }
        return ok(coverage);
      }
      if (path === '/projects/clemvion/requirements') return ok(requirements);
      if (path === '/projects/clemvion/requirements/REQ-CWC-031') return ok(DETAIL);
      return ok({ items: [], next_cursor: null, total: 0, summary: {}, count: 0, totals: {} });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderAt(path: string): ReturnType<typeof createRouter> {
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({ routeTree, history });
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
  return router as never;
}

describe('드릴다운 — 영역 → 문서 → 요구사항 (REQ-WEB-315)', () => {
  it('영역에서 문서로, 문서에서 요구사항으로 내려가고 그 자리가 주소에 남는다', async () => {
    const router = renderAt('/p/clemvion/coverage');
    const areas = await screen.findAllByTestId('coverage-area-row');
    expect(areas).toHaveLength(2);
    expect(areas[0]!.textContent).toContain('웹챗');
    expect(areas[0]!.textContent).toContain('구현 1 · 검증 0 / 3');
    // 0 이 아닌 경고만 — 임포트 값도 센다
    expect(areas[0]!.textContent).toContain('출처: 임포트 2');
    expect(areas[1]!.textContent).toContain('영역에 들지 않은 스펙');
    // 2-8 의 두 수
    expect(screen.getByTestId('coverage-derived').textContent).toBe(
      '관계에서 파생 50% · 임포트 값 2건',
    );

    fireEvent.click(within(areas[0]!).getByTestId('coverage-area-row-open'));
    const specs = await screen.findAllByTestId('coverage-spec-row');
    expect(specs).toHaveLength(1);
    expect(router.state.location.search).toEqual({ area: 'area-chat' });
    expect(
      within(specs[0]!)
        .getByRole('link', { name: /문서 열기/ })
        .getAttribute('href'),
    ).toBe('/p/clemvion/specs/SPC-CWC-007');

    fireEvent.click(within(specs[0]!).getByTestId('coverage-spec-row-open'));
    const rows = await screen.findAllByTestId('coverage-req');
    expect(rows.map((r) => r.getAttribute('data-ref'))).toEqual([
      'REQ-CWC-031',
      'REQ-CWC-032',
      'REQ-CWC-033',
    ]);
    expect(router.state.location.search).toEqual({ area: 'area-chat', spec: 'SPC-CWC-007' });
    expect(calls).toContain('/projects/clemvion/requirements?spec=SPC-CWC-007');
    // 빵부스러기 — 위 단계로 돌아가는 단추
    const crumbs = screen.getByTestId('coverage-crumbs');
    expect(crumbs.textContent).toContain('모든 영역');
    expect(crumbs.textContent).toContain('웹챗');
    expect(crumbs.textContent).toContain('위젯 임베드');
  });

  it('문서 키만 든 주소로 들어와도 그 문서의 영역이 빵부스러기에 채워진다', async () => {
    renderAt('/p/clemvion/coverage?spec=SPC-CWC-007');
    await screen.findAllByTestId('coverage-req');
    expect(screen.getByTestId('coverage-crumbs').textContent).toContain('웹챗');
  });

  it('요구사항이 하나도 없으면 빈 상태와 스펙 목록으로 가는 링크를 보인다', async () => {
    coverage = {
      totals: { total: 0, imported_values: 0, derived_ratio: null },
      areas: [],
      specs: [],
    };
    renderAt('/p/clemvion/coverage');
    expect(await screen.findByText('요구사항이 아직 없습니다.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /스펙 목록으로/ }).getAttribute('href')).toBe(
      '/p/clemvion/specs',
    );
    expect(screen.queryByTestId('coverage-derived')).toBeNull();
  });

  it('받지 못하면 수 대신 이유와 [다시 시도]를 보인다', async () => {
    coverage = null;
    renderAt('/p/clemvion/coverage');
    expect(await screen.findByRole('button', { name: /다시 시도/ })).toBeTruthy();
    expect(screen.queryAllByTestId('coverage-area-row')).toHaveLength(0);
  });
});

describe('거르기 — 서버의 수와 행의 표시만 읽는다 (REQ-WEB-315 · 317)', () => {
  it('출처: 임포트를 켜면 임포트 값의 줄만 남고, 켠 칸을 다시 누르면 풀린다', async () => {
    const router = renderAt('/p/clemvion/coverage?spec=SPC-CWC-007');
    await screen.findAllByTestId('coverage-req');
    fireEvent.click(screen.getByTestId('coverage-filter-import'));
    await vi.waitFor(() =>
      expect(screen.getAllByTestId('coverage-req').map((r) => r.getAttribute('data-ref'))).toEqual([
        'REQ-CWC-031',
        'REQ-CWC-032',
      ]),
    );
    expect(router.state.location.search).toMatchObject({ filter: 'import' });
    // 줄마다 출처 표시 — 파생한 줄에는 붙지 않는다
    expect(screen.getAllByTestId('import-source')).toHaveLength(2);
    fireEvent.click(screen.getByTestId('coverage-filter-import'));
    await vi.waitFor(() => expect(screen.getAllByTestId('coverage-req')).toHaveLength(3));
  });

  it('증적 없음을 켜면 영역 단계에서도 그 수가 0 인 줄이 빠진다', async () => {
    renderAt('/p/clemvion/coverage?filter=evidence_missing');
    const areas = await screen.findAllByTestId('coverage-area-row');
    expect(areas).toHaveLength(1);
    expect(areas[0]!.textContent).toContain('웹챗');
  });

  it('셀 것이 없는 거르기는 켤 수 없고, 거른 결과가 비면 거르기를 푸는 단추를 둔다', async () => {
    const router = renderAt('/p/clemvion/coverage?spec=SPC-LOOSE&filter=reverify');
    // 다시 검증 필요는 0 건이다 — 이미 켜져 있으면 풀 수는 있다
    expect(await screen.findByText('이 조건에 맞는 요구사항이 없습니다.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('coverage-clear-filter'));
    await vi.waitFor(() => expect(router.state.location.search).toEqual({ spec: 'SPC-LOOSE' }));
    const reverify = await screen.findByTestId('coverage-filter-reverify');
    expect((reverify as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('요구사항을 펼친다 — 드릴다운의 끝은 행동이다 (REQ-WEB-316)', () => {
  it('파생 작업 · 증적 · 발견 · 최근 리뷰를 링크로 보이고, 검증 증적이 없으면 [검증 작업 만들기]가 파생 폼으로 간다', async () => {
    const router = renderAt('/p/clemvion/coverage?spec=SPC-CWC-007');
    const row = (await screen.findAllByTestId('coverage-req'))[0]!;
    fireEvent.click(within(row).getByTestId('coverage-req-toggle'));
    const detail = await screen.findByTestId('coverage-req-detail');
    expect(router.state.location.search).toMatchObject({ req: 'REQ-CWC-031' });

    expect(within(detail).getByTestId('coverage-req-task').getAttribute('href')).toBe(
      '/p/clemvion/tasks/CLV-T-1KTDCK',
    );
    expect(within(detail).getByTestId('coverage-req-evidence-link').getAttribute('href')).toBe(
      'https://git.example.com/nerv/clemvion/commit/7b22ce90aa',
    );
    const findings = within(detail).getAllByTestId('coverage-req-finding');
    // 열린 발견은 리뷰 센터의 기본 거르기로, 처분된 발견은 전부 보기로 연다
    expect(findings[0]!.getAttribute('href')).toBe('/p/clemvion/reviews?finding=f-1');
    expect(findings[1]!.getAttribute('href')).toBe('/p/clemvion/reviews?finding=f-2&status=all');
    expect(within(detail).getByTestId('coverage-req-review').textContent).toBe(
      'feature/widget-v2 · 2회차 · 발견 2건',
    );
    expect(detail.textContent).toContain('열린 critical 1건');
    // 출처가 임포트면 그 뜻을 문장으로도 적는다
    expect(within(detail).getByTestId('import-source-hint')).toBeTruthy();

    const make = within(detail).getByTestId('make-verification');
    const href = make.getAttribute('href') ?? '';
    expect(href.startsWith('/p/clemvion/tasks?')).toBe(true);
    // 라우터는 숫자처럼 생긴 글자를 JSON 으로 감싸 적는다(`"4"`) — 받는 쪽(보드)도 같은 규칙으로 읽는다
    const params = Object.fromEntries(
      [...new URLSearchParams(href.split('?')[1])].map(([k, v]) => {
        try {
          return [k, JSON.parse(v) as unknown];
        } catch {
          return [k, v];
        }
      }),
    );
    expect(params).toMatchObject({
      from_version: 'v-4',
      from_spec: 'SPC-CWC-007',
      from_version_no: '4',
      requirement: 'r-1',
    });
  });

  it('작업을 만들 수 없는 역할이면 [검증 작업 만들기]를 잠그고 누가 할 수 있는지 보인다', async () => {
    roles = ['viewer'];
    renderAt('/p/clemvion/coverage?spec=SPC-CWC-007&req=REQ-CWC-031');
    const locked = await screen.findByTestId('make-verification-locked');
    expect(locked.getAttribute('aria-disabled')).toBe('true');
    expect(locked.getAttribute('data-reason')).toContain('planner');
    expect(screen.queryByTestId('make-verification')).toBeNull();
  });
});

describe('개요 카드에서 드릴다운으로 (REQ-WEB-315 · 317)', () => {
  it('[자세히 보기] · 경고 수 · 임포트 값 줄이 그 거르기를 켠 드릴다운으로 간다', async () => {
    renderAt('/p/clemvion');
    const link = await screen.findByTestId('coverage-drilldown');
    expect(link.getAttribute('href')).toBe('/p/clemvion/coverage');
    const imported = await screen.findByTestId('coverage-imported');
    expect(imported.getAttribute('href')).toBe('/p/clemvion/coverage?filter=import');
    expect(imported.textContent).toContain('관계에서 파생 50% · 임포트 값 2건');
    const hrefs = screen.getAllByTestId('coverage-metric-link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/p/clemvion/coverage?filter=evidence_missing');
    expect(hrefs).toContain('/p/clemvion/coverage?filter=empty_promises');
    // 0 인 수는 거르지 않은 처음으로 간다 — 비어 있는 거르기로 보내지 않는다
    expect(hrefs.filter((h) => h === '/p/clemvion/coverage').length).toBeGreaterThan(0);
  });

  it('임포트 값이 없으면 그 줄을 그리지 않는다', async () => {
    coverage = {
      ...coverage,
      totals: { ...(coverage!['totals'] as Row), imported_values: 0, derived_ratio: 1 },
    };
    renderAt('/p/clemvion');
    await screen.findByTestId('coverage-drilldown');
    await screen.findAllByTestId('coverage-metric-link');
    expect(screen.queryByTestId('coverage-imported')).toBeNull();
  });
});
