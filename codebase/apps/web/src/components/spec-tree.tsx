// 스펙 트리 — 사이드바와 스펙 목록이 **같은 컴포넌트**를 쓴다 (screens.md §1.3 · §2.4)
//
// **나열하는 자리는 전부 나열한다**(2026-08-30 개정 — 사람 지시). 자리는 둘인데(`variant`)
// 다른 것은 밀도와 조작이지 **무엇을 보이느냐가 아니다.**
//
// - `rail` — 좁은 사이드바. 처음에는 뿌리까지만 펼쳤다가 되돌렸다: 일부만 나열하면
//   **없는 문서와 접힌 문서를 사람이 구분하지 못하고**, 트리는 사이드바의 마지막 블록이라
//   길어져도 아래에 가릴 것이 없다(길어지는 값은 스크롤뿐이었다).
// - `full` — 스펙 목록 화면(`/p/:proj/specs`). 전수 목록이다.
//
// 목록에 노출되어야 열람도 가능한 구조라(2026-08-29 — 사람 지시), 접힌 가지에 숨은 문서는
// 없는 것과 같다. 실측이 그랬다: clemvion 141편 중 화면에 있던 것은 106편, sudoku 는 6편 중 3편.
//
// 접는 것은 **사람의 조작**이고 기본값이 아니다. 규모의 부담은 가상 스크롤이 진다(REQ-WEB-044).

import { statusLabelKey } from '@nerv/schema';
import { useT } from '../lib/i18n.js';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { rows, useSpecTree } from '../lib/queries.js';
import { StatusBadge } from './status-badge.js';
import { cn } from '../lib/utils.js';
import { relativeTime } from '../lib/format.js';
import { Button, Input } from './ui/primitives.js';
import { SPEC_VERSION_TOKEN, statusDot } from './status-token.js';
import { SpecStartCard } from './spec-start-card.js';
import type { StatusToken } from './status-badge.js';
import type { ProjectId } from '../lib/query-keys.js';

export interface TreeNode {
  id: string;
  key: string;
  title: string;
  type: string;
  parent_id: string | null;
  doc_status: string | null;
  version_no: number | null;
  /** 보관 시각 — 보관 보기를 켰을 때만 null 이 아닌 것이 섞인다 */
  archived_at?: string | null;
  /** 그 버전이 마지막으로 바뀐 시각(REQ-API-183) */
  updated_at?: string | null;
  /** 열린 코멘트 수(REQ-API-183) */
  open_comments?: number;
}

/** 트리가 서는 자리 — 화면 밀도가 아니라 **역할**이다(전수인가 동반자인가). */
export type SpecTreeVariant = 'rail' | 'full';

export interface SpecTreeProps {
  /** 구역 머리(예: "스펙 트리") — 개수를 함께 적는다(표시 / 전체) */
  heading?: string;
  projectSlug: string;
  /** 쿼리 키를 이벤트 봉투와 같은 축(UUID)에 맞추기 위한 값 — 없으면 slug 로 떨어진다 */
  projectId?: ProjectId | undefined;
  variant?: SpecTreeVariant;
  activeKey?: string | undefined;
  /** 보관한 문서까지 담는다 — 전수 목록 화면의 토글이 이것을 켠다(REQ-WEB-105) */
  includeArchived?: boolean;
  /**
   * 문서 상태 필터 — 빈 배열·생략이면 거르지 않는다(REQ-WEB-138).
   *
   * **서버에도 같은 필터가 있다**(EP-SPEC-01 `?status=` · REQ-API-092)지만 여기서는 쓰지
   * 않는다: 이 화면은 이미 전 계층을 한 응답으로 받아 두었고(REQ-WEB-044), 서버에 걸러
   * 달라고 하면 "표시 N / **전체 M**" 의 M 을 알 방법이 사라진다. 걸러진 수와 전체 수를
   * 함께 적는 줄이 이 화면의 약속이라(§2.4b) 총계를 잃는 쪽을 택하지 않는다.
   *
   * 대신 **판정은 서버와 같은 규칙**이다 — 걸린 노드와 그 조상을 남긴다(4.4 REQ-API-092).
   */
  statuses?: readonly string[];
  /** 스펙 종류 필터 — `statuses` 와 함께 걸면 **둘 다 맞는 것**만이다(REQ-API-093) */
  types?: readonly string[];
  /**
   * 이 트리에만 딸린 조작 — 필터 줄 맨 앞에 선다(REQ-WEB-140).
   *
   * 상태·종류 선택기가 화면 머리의 동작 줄에 있던 동안 **트리 탭만 상단 배치가 달랐다**:
   * 칸이 둘 더 붙어 줄이 넘치면서 표·그래프와 다른 모양이 됐다. 트리에만 듣는 조작이니
   * 트리의 조작 줄이 그것들의 자리다 — 그러면 머리의 동작 줄은 세 탭이 같아진다.
   */
  controls?: React.ReactNode;
  /** 고른 기준선 — 그 세트가 담은 문서만, 그때의 버전으로 그린다(REQ-API-098) */
  baseline?: string | undefined;
  /**
   * 레일에도 **제목 거르기** 칸을 세운다(2026-09-25 — UI/UX 검토 OBS-01 · REQ-WEB-226). 스펙 화면의 둘째 열이
   * 트리의 자리가 된 뒤로 그 열의 머리가 "어디 있나" 를 좁히는 칸이다 — 문서 검색은 ⌘K 가 한다.
   */
  titleFilter?: boolean;
  /** 머리줄 끝에 붙는 조작 — 둘째 열의 [접기]가 여기 선다 */
  headerAction?: React.ReactNode;
}

