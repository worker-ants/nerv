// NERV_* 에러 코드 → UI 동작 — 정본: docs/04-mvp/screens.md §1.5
//
// **그 표는 "모든 화면의 기본값" 으로 선언된 계약이다.** 그런데 2026-09-06 까지 코드를
// 보고 분기하는 자리는 저장소 전체에 셋뿐이었고(스펙 편집의 409 둘·메타 다이얼로그 하나),
// 나머지 여덟 코드는 전부 `pushToast({ message: error.message })` 로 떨어졌다 —
// **서버가 왜 막았는지가 화면에서 사라진다.** 봉투가 실어 오는 `retry_after_s` 와
// `next_actions` 는 `api.ts` 가 파싱까지 해 놓고 쓰는 곳이 0건이었다.
//
// 판정은 한 곳이다(D-05 의 정신). 화면은 이 함수가 돌려준 것을 그리기만 한다.

import { NERV_ERROR } from '@nerv/schema';
import type { MessageKey, Translator } from '@nerv/schema';
import { useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { NervApiError } from './api.js';
import { useT } from './i18n.js';
import { useRealtime } from './realtime.js';

export interface ApiErrorAction {
  /** 사람에게 보일 문장 — 서버 문구보다 **무엇을 하면 되는지**가 앞선다 */
  message: string;
  /** `/login` 리다이렉트가 필요한가(원래 경로 보존은 부르는 쪽의 라우터가 한다) */
  redirectToLogin: boolean;
  /** 배너를 오프라인으로 격상해야 하는가(§1.3 2단계) */
  escalateBanner: boolean;
  /** 딥링크 — 승인 대기·사람 전용 액션이 데려갈 곳 */
  href?: string;
  hrefLabel?: string;
  /** 재시도까지 남은 초 — `Retry-After` 를 존중한다 */
  retryAfterS?: number;
}

/**
 * 코드마다 "무엇을 하면 되는지" 한 줄. 표(§1.5)의 UI 동작 열과 1:1 이다.
 *
 * 자리표시자 없는 키만 담는다 — 그래야 코드에서 키를 찾아 그대로 부를 수 있다.
 */
type PlainErrorKey = Exclude<Extract<MessageKey, `apierr.${string}`>, 'apierr.retry_after'>;

const MESSAGE: Record<string, PlainErrorKey> = {
  [NERV_ERROR.UNAUTHENTICATED]: 'apierr.unauthenticated',
  [NERV_ERROR.FORBIDDEN]: 'apierr.forbidden',
  [NERV_ERROR.PRECONDITION]: 'apierr.precondition',
  [NERV_ERROR.CONFLICT_SCOPE]: 'apierr.conflict_scope',
  [NERV_ERROR.LEASE_EXPIRED]: 'apierr.lease_expired',
  [NERV_ERROR.DRAFT_LEASED]: 'apierr.draft_leased',
  [NERV_ERROR.APPROVAL_REQUIRED]: 'apierr.approval_required',
  [NERV_ERROR.HUMAN_ONLY]: 'apierr.human_only',
  [NERV_ERROR.RATE_LIMIT]: 'apierr.rate_limit',
  [NERV_ERROR.UNAVAILABLE]: 'apierr.unavailable',
};

/**
 * 봉투 하나를 화면 동작으로 옮긴다.
 *
 * **서버 문장을 버리지 않는다.** 코드가 말하는 것은 *부류*이고 서버 문장은 *이 건*이다 —
 * "겹칩니다" 만 남기고 상대 세션의 사용자·hostname 을 지우면 사람은 다시 물어야 한다.
 */
export function describeApiError(t: Translator, error: unknown): ApiErrorAction {
  if (!(error instanceof NervApiError)) {
    return {
      message: error instanceof Error ? error.message : t('apierr.unknown'),
      redirectToLogin: false,
      // 봉투가 없는 실패는 네트워크 단절일 때가 많다 — 다만 배너의 스위치는 `api.ts` 의
      // 도달 판정이 이미 쥐고 있으므로 여기서 겹쳐 켜지 않는다.
      escalateBanner: false,
    };
  }

  const { code, message, details, retry_after_s, next_actions } = error.body;
  const headline = code === null ? message : t(MESSAGE[code] ?? 'apierr.unknown');
  const action: ApiErrorAction = {
    // 부류 → 이 건 순서다. 서버 문장이 비어 있으면 부류만 남는다.
    message: message === '' || message === headline ? headline : `${headline} — ${message}`,
    redirectToLogin: code === NERV_ERROR.UNAUTHENTICATED,
    escalateBanner: code === NERV_ERROR.UNAVAILABLE,
  };

  if (retry_after_s !== null) {
    action.retryAfterS = retry_after_s;
    action.message = t('apierr.retry_after', { n: retry_after_s, message: action.message });
  }

  // 승인 대기·사람 전용은 **갈 곳이 있다.** 링크가 없으면 사람은 "그래서 어디로" 에서 멈춘다.
  const webUrl = details['web_url'];
  if (typeof webUrl === 'string' && webUrl !== '') {
    action.href = webUrl;
    action.hrefLabel = t('apierr.open_link');
  } else if (code === NERV_ERROR.APPROVAL_REQUIRED) {
    action.href = '/inbox';
    action.hrefLabel = t('apierr.open_inbox');
  }

  // `next_actions` 는 서버가 적어 보낸 다음 행동이다 — 파싱만 하고 버리던 값이다.
  const next = next_actions.filter((a) => a !== '');
  if (next.length > 0) action.message = `${action.message} (${next.join(' · ')})`;

  return action;
}

/**
 * 화면이 쓰는 손잡이 — `onError: onApiError` 한 줄로 §1.5 의 기본값을 받는다.
 *
 * **31곳이 각자 `error.message` 를 토스트에 넣고 있었다.** 같은 표를 서른한 번 다시 쓰면
 * 그때마다 조금씩 다르게 틀리고, 실제로는 아무도 쓰지 않아 여덟 코드가 통째로 빠졌다.
 */
export function useApiError(): (error: unknown) => void {
  const t = useT();
  const { pushToast, setOffline } = useRealtime();
  const navigate = useNavigate();

  return useCallback(
    (error: unknown) => {
      const action = describeApiError(t, error);
      if (action.escalateBanner) setOffline(true);
      if (action.redirectToLogin) {
        // 원래 경로를 보존한다 — 로그인 뒤 홈으로 떨구면 하던 일을 다시 찾아가야 한다
        const redirect = `${window.location.pathname}${window.location.search}`;
        void navigate({ to: '/login', search: { redirect } });
        return;
      }
      pushToast({
        tone: 'warn',
        message: action.message,
        href: action.href,
        hrefLabel: action.hrefLabel,
      });
    },
    [t, pushToast, setOffline, navigate],
  );
}
