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
import type { NervEventEnvelope } from '@nerv/schema';
import { connectNervSocket, joinProjectRoom, leaveProjectRoom } from './ws.js';
import { invalidationKeysFor } from './event-invalidation.js';
import type { ConnectionState } from './ws.js';

export interface Toast {
  id: string;
  tone: 'warn' | 'info' | 'ok';
  message: string;
  /** 되돌리기 링크 — 승인 처리 트레일이 쓴다(ui-wireframes §4.1) */
  href?: string | undefined;
  hrefLabel?: string | undefined;
}

export interface RealtimeValue {
  /** 'connected' | 'connecting' | 'disconnected' — 배너 1단계의 근거 */
  state: ConnectionState;
  /** REST 자체가 죽었나 — 배너 2단계(오프라인)로 격상한다(NFR-05) */
  offline: boolean;
  setOffline: (offline: boolean) => void;
  joinProject: (projectId: string) => () => void;
  toasts: Toast[];
  pushToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
}

const RealtimeContext = createContext<RealtimeValue | null>(null);

export function useRealtime(): RealtimeValue {
  const value = useContext(RealtimeContext);
  if (value === null) throw new Error('RealtimeProvider 밖에서 useRealtime 을 불렀습니다.');
  return value;
}

/** 폴백 폴링 간격 — WS 가 끊긴 동안의 갱신 수단(REQ-WEB-002). */
export const FALLBACK_POLL_MS = 15_000;

export function RealtimeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConnectionState>('connecting');
  const [offline, setOffline] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const wasConnected = useRef(false);

  const pushToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
    // 처리됨 트레일은 3분 유지다(ui-wireframes §4.1) — 경고는 그보다 짧게 둔다.
    const ttl = toast.tone === 'ok' ? 180_000 : 20_000;
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), ttl);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const onEvent = useCallback(
    (event: NervEventEnvelope) => {
      for (const key of invalidationKeysFor(event)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      // 겹침 경고는 무효화만으로 충분하지 않다 — 사람이 **지금** 알아야 하는 사실이다.
      if (event.type === NERV_EVENT.CLAIM_CONFLICT_WARN) {
        pushToast({ tone: 'warn', message: t('realtime.conflict_warn') });
      }
      if (event.type === NERV_EVENT.CLAIM_CONFLICT_BLOCKED) {
        pushToast({ tone: 'warn', message: t('realtime.conflict_blocked') });
      }
    },
    [pushToast, queryClient],
  );

  useEffect(() => {
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
    socketRef.current = socket;
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [onEvent, queryClient]);

  const joinProject = useCallback((projectId: string) => {
    const socket = socketRef.current;
    if (socket === null) return () => undefined;
    joinProjectRoom(socket, projectId);
    return () => leaveProjectRoom(socket, projectId);
  }, []);

  const value = useMemo<RealtimeValue>(
    () => ({ state, offline, setOffline, joinProject, toasts, pushToast, dismissToast }),
    [state, offline, joinProject, toasts, pushToast, dismissToast],
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
