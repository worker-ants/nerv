// /p/:proj/specs/:spec → S3 스펙 상세 (ui-wireframes §2.3 · screens.md §2.4 · §3)
//
// 3열이다: 좌 트리 · 중앙 본문 · 우 상태 패널. 우측이 이 화면의 무게중심인데, 거기 있는 것이
// **버전 · 관계(역참조) · 코멘트 · 승인**이기 때문이다 — "이 문서를 고치면 무엇이 흔들리는가"에
// 답하지 못하는 편집기는 문서를 고치게 만들지 말아야 한다.

import { useT } from '../../lib/i18n.js';
import { useTitleDetail } from '../../lib/title-detail.js';
import { useApiError } from '../../lib/api-errors.js';
import { scrollEdges, type ScrollEdges } from '../../lib/scroll-edges.js';
import {
  createFileRoute,
  Link,
  useNavigate,
  useRouter,
  useRouterState,
} from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useRef, useState } from 'react';
import { BaselineSelect } from '../../features/spec-editor/baseline-controls.js';
import { MetaDialog } from '../../features/spec-editor/meta-dialog.js';
import { SpecEditor } from '../../features/spec-editor/editor.js';
import {
  DerivedTaskPanel,
  RequirementPanel,
} from '../../features/spec-editor/requirement-panel.js';
import { SourceView } from '../../features/spec-editor/source-view.js';
import { TerminalHandoffCard } from '../../features/spec-editor/terminal-handoff.js';
import { VersionDiff } from '../../features/spec-editor/version-diff.js';
import { NextStep } from '../../features/spec-editor/next-step.js';
import { SpecToc } from '../../features/spec-editor/spec-toc.js';
import { CommentList } from '../../features/spec-editor/comment-list.js';
import type { AnchorChoice } from '../../features/spec-editor/comment-list.js';
import { dropLeadingTitle, headingElement, markdownHeadings } from '../../lib/spec-anchors.js';
import { useMediaQuery } from '../../lib/use-media-query.js';
import { AttachmentPanel } from '../../features/spec-editor/attachment-panel.js';
import { RelationTabs } from '../../components/relation-tabs.js';
import type { RelationDirection } from '../../components/relation-tabs.js';
import { StatusBadge } from '../../components/status-badge.js';
import { SPEC_VERSION_TOKEN } from '../../components/status-token.js';
import { statusLabelKey, TASK_CREATE_ROLES } from '@nerv/schema';
import { apiFetch, NervApiError } from '../../lib/api.js';
import { usePressKey } from '../../lib/press-key.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import {
  rows,
  useMe,
  useSpec,
  useSpecCheck,
  useSpecComments,
  useSpecRelations,
  useSpecDiff,
  useSpecVersion,
  useSpecAttachments,
  useRequirements,
  useProject,
  useSpecTree,
  useSpecVersions,
} from '../../lib/queries.js';
import { ancestorsOf } from '../../components/spec-tree.js';
import type { TreeNode } from '../../components/spec-tree.js';
import { relativeTime } from '../../lib/format.js';
import { rolesInProject } from '../../lib/session.js';
import { useScope } from '../../lib/scope.js';
import { useRememberVisit } from '../../components/quick-switcher.js';
import { cn } from '../../lib/utils.js';
import {
  Avatar,
  Button,
  GlyphChip,
  Mono,
  PageBody,
  Skeleton,
} from '../../components/ui/primitives.js';
import { ErrorState, NotFoundState, isNotFound } from '../../components/query-state.js';
import type { StatusToken } from '../../components/status-badge.js';
import { asProjectId } from '../../lib/query-keys.js';
import { useScrollTopOn } from '../../lib/scroll-top.js';

export const Route = createFileRoute('/p/$proj/specs/$spec')({
  /**
   * 두 축이 주소에 있다(§2.4). `?v=3` 은 그 버전 전문, `?diff=v2..v3` 은 두 버전의 차이 —
   * **화면 상태가 아니라 주소가 진실이라** 공유·북마크·뒤로가기가 그대로 산다.
   */
  validateSearch: (
    search: Record<string, unknown>,
  ): { v?: number; diff?: string; baseline?: string; rail?: RailTab; body?: BodyTab } => ({
    ...(typeof search['v'] === 'string' || typeof search['v'] === 'number'
      ? { v: Number(search['v']) }
      : {}),
    ...(typeof search['diff'] === 'string' && DIFF_RE.test(search['diff'])
      ? { diff: search['diff'] }
      : {}),
    // **레일도 주소의 축이다**(REQ-WEB-163). 알림이 "코멘트가 달렸다" 를 전하면서 본문만
    // 열어 주면, 정작 읽으러 온 코멘트는 레일 다섯 탭 중 하나에 접혀 있다. 어휘 밖 값은
    // 버린다 — 탭 이름은 닫힌 집합이라 모르는 값에 화면을 맞출 자리가 없다.
    ...(isRailTab(search['rail']) ? { rail: search['rail'] } : {}),
    // **본문을 보는 방식도 주소의 축이다**(REQ-WEB-173). 소스를 보고 있는 화면을 그대로
    // 넘겨줄 수 있어야 한다 — "거기 원문 몇 번째 줄" 이 오가는 대화가 그것이다.
    ...(isBodyTab(search['body']) ? { body: search['body'] } : {}),
    // 목록에서 고른 기준선을 그대로 물고 온다 — 상세도 같은 세트를 읽어야 한다(REQ-WEB-135)
    ...(typeof search['baseline'] === 'string' && search['baseline'] !== ''
      ? { baseline: search['baseline'] }
      : {}),
  }),
  component: SpecDetailGate,
});

/** `v2..v3` — 양쪽 다 있어야 한 쌍이다 */
const DIFF_RE = /^v(\d+)\.\.v(\d+)$/;

/** 레일 탭 어휘 — 주소(`?rail=`)와 상태가 같은 집합을 쓴다 */
const RAIL_TABS = ['relations', 'requirements', 'versions', 'attachments', 'comments'] as const;
export type RailTab = (typeof RAIL_TABS)[number];

function isRailTab(value: unknown): value is RailTab {
  return typeof value === 'string' && (RAIL_TABS as readonly string[]).includes(value);
}

/**
 * 본문을 보는 방식 — **뷰어와 소스 둘뿐이다**(2026-09-22 사람 결정 · REQ-WEB-173).
 *
 * 편집 탭은 없다. 웹에서 본문을 고치는 경로를 걷어냈기 때문이다 — 본문은 에이전트가 쓴다
 * (§3.1 개정). 둘을 탭으로 가르는 이유는 **축을 사람의 의도로 바꾸기 위해서**다: 예전에는
 * 읽는 면과 고치는 면이 같은 편집기였고 둘을 가르는 것이 "이 문서가 초안인가" 였다.
 */
const BODY_TABS = ['viewer', 'source'] as const;
export type BodyTab = (typeof BODY_TABS)[number];

function isBodyTab(value: unknown): value is BodyTab {
  return typeof value === 'string' && (BODY_TABS as readonly string[]).includes(value);
}

/** 주소의 `diff` 를 두 수로 — 항상 **오래된 쪽 → 새 쪽**이다(added/removed 는 순서가 뜻이다) */
function parseDiff(value: string | undefined): { from: number; to: number } | null {
  const m = value === undefined ? null : DIFF_RE.exec(value);
  if (m === null) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return { from: Math.min(a, b), to: Math.max(a, b) };
}

/**
 * **받아 오기 전에는 문서를 그리지 않는다**(REQ-WEB-198 · 199).
 *
 * 예전에는 받아 오기 전에도 문서 틀을 그렸다 — 제목 자리에 키가 서고, 상태 배지는 기본값
 * `draft` 로 "초안" 이라 말했다. 없는 키로 들어오면 그 모양이 그대로 남아 **빈 초안**처럼 보였다.
 *
 * 문지기를 따로 두는 이유: 본문 쪽은 레일 탭 줄의 폭을 재는 effect 들이 요소가 마운트된 뒤
 * 한 번 붙는다. 같은 컴포넌트 안에서 일찍 돌려보내면 요소가 늦게 서도 그 effect 는 다시 돌지
 * 않는다 — 문서가 도착하면 **새로 마운트**되게 가른다.
 */
/** 버전 탭이 먼저 보이는 수 — 나머지는 "이전 버전 N개 더 보기" 뒤에 있다 */
const VERSION_CAP = 8;

function SpecDetailGate(): React.JSX.Element {
  const t = useT();
  const { proj, spec } = Route.useParams();
  const detail = useSpec(proj, spec, Route.useSearch().baseline);
  // 탭 제목과 헤더 끝이 **이 문서**를 말한다(REQ-WEB-228) — 받아 오는 동안·없는 문서여도 키는 안다
  useTitleDetail({
    key: spec,
    title: typeof detail.data?.['title'] === 'string' ? detail.data['title'] : null,
  });
  if (detail.data !== undefined) return <SpecDetail />;
  return (
    <PageBody>
      {detail.isError ? (
        isNotFound(detail.error) ? (
          <NotFoundState
            title={t('state.spec_not_found', { key: spec })}
            hint={t('state.not_found_item_hint')}
            action={
              <Link to="/p/$proj/specs" params={{ proj }} className="text-sm text-link">
                {t('state.back_to_list')}
              </Link>
            }
          />
        ) : (
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
        )
      ) : (
        <div data-testid="spec-skeleton" className="flex flex-col gap-3">
          <div className="h-9 w-1/2 animate-pulse rounded-nerv bg-bg-sunken" />
          <Skeleton rows={6} />
        </div>
      )}
    </PageBody>
  );
}

