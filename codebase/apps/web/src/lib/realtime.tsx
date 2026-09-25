// 실시간 연결 — WS 구독 · 쿼리 무효화 · 연결 상태 2단계 · 토스트 (screens.md §1.4 · REQ-WEB-002)
//
// 클라이언트 계약은 세 줄이다: 룸 2종 · **이벤트는 무효화 신호** · 재연결 = 전체 재조회.
// 그래서 이 파일은 어떤 상태도 이벤트 본문으로 갱신하지 않는다 — 봉투에는 식별자만 있고
// 진실은 DB 다(D-14). 이 규칙 하나가 "화면과 DB 가 다른" 종류의 버그를 통째로 없앤다.

import type { Translator } from '@nerv/schema';
import { useT } from '../lib/i18n.js';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Socket } from 'socket.io-client';
import { NERV_EVENT } from '@nerv/schema';
import type { NervEventEnvelope, NervEventName } from '@nerv/schema';
import { onReachabilityChange } from './api.js';
import { useMe } from './queries.js';
import { connectNervSocket, forgetRooms, joinProjectRoom, leaveProjectRoom } from './ws.js';
import { headPredicateFor, invalidationKeysFor, sharedKeysFor } from './event-invalidation.js';
import type { ConnectionState } from './ws.js';

export interface Toast {
  id: string;
  /**
   * 모양과 보조기기 알림을 정한다(REQ-WEB-197) — `warn` 은 실패·경고(⚠, `role="alert"`),
   * `ok` 는 내가 한 일의 결과(✓), `info` 는 남이 한 일(ℹ). 셋 다 같은 흰 상자였던 동안
   * "권한이 없습니다" 와 "승인했습니다" 를 모양으로 가를 수 없었다.
   */
  tone: 'warn' | 'info' | 'ok';
  message: string;
  /** 누르면 갈 곳 — 앱 안 경로면 새로 적재하지 않는다 */
  href?: string | undefined;
  hrefLabel?: string | undefined;
  /**
   * 결재 처리 트레일 — 3분 남는다(ui-wireframes §4.1). 수명은 톤이 아니라 **종류**가 정한다:
   * 톤으로 정하던 동안 에이전트가 초안을 저장할 때마다 뜨는 알림까지 3분씩 쌓였다.
   */
  kind?: 'trail' | undefined;
  /** 같은 값의 토스트는 한 장으로 합친다 — 같은 문서가 연달아 바뀌면 줄이 쌓이지 않게 */
  mergeKey?: string | undefined;
}

/** 수명(REQ-WEB-197) — 결재 트레일 3분 · 경고 20초 · 그 밖 8초 */
export const TOAST_TTL_MS = { trail: 180_000, warn: 20_000, default: 8_000 } as const;

function ttlOf(toast: Omit<Toast, 'id'>): number {
  if (toast.kind === 'trail') return TOAST_TTL_MS.trail;
  return toast.tone === 'warn' ? TOAST_TTL_MS.warn : TOAST_TTL_MS.default;
}

export interface RealtimeValue {
  /** 'connected' | 'connecting' | 'disconnected' — 배너 1단계의 근거 */
  state: ConnectionState;
  /** REST 자체가 죽었나 — 배너 2단계(오프라인)로 격상한다(NFR-05) */
  offline: boolean;
  setOffline: (offline: boolean) => void;
  /** 프로젝트 룸에 붙는다. slug 를 주면 그 프로젝트의 알림 토스트가 문서 링크를 단다 */
  joinProject: (projectId: string, projectSlug?: string) => () => void;
  toasts: Toast[];
  pushToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
  dismissAllToasts: () => void;
}

const RealtimeContext = createContext<RealtimeValue | null>(null);

export function useRealtime(): RealtimeValue {
  const value = useContext(RealtimeContext);
  // eslint-disable-next-line no-restricted-syntax -- 개발자 오류 — 화면에 뜨지 않는다(REQ-CB-022)
  if (value === null) throw new Error('RealtimeProvider 밖에서 useRealtime 을 불렀습니다.');
  return value;
}

/** 폴백 폴링 간격 — WS 가 끊긴 동안의 갱신 수단(REQ-WEB-002). */
export const FALLBACK_POLL_MS = 15_000;

/**
 * 토스트로 알릴 이벤트 — **전부는 아니다.**
 *
 * 알림의 기준은 "화면을 보고 있는 사람이 지금 알아야 하는가"다. 스펙이 생기거나 승인되는
 * 것은 그렇고(내 화면의 내용이 바뀐다), 하트비트나 세션 활동은 그렇지 않다 — 그런 것까지
 * 띄우면 토스트가 배경 소음이 되고, 그러면 정작 중요한 겹침 경고도 같이 묻힌다.
 */
