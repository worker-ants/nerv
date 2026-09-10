// S6 리뷰 센터 — screens.md §2.6a
//
//   REQ-WEB-061  필터 칸의 건수는 같은 응답의 facet 값이다
//   REQ-WEB-062  코드·검토 커밋·유래 스펙 세 출처를 함께 적고, 없는 것은 "없음"으로 밝힌다
//   REQ-WEB-063  같은 지적은 카드 하나 + 관측 횟수
//   REQ-WEB-064  처분은 근거 필수, `fixed` 는 커밋까지
//   REQ-WEB-065  면제는 같은 줄에 사람·시각·사유로 펼친다
//
// **라우트째로 그린다.** 카드 하나만 떼어 그리면 `<Link>` 가 라우터를 못 찾아 터지고,
// 그것을 피하려고 링크를 걷어내면 정작 검사해야 할 provenance 링크가 테스트에서 사라진다.

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

const FINDING = {
  id: '0f3a91c2-7d10-4b55-9a3e-1c2d3e4f5a6b',
  severity: 'critical',
  status: 'open',
  category: 'security',
  title: '세션 토큰이 localStorage 에 평문 저장',
  tags: ['spec_drift'],
  file_path: 'src/widget/session.ts',
  line_start: 88,
  occurrence_count: 3,
  head_sha: '9a41c2ffee11',
  branch: 'feature/widget-v2',
  round_no: 3,
  spec_key: 'SPC-CWC-007',
  requirement_ref: 'REQ-CWC-031',
  symbol: 'restoreSession',
  detail_md: 'XSS 한 번이면 그대로 새어 나간다. 서버 세션 쿠키로 옮겨야 한다.',
  suggestion_md: 'httpOnly 쿠키 + 서버 세션으로 전환',
};

const BARE = {
  ...FINDING,
  id: '11112222-3333-4444-5555-666677778888',
  severity: 'warning',
  title: '로더 캐시 헤더 TTL 미지정',
  tags: [],
  file_path: null,
  line_start: null,
  spec_key: null,
  requirement_ref: null,
  occurrence_count: 1,
  detail_md: null,
  suggestion_md: null,
};

const GATE_ROWS = [
  {
    branch: 'hotfix/session-restore',
    head_sha: '3d90f1aabb',
    round_no: 2,
    resolved: 4,
    total: 5,
    verdict: 'pending',
    bypasses: [
      {
        display_name: '하나',
        decided_at: new Date(Date.now() - 3_600_000).toISOString(),
        bypass_reason: '핫픽스 배포, 사후 리뷰 예약',
      },
    ],
  },
];
// 응답은 **잘린 사실을 함께 준다** — total 이 없으면 화면이 "이게 전부"라고 거짓말한다
const GATE = { items: GATE_ROWS, total: 441 };

/** 처분 호출을 잡아 두는 곳 — 무엇을 보냈는지가 검사 대상이다 */
let posted: { url: string; body: unknown }[] = [];
/** 이 사람의 역할 — 권한 축이 둘로 갈리는 것을 보려면 갈아 끼울 수 있어야 한다 */
let roles: string[] = ['qa'];
/**
 * 곁레일이 서는 폭인가(`xl` 이상). **jsdom 에는 `matchMedia` 가 없어** 그대로 두면 훅이
 * 늘 좁은 화면으로 읽는다 — 폭이 이 화면의 배치를 가르는 축이 된 뒤로(REQ-WEB-161) 둘 다
 * 태워야 하므로 여기서 손잡이로 만든다. 기본은 넓은 화면이다(이 파일의 나머지가 보는 배치).
 */
let wide = true;

