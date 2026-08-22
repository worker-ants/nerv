// TanStack Query 클라이언트.
// 진실은 DB 다(D-14) — 캐시는 화면 반응 속도를 위한 것이고, 이벤트가 오면 무효화로 다시 읽는다.
import { QueryClient } from '@tanstack/react-query';

export function createQueryClient(): QueryClient {
  return new QueryClient({
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
