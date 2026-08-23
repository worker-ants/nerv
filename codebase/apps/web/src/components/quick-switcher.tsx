// 전역 퀵 스위처 ⌘K — 정본: screens.md §1.3a (REQ-WEB-040)
//
// 대규모 프로젝트의 **기본 이동 수단**이다. 트리 스크롤 대신 타이핑 → Enter 로 어디서든
// 어디로든 간다. 안정 ID(SPC-·REQ-·TSK-)는 검색을 거치지 않고 직행한다 — 사람이 ID 를
// 칠 때는 "찾아줘"가 아니라 "열어줘"라는 뜻이기 때문이다(서버 파이프라인 ①과 같은 규칙).
//
// 최근 방문·핀은 localStorage 다 — 뷰 상태 등급이고 서버 동기화는 Phase 2(§1.3a).

import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../lib/api.js';
import { StatusBadge } from './status-badge.js';
import { SPEC_VERSION_TOKEN } from './status-token.js';
import type { StatusToken } from './status-badge.js';

export interface SwitcherHit {
  key: string;
  title: string;
  type: string;
  doc_status: string | null;
  anchor: string | null;
}

const RECENT_KEY = 'nerv.quickswitcher.recent';
const PIN_KEY = 'nerv.quickswitcher.pins';
const MAX_RECENT = 20;

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
    const next = [hit, ...readList(RECENT_KEY).filter((h) => h.key !== hit.key)].slice(
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
  const next = pins.some((p) => p.key === hit.key)
    ? pins.filter((p) => p.key !== hit.key)
    : [hit, ...pins];
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify(next));
  } catch {
    /* 위와 같다 */
  }
  return next;
}

export interface QuickSwitcherProps {
  projectSlug: string | undefined;
  open: boolean;
  onClose: () => void;
}

export function QuickSwitcher({
  projectSlug,
  open,
  onClose,
}: QuickSwitcherProps): React.JSX.Element | null {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SwitcherHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 빈 입력에서는 최근 방문 + 핀을 보여준다 — "방금 보던 것"이 대개 다음 목적지다.
  const fallback = useMemo(() => {
    const pins = readList(PIN_KEY);
    const recent = readList(RECENT_KEY).filter((r) => !pins.some((p) => p.key === r.key));
    return [...pins, ...recent];
  }, [open]);

  const rows = query.trim() === '' ? fallback : hits;

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else {
      setQuery('');
      setHits([]);
      setCursor(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open || projectSlug === undefined || query.trim() === '') return;
    const timer = setTimeout(() => {
      void apiFetch<{ items: SwitcherHit[] }>(
        `/projects/${projectSlug}/specs/search?q=${encodeURIComponent(query)}&limit=10`,
      )
        .then((result) => setHits(result.items ?? []))
        .catch(() => setHits([]));
    }, 180); // 디바운스 — 타이핑마다 서버를 때리지 않는다
    return () => clearTimeout(timer);
  }, [open, projectSlug, query]);

  const go = useCallback(
    (hit: SwitcherHit) => {
      rememberVisit(hit);
      onClose();
      if (projectSlug === undefined) return;
      if (hit.key.startsWith('TSK-')) {
        void navigate({ to: '/p/$proj/tasks/$task', params: { proj: projectSlug, task: hit.key } });
        return;
      }
      void navigate({ to: '/p/$proj/specs/$spec', params: { proj: projectSlug, spec: hit.key } });
    },
    [navigate, onClose, projectSlug],
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="빠른 이동"
      data-testid="quick-switcher"
      className="fixed inset-0 z-50 flex items-start justify-center bg-text/20 pt-[15vh] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-nerv-lg border border-border bg-bg-elev shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            // 키보드로 완결한다 — 마우스 없이 검색·이동이 끝나야 한다(§1.3a)
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') setCursor((c) => Math.min(c + 1, rows.length - 1));
            if (e.key === 'ArrowUp') setCursor((c) => Math.max(c - 1, 0));
            if (e.key === 'Enter') {
              const hit = rows[cursor];
              if (hit !== undefined) go(hit);
            }
          }}
          placeholder="스펙·작업 검색 또는 안정 ID (SPC-… · TSK-…)"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-base outline-none placeholder:text-text-faint"
        />
        <ul className="max-h-80 overflow-y-auto py-1">
          {rows.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-text-faint">
              {query.trim() === ''
                ? '최근 방문한 문서가 여기 쌓입니다.'
                : '결과가 없습니다 — 다른 표현으로 찾아보세요.'}
            </li>
          )}
          {rows.map((hit, index) => (
            <li key={`${hit.key}-${hit.anchor ?? ''}`}>
              <button
                type="button"
                onClick={() => go(hit)}
                data-active={index === cursor}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-bg-hover data-[active=true]:bg-bg-active"
              >
                <span className="font-mono text-xs text-text-faint">{hit.key}</span>
                <span className="min-w-0 flex-1 truncate">{hit.title}</span>
                {hit.doc_status !== null && (
                  <StatusBadge
                    token={
                      (SPEC_VERSION_TOKEN[hit.doc_status as keyof typeof SPEC_VERSION_TOKEN] ??
                        'idle') as StatusToken
                    }
                    label={hit.doc_status}
                  />
                )}
              </button>
            </li>
          ))}
        </ul>
        {/* 이 상자 안에서 이동이 끝난다는 것을 바닥이 말해준다 */}
        <p className="flex gap-3 border-t border-border px-4 py-1.5 text-2xs text-text-faint">
          <span>↑↓ 이동</span>
          <span>↵ 열기</span>
          <span>esc 닫기</span>
        </p>
      </div>
    </div>
  );
}