beforeEach(() => {
  localStorage.clear();
  posted = [];
  roles = ['qa'];
  wide = true;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: wide,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const path = String(url);
      if (init?.method === 'POST') {
        posted.push({ url: path, body: JSON.parse(init.body ?? '{}') });
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      if (path.includes('/specs/tree')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { id: 'sp-1', key: 'SPC-CWC-007', title: '웹챗 위젯', type: 'feature' },
          ],
        };
      }
      if (path.includes('/specs/SPC-CWC-007')) {
        // 증거는 그 문서의 **지금 버전**이다
        return { ok: true, status: 200, json: async () => ({ version_id: 'v-77' }) };
      }
      if (path.includes('/comments')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                id: 'c-1',
                body_md: '이건 의도된 동작이다',
                author_name: '규아',
                is_agent: false,
                created_at: new Date().toISOString(),
              },
            ],
          }),
        };
      }
      const json = path.includes('/findings')
        ? {
            items: [FINDING, BARE],
            facets: {
              severity: { critical: 1, warning: 1, info: 42 },
              status: { open: 2, dismissed: 7 },
              tag: { spec_drift: 1 },
            },
          }
        : path.includes('/gates/reviews')
          ? GATE
          : path.includes('/me')
            ? {
                id: 'u-1',
                display_name: '규아',
                memberships: [
                  { org_slug: 'nerv', project_slug: 'clemvion', roles, project_id: 'p-1' },
                ],
              }
            : path.includes('/projects/clemvion')
              ? { id: 'p-1', slug: 'clemvion', key: 'CLV', name: 'clemvion', org_slug: 'nerv' }
              : { items: [], memberships: [], count: 0, summary: {} };
      return { ok: true, status: 200, json: async () => json };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

async function renderCenter(): Promise<void> {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/p/clemvion/reviews'] }),
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
  await waitFor(() => expect(screen.getAllByTestId('finding-card').length).toBe(2));
}

describe('S6 발견 큐 — provenance 와 dedup (REQ-WEB-062·063)', () => {
  it('코드 위치·검토 커밋·유래 스펙을 함께 적는다', async () => {
    await renderCenter();
    const card = within(screen.getAllByTestId('finding-card')[0]!);
    expect(card.getByText('src/widget/session.ts:88')).toBeDefined();
    expect(card.getByText('feature/widget-v2 @ 9a41c2f')).toBeDefined();
    expect(card.getByText('SPC-CWC-007 / REQ-CWC-031')).toBeDefined();
  });

  it('없는 출처는 빈칸이 아니라 "없음"이다 — 빈칸은 "아직 안 불러왔나"로 읽힌다', async () => {
    await renderCenter();
    const bare = within(screen.getAllByTestId('finding-card')[1]!);
    expect(bare.getAllByText('없음')).toHaveLength(2);
  });

  it('같은 지적은 카드 하나 + 관측 횟수다 (fingerprint dedup)', async () => {
    await renderCenter();
    expect(screen.getByTestId('finding-occurrences').textContent).toContain('3회 관측');
  });

  it('표시 키를 만들지 않는다 — "짧은 id" 라고 밝히고 **뒤** 8자를 준다', async () => {
    await renderCenter();
    // 밝히지 않으면 사람은 그것을 전체 id 로 오해하고 어딘가에 붙여 넣는다.
    // 앞자리가 아닌 이유: UUIDv7 의 앞 48비트는 시각이라 같은 리뷰에서 나온 발견들이
    // 전부 같은 앞자리를 갖는다(실측 — 시드 화면에서 세 발견이 모두 `01990a66` 이었다).
    expect(screen.getByText('짧은 id 3e4f5a6b')).toBeDefined();
    // 두 발견의 짧은 id 는 서로 달라야 한다 — 같으면 손잡이가 아니다
    expect(screen.getByText('짧은 id 77778888')).toBeDefined();
  });

  it('심각도는 색만이 아니라 라벨로도 나온다 (REQ-WEB-033)', async () => {
    await renderCenter();
    const card = within(screen.getAllByTestId('finding-card')[0]!);
    expect(card.getByText('critical')).toBeDefined();
  });
});

describe('S6 규모 — 잘린 사실을 말한다 (REQ-WEB-067)', () => {
  it('큐가 잘리면 "몇 건 중 몇 건"을 적고 더 보기를 준다', async () => {
    await renderCenter();
    // 픽스처는 열린 것 2건인데 facet 은 2건이라 잘리지 않는다 → 표기도 없다
    expect(screen.queryByTestId('queue-more')).toBeNull();
  });
});