/**
 * 가상 스크롤 임계 — 이 수를 넘으면 보이는 만큼만 그린다(REQ-WEB-044).
 *
 * 전수 목록은 기본이 전부 펼침이라 큰 프로젝트에서 이 분기가 곧바로 걸린다. 그래서
 * **가상 분기도 일반 렌더와 같은 줄을 그린다** — 삼각형과 자식 수가 사라지면 200편을
 * 넘긴 프로젝트만 접을 수단을 잃는다.
 */
const VIRTUAL_THRESHOLD = 200;
const ROW_HEIGHT = 24;

/**
 * 평면 목록 → 부모별 자식 맵. 서버는 정렬만 하고 계층 조립은 화면 몫이다.
 *
 * **부모를 못 찾은 노드는 뿌리로 올린다.** 렌더는 뿌리(`null`)에서 내려가므로, 부모가 이
 * 응답에 없는 노드를 그 부모 아래에 넣어 두면 그 문서는 **화면에서 사라진다** — 목록에
 * 없으면 열람도 없다는 것이 이 화면의 계약이라(REQ-WEB-101) 트리에 자리가 없다고 문서를
 * 지울 수는 없다. 실제로 만들 수 있는 상태였다(실측 2026-08-29 — 보관된 부모 아래 생성).
 * 서버가 그 경로를 막은 뒤에도 이 방어는 남긴다: 화면은 자기가 받은 목록을 다 그려야 한다.
 */
export function groupByParent(nodes: TreeNode[]): Map<string | null, TreeNode[]> {
  const list = Array.isArray(nodes) ? nodes : [];
  const known = new Set(list.map((n) => n.id));
  const map = new Map<string | null, TreeNode[]>();
  for (const node of list) {
    const parent = node.parent_id !== null && known.has(node.parent_id) ? node.parent_id : null;
    const siblings = map.get(parent) ?? [];
    siblings.push(node);
    map.set(parent, siblings);
  }
  return map;
}

/**
 * 첫 펼침 상태 — 저장된 것이 없을 때의 초깃값은 **전부**다. 자리를 가리지 않는다.
 *
 * 사이드바는 뿌리까지만 펼쳤었다(2026-08-29). 141줄이 늘 떠 있으면 그 아래가 안 보인다는
 * 이유였는데, **트리는 사이드바의 마지막 블록이라 아래에 가릴 것이 없다** — 길어지는 값은
 * 스크롤뿐이었다. 그리고 그 대가가 컸다: 나열하는 자리에서 일부만 나열하면 **없는 문서와
 * 접힌 문서를 사람이 구분하지 못한다**(2026-08-30 개정 — 사람 지시).
 *
 * 접는 것은 사람의 조작이고 자리별로 남는다(REQ-WEB-104).
 */
export function defaultExpanded(nodes: TreeNode[]): Set<string> {
  const parents = new Set(nodes.map((n) => n.parent_id).filter((id): id is string => id !== null));
  return new Set(nodes.filter((n) => parents.has(n.id)).map((n) => n.id));
}

/**
 * 펼침 상태를 브라우저에 남긴다 — 문서를 옮길 때마다 다시 펼치는 것은 반복 노동이다.
 *
 * 프로젝트별로 나누고 **역할별로도 나눈다**: 두 트리가 한 열쇠를 함께 쓰면 사이드바에서
 * 가지 하나를 접은 것이 전수 목록의 첫 화면을 부분으로 만든다(같은 화면에 106과 141이
 * 동시에 뜨던 원인 — 실측 2026-08-29).
 */
/**
 * 펴기/접기 표식 — REQ-WEB-170.
 *
 * **글꼴 글리프(`▾`/`▸`)를 쓰지 않는다.** 2026-09-21 까지 이 자리는 `text-2xs`(10.5px)
 * 삼각형 글자였고 색은 `text-text-faint` 라 **바로 옆 제목(`text-text-mute`)보다 흐렸다** —
 * 줄에서 가장 중요한 조작이 가장 안 보였다(사람 보고). 글리프는 폰트마다 크기와 베이스라인이
 * 달라 줄마다 흔들리기도 한다.
 *
 * **방향은 회전으로 말한다.** 두 글자(`▾`·`▸`)를 구별하는 것보다 같은 도형이 90° 도는 편이
 * 눈에 빠르고, 애니메이션이 그 변화를 한 번 더 짚어 준다.
 */