type SpecNotice =
  | 'realtime.spec_changed'
  | 'realtime.spec_submitted'
  | 'realtime.spec_approved'
  | 'realtime.spec_rejected';

const NOTIFY: Partial<Record<NervEventName, SpecNotice>> = {
  [NERV_EVENT.SPEC_DRAFT_CREATED]: 'realtime.spec_changed',
  [NERV_EVENT.SPEC_DRAFT_UPDATED]: 'realtime.spec_changed',
  [NERV_EVENT.SPEC_SUBMITTED]: 'realtime.spec_submitted',
  [NERV_EVENT.SPEC_APPROVED]: 'realtime.spec_approved',
  [NERV_EVENT.SPEC_REJECTED]: 'realtime.spec_rejected',
  [NERV_EVENT.SPEC_ARCHIVED]: 'realtime.spec_changed',
  [NERV_EVENT.SPEC_RESTORED]: 'realtime.spec_changed',
  [NERV_EVENT.SPEC_META_UPDATED]: 'realtime.spec_changed',
};

export function RealtimeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const t = useT();
  // **번역기는 소켓의 수명에 영향을 주지 않는다.** `onEvent` 가 `t` 에 의존하면 언어를
  // 바꿀 때마다 콜백 정체성이 바뀌고, 그러면 소켓 effect 가 다시 돌아 연결을 닫고 새로
  // 만들며 `forgetRooms()` 로 기억까지 지운다 — 그런데 화면의 join effect 는 다시 돌지
  // 않으므로 그 프로젝트의 실시간이 조용히 끊겼다(REQ-WEB-127 이 고친 결함의 다른 문).
  // ref 로 최신 번역기를 들고 있으면 문구는 최신이고 소켓은 그대로다.
  const translate = useRef(t);
  translate.current = t;
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConnectionState>('connecting');
  const [offline, setOffline] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const me = useMe();
  const wasConnected = useRef(false);
  // 룸에 붙은 프로젝트의 slug — 봉투는 id 만 싣는다(D-14). 토스트의 문서 링크가 쓴다.
  const projectSlugs = useRef(new Map<string, string>());

  // 토스트마다 걸린 타이머 — 닫거나 합칠 때 옛 타이머가 새 토스트를 지우지 않게 쥔다
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismissToast = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAllToasts = useCallback(() => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    setToasts([]);
  }, []);

  const pushToast = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((prev) => {
        // **합친다**(REQ-WEB-197). 같은 문서가 연달아 바뀌면 같은 줄이 쌓였다 — 에이전트가
        // 초안을 저장할 때마다 한 장씩이었다. 옛 장을 지우고 새 장을 맨 아래(가장 새 자리)에 둔다.
        const merged =
          toast.mergeKey === undefined ? [] : prev.filter((t) => t.mergeKey === toast.mergeKey);
        for (const old of merged) {
          const timer = timers.current.get(old.id);
          if (timer !== undefined) clearTimeout(timer);
          timers.current.delete(old.id);
        }
        const rest = merged.length === 0 ? prev : prev.filter((t) => !merged.includes(t));
        return [...rest, { ...toast, id }];
      });
      timers.current.set(
        id,
        setTimeout(() => dismissToast(id), ttlOf(toast)),
      );
    },
    [dismissToast],
  );

  // onEvent 가 읽으므로 그보다 먼저 잡는다 — "내가 한 일"을 가르는 기준이다
  const userId = me.data?.id;

  const onEvent = useCallback(
    (event: NervEventEnvelope) => {
      for (const key of [...invalidationKeysFor(event), ...sharedKeysFor(event)]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      // 키로 닿지 않는 머리(slug 축 프로젝트 · 조직의 프로젝트 목록) — REQ-WEB-219
      const head = headPredicateFor(event);
      if (head !== null) void queryClient.invalidateQueries({ predicate: head });
      // 겹침 경고는 무효화만으로 충분하지 않다 — 사람이 **지금** 알아야 하는 사실이다.
      if (event.type === NERV_EVENT.CLAIM_CONFLICT_WARN) {
        pushToast({ tone: 'warn', message: translate.current('realtime.conflict_warn') });
        return;
      }
      if (event.type === NERV_EVENT.CLAIM_CONFLICT_BLOCKED) {
        pushToast({ tone: 'warn', message: translate.current('realtime.conflict_blocked') });
        return;
      }

      // **남이 바꾼 것만 알린다**(2026-08-29 신설). 화면이 조용히 갱신되면 사람은 "안 바뀌었다"
      // 와 구별하지 못한다 — 에이전트가 스펙을 만들어도 알 길이 없었다. 반대로 내가 방금 한
      // 저장까지 알리면 저장할 때마다 두 번 뜨고, 그 소음은 알림 자체를 못 믿게 만든다.
      // 그래서 봉투의 `actor_user_id` 로 가른다(api.md §3.3).
      if (event.actor_user_id !== null && event.actor_user_id === userId) return;
      const label = NOTIFY[event.type];
      if (label === undefined) return;
      // **남이 한 일은 `info` 다**(REQ-WEB-197) — 내가 한 일의 ✓ 와 모양이 같으면 무엇이 내
      // 결과인지 가를 수 없다. 같은 문서는 한 장으로 합치고, 그 문서로 가는 길을 단다.
      const subject = event.subject_key ?? '';
      const slug = projectSlugs.current.get(event.project_id);
      pushToast({
        tone: 'info',
        message: translate.current(label, { subject }),
        mergeKey: `spec:${event.project_id}:${subject}`,
        ...(slug !== undefined && subject !== ''
          ? {
              href: `/p/${slug}/specs/${encodeURIComponent(subject)}`,
              hrefLabel: translate.current('shell.toast.open'),
            }
          : {}),
      });
    },
    [pushToast, queryClient, userId],
  );

  // **인증된 뒤에만 붙는다.** 예전에는 마운트 즉시 붙었는데, 로그인 화면에서는 세션 쿠키가
  // 없어 서버가 핸드셰이크를 거절하고 소켓을 끊는다. socket.io 는 **서버가 끊은 연결은 자동
  // 재연결하지 않으므로**(`io server disconnect`) 로그인에 성공해도 실시간이 영영 죽은 채로
  // 남았다 — 새로고침하기 전까지 "실시간 갱신 중단" 배너가 걸려 있었다(실측 2026-08-23).
  //
  // E2E 가 이것을 놓친 이유도 같다: 저장된 세션으로 시작하니 첫 연결이 성공했다.
  // 로그인 **화면을 거쳐** 들어오는 경로가 검증되지 않았던 것이다.

  useEffect(() => {
    if (userId === undefined) return undefined;
    const socket = connectNervSocket({
      onEvent,
      onStateChange: (next) => {
        setState(next);
        // 재연결 = 전체 재조회. replay 가 없으므로 끊긴 동안의 변화는 이 한 번으로 따라잡는다.
        if (next === 'connected' && wasConnected.current) {
          void queryClient.invalidateQueries();
        }
        if (next === 'connected') wasConnected.current = true;
      },
    });
    // 새 소켓은 새 기억으로 시작한다 — 앞 계정이 보던 룸을 물려받지 않는다
    forgetRooms();
    socketRef.current = socket;
    return () => {
      socket.close();
      socketRef.current = null;
    };
    // userId 가 바뀌면(로그인·로그아웃·계정 전환) 소켓을 새로 만든다
  }, [onEvent, queryClient, userId]);

  // 떠날 때 남은 타이머를 거둔다 — 언마운트된 공급자의 setState 를 부르지 않게
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  // 배너 ②를 켜는 유일한 자리(§1.3). 폴백 폴링이 계속 돌므로 되살아나는 것도 여기서 본다.
  useEffect(() => onReachabilityChange((reachable) => setOffline(!reachable)), []);

  const joinProject = useCallback((projectId: string, projectSlug?: string) => {
    // 소켓이 아직 없어도 **기억은 남긴다** — 붙는 순간 `connect` 핸들러가 되찾는다.
    joinProjectRoom(socketRef.current, projectId);
    if (projectSlug !== undefined) projectSlugs.current.set(projectId, projectSlug);
    return () => {
      leaveProjectRoom(socketRef.current, projectId);
      projectSlugs.current.delete(projectId);
    };
  }, []);

  const value = useMemo<RealtimeValue>(
    () => ({
      state,
      offline,
      setOffline,
      joinProject,
      toasts,
      pushToast,
      dismissToast,
      dismissAllToasts,
    }),
    [state, offline, joinProject, toasts, pushToast, dismissToast, dismissAllToasts],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

/**
 * 배너 문구 — 2단계다(§1.3).
 *   ① WS 끊김(REST 정상): 폴백 폴링으로 계속 돈다
 *   ② 플랫폼 끊김(REST 실패): 캐시된 읽기 전용으로 격상 — 쓰기를 막는 것은 화면의 몫이다
 */
export function connectionBanner(
  t: Translator,
  state: ConnectionState,
  offline: boolean,
): string | null {
  if (offline) return t('realtime.offline');
  if (state === 'disconnected') return t('realtime.ws_down');
  return null;
}
