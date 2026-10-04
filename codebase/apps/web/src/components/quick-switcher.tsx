// 전역 명령 팔레트 ⌘K — 정본: screens.md §1.3a (REQ-WEB-040 · REQ-WEB-223)
//
// 대규모 프로젝트의 **기본 이동 수단**이다. 트리 스크롤 대신 타이핑 → Enter 로 어디서든
// 어디로든 간다. **키를 그대로 치면 직행한다** — 사람이 키를 칠 때는 "찾아줘"가 아니라
// "열어줘"라는 뜻이기 때문이다(서버 파이프라인 ①과 같은 규칙). 키 형식은 프로젝트가
// 정하고(`<PRJ>-<타입>-<base32 6>` — 3.3 §5.1) 접두를 여기서 가정하지 않는다: 예전에는
// `TSK-` 접두로 Task 를 갈랐는데 실데이터에 그 접두를 가진 Task 가 **한 건도 없었다**.
//
// **문서만 찾던 상자였다**(2026-09-25 — UI/UX 검토 NAV-11 · REQ-WEB-223). 헤더에 입력창처럼 늘 서
// 있는데 누르면 한 프로젝트의 스펙·작업 키만 찾았다 — 홈·받은 요청에서 열면 "프로젝트를 고르라" 고만
// 했고, "받은 요청"·"토큰"·다른 프로젝트 이름을 쳐도 아무것도 나오지 않았다. 이제 무리가 있다:
// 고정 · 최근 · **이동**(홈·받은 요청·알림·설정 넷·도움말) · **이 프로젝트**(개요~리뷰) · **프로젝트** ·
// 문서(프로젝트 안에서만 — EP-SPEC-02). 정적 무리는 화면에서 걸러 요청을 늘리지 않는다.
//
// **명령 무리**(2026-09-28 · REQ-WEB-266) — 가는 곳이 아니라 **하는 일**이다: 언어 · 테마 전환과
// 새 스펙 시작 명령 복사. 사용자 메뉴를 열어 찾던 일을 여기서 끝낸다. 스펙은 웹에서 만들지 않으므로
// (REQ-WEB-173) "새 스펙" 은 시작 카드와 같은 명령을 복사한다 — 할 수 없는 역할에게는 보이지 않는다.
//
// 최근 방문·핀은 localStorage 다 — 뷰 상태 등급이고 서버 동기화는 Phase 2(§1.3a).

import { LOCALES, scopesForRoles, statusLabelKey } from '@nerv/schema';
import { LOCALE_LABEL, useLocale, useT } from '../lib/i18n.js';
import { useRouter, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../lib/api.js';
import { helpForRoute } from '../lib/manual.js';
import { helpHref } from '../lib/manual-chapters.js';
import { useMe } from '../lib/queries.js';
import { useRealtime } from '../lib/realtime.js';
import { inOrgHref, useScope } from '../lib/scope.js';
import { rolesInProject } from '../lib/session.js';
import { THEMES, useTheme } from '../lib/theme.js';
import { cn } from '../lib/utils.js';
import { StatusBadge } from './status-badge.js';
import { useModal } from './ui/modal.js';
import { NEW_SPEC_COMMAND } from './spec-start-card.js';
import { SPEC_VERSION_TOKEN } from './status-token.js';
import type { StatusToken } from './status-badge.js';

export interface SwitcherHit {
  key: string;
  title: string;
  type: string;
  doc_status: string | null;
  anchor: string | null;
  /** 무엇에 맞았나 — 서버가 준다(`spec`·`requirement`·`task`). 없으면 스펙으로 본다 */
  kind?: string;
  /** 보관된 문서면 그 시각 — 번호로 찾으면 보관된 문서도 나온다(REQ-API-258) */
  archived_at?: string | null;
  /**
   * **어느 프로젝트의 것인가**(2026-09-25 — UI/UX 검토 NAV-04 · REQ-WEB-223). 기록이 프로젝트를 잊는
   * 동안 A 에서 고정한 스펙을 B 에서 열면 `/p/B/specs/<A 의 키>` 로 가서 "없다" 가 떴고, 홈에서 누르면
   * 창만 닫혔다. 검색 응답에는 없으니 기록하는 순간의 범위로 채운다.
   */
  project_slug?: string;
  project_name?: string;
  org_slug?: string;
}

const RECENT_KEY = 'nerv.quickswitcher.recent';
const PIN_KEY = 'nerv.quickswitcher.pins';
const MAX_RECENT = 20;
/** 빈 입력에서 보이는 최근 줄 수 — 나머지는 치면 나온다 */
const SHOWN_RECENT = 8;

/** 같은 문서인가 — 키는 프로젝트 접두를 갖지만 서로 다른 프로젝트의 같은 키를 한데 묶지 않는다 */
const sameHit = (a: SwitcherHit, b: SwitcherHit): boolean =>
  a.key === b.key && (a.project_slug ?? '') === (b.project_slug ?? '');

export function readList(storageKey: string): SwitcherHit[] {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw === null ? [] : (JSON.parse(raw) as SwitcherHit[]);
  } catch {
    // 사파리 프라이빗 모드처럼 접근 자체가 던지는 환경이 있다 — 없는 셈 친다.
    return [];
  }
}