function Chevron({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('transition-transform duration-150', open ? 'rotate-90' : undefined)}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/**
 * 전체 펴기/접기 아이콘 — REQ-WEB-171.
 *
 * 화살표 둘이 **모이거나 벌어진다**: 접기는 위아래에서 가운데로, 펴기는 가운데에서 밖으로.
 * 글자 없이도 방향이 읽히는 것이 좁은 머리줄의 조건이다. 단추가 둘로 갈라진 뒤(2026-09-24)
 * 각 단추는 **제 모양 하나만** 그린다 — 상태에 따라 모양이 바뀌지 않는다.
 *
 * **가운데 선을 두지 않는다**(2026-09-21 실측). 처음에는 두 화살표 사이에 가로선을 그었는데,
 * 14px 에서 선과 두 꼭짓점이 겹쳐 **별표(✳)처럼** 보였다 — 방향이 읽히기는커녕 무슨 도형인지
 * 알 수 없었다. 스크린샷으로 보기 전에는 몰랐던 자리다.
 */
function FoldAll({ collapsed }: { collapsed: boolean }): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {collapsed ? (
        // 펴기 — 가운데에서 위아래로 벌어진다
        <>
          <path d="M7 9l5-5 5 5" />
          <path d="M7 15l5 5 5-5" />
        </>
      ) : (
        // 접기 — 위아래에서 가운데로 모인다
        <>
          <path d="M7 4l5 5 5-5" />
          <path d="M7 20l5-5 5 5" />
        </>
      )}
    </svg>
  );
}

/**
 * 지금 보는 문서로 — REQ-WEB-187.
 *
 * 과녁(원 + 네 눈금)이다. 접기·펴기의 화살표와 **다른 모양**이어야 한다 — 셋이 나란히 서는
 * 좁은 머리줄에서 비슷한 도형이 섞이면 무엇을 누르는지 매번 읽어야 한다.
 */
function Locate(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="6" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </svg>
  );
}

function storageKeyFor(projectSlug: string, variant: SpecTreeVariant): string {
  return `nerv.tree.${projectSlug}.${variant}`;
}

function readExpanded(key: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : new Set(JSON.parse(raw) as string[]);
  } catch {
    // 저장이 막힌 환경(사생활 보호 모드)에서도 트리는 떠야 한다
    return null;
  }
}

function writeExpanded(key: string, value: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...value]));
  } catch {
    // 이번 세션 동안만 유지된다 — 되돌려 놓는 것이 더 나쁘다
  }
}

/** 어떤 노드에서 뿌리까지의 조상 id — 딥링크로 들어와도 그 자리를 펼쳐 보이기 위해 */
export function ancestorsOf(nodes: readonly TreeNode[], key: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const start = nodes.find((n) => n.key === key);
  const chain: string[] = [];
  let parent = start?.parent_id ?? null;
  while (parent !== null && !chain.includes(parent)) {
    chain.push(parent);
    parent = byId.get(parent)?.parent_id ?? null;
  }
  return chain;
}