describe('S6 필터 — facet 은 같은 응답에서 온다 (REQ-WEB-061)', () => {
  it('필터 칸의 숫자가 facet 값이다 — 따로 세지 않는다', async () => {
    await renderCenter();
    const info = screen.getByTestId('facet-info');
    expect(info.textContent).toContain('42');
    expect(screen.getByTestId('facet-critical').textContent).toContain('1');
  });

  it('태그 facet 은 서버가 준 것만 그린다 — 없는 태그 칸을 만들지 않는다', async () => {
    await renderCenter();
    expect(screen.getByTestId('facet-spec_drift')).toBeDefined();
  });

  it('켜짐을 색만으로 알리지 않는다 (REQ-WEB-033)', async () => {
    await renderCenter();
    // 기본은 열린 것만이다 — 큐가 큐이기를 그만두지 않게
    expect(screen.getByTestId('facet-open').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('facet-open').textContent).toContain('☑');
    expect(screen.getByTestId('facet-fixed').textContent).toContain('☐');
  });

  it('필터를 켜면 서버에 그 필터로 다시 묻는다', async () => {
    await renderCenter();
    fireEvent.click(screen.getByTestId('facet-critical'));
    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      expect(calls.some((c) => String(c[0]).includes('severity=critical'))).toBe(true);
    });
  });
});