export function rememberVisit(hit: SwitcherHit): void {
  try {
    const next = [hit, ...readList(RECENT_KEY).filter((h) => !sameHit(h, hit))].slice(
      0,
      MAX_RECENT,
    );
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* 저장 실패는 기능 손실이 아니라 편의 손실이다 */
  }
}

export function togglePin(hit: SwitcherHit): SwitcherHit[] {
  const pins = readList(PIN_KEY);
  const next = pins.some((p) => sameHit(p, hit))
    ? pins.filter((p) => !sameHit(p, hit))
    : [hit, ...pins];
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify(next));
  } catch {
    /* 위와 같다 */
  }
  return next;
}

/**
 * **실제로 연 문서를 최근에 남긴다**(REQ-WEB-223). "최근 방문" 이라는 이름과 달리 트리·링크·알림으로 연
 * 문서는 기록되지 않고 ⌘K 에서 고른 것만 쌓였다 — 스펙·작업 상세가 데이터를 받으면 부른다.
 */
export function useRememberVisit(hit: SwitcherHit | null): void {
  const identity = hit === null ? null : `${hit.project_slug ?? ''}/${hit.key}`;
  useEffect(() => {
    if (hit !== null) rememberVisit(hit);
    // 같은 문서를 다시 그릴 때마다 적지 않는다 — 문서가 바뀔 때만
  }, [identity]);
}

/** 지금 조직에서 갈 수 있는 기록만 — **프로젝트를 모르는 옛 기록은 읽지 않는다**(갈 곳을 모른다) */
function usable(list: SwitcherHit[], orgSlug: string | null): SwitcherHit[] {
  return list.filter(
    (h) =>
      typeof h.project_slug === 'string' &&
      h.project_slug !== '' &&
      (orgSlug === null || h.org_slug === undefined || h.org_slug === orgSlug),
  );
}

/** 문서 줄이 가는 곳 — 요구사항은 요구사항 탭으로, 헤딩 앵커는 그 절로(§1.3a) */
function hrefOfHit(hit: SwitcherHit): string {
  const slug = encodeURIComponent(hit.project_slug ?? '');
  const key = encodeURIComponent(hit.key);
  if (hit.kind === 'task') return `/p/${slug}/tasks/${key}`;
  if (hit.kind === 'requirement') return `/p/${slug}/specs/${key}?rail=requirements`;
  const anchor =
    hit.anchor === null || hit.anchor === '' ? '' : `#${encodeURIComponent(hit.anchor)}`;
  return `/p/${slug}/specs/${key}${anchor}`;
}

type Group = 'pinned' | 'recent' | 'docs' | 'here' | 'go' | 'commands' | 'projects';

interface PaletteItem {
  id: string;
  group: Group;
  label: string;
  /** 줄 오른쪽의 흐린 말 — 프로젝트 이름·경로 */
  sub?: string;
  href: string;
  /** 명령 줄이면 할 일 — 있으면 `href` 로 가지 않고 이것을 부른다 */
  run?: () => void;
  /** 문서 줄이면 그 문서 — 고정 단추와 상태 배지가 선다 */
  hit?: SwitcherHit;
  /** 화면 언어와 무관하게 맞는 말(경로 낱말) */
  keywords?: string;
}

