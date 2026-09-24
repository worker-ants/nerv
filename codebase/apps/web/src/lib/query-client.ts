// TanStack Query 클라이언트.
// 진실은 DB 다(D-14) — 캐시는 화면 반응 속도를 위한 것이고, 이벤트가 오면 무효화로 다시 읽는다.
import { MutationCache, QueryClient } from '@tanstack/react-query';

/**
 * 실패한 쓰기의 **기본 처리기**(REQ-WEB-196) — 앱 셸이 `useApiError()` 를 여기 걸어 둔다.
 *
 * 2026-09-24 까지 `onError` 를 적지 않은 쓰기는 **실패해도 아무 말이 없었다** — 코멘트 달기·
 * 해결, 첨부 삭제, 알림 읽음·모두 읽음, 토큰 폐기가 그랬다. 코멘트를 쓰고 [추가] 를 눌렀는데
 * 서버가 거절하면 입력은 그대로 남고 화면은 조용했다 — 달렸는지 사람은 알 수 없다.
 * 서른 곳이 각자 적어야 하는 규칙은 언젠가 한 곳이 빠진다. 그래서 기본값은 여기 한 곳이다.
 *
 * 처리기는 모듈 변수다. 처리기를 만드는 `useApiError` 는 라우터·실시간 문맥이 필요한데
 * 이 클라이언트는 그 둘보다 바깥에서 만들어진다(main.tsx).
 */
type MutationErrorHandler = (error: unknown) => void;
let mutationErrorHandler: MutationErrorHandler | null = null;

export function setMutationErrorHandler(handler: MutationErrorHandler | null): void {
  mutationErrorHandler = handler;
}

/**
 * 기본 처리기가 **나서지 않는** 두 경우다.
 *   ① 쓰기가 자기 `onError` 를 가졌다 — 그 자리가 이미 말한다(인라인이든 토스트든).
 *      TanStack 은 캐시의 처리기와 쓰기의 처리기를 **둘 다** 부르므로, 여기서 비키지 않으면
 *      같은 실패가 두 번 뜬다(§1.5 "전역 토스트로 중복 알리지 않는다").
 *   ② `meta.inlineError` — 그 화면이 `isError` 로 제자리에 그린다(기준선 동결·초대 수락).
 */
export function reportMutationError(
  error: unknown,
  mutation: { options: { onError?: unknown; meta?: Record<string, unknown> | undefined } },
): void {
  if (mutation.options.onError !== undefined) return;
  if (mutation.options.meta?.['inlineError'] === true) return;
  mutationErrorHandler?.(error);
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => reportMutationError(error, mutation),
    }),
    defaultOptions: {
      queries: {
        // 실시간 갱신은 WS 이벤트 → invalidate 경로가 담당한다. 폴링은 WS 끊김 시의
        // 폴백일 뿐이며 그 전환은 앱 셸의 연결 상태 배너가 관리한다(REQ-WEB-002).
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 30_000,
      },
    },
  });
}