function SpecDetail(): React.JSX.Element {
  const t = useT();
  const { proj, spec } = Route.useParams();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();
  const me = useMe();
  const { orgSlug, project: scopeProject } = useScope(proj);
  const detail = useSpec(proj, spec, Route.useSearch().baseline);
  // **연 문서를 최근에 남긴다**(REQ-WEB-223) — ⌘K 에서 고른 것만 쌓이던 "최근 방문" 이 진짜 방문이 된다
  useRememberVisit(
    detail.data === undefined
      ? null
      : {
          key: spec,
          title: String(detail.data['title'] ?? spec),
          type: String(detail.data['type'] ?? ''),
          doc_status:
            typeof detail.data['doc_status'] === 'string' ? detail.data['doc_status'] : null,
          anchor: null,
          kind: 'spec',
          project_slug: proj,
          ...(scopeProject === undefined ? {} : { project_name: String(scopeProject['name']) }),
          ...(orgSlug === null ? {} : { org_slug: orgSlug }),
        },
  );
  const versions = useSpecVersions(proj, spec);
  const requirements = useRequirements(proj, spec);
  const comments = useSpecComments(proj, spec);
  const relations = useSpecRelations(proj, spec);
  const attachments = useSpecAttachments(proj, spec);

  const search = Route.useSearch();
  const navigate = useNavigate();
  const compare = parseDiff(search.diff);
  // `?v=` 가 **기본 버전**을 가리키면 그것은 "다른 버전 보기" 가 아니라 기본 화면이다 — 에이전트가
  // 건넨 주소가 늘 버전을 싣게 되어도(REQ-API-182) 그 버전이 기본이면 평소 화면이 선다
  const askedVersion = typeof search.v === 'number' && Number.isFinite(search.v) ? search.v : null;
  const viewing =
    askedVersion !== null && askedVersion !== Number(detail.data?.['version_no'])
      ? askedVersion
      : null;
  const [diffFull, setDiffFull] = useState(false);
  const diff = useSpecDiff(proj, spec, compare?.from ?? null, compare?.to ?? null);
  // 옛 버전 전문 — 지금 버전이 아닌 것을 볼 때만 부른다
  const pastVersion = useSpecVersion(proj, spec, viewing, viewing !== null);
  /**
   * **보는 버전은 하나다**(2026-09-24 — UI/UX 검토 SPEC-01 · REQ-WEB-214). `?v=4` 로 초안을 열어도
   * 바뀌는 것은 본문뿐이었다 — 머리의 배지와 버전·사전 검토·[검토 요청]·코멘트가 달리는 버전은
   * 계속 승인본(v3)이라, [검토 요청]은 이유 없이 잠겼고 승인본 위의 초안은 웹에서 앞으로 보낼
   * 길이 없었다. 이제 그것들이 전부 여기서 읽는다.
   */
  const viewed: Record<string, unknown> | undefined =
    viewing === null ? detail.data : pastVersion.data;
  const check = useSpecCheck(proj, String(viewed?.['version_id'] ?? ''));

  const [showImpact, setShowImpact] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  // 레일 탭 — 관계가 기본이다: "이 문서를 고치면 무엇이 흔들리나"가 이 레일의 첫 질문이다.
  //
  // **진실은 주소다**(REQ-WEB-163) — `?v`·`?diff` 와 같은 규칙이고, 이유도 같다. 상태로만
  // 들고 있으면 두 가지가 안 된다: 알림이 "코멘트가 달렸다" 를 전하면서 그 코멘트로
  // 데려가지 못하고(레일 다섯 탭 중 하나에 접혀 있다), 사람이 탭을 옮긴 뒤 복사한 주소가
  // 자기가 보던 화면을 열지 않는다.
  //
  // 옮기는 것은 **이력에 쌓지 않는다**(`replace`) — 탭 하나 누를 때마다 뒤로가기가 한 칸씩
  // 늘면 그 단추는 문서를 떠나는 데 쓸 수 없게 된다. 다른 축(`v`·`diff`·`baseline`)은
  // 그대로 물고 간다: 레일을 옮겼다고 보던 버전이 바뀌면 안 된다.
  // **읽는 자리에서도 어휘를 확인한다.** 부모 라우트는 검사하지 않은 인자를 그대로 흘려서, 이
  // 라우트의 `validateSearch` 가 버린 `?rail=그런탭은없다` 가 여기까지 살아 온다. 전에는 마운트
  // 효과가 레일을 관계로 덮어써 가려져 있었다(그 효과가 `?rail=comments` 도 덮었다 — SPEC-03)
  const railTab: RailTab = isRailTab(search.rail) ? search.rail : 'relations';
  const setRailTab = (key: RailTab): void => {
    void navigate({ to: '.', search: (prev) => ({ ...prev, rail: key }), replace: true });
  };
  /**
   * **1열이면 레일은 본문 뒤에 있다**(2026-09-24 · SPEC-X1 · REQ-WEB-215). `lg` 미만에서 레일은 본문
   * 전체 다음에 쌓여, 머리의 칩을 누르거나 `?rail=comments` 로 들어와도 펴진 탭은 수십 화면 아래였다.
   * 그때는 탭을 펴면서 레일로 내려 준다. 2열에서는 옆에 있으니 움직이지 않는다.
   */
  const asideRef = useRef<HTMLElement>(null);
  // **다른 문서로 옮기면 본문과 레일은 처음부터**(REQ-WEB-244). 열쇠는 문서다 — 레일 탭 ·
  // 본문 탭 · 버전은 같은 문서 안의 이동이라 읽던 자리를 지킨다
  const bodyRef = useRef<HTMLDivElement>(null);
  useScrollTopOn(bodyRef, spec);
  useScrollTopOn(asideRef, spec);
  const twoColumns = useMediaQuery('(min-width: 64rem)');
  const openRail = (key: RailTab): void => {
    setRailTab(key);
    if (!twoColumns) asideRef.current?.scrollIntoView?.({ block: 'start' });
  };
  const railLanded = useRef(false);
  useEffect(() => {
    if (railLanded.current || search.rail === undefined || twoColumns) return;
    railLanded.current = true;
    asideRef.current?.scrollIntoView?.({ block: 'start' });
  }, [search.rail, twoColumns]);
  /**
   * 탭 줄의 양 끝 — 잘린 쪽을 흐려 "더 있다" 를 말한다(2026-09-08 · REQ-WEB-154).
   * 줄이 스크롤 상자가 된 뒤에도(REQ-WEB-151) 잘렸다는 **표시**가 없었다: macOS 는
   * 쉬는 동안 스크롤 막대를 숨기므로, 사람은 잘린 탭을 목록의 끝으로 읽는다.
   */
  const railTabsRef = useRef<HTMLDivElement>(null);
  /**
   * **지금 탭은 탭 줄 안에 보인다**(2026-09-24 · REQ-WEB-216). 다섯 탭은 17rem 레일보다 넓어(REQ-WEB-151)
   * 마지막의 코멘트 탭은 줄 밖에 있다 — `?rail=comments` 로 들어오면 열린 탭이 페이드 뒤에 잘려 있었다.
   * 줄만 옆으로 민다(페이지는 움직이지 않는다 — `scrollIntoView` 를 쓰지 않는 이유다).
   */
  useEffect(() => {
    const list = railTabsRef.current;
    const tab = document.getElementById(`spec-rail-tab-${railTab}`);
    if (list === null || tab === null) return;
    const left = tab.offsetLeft - list.offsetLeft;
    const right = left + tab.offsetWidth;
    if (left < list.scrollLeft) list.scrollLeft = left;
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth;
  }, [railTab]);
  const [tabEdges, setTabEdges] = useState<ScrollEdges>('none');
  /**
   * 본문을 보는 방식 — **주소가 진실이다**(REQ-WEB-173 · §1.4 뷰 상태 규약).
   * 기본은 뷰어이고, `?body=source` 면 원문 md 가 선다.
   */
  const bodyTab: BodyTab = isBodyTab(search.body) ? search.body : 'viewer';
  const setBodyTab = (key: BodyTab): void => {
    void navigate({
      to: '.',
      // 기본값은 **주소에 남기지 않는다** — 뜻 없는 인자를 주소에 남기지 않는 규칙이
      // 이미 있다(REQ-WEB-163 의 "v1 에는 아무 인자도 붙이지 않는다").
      search: ({ body: _drop, ...rest }) => (key === 'viewer' ? rest : { ...rest, body: key }),
      replace: true,
    });
  };
  // 관계 안의 두 방향은 **다른 질문**이다: 역참조는 "고치면 무엇이 흔들리나",
  // 레퍼런스는 "이 문서가 무엇에 기대나". 섞어 놓으면 둘 다 훑어야 답이 나온다.
  const [relTab, setRelTab] = useState<RelationDirection>('all');
  // **잘랐으면 잘랐다고 말한다**(REQ-WEB-199). 버전 탭은 수를 전부 세면서 목록은 최신 8개에서
  // 말없이 잘랐다 — 아홉째부터는 [열기]를 누를 자리가 없었다. 보는 버전이 잘린 구간에 있으면
  // 펼친 채로 시작한다.
  const [allVersions, setAllVersions] = useState(false);

  // **스펙이 바뀌면 이 화면의 상태는 전부 남의 것이 된다.** 라우트 파라미터만 바뀌면
  // 리액트는 같은 컴포넌트를 재사용하므로 열어 둔 것이 그대로 살아남는다 — 앞 문서의
  // 영향 미리보기가 다음 문서 위에 떠 있으면, 거기 적힌 수는 이 문서의 것이 아니다.
  //
  // **레일 탭은 여기서 되돌리지 않는다**(2026-09-24 · SPEC-03). 이 효과는 첫 마운트에도 돌아서
  // 알림이 연 `?rail=comments` 를 곧바로 관계 탭으로 덮었다 — REQ-WEB-163(2026-09-10 사람 지시)이
  // 막으려던 바로 그 장면이다. 레일은 주소의 축이라 다른 문서로 가는 링크가 싣지 않으면 저절로
  // 기본으로 돌아가고, 싣고 오면(작업의 출처 요구사항 → `?rail=requirements`) 그것이 맞다.
  useEffect(() => {
    setShowImpact(false);
    setMetaOpen(false);
  }, [spec]);

  const body = String(detail.data?.['body_md'] ?? '');
  const title = String(detail.data?.['title'] ?? spec);
  // 뷰어만 본문 첫 줄의 같은 제목을 뺀다(OBS-04) — 소스 탭은 바이트 그대로다
  const viewerBody = dropLeadingTitle(body, title);
  const pastBody = dropLeadingTitle(String(pastVersion.data?.['body_md'] ?? ''), title);
  /** 뷰어가 그리는 헤딩 — 앵커를 "몇 번째 헤딩인가" 로 푸는 기준이다(lib/spec-anchors.ts) */
  const headings = markdownHeadings(viewing === null ? viewerBody : pastBody);
  /**
   * 코멘트를 달 수 있는 자리 — **보는 버전**의 헤딩(제목 줄 포함)과 요구사항(SPEC-04). 같은 slug 의
   * 헤딩이 둘이면 하나만 싣는다 — 앵커는 slug 라서 둘을 가를 수 없다.
   */
  const commentAnchors: AnchorChoice[] = [];
  const seenAnchors = new Set<string>();
  for (const h of markdownHeadings(
    viewing === null ? body : String(pastVersion.data?.['body_md'] ?? ''),
  )) {
    if (h.slug === '' || seenAnchors.has(h.slug)) continue;
    seenAnchors.add(h.slug);
    commentAnchors.push({
      value: h.slug,
      label: `${'\u00a0\u00a0'.repeat(Math.max(0, h.level - 1))}${h.text.replace(/[`*]/g, '')}`,
      kind: 'heading',
    });
  }
  for (const r of rows(requirements.data)) {
    const ref = String(r['ref'] ?? '');
    if (ref === '' || seenAnchors.has(ref)) continue;
    seenAnchors.add(ref);
    commentAnchors.push({ value: ref, label: ref, kind: 'requirement' });
  }
  const openCommentCount = rows(comments.data).filter((c) => c['status'] === 'open').length;
  const router = useRouter();
  const hash = useRouterState({ select: (s) => s.location.hash });
  /**
   * **앵커로 간다**(2026-09-24 · SPEC-05 · REQ-WEB-215). 목차·사전 검토 지적·코멘트 앵커·본문의
   * `#…` 링크·들어오는 주소의 해시가 모두 이 한 길을 쓴다. 해시가 주소에 남아 그 자리를 건넬 수
   * 있다. 본문은 나중에 그려지므로 잠깐 기다렸다가 찾는다.
   */
  const scrollToAnchor = (anchor: string): boolean => {
    if (/^L\d+$/.test(anchor)) {
      const line = document.getElementById(anchor);
      line?.scrollIntoView({ block: 'center' });
      return line !== null;
    }
    const target = headingElement(
      document.querySelector('[data-testid="editor-content"]'),
      headings,
      anchor,
    );
    target?.scrollIntoView({ block: 'start' });
    return target !== null;
  };
  const goAnchor = (anchor: string): void => {
    void navigate({ to: '.', search: (prev) => prev, hash: anchor, replace: true });
    scrollToAnchor(anchor);
  };
  useEffect(() => {
    if (hash === '') return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = (): void => {
      if (scrollToAnchor(hash) || tries >= 20) return;
      tries += 1;
      timer = setTimeout(attempt, 100);
    };
    attempt();
    return () => clearTimeout(timer);
    // 본문이 바뀌면(다른 버전·늦게 온 본문) 다시 찾는다 — `scrollToAnchor` 가 읽는 헤딩은 이 둘에서 온다
  }, [hash, viewerBody, pastBody, bodyTab]);
  /**
   * **본문 안의 앱 링크는 앱 안에서 옮긴다**(SPEC-05). 읽기 전용 본문에서는 브라우저 기본 동작이
   * 링크를 열어 누를 때마다 앱 전체가 다시 적재됐고, 사이드바 트리의 스크롤 자리를 잃었다.
   * 밖으로 가는 링크는 편집기가 새 탭으로 연다(editor.tsx). 수정 키를 누른 클릭은 브라우저의 것이다.
   */
  const onDocClick = (e: React.MouseEvent): void => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    const link = (e.target as HTMLElement).closest('a');
    const href = link?.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      e.preventDefault();
      goAnchor(href.slice(1));
    } else if (href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/api/')) {
      e.preventDefault();
      router.history.push(href);
    }
  };
  // area 는 임포터가 디렉터리에서 만든 **묶음 노드**다 — 본문이 없는 것이 정상일 수 있다
  const isArea = String(detail.data?.['type'] ?? '') === 'area';
  const docStatus = String(viewed?.['doc_status'] ?? '');
  const versionId = String(viewed?.['version_id'] ?? '');
  const versionNo = Number(viewed?.['version_no'] ?? detail.data?.['version_no']);
  // 누름마다 새 키다(REQ-WEB-195) — 버전 id 로 만들면 그 버전의 두 번째 제출이 첫 응답의 재생이 된다
  const submitPress = usePressKey('submit');
  const submit = useMutation({
    mutationFn: () =>
      apiFetch<Record<string, unknown>>(`/projects/${proj}/spec-versions/${versionId}/submit`, {
        method: 'POST',
        body: {},
        idempotencyKey: submitPress.take(),
      }),
    onSettled: submitPress.release,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.spec(spec) });
      const gate = result['gate'] as { tier?: string } | undefined;
      const approvalId = typeof result['approval_id'] === 'string' ? result['approval_id'] : null;
      pushToast({
        tone: 'ok',
        message:
          result['status'] === 'approved'
            ? t('spec.gate_passed', { tier: gate?.tier ?? 'T0' })
            : t('spec.submit_done'),
        // **결재가 어디서 누구를 기다리는지**로 데려간다(SPEC-02) — 한 줄 토스트로 끝나면 사람은
        // 그 요청이 어디에 섰는지 모른다
        ...(approvalId === null
          ? {}
          : {
              href: `/inbox?focus=${encodeURIComponent(approvalId)}`,
              hrefLabel: t('spec.next.open_inbox'),
            }),
      });
    },
    onError: onApiError,
  });

  // **복구는 이 화면에만 있다**(REQ-WEB-105). 보관한 문서는 목록·트리에서 빠지므로
  // 되살릴 손잡이를 목록에 둘 수 없다 — 주소로 들어온 이 자리가 그 손잡이의 유일한 집이다.
  // **slug 로 떨어뜨리지 않는다**(2026-09-10 · 브랜드 타입이 짚은 자리). 예전에는 문서가
  // 도착하기 전 `proj`(slug)를 대신 담았고, 그동안의 무효화는 아무 캐시에도 닿지 않았다 —
  // 조용히 아무 일도 하지 않는 그 부류다(4.5 §1.4). 없으면 없는 채로 둔다.
  //
  // **문서 응답에서 읽지 않는다**(2026-09-25 실측 — REQ-WEB-228 을 붙이다 드러났다). EP-SPEC-03 은 `project_id` 를
  // 싣지 않아서 이 값은 실제 서버에서 **늘 비어 있었고**, 그래서 파생 작업 목록은 한 번도 불리지 않았으며(늘 "없음")
  // 복구 뒤 무효화도 건너뛰었다. 검사의 가짜 서버만 `project_id` 를 줘서 가려져 있었다. 셸이 이미 받아 둔
  // 프로젝트 조회(같은 slug 키)의 id 를 쓴다 — 새 요청이 없다.
  const projectOfRoute = useProject(proj);
  const projectUuid = asProjectId(projectOfRoute.data?.['id']);
  /**
   * **이 문서가 트리의 어디인가**(2026-09-25 — NAV-13 · REQ-WEB-228). 넓은 화면에서는 옆의 트리 열이 짚어 주지만,
   * 좁은 화면에서는 그 열이 띠 뒤에 접혀 있어 위치를 알 길이 없었다. 트리 열과 **같은 캐시**를 읽는다 — 새 요청이
   * 없다(프로젝트 축 · 같은 기준선).
   */
  const specTree = useSpecTree(proj, projectUuid, false, search.baseline);
  const treeNodes = rows(specTree.data) as unknown as TreeNode[];
  const ancestors = ancestorsOf(treeNodes, spec)
    .map((id) => treeNodes.find((node) => node.id === id))
    .filter((node): node is TreeNode => node !== undefined)
    .reverse();
  const restore = useMutation({
    mutationFn: () =>
      apiFetch<Record<string, unknown>>(`/projects/${proj}/specs/${spec}/restore`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.spec(spec) });
      // 목록으로 돌아오는 것이 복구의 요점이다 — 트리와 표(그래프 응답)를 함께 새로 받는다
      if (projectUuid !== undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.projectSpecTree(projectUuid) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.projectSpecGraph(projectUuid) });
      }
      pushToast({ tone: 'ok', message: t('spec.restore_done') });
    },
    onError: (error: Error) => {
      // 상위가 보관돼 있으면 되살릴 자리가 없다 — 무엇을 먼저 복구해야 하는지 이름으로 말한다
      if (
        error instanceof NervApiError &&
        error.body.details['kind'] === 'parent_archived' &&
        typeof error.body.details['parent'] === 'string'
      ) {
        pushToast({
          tone: 'warn',
          message: t('spec.restore_blocked_parent', { parent: error.body.details['parent'] }),
        });
        return;
      }
      onApiError(error);
    },
  });

  const relationItems = relations.data?.items ?? [];
  // 참조 갱신 — 서버 판정(REQ-WEB-037). 배지는 이 값만 본다.
  const recheck = (detail.data?.['recheck'] ?? {}) as { count?: number; specs?: string[] };
  const recheckCount = typeof recheck.count === 'number' ? recheck.count : 0;
  const recheckSpecs = Array.isArray(recheck.specs) ? recheck.specs : [];
  const backlinks = relationItems.filter((r) => r['direction'] === 'in');
  const outgoing = relationItems.filter((r) => r['direction'] !== 'in');
  const shownRelations = relTab === 'in' ? backlinks : relTab === 'out' ? outgoing : relationItems;

  /**
   * 탭 줄이 어느 쪽으로 잘렸는지 다시 잰다. 스크롤할 때 · 창이 바뀔 때 · **수가 들어올 때**
   * 셋이다 — 마지막이 빠지면 처음 그린 빈 수(0)로 잰 결과가 그대로 남아, 데이터가 도착해
   * 줄이 넓어져도 페이드가 없다.
   */
  const railTabWidths = [
    relationItems.length,
    rows(requirements.data).length,
    rows(versions.data).length,
    rows(attachments.data).length,
    rows(comments.data).length,
  ].join(',');
  useEffect(() => {
    const el = railTabsRef.current;
    if (el === null) return undefined;
    const read = (): void => {
      setTabEdges(scrollEdges(el.scrollLeft, el.scrollWidth, el.clientWidth));
    };
    read();
    el.addEventListener('scroll', read, { passive: true });
    window.addEventListener('resize', read);
    return () => {
      el.removeEventListener('scroll', read);
      window.removeEventListener('resize', read);
    };
    // 활성 탭은 굵어져 줄 폭이 달라진다 — 그것도 다시 재는 계기다
  }, [railTabWidths, railTab]);
  // 역할은 me 의 멤버십에서 온다 — 권한 판정의 정본은 서버지만, 화면은 미리 알려준다.
  // **합집합으로 본다**: 멤버십 한 행만 보면 조직 단위 admin 이 어느 프로젝트에서도
  // 역할이 없는 사람이 되어, 서버가 허용할 편집을 화면이 막는다(실측 2026-08-24).
  const versionRows = rows(versions.data);
  const olderInView = versionRows.slice(VERSION_CAP).some((v) => {
    const no = Number(v['version_no']);
    return no === viewing || no === compare?.to || no === compare?.from;
  });
  const showAllVersions = allVersions || olderInView;
  const versionsShown = showAllVersions ? versionRows.length : VERSION_CAP;
  const canEditMeta = rolesInProject(me.data, orgSlug, proj).some(
    (r) => r === 'planner' || r === 'admin',
  );
  // 작업을 만드는 역할 — 정본은 `@nerv/schema` 다(보드의 [+ 새 작업]과 같은 목록)
  const canCreateTask = rolesInProject(me.data, orgSlug, proj).some((r) =>
    (TASK_CREATE_ROLES as readonly string[]).includes(r),
  );
  /**
   * **보는 것보다 새 초안이 있다**(SPEC-01). 승인본을 보는 사람은 v4 초안이 검토를 기다린다는
   * 사실을 화면 어디에서도 들을 수 없었다 — 버전 탭을 열어야 알았다.
   */
  const newest = versionRows.reduce<Record<string, unknown> | undefined>(
    (top, v) =>
      top === undefined || Number(v['version_no']) > Number(top['version_no']) ? v : top,
    undefined,
  );
  const newerVersion =
    newest !== undefined &&
    Number(newest['version_no']) > versionNo &&
    (newest['status'] === 'draft' || newest['status'] === 'in_review')
      ? newest
      : null;

  return (
    // 3열 중 **좌측 트리는 셸이 세우는 둘째 열이다**(§1.3 · REQ-WEB-226 — `SpecTreeColumn`). 문서를 옮기는
    // 동안(이 컴포넌트가 불러오는 중에도) 열이 남아야 펼침·스크롤이 이어지므로 여기서 그리지 않는다.
    // **상한을 두 겹으로 두면 창을 넓혀도 화면이 자라지 않는다**(2026-09-08 — 사람 지시).
    // 컨테이너 80rem + 본문 44rem 이라 1512px 위로는 늘어나는 것이 여백뿐이었고,
    // 레일은 오른쪽 끝에서 한참 떨어진 채 섰다. 상한을 걷어 레일이 끝에 붙고 본문이
    // 창을 따라 넓어진다 — 좌우 24px(`px-6`)은 보드·목록(`PageBody wide`)과 같은 값이다.
    // **본문도 자기 상자 안에서 흐른다**(2026-09-08 — 사람 지시 · REQ-WEB-156). 여태
    // 스크롤 상자는 문서 전체였다: 본문이 길면(clemvion `data-model` 50,685px = 화면 56장)
    // 바퀴를 어디서 굴리든 페이지가 움직였고, 곁레일은 `sticky` 로 붙어 있을 뿐이라 붙는
    // 자리에 닿기 전까지 본문과 **함께** 위로 밀렸다 — 문서를 읽는 동안 옆의 것이
    // 움직이면 그것은 나란히 놓은 두 칸이 아니다. 화면 높이를 확정하고 본문·레일이
    // 각자 자기 안에서 흐른다(§2.4a 그래프 패널이 먼저 쓴 그 규약이다).
    // 행에 `minmax(0,1fr)` 을 적어야 한다 — 격자의 암시 행은 `auto` 라 내용만큼 자라고,
    // 그러면 칸이 상자보다 커져 **안쪽 스크롤이 서지 않는다**(높이만 잡으면 헛돈다).
    // 높이를 묶는 것은 2열일 때뿐이다: 1열(좁은 화면)에서 두 칸을 각각 가두면 스크롤이
    // 두 겹이 되고, 안쪽 스크롤은 바깥 스크롤에 가려 있다는 것 자체가 보이지 않는다.
    <div
      className="grid w-full gap-6 px-6 py-6 lg:h-below-header
        lg:grid-cols-[1fr_17rem] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden"
    >
      {/* **본문은 창을 따라 넓어진다**(2026-09-08 — 사람 지시 · 2026-08-23 의 44rem 을
          뒤집는다 · 4.5 §2.4d 점화 기록). 읽는 폭을 지키려던 상한이 실제로는 낭비를
          만들었다 — 1280px 에서 본문 폭은 예전과 같고, 그 위로만 넓어진다.

          바닥은 `lg` 부터만 둔다. 2열이 시작되는 가장 좁은 지점(1024px)에서 본문에
          남는 폭이 448px 이라 그보다 큰 바닥을 두면 **페이지가 가로로 밀린다**
          (REQ-WEB-151 이 막은 그 모양이다). 26rem 은 그 아래이고, 1열인 좁은 화면은
          `min-w-0` 그대로다 — 그리고 이 값은 `min-width: auto` 를 덮어써서 넓은 코드
          블록이 트랙을 밀어 넓히지 못하게 한다(넓은 것은 자기 상자 안에서 스크롤).

          `<main>` 이 아니라 `<div>` 다 — 셸이 이미 `<main>` 으로 감싸고 있어(app-shell.tsx)
          여기서 또 쓰면 랜드마크가 **겹쳐 두 개**가 되고, 그것은 유효하지 않은 문서다.
          다른 라우트는 전부 셸의 것 하나만 쓴다. */}
      <div
        ref={bodyRef}
        data-testid="spec-body"
        className="min-w-0 lg:h-full lg:min-w-104 lg:overflow-x-hidden lg:overflow-y-auto lg:pr-1"
      >
        {/* 시안의 문서 머리: **메타 줄 → 큰 제목 → 곁줄** 세 층이다. 제목 옆에 배지를
            늘어놓던 이전 배치는 제목이 배지들과 폭을 다퉜다 — 문서의 이름은 문서에서
            가장 큰 글자여야 하고(33px), 신원(키·타입·버전)은 그 위에 조용히 눕는다.
            세 층을 `<header>` 로 묶지 **않는다**: `position: sticky` 는 부모 상자 안에서만
            붙어 있으므로, 150px 짜리 머리 안에 제목을 두면 머리가 화면을 떠날 때 제목도
            같이 떠난다(실측 2026-08-27 — 그래서 처음 시도가 동작하지 않았다). 제목이
            본문 끝까지 붙어 있으려면 본문만큼 긴 상자의 자식이어야 한다. */}
        {ancestors.length > 0 && (
          <nav
            aria-label={t('spec.ancestors')}
            data-testid="spec-ancestors"
            className="mb-1 flex flex-wrap items-center gap-x-1 text-xs text-text-faint"
          >
            {ancestors.map((node, index) => (
              <Fragment key={node.id}>
                {index > 0 && <span aria-hidden="true">›</span>}
                <Link
                  to="/p/$proj/specs/$spec"
                  params={{ proj, spec: node.key }}
                  search={search.baseline === undefined ? {} : { baseline: search.baseline }}
                  className="rounded-nerv-sm hover:text-text hover:underline"
                >
                  {node.title}
                </Link>
              </Fragment>
            ))}
          </nav>
        )}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <StatusBadge
            token={
              (SPEC_VERSION_TOKEN[docStatus as keyof typeof SPEC_VERSION_TOKEN] ??
                'idle') as StatusToken
            }
            label={t(statusLabelKey('spec', docStatus))}
          />
          <Mono className="text-xs">{spec}</Mono>
          {typeof detail.data?.['type'] === 'string' && (
            <>
              <span aria-hidden="true" className="text-text-ghost">
                ·
              </span>
              <span className="text-sm text-text-faint">{String(detail.data['type'])}</span>
            </>
          )}
          <span aria-hidden="true" className="text-text-ghost">
            ·
          </span>
          <span data-testid="spec-version" className="text-sm text-text-faint">
            v{Number.isFinite(versionNo) ? String(versionNo) : ''}
          </span>
          {/* **어느 세트로 읽고 있는지 화면이 말한다**(REQ-WEB-135). 말하지 않으면 사람은
              최신 버전을 본다고 믿는다 — 기준선의 값어치가 거기서 사라진다.
              그 세트에 이 문서가 없으면(`baseline_pinned: false`) 최신으로 떨어졌다는
              사실까지 말해야 한다. */}
          {typeof detail.data?.['baseline'] === 'string' && (
            <StatusBadge
              token={detail.data['baseline_pinned'] === true ? 'ok' : 'waiting'}
              label={
                detail.data['baseline_pinned'] === true
                  ? `${String(detail.data['baseline'])} ${t('spec.baseline_pinned')}`
                  : `${String(detail.data['baseline'])} ${t('spec.baseline_unpinned')}`
              }
            />
          )}
          {/* **여기서 바꾸거나 풀 수 있어야 한다**(2026-09-24 · SPEC-06). 배지는 말할 뿐이라, 최신으로
              돌아가려면 목록으로 나가 다시 골라야 했다. 기준선으로 읽는 동안에만 선다 */}
          {search.baseline !== undefined && (
            <BaselineSelect
              projectSlug={proj}
              value={search.baseline}
              onChange={(name) =>
                void navigate({
                  to: '.',
                  search: ({ baseline: _baseline, ...rest }) =>
                    name === null ? rest : { ...rest, baseline: name },
                  replace: true,
                })
              }
            />
          )}
          {detail.data?.['basis_superseded'] === true && (
            <StatusBadge token="waiting" label={t('spec.badge_superseded')} />
          )}
          {/* 참조 갱신 배지(REQ-WEB-037) — 내가 참조하는 문서가 나보다 앞서 갔다는 신호.
                이게 없으면 낡은 근거 위에서 계속 쓰게 된다.

                **판정은 서버가 한다**(2026-09-03). 예전에는 "참조하는 approved 문서가 있고
                내가 초안이면" 으로 켰는데, 그것은 초안이면 거의 언제나 참이라 **초안 26버전 중
                26버전에서 켜져 있었다**(실측). 늘 켜진 경고는 아무도 읽지 않는다. 서버는 참조
                전파에서 이미 `spec.recheck_requested` 를 발행하므로, 판정은 "이 버전을 마지막으로
                쓴 뒤 그 신호가 왔는가" 이고 무엇 때문인지도 함께 온다. */}
          {recheckCount > 0 && (
            <span data-testid="recheck-badge" title={recheckSpecs.join(', ')}>
              <StatusBadge token="waiting" label={t('spec.recheck')} />
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">
            {/* 목차 — 긴 문서의 절 사이를 오간다(SPEC-05 · REQ-WEB-215) */}
            <SpecToc headings={headings} onPick={goAnchor} />
            <Button
              size="sm"
              variant="ghost"
              data-testid="meta-open"
              onClick={() => setMetaOpen(true)}
            >
              {t('spec.meta_button')}
            </Button>
          </span>
        </div>
        {/* **이름은 화면을 떠나지 않는다**(2026-08-27 — 사람 요청). 스펙 본문은 길다
            (clemvion 실측: `data-model` 50,685px = 화면 56장). 몇 장만 내려가도 지금
            보는 것이 어느 문서인지가 화면에서 사라지고, 트리에서 눌러 들어온 사람은
            되짚을 것이 스크롤바밖에 없다. 아래로 흐르는 본문을 덮어야 하므로 배경은
            **불투명**하다.

            붙는 자리는 **스크롤 상자가 어디냐**를 따라간다(2026-09-08 · REQ-WEB-156):
            2열에서는 본문 칸이 그 상자라 그 꼭대기(`top-0`)에, 1열에서는 페이지가
            스크롤하므로 셸 헤더 아래(`top-header`)에 붙는다. 그리고 위 여백은
            **메타 줄이 든다** — 제목에 `mt` 를 주면 `sticky` 는 margin 상자를 가두므로
            붙었을 때 그만큼 틈이 남고, 그 틈으로 흐르는 본문이 비쳐 지나간다. */}
        <h1
          data-testid="spec-title"
          className="sticky top-header z-20 bg-bg pt-1.5 pb-0.5 text-3xl font-bold tracking-tight lg:top-0
            after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-2
            after:bg-gradient-to-b after:from-bg after:to-transparent after:content-['']"
        >
          {String(detail.data?.['title'] ?? spec)}
        </h1>
        {/* 곁줄 — 이 문서의 이력·무게가 한 줄로 요약된다(시안: 승인자 · 파생 · 역참조) */}
        <div className="mt-2 mb-3 flex flex-wrap items-center gap-2 border-b border-border pb-5 text-sm text-text-mute">
          <Byline detail={viewed ?? detail.data} backlinks={backlinks.length} t={t} />
        </div>

        {/* **다음 할 일**(2026-09-24 — UI/UX 검토 SPEC-02 · SPEC-08 · SPEC-10 · REQ-WEB-214). 이 화면의 거의
            유일한 결정 단추 [검토 요청]이 본문 칸의 **맨 끝**에 있었다 — 56화면짜리 문서라면 56화면
            아래다. 잠긴 이유도, 검토 중이면 결재가 어디서 기다리는지도, 승인본이면 무엇을 하면 되는지도
            말하지 않았다. 보는 버전의 상태가 이 줄을 정한다 */}
        <NextStep
          proj={proj}
          spec={spec}
          viewed={viewed}
          viewingPast={viewing !== null}
          checkBlocks={
            check.data?.['verdict'] === 'block'
              ? rows(check.data['findings']).filter((f) => f['severity'] === 'block').length
              : 0
          }
          openComments={openCommentCount}
          requirementCount={rows(requirements.data).length}
          canCreateTask={canCreateTask}
          submitting={submit.isPending}
          onSubmit={() => setShowImpact(true)}
          onRail={openRail}
        />
        {showImpact && (
          <div
            role="dialog"
            aria-label={t('spec.impact_dialog')}
            data-testid="impact-preview"
            className="mb-3 w-full rounded-nerv border border-border bg-bg-elev p-3 text-sm"
          >
            <p className="font-medium">{t('spec.impact_title')}</p>
            <ul className="mt-1 flex flex-col gap-0.5 text-text-mute">
              {/* 승인 전에 "무엇이 흔들리나"를 보이는 것이 이 화면의 요점이다 —
                  승인하고 나서 알게 되면 되돌리는 비용이 훨씬 크다 */}
              <li>{t('spec.impact_backlinks', { count: backlinks.length })}</li>
              <li>{t('spec.impact_tasks', { count: rows(detail.data?.['tasks']).length })}</li>
            </ul>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="primary"
                data-testid="impact-confirm"
                disabled={submit.isPending}
                onClick={() => {
                  setShowImpact(false);
                  submit.mutate();
                }}
              >
                {t('spec.impact_send')}
              </Button>
              <Button size="sm" onClick={() => setShowImpact(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}
        {newerVersion !== null && (
          <div
            data-testid="spec-newer-version"
            className="mb-3 flex flex-wrap items-center gap-2 rounded-nerv border border-status-waiting/40 bg-status-waiting-soft px-3 py-1.5 text-sm text-status-waiting"
          >
            <span className="min-w-0 flex-1">
              {t('spec.newer_version', {
                n: Number(newerVersion['version_no']),
                status: t(statusLabelKey('spec', String(newerVersion['status']))),
              })}
            </span>
            <Button
              size="xs"
              variant="subtle"
              data-testid="spec-newer-open"
              onClick={() =>
                void navigate({
                  to: '.',
                  search: ({ diff: _diff, ...rest }) => ({
                    ...rest,
                    v: Number(newerVersion['version_no']),
                  }),
                })
              }
              className="bg-bg-elev text-text"
            >
              {t('spec.newer_open', { n: Number(newerVersion['version_no']) })}
            </Button>
            {Number.isFinite(versionNo) && (
              <Button
                size="xs"
                variant="subtle"
                data-testid="spec-newer-diff"
                onClick={() =>
                  void navigate({
                    to: '.',
                    search: ({ v: _v, ...rest }) => ({
                      ...rest,
                      diff: `v${String(versionNo)}..v${String(newerVersion['version_no'])}`,
                    }),
                  })
                }
                className="bg-bg-elev text-text"
              >
                {t('spec.newer_diff', { from: versionNo, to: Number(newerVersion['version_no']) })}
              </Button>
            )}
          </div>
        )}

        {/* 보관 배너 — 목록에 없는 문서를 주소로 열었을 때, 화면이 그 사실을 **먼저** 말한다.
            이게 없으면 보관된 문서가 평소와 똑같이 열려 살아 있는 기준으로 읽힌다 */}
        {detail.data?.['archived_at'] != null && (
          <div
            data-testid="archived-banner"
            className="mb-3 flex flex-wrap items-center gap-3 rounded-nerv border border-border bg-bg-sunken px-3 py-2 text-sm text-text-mute"
          >
            <StatusBadge token="idle" label={t('specs.archived_badge')} />
            <span className="min-w-0 flex-1">{t('spec.archived_banner')}</span>
            {canEditMeta && (
              <Button
                size="sm"
                data-testid="spec-restore"
                disabled={restore.isPending}
                onClick={() => restore.mutate()}
              >
                {t('spec.restore')}
              </Button>
            )}
          </div>
        )}

        {check.data !== undefined && rows(check.data['findings']).length > 0 && (
          <section
            data-testid="check-findings"
            className="mb-3 rounded-nerv border border-border bg-bg-elev p-3 text-sm"
          >
            <h2 className="mb-1.5 text-xs font-semibold tracking-wide text-text-mute uppercase">
              {t('spec.check_title')}{' '}
              <span
                className={
                  check.data['verdict'] === 'block' ? 'text-status-danger' : 'text-status-waiting'
                }
              >
                {checkLevel(t, check.data['verdict'])}
              </span>
            </h2>
            <ul className="flex flex-col gap-1">
              {rows(check.data['findings']).map((f, i) => (
                <li key={`${String(f['checker'])}-${i}`} className="flex flex-wrap gap-2 text-xs">
                  <span className="font-mono text-text-faint">{String(f['checker'])}</span>
                  <span
                    className={
                      f['severity'] === 'block' ? 'text-status-danger' : 'text-status-waiting'
                    }
                  >
                    {checkLevel(t, f['severity'])}
                  </span>
                  {/* 앵커가 없는 지적은 지적이 아니다 — 어디를 고칠지 못 가리키기 때문이다 */}
                  {/* **앵커는 그 자리로 데려간다**(SPEC-05) — 글자로만 적혀 있어 고칠 곳을 눈으로 찾았다.
                      요구사항 ref 면 레일의 요구사항 탭이 그 자리다 */}
                  {f['anchor'] !== null && (
                    <button
                      type="button"
                      data-testid="check-anchor"
                      onClick={() => {
                        const anchor = String(f['anchor']);
                        if (/^REQ-/.test(anchor)) openRail('requirements');
                        else goAnchor(anchor);
                      }}
                      className="font-mono text-link hover:underline"
                    >
                      {String(f['anchor'])}
                    </button>
                  )}
                  <span className="min-w-0 flex-1">{String(f['message'])}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* **비교 중에는 편집기가 아니라 diff 다**(REQ-WEB-121). 지금 버전이 아닌 것을 보고
            있을 수 있으므로 이 자리에서 고치게 두지 않는다 — 주소를 비우면 돌아온다 */}
        {compare !== null && (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Button
                size="xs"
                variant="subtle"
                data-testid="diff-close"
                // 닫는 것은 **비교만** 내려놓는다 — 레일·기준선·본문 보기는 보던 그대로다(SPEC-03)
                onClick={() =>
                  void navigate({
                    to: '.',
                    search: ({ diff: _diff, v: _v, ...rest }) => rest,
                    replace: true,
                  })
                }
              >
                ← {t('spec.diff.close')}
              </Button>
            </div>
            <VersionDiff
              diff={diff.data}
              isPending={diff.isPending}
              isError={diff.isError}
              versions={rows(versions.data)}
              from={compare.from}
              to={compare.to}
              onChange={(from, to) =>
                void navigate({
                  to: '.',
                  search: ({ v: _v, ...rest }) => ({
                    ...rest,
                    diff: `v${String(Math.min(from, to))}..v${String(Math.max(from, to))}`,
                  }),
                  replace: true,
                })
              }
              full={diffFull}
              onToggleFull={() => setDiffFull(!diffFull)}
            />
          </>
        )}

        {/* 옛 버전 전문 — 읽기 전용이고, 돌아오는 길을 같은 자리에 둔다(§1.5) */}
        {compare === null && viewing !== null && (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-nerv-sm bg-status-waiting-soft px-3 py-1.5 text-sm text-status-waiting">
              <span data-testid="version-view-banner">
                {t('spec.version_view', { n: viewing })}
              </span>
              <Button
                size="xs"
                variant="subtle"
                data-testid="version-view-close"
                onClick={() =>
                  void navigate({
                    to: '.',
                    search: ({ diff: _diff, v: _v, ...rest }) => rest,
                    replace: true,
                  })
                }
                className="bg-bg-elev text-text"
              >
                {t('spec.version_current')}
              </Button>
            </div>
            <div onClick={onDocClick}>
              <SpecEditor key={`v${String(viewing)}`} value={pastBody} />
            </div>
          </>
        )}

        {/* **본문 없는 묶음 노드를 빈 화면으로 두지 않는다**(2026-08-24 · REQ-WEB-068).
            임포터는 디렉터리마다 area 노드를 만드는데, 원본에 `_product-overview.md` 가
            없으면 본문이 없다(4.7 §2.2 — clemvion 실측 area 16개 중 9개). 그냥 비워 두면
            "내용이 사라졌다"로 읽힌다 — 무엇이고 어디로 가면 되는지 말해야 한다(§1.5).
            **편집 권한과 무관하게** 띄운다: 빈 이유를 알아야 하는 것은 읽는 사람도 같다. */}
        {compare === null && viewing === null && body.trim() === '' && (
          <div
            data-testid="spec-empty-body"
            className="mb-3 rounded-nerv border border-border bg-bg-sunken px-3 py-2 text-sm text-text-mute"
          >
            {isArea ? t('spec.empty.area') : t('spec.empty.body')}
          </div>
        )}

        {/* **본문을 보는 방식은 탭이다**(2026-09-22 사람 결정 · REQ-WEB-173). 예전에는
            읽는 면과 고치는 면이 **같은 편집기**였고 둘을 가르는 것이 "이 문서가 초안인가"
            였다 — 사람의 의도가 아니라 문서의 상태가 축이었던 것이고, 그 혼동이 초안의
            mermaid 가 코드로 보이던 결함을 만들었다(REQ-WEB-169). 이제 축은 둘뿐이다. */}
        {compare === null && viewing === null && (
          <div
            className="mb-2 flex items-center gap-1"
            role="tablist"
            aria-label={t('spec.body_tabs')}
          >
            {BODY_TABS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                data-testid={`body-tab-${key}`}
                aria-selected={bodyTab === key}
                onClick={() => setBodyTab(key)}
                className={cn(
                  'rounded-nerv-sm px-2 py-0.5 text-xs',
                  bodyTab === key
                    ? 'bg-bg-active font-medium text-text'
                    : 'text-text-mute hover:bg-bg-hover hover:text-text',
                )}
              >
                {t(key === 'viewer' ? 'spec.body_viewer' : 'spec.body_source')}
              </button>
            ))}
          </div>
        )}

        {/* **문서마다 새 편집기다.** TipTap 인스턴스가 살아남으면 문서 B 를 열어도
            앞 문서의 그림·스크롤이 남는다. 이력은 문서에 속한다. */}
        {compare === null && viewing === null && bodyTab === 'source' && <SourceView body={body} />}

        {compare === null && viewing === null && bodyTab === 'viewer' && (
          <div onClick={onDocClick}>
            <SpecEditor key={spec} value={viewerBody} />
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {/* **본문을 쓰는 단추가 여기 없다**(2026-09-22 사람 결정 · REQ-WEB-173).
              웹은 읽고·결정하고·매다는 자리이고 본문은 에이전트가 쓴다. 그 사실을 화면이
              말하지 않으면 사람은 고칠 곳을 찾아 헤맨다 — §1.5 가 금지하는 막다른 길이다.
              **갈 곳까지 같은 자리에서 준다**: 레일 바닥의 터미널 카드가 그 명령이다. */}
          <span data-testid="body-read-only" className="text-xs text-text-mute">
            {t('spec.body_agent_only')}
          </span>
          {/* [검토 요청]과 영향 미리보기는 **머리의 다음 할 일 줄**로 올라갔다(SPEC-02). 명령 줄의
              복사 없는 사본도 걷었다(SPEC-09) — 복사 단추가 있는 [터미널에서 이어쓰기] 카드 하나다 */}
        </div>
      </div>

      {metaOpen && (
        <MetaDialog
          projectSlug={proj}
          projectId={projectUuid}
          specKey={spec}
          title={String(detail.data?.['title'] ?? spec)}
          // 역할은 me 의 멤버십에서 온다 — 권한 판정의 정본은 서버지만, 화면은 미리 알려준다.
          // **합집합으로 본다**: 멤버십 한 행만 보면 조직 단위 admin 이 어느 프로젝트에서도
          // 역할이 없는 사람이 되어, 서버가 허용할 편집을 화면이 막는다(실측 2026-08-24).
          canEdit={canEditMeta}
          onClose={() => setMetaOpen(false)}
        />
      )}

      {/* 우측이 이 화면의 무게중심이다 — 본문을 내려도 제자리에 있어야 "무엇이 흔들리나"를
          본문과 나란히 볼 수 있다 */}
      {/* **레일도 스스로 스크롤한다.** `sticky` 로 붙여만 두면 내용이 화면보다 길 때
          아래쪽이 영영 닿지 않는다 — 역참조 18건이면 이미 그렇다(실측 2026-08-23).
          높이를 뷰포트에 묶고 넘치면 레일 안에서 흐르게 한다.
          **그 높이는 이제 격자 행이 준다**(2026-09-08 · REQ-WEB-156). 페이지가 스크롤하던
          동안에는 `sticky` + `max-h` 로 뷰포트에 손수 묶어야 했지만, 본문이 자기 안에서
          흐르게 된 뒤로 페이지에는 스크롤이 없다 — 붙일 것이 없는 자리의 `sticky` 는
          아무 일도 하지 않으면서 계산식 둘을 남긴다(같은 값을 두 곳에 적으면 갈린다). */}
      {/* **가로는 레일이 아니라 안의 두 칸이 맡는다**(2026-09-08 — 사람 보고). CSS 에서
          한 축이 `visible` 이 아니면 다른 축도 `auto` 가 되므로, 세로만 흐르게 하려던
          `overflow-y-auto` 가 레일 전체를 **가로 스크롤 상자**로 만들었다 — 탭 다섯이
          17rem 을 넘치자 레일 바닥에 가로 막대가 서고, 그것을 밀면 탭과 본문이 **함께**
          옆으로 밀렸다(고정된 탭 줄 없이 목록만 어긋난다). 레일의 가로는 잠그고 탭 줄과
          본문이 각자 자기 안에서 민다 — 스크롤 상자가 되면 `min-height:auto` 가 0 이
          되므로 둘 다 `shrink-0` 이어야 세로로 찌그러지지 않는다. */}
      <aside
        ref={asideRef}
        className="flex min-w-0 scroll-mt-16 flex-col text-sm lg:h-full lg:overflow-x-hidden lg:overflow-y-auto lg:pr-1"
      >
        {/* **탭이다**(시안). 버전·역참조·코멘트를 세로로 쌓으면 레일이 세 화면 길이가
            되고, 그때 코멘트는 스크롤 끝의 소문이 된다. 한 번에 하나를 보이되 수는
            탭 이름 옆에 미리 적는다 — 눌러 보기 전에 "있는지"는 알아야 한다. */}
        {/* **머리는 스크롤에서 빠진다**(2026-09-08 — 사람 지시 · REQ-WEB-153). 관계가
            93건인 문서에서 목록을 내리면 탭 줄이 화면 위로 사라졌고, 그때 "지금 어느
            탭인가"와 "방향을 바꾸려면 어디로"가 함께 사라진다 — 돌아가려면 레일을
            끝까지 되감아야 했다. 레일이 자기 안에서 스크롤하므로(위) 그 상자에 붙인다.
            배경을 깔지 않으면 목록이 글자 위로 비쳐 지나간다. */}
        <div data-testid="rail-head" className="shrink-0 bg-bg lg:sticky lg:top-0 lg:z-10">
          {/* **잘린 쪽을 흐린다**(2026-09-08 — 사람 지시 · REQ-WEB-154). 줄이 스크롤
              상자가 된 뒤에도 잘렸다는 **표시**가 없었다 — macOS 는 쉬는 동안 막대를
              숨기므로, 사람은 잘린 탭을 목록의 끝으로 읽는다. 페이드는 줄 **위에**
              덮는다: 줄 자신에 마스크를 씌우면 밑줄(`border-b`)까지 흐려진다.
              그래서 `bottom-px` 로 그 1px 을 비켜 준다. */}
          <div className="relative">
            {/* **탭 묶음이라고 말한다**(2026-09-24 · SPEC-X3 · REQ-WEB-215). 굵기와 밑줄 색으로만 지금
                탭을 알려, 보조기기에는 이것이 탭이라는 것도 어느 것이 열렸는지도 없었다. 같은 화면의
                본문 탭은 이미 `tablist` 였다 — 좌우 화살표로 옮긴다 */}
            <div
              ref={railTabsRef}
              data-testid="rail-tabs"
              data-edges={tabEdges}
              role="tablist"
              aria-label={t('spec.rail.label')}
              onKeyDown={(e) => {
                const order = RAIL_TABS;
                const at = order.indexOf(railTab);
                const next =
                  e.key === 'ArrowRight'
                    ? order[(at + 1) % order.length]
                    : e.key === 'ArrowLeft'
                      ? order[(at - 1 + order.length) % order.length]
                      : e.key === 'Home'
                        ? order[0]
                        : e.key === 'End'
                          ? order[order.length - 1]
                          : undefined;
                if (next === undefined) return;
                e.preventDefault();
                setRailTab(next);
                document.getElementById(`spec-rail-tab-${next}`)?.focus();
              }}
              className="flex overflow-x-auto border-b border-border"
            >
              {(
                [
                  ['relations', t('spec.rail.relations'), relationItems.length],
                  // **약속이 레일의 두 번째 질문이다** — "이 문서가 무엇을 약속했고 누가
                  // 지키고 있나"(D-03 · FR-13). 그 답이 화면 어디에도 없었다.
                  ['requirements', t('spec.requirements'), rows(requirements.data).length],
                  ['versions', t('spec.versions'), rows(versions.data).length],
                  ['attachments', t('spec.attachments'), rows(attachments.data).length],
                  // **열린 것만 센다**(SPEC-04) — 해결된 것까지 세어 "코멘트 5" 를 눌렀는데 "열린 코멘트가
                  // 없습니다" 가 떴다. 머리의 칩과 같은 수다
                  ['comments', t('spec.comments'), openCommentCount],
                ] as const
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  id={`spec-rail-tab-${key}`}
                  aria-selected={railTab === key}
                  aria-controls="spec-rail-panel"
                  aria-label={t('spec.rail.tab_label', { label, count })}
                  tabIndex={railTab === key ? 0 : -1}
                  data-testid={`rail-tab-${key}`}
                  onClick={() => setRailTab(key)}
                  className={cn(
                    'flex shrink-0 items-center gap-1 border-b-2 px-2.5 pt-1 pb-2.5 text-sm whitespace-nowrap transition-colors',
                    railTab === key
                      ? 'border-text font-semibold text-text'
                      : 'border-transparent text-text-faint hover:text-text',
                  )}
                >
                  {label}
                  <span aria-hidden="true" className="text-2xs text-text-ghost tabular-nums">
                    {count}
                  </span>
                </button>
              ))}
            </div>

            {/* 페이드는 **신호**라 뜻이 있을 때만 있다 — 끝에 닿았는데 남아 있으면
                "더 있다" 는 거짓말이 된다(판정은 `scrollEdges` 한 곳). */}
            {(tabEdges === 'start' || tabEdges === 'both') && (
              <span
                aria-hidden="true"
                data-testid="rail-tabs-fade-start"
                className="pointer-events-none absolute top-0 bottom-px left-0 w-6 bg-gradient-to-r from-bg to-transparent"
              />
            )}
            {(tabEdges === 'end' || tabEdges === 'both') && (
              <span
                aria-hidden="true"
                data-testid="rail-tabs-fade-end"
                className="pointer-events-none absolute top-0 right-0 bottom-px w-6 bg-gradient-to-l from-bg to-transparent"
              />
            )}
          </div>

          {/* **하위 탭은 방향으로 가른다**(사람 지시 2026-08-24). 관계가 스무 건이
              넘으면 "이 문서를 고치면 무엇이 흔들리나"와 "이 문서가 무엇에 기대나"가
              한 목록에 섞여, 둘 중 하나를 보려면 목록 전체를 훑어야 한다.
              수는 **누르기 전에** 적는다 — 빈 탭을 열어 보게 하지 않는다.
              이 줄도 머리에 있다 — 방향을 바꾸는 손잡이가 목록과 함께 떠나면
              목록을 다 내려간 사람은 되감아야 방향을 바꾼다. */}
          {railTab === 'relations' && (
            // **좁으면 줄을 바꾼다** — 방향 탭 셋 옆에 링크 하나가 더 서면 좁은 레일에서 줄이 레일보다
            // 넓어져 레일 전체가 옆으로 밀렸다(CI 의 리눅스 글꼴 폭에서 18px · spec-navigation L3)
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 pt-2 pb-2">
              <RelationTabs
                value={relTab}
                onChange={setRelTab}
                counts={{ all: relationItems.length, in: backlinks.length, out: outgoing.length }}
              />
              {/* **이 문서 주변을 그림으로**(2026-09-24 · SPEC-07). 목록의 그래프는 늘 전역에서
                  시작해서, 상세에서 "이 문서 주변" 으로 갈 길이 없었다 */}
              {relationItems.length > 0 && (
                <Link
                  to="/p/$proj/specs"
                  params={{ proj }}
                  search={{
                    view: 'graph',
                    focus: spec,
                    ...(search.baseline === undefined ? {} : { baseline: search.baseline }),
                  }}
                  data-testid="rail-graph-link"
                  className="ml-auto shrink-0 text-2xs text-link hover:underline"
                >
                  {t('spec.rail.graph_link')} →
                </Link>
              )}
            </div>
          )}
        </div>

        <div
          data-testid="rail-body"
          role="tabpanel"
          id="spec-rail-panel"
          aria-labelledby={`spec-rail-tab-${railTab}`}
          className="flex shrink-0 flex-col gap-1 overflow-x-auto pt-2.5"
        >
          {railTab === 'relations' && (
            <>
              {shownRelations.length === 0 && (
                <p className="px-2 text-text-faint">{t('common.not_yet')}</p>
              )}

              {/* 역참조 무리 — 설명은 **머리에** 단다(사람 지시 2026-08-24). 꼬리에 달면
                  스무 줄을 다 내려간 뒤에야 "이게 뭐였나"를 알게 되고, 그때는 이미 다
                  읽은 뒤다. 그리고 그 설명이 무엇을 가리키는지는 **보이는 목록에 역참조가
                  있을 때만** 성립한다 — 레퍼런스만 보는 중에 떠 있으면 지금 보고 있는
                  것을 잘못 읽게 된다. */}
              {relTab !== 'out' && backlinks.length > 0 && (
                <>
                  <p className="px-2 pb-1 text-xs text-text-faint">{t('spec.backlinks_hint')}</p>
                  {backlinks.map((r) => (
                    <RelationRow
                      key={relationKey(r)}
                      relation={r}
                      proj={proj}
                      baseline={search.baseline}
                      t={t}
                    />
                  ))}
                </>
              )}

              {/* 전체 탭에서 **방향이 바뀌는 자리**에 선을 긋는다(사람 지시 2026-08-24).
                  화살표만으로는 무리가 바뀐 것을 눈이 알아채지 못한다 — 한쪽이 비어
                  있으면 나눌 것도 없으므로 선도 없다. */}
              {relTab === 'all' && backlinks.length > 0 && outgoing.length > 0 && (
                <hr data-testid="rel-divider" className="my-1.5 border-t border-border" />
              )}

              {relTab !== 'in' &&
                outgoing.map((r) => (
                  <RelationRow
                    key={relationKey(r)}
                    relation={r}
                    proj={proj}
                    baseline={search.baseline}
                    t={t}
                  />
                ))}
            </>
          )}

          {railTab === 'versions' && (
            <ul className="flex flex-col gap-1 px-2">
              {versionRows.slice(0, versionsShown).map((v) => (
                <li
                  key={String(v['id'])}
                  className={cn(
                    'rounded-nerv-sm py-0.5',
                    // 지금 보고 있는 버전을 표시한다 — 목록과 본문이 다른 말을 하지 않게
                    (viewing === Number(v['version_no']) ||
                      compare?.to === Number(v['version_no'])) &&
                      'bg-bg-sunken',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-8 shrink-0 font-mono text-xs text-text-faint">
                      v{String(v['version_no'])}
                    </span>
                    <StatusBadge
                      token={
                        (SPEC_VERSION_TOKEN[
                          String(v['status']) as keyof typeof SPEC_VERSION_TOKEN
                        ] ?? 'idle') as StatusToken
                      }
                      label={t(statusLabelKey('spec', String(v['status'])))}
                    />
                    {/* **바뀐 시각**이지 만든 시각이 아니다 — draft 는 같은 행을
                          덮어쓰므로 created_at 을 적으면 방금 고친 문서가 "2시간 전"이 된다 */}
                    <span className="ml-auto shrink-0 text-2xs text-text-faint">
                      {relativeTime(t, changedAt(v))}
                    </span>
                  </div>
                  {/* **누를 수 있어야 한다**(2026-09-01 — 사람 요청 · REQ-WEB-121·122).
                        서버는 처음부터 diff 를 줄 수 있었는데(EP-SPEC-06) 이 목록이
                        글자였을 뿐이라, "무엇이 바뀌었나" 를 화면에서 물을 수 없었다.
                        누르면 **직전과의 차이**(가장 흔한 물음), 옆이 그 버전 전문이다. */}
                  <div className="mt-0.5 ml-10 flex flex-wrap gap-1.5">
                    <Button
                      size="xs"
                      variant="subtle"
                      data-testid={`diff-open-${String(v['version_no'])}`}
                      disabled={Number(v['version_no']) <= 1}
                      // 첫 버전은 견줄 것이 없다 — 그 까닭을 키보드에도 말한다(`title` 은 마우스에만 닿는다)
                      disabledReason={t('spec.diff.no_previous')}
                      // 다른 축(레일·기준선·본문 보기)은 **물고 간다**(SPEC-03) — 비교를 열 때마다
                      // 레일이 관계 탭으로 튀어, 다른 쌍을 보려면 버전 탭을 다시 눌러야 했다
                      onClick={() =>
                        void navigate({
                          to: '.',
                          search: ({ v: _v, ...rest }) => ({
                            ...rest,
                            diff: `v${String(Number(v['version_no']) - 1)}..v${String(v['version_no'])}`,
                          }),
                        })
                      }
                    >
                      {t('spec.diff.open')}
                    </Button>
                    <Button
                      size="xs"
                      variant="subtle"
                      data-testid={`version-open-${String(v['version_no'])}`}
                      onClick={() =>
                        void navigate({
                          to: '.',
                          search: ({ diff: _diff, ...rest }) => ({
                            ...rest,
                            v: Number(v['version_no']),
                          }),
                        })
                      }
                    >
                      {t('spec.version.open')}
                    </Button>
                  </div>
                  {/* **무엇을 왜 바꿨나** — 이 줄이 없으면 목록은 번호와 배지뿐이고,
                        draft 는 덮어써지므로 되짚을 diff 도 없다(api.md §2.2) */}
                  {typeof v['change_summary_md'] === 'string' && v['change_summary_md'] !== '' && (
                    <p
                      data-testid="version-summary"
                      className="mt-0.5 ml-10 line-clamp-2 text-xs text-text-mute"
                    >
                      {v['change_summary_md']}
                    </p>
                  )}
                </li>
              ))}
              {versionRows.length > VERSION_CAP && (
                <li>
                  <button
                    type="button"
                    data-testid="versions-more"
                    onClick={() => setAllVersions(!showAllVersions)}
                    className="py-1 text-left text-xs text-text-mute hover:text-text"
                  >
                    {showAllVersions
                      ? t('spec.versions.less', { n: VERSION_CAP })
                      : t('spec.versions.more', { n: versionRows.length - VERSION_CAP })}
                  </button>
                </li>
              )}
            </ul>
          )}

          {railTab === 'attachments' && (
            <AttachmentPanel projectSlug={proj} specKey={spec} canEdit={canEditMeta} />
          )}

          {railTab === 'requirements' && (
            <div className="flex flex-col gap-3">
              <RequirementPanel
                projectSlug={proj}
                specKey={spec}
                {...(typeof detail.data?.['version_id'] === 'string'
                  ? {
                      version: {
                        id: String(detail.data['version_id']),
                        versionNo: Number(detail.data['version_no'] ?? 0),
                        status: String(detail.data['doc_status'] ?? ''),
                      },
                    }
                  : {})}
              />
              <section className="border-t border-border pt-2">
                <p className="px-1 pb-1 text-2xs tracking-wide text-text-faint uppercase">
                  {t('spec.derived_tasks')}
                </p>
                <DerivedTaskPanel projectSlug={proj} projectId={projectUuid} specKey={spec} />
              </section>
            </div>
          )}

          {railTab === 'comments' && (
            <div className="px-2" data-testid="rail-panel-comments">
              <CommentList
                projectSlug={proj}
                specKey={spec}
                versionId={versionId}
                comments={rows(comments.data)}
                anchors={commentAnchors}
                onAnchor={goAnchor}
              />
            </div>
          )}
        </div>

        {/* **나가는 문**(§2.4 · ui-wireframes §2.3 (12)). 들어오는 문은 이미 있었다 —
            `nerv_spec_draft_upsert` 응답의 `web_url` 이 이 화면으로 데려온다. */}
        <TerminalHandoffCard specKey={spec} />

        <section className="mt-4 border-t border-border px-2 pt-3 text-2xs text-text-faint">
          {me.data !== undefined && t('spec.viewer', { name: me.data.display_name })}
        </section>
      </aside>
    </div>
  );
}

/**
 * 문서 곁줄 — **누가 언제 승인했고 무엇이 이 문서에 매달려 있는가.**
 * 승인자가 없으면(초안) 작성 흐름의 정보만 남는다. 파생 작업 수는 상세 응답에 없으면
 * 조용히 생략한다 — 없는 숫자를 0 으로 지어내지 않는다.
 */
function Byline({
  detail,
  backlinks,
  t,
}: {
  detail: Record<string, unknown> | undefined;
  backlinks: number;
  t: ReturnType<typeof useT>;
}): React.JSX.Element {
  const approver =
    typeof detail?.['approved_by_name'] === 'string' ? detail['approved_by_name'] : null;
  const approvedAt = typeof detail?.['approved_at'] === 'string' ? detail['approved_at'] : null;
  return (
    <>
      {approver !== null && (
        <span className="flex items-center gap-2">
          <Avatar name={approver} size="sm" />
          {approvedAt === null
            ? t('spec.byline.approved_by', { name: approver })
            : t('spec.byline.approved_when', {
                name: approver,
                when: relativeTime(t, approvedAt),
              })}
        </span>
      )}
      {approver !== null && (
        <span aria-hidden="true" className="text-text-ghost">
          ·
        </span>
      )}
      <span>{t('spec.byline.backlinks', { count: backlinks })}</span>
    </>
  );
}

/** 관계 한 줄의 키 — 같은 문서가 kind·방향을 달리해 두 번 나올 수 있다 */
function relationKey(r: Record<string, unknown>): string {
  return `${String(r['spec_id'])}-${String(r['kind'])}-${String(r['direction'])}`;
}

/**
 * 관계 한 줄 — 역참조 무리와 레퍼런스 무리가 **같은 컴포넌트**를 쓴다.
 * 무리마다 따로 그리면 둘의 생김새가 조용히 갈라지고, 그때 사람은 방향이 아니라
 * 모양의 차이를 먼저 읽는다.
 */
function RelationRow({
  relation,
  proj,
  baseline,
  t,
}: {
  relation: Record<string, unknown>;
  proj: string;
  /** 보던 기준선 — 이웃 문서도 같은 세트로 읽는다(REQ-WEB-135 · SPEC-06) */
  baseline: string | undefined;
  t: ReturnType<typeof useT>;
}): React.JSX.Element {
  const incoming = relation['direction'] === 'in';
  return (
    <Link
      to="/p/$proj/specs/$spec"
      params={{ proj, spec: String(relation['key']) }}
      search={baseline === undefined ? {} : { baseline }}
      className="flex items-start gap-2 rounded-nerv px-2 py-2 transition-colors hover:bg-bg-hover"
    >
      {/* 방향 표식(시안): 들어오는 것은 조용히, 나가는 것은 물들여서 */}
      <GlyphChip
        className={cn(
          'mt-px',
          incoming ? 'bg-bg-sunken text-text-mute' : 'bg-status-action-soft text-status-action',
        )}
      >
        {incoming ? '↓' : '↑'}
      </GlyphChip>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm leading-snug text-text">
          {String(relation['title'])}
        </span>
        <span className="mt-0.5 block text-2xs text-text-faint">
          {incoming ? t('spec.rail.backlink') : String(relation['kind'])} ·{' '}
          {String(relation['key'])}
        </span>
      </span>
    </Link>
  );
}

/**
 * 사전 검토의 판정·심각도 — 영어 원문(`block`·`warning`)을 그대로 적었다(2026-09-24 · SPEC-02).
 * 모르는 값은 원문으로 둔다: 없는 말을 지어 붙이는 것보다 낫다.
 */
function checkLevel(t: ReturnType<typeof useT>, value: unknown): string {
  switch (value) {
    case 'block':
      return t('spec.check.level.block');
    case 'warning':
      return t('spec.check.level.warning');
    case 'info':
      return t('spec.check.level.info');
    default:
      return String(value);
  }
}

/** 버전이 마지막으로 바뀐 시각 — 옛 행에는 `updated_at` 이 없으니 만든 시각으로 떨어진다 */
function changedAt(version: Record<string, unknown>): string | null {
  const changed = version['updated_at'];
  if (typeof changed === 'string') return changed;
  return typeof version['created_at'] === 'string' ? version['created_at'] : null;
}