export interface QuickSwitcherProps {
  projectSlug: string | undefined;
  /** 문서를 찾는 범위를 자리표시자가 말한다(REQ-WEB-193) */
  projectName?: string | undefined;
  open: boolean;
  onClose: () => void;
}

export function QuickSwitcher({
  projectSlug,
  projectName,
  open,
  onClose,
}: QuickSwitcherProps): React.JSX.Element | null {
  const t = useT();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const scope = useScope(projectSlug);
  const orgSlug = scope.orgSlug;
  const me = useMe();
  const { locale, setLocale } = useLocale();
  const { theme, setTheme } = useTheme();
  const { pushToast } = useRealtime();
  // 새 스펙은 초안을 쓸 수 있는 사람의 일이다 — 서버 가드와 같은 값(`spec:draft`)을 본다
  const canDraft =
    projectSlug !== undefined &&
    scopesForRoles(rolesInProject(me.data, orgSlug, projectSlug)).has('spec:draft');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SwitcherHit[]>([]);
  /**
   * **결과가 어느 검색어의 것인가**(2026-10-04 · REQ-WEB-288). 디바운스 동안에는 앞 글자의 결과가
   * 남아 있어서, 번호를 다 치고 바로 Enter 를 누르면 그 앞 검색어의 첫 결과가 열렸다.
   */
  const [hitsFor, setHitsFor] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  // **핀은 상태다.** localStorage 만 보고 그리면 눌러도 화면이 그대로라, 판정과 저장은
  // 있는데 쓸 수 없었다 — 2026-09-05 감사까지 이 목록에 단추가 없던 자리다.
  const [pins, setPins] = useState<SwitcherHit[]>([]);

  useEffect(() => {
    if (open) setPins(readList(PIN_KEY));
  }, [open]);

  const isPinned = (hit: SwitcherHit): boolean => pins.some((p) => sameHit(p, hit));
  const q = query.trim().toLowerCase();

  const items = useMemo((): PaletteItem[] => {
    const docItem = (group: Group, hit: SwitcherHit, i: number): PaletteItem => ({
      id: `${group}-${hit.project_slug ?? ''}-${hit.key}-${hit.anchor ?? ''}-${i}`,
      group,
      label: hit.title,
      // 같은 문서가 앵커마다 한 줄씩 온다 — **어느 자리인지**(절·요구사항)를 적어야 줄이 갈린다
      sub:
        hit.anchor !== null && hit.anchor !== ''
          ? `§ ${hit.anchor}`
          : (hit.project_name ?? hit.project_slug ?? ''),
      href: hrefOfHit(hit),
      hit,
    });
    const go: PaletteItem[] = [
      { id: 'go-home', group: 'go', label: t('shell.home'), href: '/', keywords: 'home' },
      { id: 'go-inbox', group: 'go', label: t('shell.inbox'), href: '/inbox', keywords: 'inbox' },
      {
        id: 'go-notifications',
        group: 'go',
        label: t('shell.notifications'),
        href: '/notifications',
        keywords: 'notifications',
      },
      ...(['org', 'members', 'projects', 'gates', 'tokens'] as const).map((tab) => ({
        id: `go-settings-${tab}`,
        group: 'go' as const,
        label: t(`settings.tab.${tab}`),
        sub: t('shell.settings'),
        href: `/settings/${tab}`,
        keywords: `settings ${tab}`,
      })),
      { id: 'go-help', group: 'go', label: t('shell.help'), href: '/help', keywords: 'help' },
      ...((): PaletteItem[] => {
        const target = helpForRoute(pathname);
        return target === null
          ? []
          : [
              {
                id: 'go-help-here',
                group: 'go',
                label: t('switcher.help_here'),
                sub: t('shell.help'),
                // 절까지 간다(REQ-WEB-268) — 게이트 정책 화면이면 설정 장의 게이트 정책 절
                href: helpHref(target),
                keywords: 'help',
              },
            ];
      })(),
    ];
    const here: PaletteItem[] =
      projectSlug === undefined
        ? []
        : (
            [
              ['overview', '', 'shell.nav.overview'],
              ['specs', '/specs', 'shell.nav.specs'],
              ['tasks', '/tasks', 'shell.nav.tasks'],
              ['sessions', '/sessions', 'shell.nav.sessions'],
              ['reviews', '/reviews', 'shell.nav.review'],
            ] as const
          )
            .map(([id, path, label]): PaletteItem => ({
              id: `here-${id}`,
              group: 'here' as const,
              label: t(label),
              sub: projectName ?? projectSlug,
              href: `/p/${encodeURIComponent(projectSlug)}${path}`,
              keywords: id,
            }))
            .concat(
              /**
               * **이 프로젝트의 받은 요청 · 알림**(2026-09-27 · 사람 결정 N1 · REQ-WEB-258). 두 화면은 조직
               * 전체의 것이라 프로젝트 메뉴에 없다 — 여기서는 그 프로젝트로 좁힌 주소를 연다.
               */
              (
                [
                  ['inbox', '/inbox', 'shell.inbox'],
                  ['notifications', '/notifications', 'shell.notifications'],
                ] as const
              ).map(([id, path, label]) => {
                const params = new URLSearchParams();
                if (orgSlug !== null) params.set('org', orgSlug);
                params.set('project', projectSlug);
                return {
                  id: `here-${id}`,
                  group: 'here' as const,
                  label: t(label),
                  sub: projectName ?? projectSlug,
                  href: `${path}?${params.toString()}`,
                  keywords: id,
                };
              }),
            );
    const commands: PaletteItem[] = [
      ...(canDraft
        ? [
            {
              id: 'cmd-new-spec',
              group: 'commands' as const,
              label: t('switcher.cmd.new_spec'),
              sub: NEW_SPEC_COMMAND,
              href: '',
              keywords: 'new spec create',
              run: () => {
                void navigator.clipboard
                  ?.writeText(NEW_SPEC_COMMAND)
                  .then(() =>
                    pushToast({ tone: 'ok', message: t('switcher.cmd.new_spec_copied') }),
                  );
              },
            },
          ]
        : []),
      // 지금 것은 빼고 나머지를 보인다 — 이미 켜진 것을 고르는 줄은 할 일이 없다
      ...LOCALES.filter((code) => code !== locale).map((code) => ({
        id: `cmd-locale-${code}`,
        group: 'commands' as const,
        label: t('switcher.cmd.locale', { name: LOCALE_LABEL[code] }),
        href: '',
        keywords: `language locale ${code}`,
        run: () => setLocale(code),
      })),
      ...THEMES.filter((name) => name !== theme).map((name) => ({
        id: `cmd-theme-${name}`,
        group: 'commands' as const,
        label: t('switcher.cmd.theme', { name: t(`theme.${name}`) }),
        href: '',
        keywords: `theme ${name}`,
        run: () => setTheme(name),
      })),
    ];
    const projects: PaletteItem[] = scope.projects.map((p) => ({
      id: `project-${String(p['slug'])}`,
      group: 'projects',
      label: String(p['name'] ?? p['slug']),
      sub: String(p['slug']),
      href: `/p/${encodeURIComponent(String(p['slug']))}`,
      keywords: String(p['slug']),
    }));
    if (q === '') {
      const pinned = usable(pins, orgSlug);
      const recent = usable(readList(RECENT_KEY), orgSlug)
        .filter((r) => !pinned.some((p) => sameHit(p, r)))
        .slice(0, SHOWN_RECENT);
      return [
        ...pinned.map((h, i) => docItem('pinned', h, i)),
        ...recent.map((h, i) => docItem('recent', h, i)),
        ...here,
        ...go,
        ...commands,
        ...projects,
      ];
    }
    const matches = (item: PaletteItem): boolean =>
      `${item.label} ${item.sub ?? ''} ${item.keywords ?? ''}`.toLowerCase().includes(q);
    // 문서 결과에는 기록할 범위가 없다 — 지금 프로젝트의 것이다
    const docs = (hitsFor === query ? hits : []).map((hit, i) =>
      docItem(
        'docs',
        {
          ...hit,
          ...(projectSlug === undefined ? {} : { project_slug: projectSlug }),
          ...(projectName === undefined ? {} : { project_name: projectName }),
          ...(orgSlug === null ? {} : { org_slug: orgSlug }),
        },
        i,
      ),
    );
    return [
      ...docs,
      ...here.filter(matches),
      ...go.filter(matches),
      ...commands.filter(matches),
      ...projects.filter(matches),
    ];
  }, [
    q,
    query,
    hits,
    hitsFor,
    pins,
    orgSlug,
    scope.projects,
    projectSlug,
    projectName,
    pathname,
    t,
    canDraft,
    locale,
    setLocale,
    theme,
    setTheme,
    pushToast,
  ]);

  // 목록이 줄면 커서를 끌어온다 — 커서가 목록 밖에 남으면 Enter 가 아무 일도 하지 않는다
  useEffect(() => {
    if (cursor > items.length - 1) setCursor(Math.max(0, items.length - 1));
  }, [items.length, cursor]);

  // 첫 포커스는 입력칸 · Esc 는 어디서든 · Tab 은 안에서 · 닫으면 연 자리로 — 모달 한 벌의 규칙이다(REQ-WEB-224)
  const { onKeyDown: modalKeys } = useModal(open, boxRef, onClose, inputRef);
  useEffect(() => {
    if (open) return;
    setQuery('');
    setHits([]);
    setHitsFor('');
    setCursor(0);
  }, [open]);

  useEffect(() => {
    if (!open || projectSlug === undefined || q === '') return;
    const timer = setTimeout(() => {
      void apiFetch<{ items: SwitcherHit[] }>(
        `/projects/${projectSlug}/specs/search?q=${encodeURIComponent(query)}&limit=10`,
      )
        .then((result) => {
          setHits(result.items ?? []);
          setHitsFor(query);
        })
        .catch(() => {
          setHits([]);
          setHitsFor(query);
        });
    }, 180); // 디바운스 — 타이핑마다 서버를 때리지 않는다
    return () => clearTimeout(timer);
  }, [open, projectSlug, query, q]);

  const go = useCallback(
    (item: PaletteItem) => {
      if (item.hit !== undefined) rememberVisit(item.hit);
      onClose();
      if (item.run !== undefined) {
        item.run();
        return;
      }
      // 다른 조직의 기록이면 조직을 바꾸고 그 자리로 간다(REQ-WEB-199)
      router.history.push(inOrgHref(item.hit?.org_slug, item.href, orgSlug));
    },
    [onClose, orgSlug, router],
  );

  if (!open) return null;

  const GROUP_LABEL: Record<Group, string> = {
    pinned: t('switcher.group.pinned'),
    recent: t('switcher.group.recent'),
    docs: t('switcher.group.docs'),
    here: t('switcher.group.here', { project: projectName ?? projectSlug ?? '' }),
    go: t('switcher.group.go'),
    commands: t('switcher.group.commands'),
    projects: t('switcher.group.projects'),
  };
  const optionId = (index: number): string => `${listId}-opt-${index}`;
  const groups: { group: Group; entries: { item: PaletteItem; index: number }[] }[] = [];
  items.forEach((item, index) => {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.group === item.group) last.entries.push({ item, index });
    else groups.push({ group: item.group, entries: [{ item, index }] });
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('switcher.label')}
      data-testid="quick-switcher"
      className="fixed inset-0 z-50 flex items-start justify-center bg-text/20 pt-[15vh] backdrop-blur-xs"
      onClick={onClose}
      // Esc 는 **어디서든** 닫는다 — 입력칸에 있을 때만 먹던 동안 고정 단추로 옮겨 가면 닫을 수 없었다
      onKeyDown={modalKeys}
    >
      <div
        ref={boxRef}
        className="w-full max-w-xl overflow-hidden rounded-nerv-lg border border-border bg-bg-elev shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={items.length === 0 ? undefined : optionId(cursor)}
          aria-label={t('switcher.label')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            // 키보드로 완결한다 — 마우스 없이 검색·이동이 끝나야 한다(§1.3a)
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, items.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            }
            if (e.key === 'Enter') {
              const item = items[cursor];
              if (item !== undefined) go(item);
            }
          }}
          placeholder={
            projectSlug === undefined
              ? t('switcher.placeholder_no_project')
              : t('switcher.placeholder_in', { project: projectName ?? projectSlug })
          }
          className="w-full border-b border-border bg-transparent px-4 py-3 text-base outline-none placeholder:text-text-faint"
        />
        <div
          id={listId}
          role="listbox"
          aria-label={t('switcher.label')}
          className="max-h-96 overflow-y-auto py-1"
        >
          {items.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-text-faint">
              {/* 프로젝트 밖에서 문서를 찾으면 **결과가 없는 것이 아니라 찾지 않은 것**이다(REQ-WEB-193) */}
              {projectSlug === undefined
                ? t('switcher.no_results_outside')
                : t('switcher.no_results')}
            </p>
          )}
          {groups.map(({ group, entries }) => (
            <div
              key={`${group}-${entries[0]!.index}`}
              role="group"
              aria-label={GROUP_LABEL[group]}
              data-testid={`switcher-group-${group}`}
            >
              <p
                aria-hidden="true"
                className="px-4 pt-2 pb-1 text-2xs font-semibold tracking-label text-text-faint"
              >
                {GROUP_LABEL[group]}
              </p>
              {entries.map(({ item, index }) => (
                <div
                  key={item.id}
                  data-active={index === cursor}
                  className="flex items-center hover:bg-bg-hover data-[active=true]:bg-bg-active"
                >
                  <div
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === cursor}
                    data-testid="switcher-option"
                    onClick={() => go(item)}
                    onMouseMove={() => setCursor(index)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-4 py-2 text-left text-sm"
                  >
                    {item.hit !== undefined && (
                      <span className="font-mono text-xs text-text-faint">{item.hit.key}</span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.sub !== undefined && item.sub !== '' && (
                      <span className="max-w-[40%] shrink-0 truncate text-2xs text-text-faint">
                        {item.sub}
                      </span>
                    )}
                    {item.hit?.archived_at != null && (
                      <StatusBadge token="idle" label={t('specs.archived_badge')} />
                    )}
                    {item.hit !== undefined && item.hit.doc_status !== null && (
                      <StatusBadge
                        token={
                          (SPEC_VERSION_TOKEN[
                            item.hit.doc_status as keyof typeof SPEC_VERSION_TOKEN
                          ] ?? 'idle') as StatusToken
                        }
                        label={t(statusLabelKey('spec', item.hit.doc_status))}
                      />
                    )}
                  </div>
                  {/* **고정은 여는 것과 다른 일이다** — 그래서 단추도 따로다(중첩할 수도 없다).
                      최근 방문은 어제 본 것이 오늘 밀려나지만, 매일 여는 대여섯은 그러면 안 된다. */}
                  {item.hit !== undefined && (
                    <button
                      type="button"
                      data-testid={`switcher-pin-${item.hit.key}`}
                      aria-pressed={isPinned(item.hit)}
                      title={t(isPinned(item.hit) ? 'switcher.unpin' : 'switcher.pin')}
                      onClick={() => setPins(togglePin(item.hit!))}
                      className={cn(
                        'shrink-0 px-3 py-2 text-sm text-text-faint hover:text-text aria-pressed:text-status-action',
                      )}
                    >
                      <span aria-hidden="true">{isPinned(item.hit) ? '★' : '☆'}</span>
                      <span className="sr-only">
                        {t(isPinned(item.hit) ? 'switcher.unpin' : 'switcher.pin')}
                      </span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
        {/* 이 상자 안에서 이동이 끝난다는 것을 바닥이 말해준다 */}
        <p className="flex gap-3 border-t border-border px-4 py-1.5 text-2xs text-text-faint">
          <span>{t('switcher.key_move')}</span>
          <span>{t('switcher.key_open')}</span>
          <span>{t('switcher.key_close')}</span>
        </p>
      </div>
    </div>
  );
}