export function SpecTree({
  projectSlug,
  projectId,
  variant = 'full',
  activeKey,
  heading,
  includeArchived = false,
  statuses,
  types,
  controls,
  baseline,
  titleFilter = false,
  headerAction,
}: SpecTreeProps): React.JSX.Element {
  const t = useT();
  const tree = useSpecTree(projectSlug, projectId, includeArchived, baseline);
  const [filter, setFilter] = useState('');
  // null = 아직 정하지 않음. 첫 데이터가 와야 초깃값을 만들 수 있다.
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  // 목록 응답을 믿고 크래시하지 않는다 — 트리 하나 때문에 셸 전체가 흰 화면이 된다.
  const nodes = rows(tree.data) as unknown as TreeNode[];
  const byParent = useMemo(() => groupByParent(nodes), [nodes]);
  const matches = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === '') return null;
    return new Set(
      nodes
        .filter(
          (n) => n.title.toLowerCase().includes(needle) || n.key.toLowerCase().includes(needle),
        )
        .map((n) => n.id),
    );
  }, [filter, nodes]);

  /**
   * 성질 필터(상태·종류) — 걸린 노드와 **그 조상**을 남긴다. 둘 다 걸리면 AND 다.
   *
   * 조상을 빼면 트리가 끊어진다: 실측(clemvion 141노드) `draft` 26건 중 **17건의 부모가
   * draft 가 아니다.** 부모 없는 줄은 자리를 잃고 목록의 위아래가 뒤섞인다.
   */
  const statusKept = useMemo(() => {
    const wantedStatus = statuses !== undefined && statuses.length > 0 ? new Set(statuses) : null;
    const wantedType = types !== undefined && types.length > 0 ? new Set(types) : null;
    if (wantedStatus === null && wantedType === null) return null;
    const matched = new Set(
      nodes
        .filter(
          (n) =>
            (wantedStatus === null || (n.doc_status !== null && wantedStatus.has(n.doc_status))) &&
            (wantedType === null || wantedType.has(n.type)),
        )
        .map((n) => n.id),
    );
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const kept = new Set(matched);
    for (const id of matched) {
      let parent = byId.get(id)?.parent_id ?? null;
      // 이미 남기기로 한 조상에 닿으면 멈춘다 — 그 위쪽은 그것을 넣은 걸음이 이미 채웠다
      while (parent !== null && !kept.has(parent)) {
        kept.add(parent);
        parent = byId.get(parent)?.parent_id ?? null;
      }
    }
    return kept;
  }, [statuses, types, nodes]);

  const storageKey = storageKeyFor(projectSlug, variant);

  useEffect(() => {
    if (expanded !== null || nodes.length === 0) return;
    setExpanded(readExpanded(storageKey) ?? defaultExpanded(nodes));
  }, [expanded, nodes, storageKey]);

  /**
   * 보고 있는 문서까지의 길을 펼친다 — 딥링크로 들어오면 트리에서 내 위치를 알 수 없다.
   *
   * **문서를 옮겼을 때 한 번이다**(2026-09-24 — 사람 보고 · REQ-WEB-186). 이 effect 는
   * 펼침 상태가 바뀔 때마다 돌았고, 그래서 사람이 조상을 접으면 다음 렌더에서 **도로
   * 펴졌다** — 하위 문서를 연 채로는 그 위 가지도, 전체 접기도 듣지 않았다. 앞의
   * `depth === 0` 결함(§2.4b)과 같은 종류다: 상태는 바뀌는데 화면이 안 바뀐다.
   *
   * 펼쳐 준 키를 기억해 두고 **같은 문서에서는 다시 펼치지 않는다.** 그 문서가 아직 목록에
   * 없으면(방금 만든 문서 — 트리 응답이 늦다) 기억하지 않는다: 도착한 뒤에 펼쳐야 한다.
   */
  const revealedKey = useRef<string | undefined>(undefined);
  /** 활성 줄로 스크롤해 달라는 요청 — 경로를 펼친 그 렌더 **뒤에** 옮겨야 줄이 있다 */
  const [scrollRequest, setScrollRequest] = useState(0);
  useEffect(() => {
    if (activeKey === undefined || expanded === null || nodes.length === 0) return;
    if (revealedKey.current === activeKey) return;
    if (!nodes.some((n) => n.key === activeKey)) return;
    revealedKey.current = activeKey;
    const chain = ancestorsOf(nodes, activeKey);
    if (!chain.every((id) => expanded.has(id)))
      setExpanded((prev) => new Set([...(prev ?? []), ...chain]));
    setScrollRequest((n) => n + 1);
  }, [activeKey, expanded, nodes]);

  /**
   * 펼쳐도 화면 밖이면 못 본 것과 같다(REQ-WEB-053).
   *
   * **다음 프레임에 옮긴다.** 트리가 전부 펼쳐지면서 이 줄이 3,697px 짜리 상자의 2,580px
   * 자리에 서게 됐는데, 렌더 직후에 부르면 라우터의 스크롤 복원이 그 뒤에 0 으로 되돌린다
   * (실측 2026-08-30 — 손으로 부르면 2,005 로 옮겨졌다).
   *
   * **옮기는 것은 요청이 있을 때뿐이다**(2026-09-24). 펼침 상태에 걸어 두었더니 다른 가지를
   * 접거나 펴기만 해도 목록이 활성 줄로 끌려갔다 — 보던 자리를 사람이 잃는다. 요청은 둘이다:
   * 문서를 옮겼을 때(위 effect)와 [보고 있는 문서로] 단추(REQ-WEB-187).
   *
   * 가상 분기에서는 그 줄이 창 밖이면 DOM 에 없다 — 그때는 줄 번호로 뷰포트를 옮긴다.
   */
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const activeIndexRef = useRef(-1);
  /**
   * **트리는 Tab 한 칸이다**(2026-09-25 — UI/UX 검토 NAV-12 · SYS-X2 · REQ-WEB-224). 줄마다 [펼침] 단추와 링크가
   * Tab 을 두 칸씩 받아, 141편을 펼친 사이드바를 지나야 본문에 닿았다. 줄 하나만 Tab 을 받고(로빙) ↑↓ 로
   * 옮기며 ←→ 로 접고 편다. 이 값이 그 한 줄이다 — 없거나 보이지 않으면 보는 문서, 그것도 없으면 첫 줄.
   */
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);
  /** 키로 옮긴 뒤 그 줄이 그려지면 포커스를 준다 — 가상 목록에서는 창을 민 다음 렌더에 그려진다 */
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const key = pendingFocus.current;
    if (key === null) return;
    const el = treeRef.current?.querySelector<HTMLElement>(`[data-tree-key="${CSS.escape(key)}"]`);
    if (el === null || el === undefined) return;
    pendingFocus.current = null;
    el.focus();
  });
  useEffect(() => {
    if (scrollRequest === 0) return undefined;
    const frame = requestAnimationFrame(() => {
      if (activeRef.current !== null) {
        activeRef.current.scrollIntoView({ block: 'nearest' });
        return;
      }
      const viewport = viewportRef.current;
      if (viewport !== null && activeIndexRef.current >= 0) {
        viewport.scrollTop = Math.max(
          0,
          activeIndexRef.current * ROW_HEIGHT - viewport.clientHeight / 2,
        );
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollRequest]);

  const open = expanded ?? new Set<string>();
  const setOpen = (next: Set<string>): void => {
    setExpanded(next);
    writeExpanded(storageKey, next);
  };
  const toggle = (id: string): void => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  };
  /** 보고 있는 문서까지의 조상 — 접힌 가지가 그것을 품었는지 가리는 데 쓴다(REQ-WEB-186) */
  const activeChain = new Set(activeKey === undefined ? [] : ancestorsOf(nodes, activeKey));
  const activeInTree = activeKey !== undefined && nodes.some((n) => n.key === activeKey);
  /**
   * 전체 접기 뒤 제자리로 돌아오는 길 — 조상을 펴고 그 줄로 옮긴다(REQ-WEB-187).
   *
   * 사람이 누른 것이므로 **저장한다** — 문서를 옮겨 자동으로 펼친 것과 다르다.
   */
  const reveal = (): void => {
    if (!activeInTree) return;
    const chain = [...activeChain];
    if (!chain.every((id) => open.has(id))) setOpen(new Set([...open, ...chain]));
    setScrollRequest((n) => n + 1);
  };

  // 머리줄에 붙는 조작(둘째 열의 [접기])은 **트리가 서기 전에도** 있어야 한다 — 불러오는 동안이나 빈
  // 프로젝트에서 사라지면 넓은 화면의 열을 접을 길이 없다
  const actionRow =
    headerAction === undefined ? null : (
      <div className="mb-1 flex justify-end px-2">{headerAction}</div>
    );

  if (tree.isLoading) {
    return (
      <div data-testid="tree-skeleton" className="flex flex-col gap-2">
        {actionRow}
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-4 rounded bg-bg-sunken" />
        ))}
      </div>
    );
  }

  if (nodes.length === 0) {
    // 막다른 길 금지 — 빈 상태에도 다음 행동이 있다(§1.5). **목록 화면이 시작하는 길을 말한다**
    // (REQ-WEB-208) — 레일(스펙 상세의 둘째 열)은 한 줄로 그리로 보낸다. 예전에는 둘 다 "첫 스펙 만들기" 로 목록을
    // 가리켰고, 목록은 같은 문장을 다시 보였다(만드는 문은 2026-09-22 에 걷혔다)
    return variant === 'full' ? (
      <SpecStartCard projectSlug={projectSlug} />
    ) : (
      <div className="text-sm text-text-mute">
        {actionRow}
        {t('specs.empty')}{' '}
        <Link
          to="/p/$proj/specs"
          params={{ proj: projectSlug }}
          data-testid="spec-tree-start"
          className="text-link underline"
        >
          {t('specs.start.how')}
        </Link>
      </div>
    );
  }

  // 필터 판정은 **한 곳에서만** 한다 — 평탄화(수 세기·가상 렌더)와 중첩 렌더가 서로 다른
  // 규칙을 쓰면 화면에 적힌 수와 화면에 그린 줄이 어긋난다.
  const childrenToShow = (parentId: string | null): TreeNode[] =>
    (byParent.get(parentId) ?? []).filter(
      (node) =>
        (matches === null || matches.has(node.id) || byParent.has(node.id)) &&
        // 상태 필터는 **조상까지 미리 계산해 두었다** — 여기서 "자식이 있으면 남긴다"로
        // 하면 아래에 걸린 것이 하나도 없는 가지가 빈 채로 남는다
        (statusKept === null || statusKept.has(node.id)),
    );
  // 필터 중에는 전부 펼친다 — 걸린 노드를 접힌 가지에 숨기면 필터가 무의미하다
  const isOpenOf = (node: TreeNode): boolean =>
    open.has(node.id) || matches !== null || statusKept !== null;

  // 보이는 노드만 평탄화한다 — 접힌 가지는 리스트에 아예 들어오지 않는다.
  const visible: { node: TreeNode; depth: number }[] = [];
  const collect = (parentId: string | null, depth: number): void => {
    for (const node of childrenToShow(parentId)) {
      visible.push({ node, depth });
      if (isOpenOf(node)) collect(node.id, depth + 1);
    }
  };
  collect(null, 0);

  const shown = visible.length;
  const total = nodes.length;
  const virtualizedNow = shown > VIRTUAL_THRESHOLD;
  activeIndexRef.current = visible.findIndex(({ node }) => node.key === activeKey);
  const rovingKey =
    focusKey !== null && visible.some(({ node }) => node.key === focusKey)
      ? focusKey
      : activeIndexRef.current >= 0
        ? (activeKey ?? null)
        : (visible[0]?.node.key ?? null);
  /** i 번째 보이는 줄로 포커스를 옮긴다 — 가상 목록이면 창을 먼저 민다 */
  const moveTo = (index: number): void => {
    const target = visible[index];
    if (target === undefined) return;
    setFocusKey(target.node.key);
    pendingFocus.current = target.node.key;
    const viewport = viewportRef.current;
    if (virtualizedNow && viewport !== null) {
      const top = index * ROW_HEIGHT;
      if (top < viewport.scrollTop) viewport.scrollTop = top;
      else if (top + ROW_HEIGHT > viewport.scrollTop + viewport.clientHeight)
        viewport.scrollTop = top + ROW_HEIGHT - viewport.clientHeight;
      setScrollTop(viewport.scrollTop);
    }
  };
  const onRowKey = (e: React.KeyboardEvent, node: TreeNode): void => {
    const index = visible.findIndex((v) => v.node.id === node.id);
    const branch = byParent.has(node.id);
    const isOpen = isOpenOf(node);
    switch (e.key) {
      case 'ArrowDown':
        moveTo(index + 1);
        break;
      case 'ArrowUp':
        moveTo(index - 1);
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(visible.length - 1);
        break;
      case 'ArrowRight':
        if (!branch) return;
        if (!isOpen) toggle(node.id);
        else moveTo(index + 1);
        break;
      case 'ArrowLeft': {
        if (branch && isOpen && open.has(node.id)) {
          toggle(node.id);
          break;
        }
        const parentIndex = visible.findIndex((v) => v.node.id === node.parent_id);
        if (parentIndex < 0) return;
        moveTo(parentIndex);
        break;
      }
      default:
        return;
    }
    e.preventDefault();
  };
  /** 가지 — 접고 펼 수 있는 노드. 없으면 전체 조작이 서지 않는다 */
  const branchIds = nodes.filter((node) => byParent.has(node.id)).map((node) => node.id);
  const hasBranches = branchIds.length > 0;
  /**
   * 할 일이 없는 단추는 **숨기지 않고 끈다**(REQ-WEB-171) — 숨기면 옆 단추가 자리를 옮겨
   * 같은 자리를 두 번 누른 사람이 다른 조작을 한다.
   */
  const allOpen = branchIds.every((id) => open.has(id));
  const noneOpen = !branchIds.some((id) => open.has(id));

  // 200 노드를 넘으면 창 밖은 그리지 않는다 — 최초 페인트가 전체 트리를 요구하지 않게.
  const virtualized = shown > VIRTUAL_THRESHOLD;
  const startIndex = virtualized ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10) : 0;
  const endIndex = virtualized
    ? Math.min(shown, startIndex + Math.ceil(viewportHeight / ROW_HEIGHT) + 20)
    : shown;

  /** 줄 하나 — 중첩 렌더와 가상 렌더가 **같은 줄**을 쓴다(둘이 갈라지면 조작이 사라진다) */
  const row = (node: TreeNode): React.JSX.Element => {
    const children = byParent.get(node.id) ?? [];
    const isOpen = isOpenOf(node);
    // 접힌 가지가 지금 보는 문서를 품었다 — 표시가 없으면 접는 순간 "내가 어디 있나" 가
    // 트리에서 사라진다(REQ-WEB-186)
    const holdsActive = !isOpen && activeChain.has(node.id);
    return (
      <div className="group flex items-center rounded-nerv-sm hover:bg-bg-hover">
        {/* 자식이 없어도 자리를 비운다 — 삼각형 유무로 들여쓰기가 어긋나면
            트리가 계단처럼 보인다 */}
        {children.length === 0 && <span aria-hidden="true" className="size-6 shrink-0" />}
        {children.length > 0 && (
          <button
            type="button"
            data-testid="tree-toggle"
            aria-label={isOpen ? t('specs.collapse') : t('specs.expand')}
            // 상태를 **이름이 아니라 상태로** 말한다 — aria-label 만으로는 스크린 리더가
            // "지금 펴져 있는가" 를 읽지 못한다(라벨은 다음에 일어날 일이다)
            aria-expanded={isOpen}
            // 키보드는 줄에서 ←→ 로 접고 편다 — 단추가 Tab 을 한 칸 더 받으면 트리가 두 배로 길어진다
            tabIndex={-1}
            className="flex size-6 shrink-0 items-center justify-center rounded-nerv-sm text-text-mute hover:bg-bg-active hover:text-text"
            onClick={() => toggle(node.id)}
          >
            <Chevron open={isOpen} />
          </button>
        )}
        <Link
          to="/p/$proj/specs/$spec"
          params={{ proj: projectSlug, spec: node.key }}
          // **고른 기준선을 상세까지 물고 간다**(REQ-WEB-135). 기준선으로 목록을 본 사람이 줄을 누르면
          // 상세는 최신 승인본을 열었고 머리의 기준선 배지도 사라졌다(2026-09-24 · SPEC-06)
          search={baseline === undefined ? {} : { baseline }}
          {...(node.key === activeKey ? { ref: activeRef } : {})}
          data-tree-key={node.key}
          tabIndex={node.key === rovingKey ? 0 : -1}
          onFocus={() => {
            if (focusKey !== node.key) setFocusKey(node.key);
          }}
          onKeyDown={(e) => onRowKey(e, node)}
          data-active={node.key === activeKey}
          data-holds-active={holdsActive}
          {...(holdsActive ? { title: t('specs.holds_active') } : {})}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 rounded-[5px] pr-1 text-text-mute data-[active=true]:bg-bg-active data-[active=true]:font-medium data-[active=true]:text-text data-[holds-active=true]:font-medium data-[holds-active=true]:text-text',
            // 시안: 사이드바 트리는 26px 줄에 13px 글자 — nav(29px)보다 반 단 조밀하다
            variant === 'rail' ? 'h-[26px] text-[13px]' : 'py-1 text-sm',
            // 보관한 것은 목록에 있어도 **같은 무게가 아니다** — 켜서 찾아온 사람에게만 보인다
            node.archived_at != null ? 'text-text-faint' : undefined,
          )}
        >
          {/* 앞머리 점 — 상태 점(뒤꼬리)과 자리가 달라 섞이지 않는다 */}
          {holdsActive && (
            <span
              data-testid="tree-holds-active"
              aria-label={t('specs.holds_active')}
              className="size-1.5 shrink-0 rounded-full bg-link"
            />
          )}
          <span className="truncate">{node.title}</span>
          {node.archived_at != null && (
            <StatusBadge token="idle" label={t('specs.archived_badge')} />
          )}
          {!isOpen && children.length > 0 && (
            <span className="shrink-0 text-2xs text-text-faint tabular-nums">
              {children.length}
            </span>
          )}
          {/* **다 같으면 그건 신호가 아니다**(2026-08-23 재검토). 141편 중 128편이
              `approved` 라 배지를 모든 줄에 달면 초록색이 줄마다 반복되고,
              정작 눈에 띄어야 할 초안·폐기가 그 반복 속에 묻힌다.
              좁은 사이드바에서는 **평소와 다른 것만** 말한다 — 승인됨은 침묵이다.
              전수 목록은 폭이 있으니 배지를 그대로 단다. */}
          {node.doc_status !== null &&
            (variant === 'rail' ? (
              node.doc_status !== 'approved' && (
                <span
                  aria-label={t(statusLabelKey('spec', node.doc_status))}
                  title={t(statusLabelKey('spec', node.doc_status))}
                  // 점은 **문서 → 토큰 → 점** 한 길이다(SYS-07) — 따로 든 색이 표 변형의 배지와 어긋났다
                  // (초안 노랑 vs 회색 · 검토 중 파랑 vs 호박 · 폐기 회색 vs 빨강)
                  data-dot={node.doc_status}
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    statusDot(SPEC_VERSION_TOKEN, node.doc_status),
                  )}
                />
              )
            ) : (
              <StatusBadge
                token={
                  (SPEC_VERSION_TOKEN[node.doc_status as keyof typeof SPEC_VERSION_TOKEN] ??
                    'idle') as StatusToken
                }
                label={t(statusLabelKey('spec', node.doc_status))}
              />
            ))}
          {/* **행이 무엇을 손봐야 하는지 말한다**(2026-09-24 · SPEC-13 · REQ-WEB-216). 명세의 행(§2.4 — 현재
              버전·최근 갱신·열린 코멘트 수)이 제목과 배지뿐이라 "손볼 문서" 를 고를 수 없었다. 전수
              목록에만 단다 — 좁은 사이드바는 평소와 다른 것만 말한다 */}
          {variant === 'full' && (
            <span
              data-testid="tree-row-meta"
              className="ml-auto flex shrink-0 items-center gap-2 pl-2 text-2xs text-text-faint tabular-nums"
            >
              {node.version_no !== null && <span>v{node.version_no}</span>}
              {typeof node.updated_at === 'string' && (
                <span>{relativeTime(t, node.updated_at)}</span>
              )}
              {(node.open_comments ?? 0) > 0 && (
                <span
                  data-testid="tree-row-comments"
                  title={t('spec.next.comments', { count: node.open_comments ?? 0 })}
                  className="text-status-waiting"
                >
                  💬 {node.open_comments}
                </span>
              )}
            </span>
          )}
        </Link>
      </div>
    );
  };

  /** 줄의 트리 의미 — 수준·펼침·보는 문서(보조기기가 "몇 단계의 어디" 인지 읽는다) */
  const itemProps = (node: TreeNode, depth: number): React.LiHTMLAttributes<HTMLLIElement> => ({
    role: 'treeitem',
    'aria-level': depth + 1,
    'aria-selected': node.key === activeKey,
    ...(byParent.has(node.id) ? { 'aria-expanded': isOpenOf(node) } : {}),
  });

  const renderLevel = (parentId: string | null, depth: number): React.JSX.Element[] =>
    childrenToShow(parentId).map((node) => {
      const children = byParent.get(node.id) ?? [];
      return (
        <li key={node.id} style={{ paddingLeft: depth === 0 ? 0 : 12 }} {...itemProps(node, depth)}>
          {row(node)}
          {isOpenOf(node) && children.length > 0 && (
            <ul role="group">{renderLevel(node.id, depth + 1)}</ul>
          )}
        </li>
      );
    });

  return (
    // 레일은 **제 상자 안에서 흐른다** — 머리(구역 이름과 수)는 붙어 있고 목록만 스크롤한다.
    // 수는 트리가 전부라는 증거이므로 스크롤과 함께 사라지면 안 된다.
    <div
      ref={treeRef}
      data-testid="spec-tree"
      data-virtualized={virtualized}
      className={cn(variant === 'rail' ? 'flex min-h-0 flex-1 flex-col' : undefined)}
    >
      {heading !== undefined && (
        <div className="mb-1 flex items-center gap-1 px-2">
          <span className="flex-1 truncate text-2xs font-semibold tracking-[0.07em] text-text-faint uppercase">
            {heading}
          </span>
          {/* **전체 펴기/접기는 레일에도 있다**(2026-09-21 — 사람 요청 · REQ-WEB-171).
              §2.4b 가 2026-08-23 에 "좁은 사이드바에는 두지 않는다" 고 적었는데, 그 판단은
              레일 기본값이 깊이 1이던 시절의 것이다 — 2026-08-30 에 기본이 **전부 펼침**이
              되면서 전제가 뒤집혔다.
              **토글 하나였다가 둘로 갈랐다**(2026-09-24 — 사람 요청). 토글은 "하나라도 펴져
              있으면 접기" 라는 판정이 맞을 때만 다음 동작을 말한다 — 하위 문서를 연 채로
              접기가 도로 펴지던 동안 아이콘은 계속 "접기" 였고, 사람은 무엇이 일어날지 알 수
              없었다. 일부만 펴진 상태에서 전부 펴려면 두 번 눌러야 하기도 했다. 단추 둘은
              누르면 **늘 같은 일**을 한다. */}
          {activeInTree && (
            <button
              type="button"
              data-testid="tree-reveal-active"
              aria-label={t('specs.reveal_active')}
              title={t('specs.reveal_active')}
              onClick={reveal}
              className="flex size-6 shrink-0 items-center justify-center rounded-nerv-sm text-text-mute hover:bg-bg-active hover:text-text"
            >
              <Locate />
            </button>
          )}
          {hasBranches && (
            <>
              <Button
                size="xs"
                variant="subtle"
                data-testid="tree-expand-all"
                aria-label={t('specs.expand_all')}
                title={t('specs.expand_all')}
                disabled={allOpen}
                onClick={() => setOpen(defaultExpanded(nodes))}
                className="shrink-0"
              >
                <FoldAll collapsed />
              </Button>
              <Button
                size="xs"
                variant="subtle"
                data-testid="tree-collapse-all"
                aria-label={t('specs.collapse_all')}
                title={t('specs.collapse_all')}
                disabled={noneOpen}
                onClick={() => setOpen(new Set())}
                className="shrink-0"
              >
                <FoldAll collapsed={false} />
              </Button>
            </>
          )}
          {/* **수는 둘이다.** 총계만 적으면 트리는 141 을 약속하고 106 만 지킨다.
              접었을 때 무엇이 감춰졌는지가 이 수로 보인다(REQ-WEB-102) */}
          <span
            data-testid="tree-count"
            aria-label={t('specs.count.shown_total', { shown, total })}
            title={t('specs.count.shown_total', { shown, total })}
            className="shrink-0 text-2xs text-text-faint tabular-nums"
          >
            {t('specs.count.short', { shown, total })}
          </span>
          {headerAction}
        </div>
      )}
      {variant === 'rail' && titleFilter && (
        <div className="mb-1.5 px-1">
          <Input
            data-testid="tree-title-filter"
            aria-label={t('specs.tree_filter')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('specs.tree_filter')}
            className="h-[27px] w-full text-sm"
          />
        </div>
      )}
      {variant === 'full' && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {controls}
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('specs.tree_filter')}
          />
          <button
            type="button"
            data-testid="tree-expand-all"
            onClick={() => setOpen(defaultExpanded(nodes))}
            className="shrink-0 rounded-nerv-sm border border-border px-2 py-1 text-xs text-text-mute hover:bg-bg-hover"
          >
            {t('specs.expand_all')}
          </button>
          <button
            type="button"
            data-testid="tree-collapse-all"
            onClick={() => setOpen(new Set())}
            className="shrink-0 rounded-nerv-sm border border-border px-2 py-1 text-xs text-text-mute hover:bg-bg-hover"
          >
            {t('specs.collapse_all')}
          </button>
          {/* 수는 그것을 바꾸는 조작 **옆에** 둔다 — 접기를 누르면 그 자리에서 줄어든다.
              시안(§2.4)은 목록 발치에 두었지만, 141줄 아래는 화면 밖이다 */}
          <span data-testid="tree-count" className="shrink-0 text-xs text-text-faint tabular-nums">
            {t('specs.count.shown_total', { shown, total })}
          </span>
        </div>
      )}
      {virtualized ? (
        <div
          data-testid="tree-viewport"
          className={cn(
            'overflow-y-auto',
            // 레일에서는 제 상자를 꽉 채운다 — 70vh 로 고정하면 스크롤이 두 겹이 되고,
            // 안쪽 스크롤은 바깥 스크롤에 가려 있다는 것 자체가 잘 안 보인다
            variant === 'rail' ? 'h-full' : 'max-h-[70vh]',
          )}
          ref={(el) => {
            viewportRef.current = el;
            if (el !== null && el.clientHeight !== viewportHeight)
              setViewportHeight(el.clientHeight);
          }}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          {/* 스크롤 높이는 전체 노드 수로 잡고 내용만 창 크기로 그린다 */}
          <div style={{ height: shown * ROW_HEIGHT, position: 'relative' }}>
            <ul
              role="tree"
              aria-label={heading ?? t('specs.tree_label')}
              style={{ position: 'absolute', top: startIndex * ROW_HEIGHT, left: 0, right: 0 }}
            >
              {visible.slice(startIndex, endIndex).map(({ node, depth }) => (
                <li
                  key={node.id}
                  style={{ paddingLeft: depth * 12, height: ROW_HEIGHT }}
                  {...itemProps(node, depth)}
                >
                  {row(node)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        // 레일에서만 목록이 스크롤한다. 전수 목록 화면은 반대로 **문서가 스크롤한다** —
        // 141줄짜리 목록을 화면에 가두면 스크롤이 두 겹이 되기 때문이다(§2.4a)
        <div className={cn(variant === 'rail' ? 'min-h-0 flex-1 overflow-y-auto' : undefined)}>
          <ul role="tree" aria-label={heading ?? t('specs.tree_label')}>
            {renderLevel(null, 0)}
          </ul>
        </div>
      )}
    </div>
  );
}