describe('S6 처분 — 근거 없는 처분은 없다 (REQ-WEB-064)', () => {
  it('근거가 비면 보낼 수 없고, 채우면 보낼 수 있다', async () => {
    await renderCenter();
    fireEvent.click(screen.getAllByTestId('resolve-dismissed')[0]!);
    const dialog = within(screen.getByTestId('resolve-dialog'));
    const submit = dialog.getByText('처분').closest('button') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(dialog.getByTestId('resolve-rationale'), { target: { value: '오탐이다' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.body).toMatchObject({ resolution: 'dismissed', rationale: '오탐이다' });
  });

  it('fixed 는 커밋까지 있어야 한다 — 검증 가능한 사실만 통과한다', async () => {
    await renderCenter();
    fireEvent.click(screen.getAllByTestId('resolve-fixed')[0]!);
    const dialog = within(screen.getByTestId('resolve-dialog'));
    fireEvent.change(dialog.getByTestId('resolve-rationale'), { target: { value: '고쳤다' } });
    const submit = dialog.getByText('처분').closest('button') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(dialog.getByTestId('resolve-commit'), { target: { value: 'dddd444' } });
    expect(submit.disabled).toBe(false);
  });

  it('dismissed 에는 커밋 칸이 없다 — 요구하지 않는 것을 묻지 않는다', async () => {
    await renderCenter();
    fireEvent.click(screen.getAllByTestId('resolve-dismissed')[0]!);
    expect(within(screen.getByTestId('resolve-dialog')).queryByTestId('resolve-commit')).toBeNull();
  });
});

describe('S6 게이트 현황 — 면제가 조용히 일어나지 않는다 (REQ-WEB-065)', () => {
  it('브랜치마다 커버 리뷰·해소·판정을 적는다', async () => {
    await renderCenter();
    const table = within(screen.getByTestId('gate-coverage'));
    expect(table.getByText('hotfix/session-restore')).toBeDefined();
    expect(table.getByText('3d90f1a · 2R')).toBeDefined();
    expect(table.getByText('4/5')).toBeDefined();
    expect(table.getByText('대기')).toBeDefined();
  });

  it('면제한 사람·시각·사유가 같은 줄에 펼쳐진다', async () => {
    await renderCenter();
    const bypass = screen.getByTestId('gate-bypass').textContent ?? '';
    expect(bypass).toContain('하나');
    expect(bypass).toContain('핫픽스 배포, 사후 리뷰 예약');
    expect(bypass).toContain('1시간 전');
  });

  it('막지는 않는다고 화면이 말한다 — 표시와 집행을 섞지 않는다', async () => {
    await renderCenter();
    expect(screen.getByText(/아직 막지는 않습니다/)).toBeDefined();
  });

  it('잘랐으면 잘랐다고 말한다 — clemvion 실측 441 브랜치 (REQ-WEB-067)', async () => {
    await renderCenter();
    // 20개만 그리고 아무 말도 안 하면 화면은 "브랜치가 20개뿐"이라고 거짓말한다
    expect(screen.getByTestId('gate-truncated').textContent).toContain('441');
  });
});

// 2026-08-30 사람 보고 — "리뷰 페이지에 한 줄만 있어서 무엇을 말하는지 알 수 없다".
// 에이전트는 처음부터 본문과 제안을 채워 보내고 있었고(sudoku 10/10 · clemvion
// 18,652/18,654) API 도 실어 주고 있었는데, **카드가 제목만 그렸다.**
describe('발견의 본문과 제안 (2026-08-30)', () => {
  it('펼치면 내용과 제안이 나온다 — 제목은 손잡이일 뿐이다', async () => {
    await renderCenter();
    await screen.findByText('세션 토큰이 localStorage 에 평문 저장');

    // 접힘이 기본이다 — 18,650건짜리 큐에서 전부 펼치면 고를 수가 없다
    expect(screen.queryByTestId('finding-detail')).toBeNull();

    const card = screen.getAllByTestId('finding-card')[0]!;
    fireEvent.click(within(card).getByTestId('finding-toggle'));

    expect(within(card).getByTestId('finding-detail').textContent).toContain('XSS 한 번이면');
    expect(within(card).getByTestId('finding-suggestion').textContent).toContain('httpOnly 쿠키');
  });

  it('본문이 없는 발견에는 펼침 단추를 두지 않는다 — 눌러도 빈 자리다', async () => {
    await renderCenter();
    await screen.findByText('로더 캐시 헤더 TTL 미지정');
    const bare = screen.getAllByTestId('finding-card')[1]!;
    expect(within(bare).queryByTestId('finding-toggle')).toBeNull();
  });

  it('고르면 레일이 카드가 자르는 것을 편다 — 갈래·심볼·전체 경로', async () => {
    await renderCenter();
    const card = await screen.findByText('세션 토큰이 localStorage 에 평문 저장');
    expect(screen.queryByTestId('finding-rail')).toBeNull();

    fireEvent.click(card);
    const rail = await screen.findByTestId('finding-rail');
    expect(rail.textContent).toContain('security');
    expect(rail.textContent).toContain('restoreSession');
    expect(rail.textContent).toContain('src/widget/session.ts:88');
  });
});

// 2026-08-30 사람 물음 — "피드백을 하면 이후 흐름이 어떻게 흘러가나".
// 예전 답은 "아무 데로도" 였다: 처분 3종 말고는 적을 자리가 없었다.
describe('발견의 피드백 (2026-08-30)', () => {
  it('레일에서 말을 남긴다 — 그 말은 지적한 세션에게 간다', async () => {
    await renderCenter();
    fireEvent.click(await screen.findByText('세션 토큰이 localStorage 에 평문 저장'));

    const rail = await screen.findByTestId('finding-rail');
    // 이미 달린 말이 대화로 보인다
    await waitFor(() =>
      expect(screen.getByTestId('finding-comments').textContent).toContain('이건 의도된 동작이다'),
    );

    fireEvent.change(within(rail).getByTestId('comment-input'), {
      target: { value: '다시 봤는데 맞는 지적이다' },
    });
    fireEvent.click(within(rail).getByTestId('comment-submit'));
    await waitFor(() => expect(posted.some((p) => p.url.includes('/comments'))).toBe(true));
    expect(posted.find((p) => p.url.includes('/comments'))?.body).toMatchObject({
      body_md: '다시 봤는데 맞는 지적이다',
    });
  });

  it('발견을 Task 로 올린다 — "나중에 하자" 가 갈 곳이다', async () => {
    await renderCenter();
    fireEvent.click(await screen.findByText('세션 토큰이 localStorage 에 평문 저장'));
    const rail = await screen.findByTestId('finding-rail');

    fireEvent.click(within(rail).getByTestId('promote-task'));
    await waitFor(() => expect(posted.some((p) => p.url.endsWith('/task'))).toBe(true));
  });

  it('빈 코멘트는 보내지 않는다 — 빈 줄은 대화가 아니다', async () => {
    await renderCenter();
    fireEvent.click(await screen.findByText('세션 토큰이 localStorage 에 평문 저장'));
    const rail = await screen.findByTestId('finding-rail');
    expect(within(rail).getByTestId('comment-submit').hasAttribute('disabled')).toBe(true);
  });
});

// 2026-08-30 사람 요청 — 에이전트 경로만 열려 있던 처분을 사람에게도 준다.
// 구현이 맞고 스펙이 틀린 지적은 코드가 아니라 문서를 고쳐 닫힌다.
describe('스펙 정정으로 닫기 (REQ-WEB-117)', () => {
  it('처분이 넷이다 — 커밋 없는 수정에도 정직한 길이 있다', async () => {
    await renderCenter();
    await screen.findByText('세션 토큰이 localStorage 에 평문 저장');
    const card = screen.getAllByTestId('finding-card')[0]!;
    expect(within(card).getByTestId('resolve-spec_change')).toBeDefined();
  });

  it('버전 id 를 묻지 않는다 — 문서만 고르면 그 지금 버전이 증거다', async () => {
    await renderCenter();
    await screen.findByText('세션 토큰이 localStorage 에 평문 저장');
    const card = screen.getAllByTestId('finding-card')[0]!;
    fireEvent.click(within(card).getByTestId('resolve-spec_change'));

    const dialog = await screen.findByTestId('resolve-dialog');
    // 지적이 나온 문서가 미리 골라져 있다 — 대개 그것을 고친다
    expect(within(dialog).getByTestId('resolve-spec-key').textContent).toBe('SPC-CWC-007');

    fireEvent.change(within(dialog).getByTestId('resolve-rationale'), {
      target: { value: '구현이 맞고 스펙이 틀렸다 — 스펙을 정정했다' },
    });
    fireEvent.click(within(dialog).getByTestId('resolve-submit'));

    await waitFor(() => expect(posted.some((p) => p.url.includes('/resolve'))).toBe(true));
    expect(posted.find((p) => p.url.includes('/resolve'))?.body).toMatchObject({
      resolution: 'spec_change',
      spec_version_id: 'v-77',
    });
  });
});

/**
 * 승격의 권한 축(2026-09-05 감사 · 07).
 *
 * 서버는 `task:update` 를 요구하는데 화면은 `review:resolve` 로 잠가서, **developer 는
 * 권한이 있는데 누를 수 없었다.** 지적을 받은 사람이 그것을 자기 백로그로 넘기지 못하면
 * 옮기는 일이 처분 권한을 가진 세 역할에게 몰린다.
 */
describe('승격은 처분과 다른 축이다 (07)', () => {
  it('developer 는 처분은 못 해도 승격은 한다', async () => {
    roles = ['developer'];
    await renderCenter();
    fireEvent.click(await screen.findByText('세션 토큰이 localStorage 에 평문 저장'));
    const rail = await screen.findByTestId('finding-rail');

    expect(within(rail).getByTestId('promote-task').hasAttribute('disabled')).toBe(false);
    // 처분 쪽은 그대로 잠겨 있어야 한다 — 한쪽을 열면서 다른 쪽까지 열지 않았다
    const cards = screen.getAllByTestId('finding-card');
    expect(within(cards[0]!).getByTestId('resolve-fixed').hasAttribute('disabled')).toBe(true);
  });

  it('viewer 는 둘 다 못 한다 — `task:update` 가 없는 역할이다', async () => {
    roles = ['viewer'];
    await renderCenter();
    fireEvent.click(await screen.findByText('세션 토큰이 localStorage 에 평문 저장'));
    const rail = await screen.findByTestId('finding-rail');

    expect(within(rail).getByTestId('promote-task').hasAttribute('disabled')).toBe(true);
  });
});

// ── 세 칸의 스크롤 상자 (2026-09-10 · 사람 지시 · REQ-WEB-158) ────────────────────
//
// 스크롤 상자가 페이지였다 — 큐가 화면보다 길면 바퀴를 **레일 위에서 굴려도 움직이는
// 것은 큐**였고(레일이 더 흘릴 것이 없으면 스크롤은 페이지로 넘어간다), 게이트 현황은
// 세 칸을 다 지난 바닥에 따로 누워 있었다. jsdom 은 레이아웃을 재지 않으므로 여기서
// 태우는 것은 **어디가 스크롤 상자이고 무엇이 어느 칸에 사는가** 라는 계약이다 —
// 실제로 페이지가 가만히 있는지는 L3 가 잰다(§2.4 REQ-WEB-156 과 같은 나눔).
describe('세 칸의 스크롤 상자 (REQ-WEB-158)', () => {
  it('페이지가 화면 높이를 쥐고, 머리 아래의 줄만 남은 높이를 나눈다', async () => {
    await renderCenter();
    const content = await screen.findByTestId('review-content');
    const row = content.parentElement;
    const page = row?.parentElement;
    expect(page?.className).toContain('lg:h-[calc(100dvh-var(--spacing-header))]');
    expect(page?.className).toContain('lg:overflow-hidden');
    // 높이만 잡으면 헛돈다 — 줄이 `min-h-0` 이 아니면 칸이 상자보다 커져 안쪽 스크롤이
    // 서지 않는다(격자의 `minmax(0,1fr)` 과 같은 이유다)
    expect(row?.className).toContain('lg:min-h-0');
    expect(row?.className).toContain('lg:flex-1');
  });

  it('세 칸이 각자 세로만 연다 — 가로까지 열면 칸이 통째로 옆으로 밀린다', async () => {
    await renderCenter();
    fireEvent.click(await screen.findByText('세션 토큰이 localStorage 에 평문 저장'));
    for (const id of ['review-filters', 'review-content']) {
      const box = screen.getByTestId(id);
      expect(box.className).toContain('lg:overflow-y-auto');
      // REQ-WEB-151 이 레일에서 겪은 그 모양이다 — 가로는 **명시로** 잠근다
      expect(box.className).toContain('lg:overflow-x-hidden');
      expect(box.className).toContain('lg:h-full');
    }
    // 레일은 틀이 서 있고 **내용이 그 안에서** 흐른다 — 테두리까지 함께 흘러 올라가지 않는다
    const rail = screen.getByTestId('review-rail');
    expect(rail.className).toContain('xl:h-full');
    expect(rail.firstElementChild?.className).toContain('xl:overflow-y-auto');
    // 페이지가 스크롤하지 않으므로 붙일 것이 없다 — 그 자리의 `sticky` 는 아무 일도 안 한다
    expect(rail.innerHTML).not.toContain('sticky');
  });

  it('게이트 현황은 컨텐츠 칸 안에 산다 — 칸을 가둔 뒤에도 닿는 길이 있어야 한다', async () => {
    await renderCenter();
    const content = await screen.findByTestId('review-content');
    expect(content.contains(screen.getByTestId('gate-coverage'))).toBe(true);
    // 큐와 **같은 칸**이다 — 둘이 한 상자에서 이어 읽힌다
    expect(content.contains(screen.getAllByTestId('finding-card')[0]!)).toBe(true);
  });
});

/**
 * **레일은 넓은 화면의 향상이지 유일한 경로가 아니다**(2026-09-10 — 사람 보고 · REQ-WEB-161).
 *
 * 곁레일은 `xl`(1280px) 부터만 서는데, 그 아래에서는 발견을 눌러도 카드 배경만 옅게 바뀌고
 * 레일이 펴는 것(갈래·심볼·전체 경로·코멘트·Task 승격)에 닿을 길이 **아예 없었다** —
 * 1024~1279px 는 노트북의 흔한 폭이다. §2.6 이 세션에서 이미 정한 규칙이다(REQ-WEB-132·142).
 */
describe('좁은 화면에서도 고른 하나를 편다 (REQ-WEB-161)', () => {
  it('곁레일이 서지 않으면 그 카드 아래에서 편다', async () => {
    wide = false;
    await renderCenter();
    fireEvent.click(await screen.findByText('세션 토큰이 localStorage 에 평문 저장'));

    const inline = await screen.findByTestId('finding-rail-inline');
    // 카드 아래다 — 목록 어딘가가 아니라 고른 그 줄이어야 "이것의 상세" 로 읽힌다
    expect(screen.getAllByTestId('finding-card')[0]!.parentElement?.contains(inline)).toBe(true);
    // 레일이 펴는 것에 실제로 닿는다(카드가 자르는 심볼·승격 단추)
    expect(within(inline).getByTestId('promote-task')).toBeDefined();
    expect(within(inline).getByTestId('finding-comments')).toBeDefined();
  });

  it('한 벌만 그린다 — 두 벌이면 코멘트 입력의 상태가 갈린다', async () => {
    wide = false;
    await renderCenter();
    fireEvent.click(await screen.findByText('세션 토큰이 localStorage 에 평문 저장'));

    expect(screen.getAllByTestId('finding-rail')).toHaveLength(1);
    expect(screen.queryByTestId('review-rail')).toBeNull();
  });

  it('넓은 화면에서는 곁레일에만 있다 — 카드 아래에 또 그리지 않는다', async () => {
    await renderCenter();
    fireEvent.click(await screen.findByText('세션 토큰이 localStorage 에 평문 저장'));

    expect(screen.queryByTestId('finding-rail-inline')).toBeNull();
    expect(screen.getByTestId('review-rail').contains(screen.getByTestId('finding-rail'))).toBe(
      true,
    );
  });
});
