// SSE 스트림 — GET /sse/projects/{proj} · GET /sse/me (계약 정본 api.md §3.5)
//
// 브라우저 밖 소비자(CLI·외부 도구)용 **단방향** 채널이다. WebSocket 과 다른 점은 대상·방향·
// 인증뿐이고, 같은 봉투를 같은 방송 버스에서 받아 흘린다(§3).
//
// 규약 네 가지를 이 파일이 진다.
//   ① replay 없음 — Last-Event-ID 를 무시한다. 끊겼던 소비자는 재조회한다(D-14)
//   ② 봉투에는 식별자만 — 상세는 수신자가 자기 권한으로 다시 읽는다
//   ③ keep-alive 25초 코멘트 라인 — 프록시가 유휴 연결을 끊지 않게(§5.4·§6.3과 짝)
//   ④ PAT 는 프로젝트 바인딩만 검사한다 — 권한별 필터링을 두지 않는 이유는 봉투에
//      식별자만 흐르기 때문이고, 최종 방어선은 상세 조회 시점의 권한 검사다
//   ⑤ 사용자당 동시 연결 8개 — 초과는 429(§3.5). **요청 쿼터와는 다른 규칙이다**: §1.8 은
//      "연결 수는 쿼터 대상이 아니다" 라고 적었고, 그것은 연결을 세지 말라는 말이 아니라
//      분당 요청으로 세지 말라는 말이다. SSE 연결은 열려 있는 동안 파드의 자원을 잡는다.

import { Controller, Req, Sse, UseGuards } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { MAX_SSE_PER_USER, msg, NERV_ERROR } from '@nerv/schema';
import { Observable } from 'rxjs';
import { NervError } from '../../common/nerv-exception.filter.js';
import { SseAccessGuard } from './sse-access.guard.js';
import type { SseRequest } from './sse-access.guard.js';
import type { Principal } from '../auth/auth.service.js';
import type { BroadcastEnvelope } from './event-subscriber.service.js';
import { FanoutService } from './fanout.service.js';
import type { RoomName } from './fanout.service.js';

/**
 * keep-alive 주기 — api.md §3.5. 에이전트 하트비트 60초와는 무관하다.
 *
 * **상수가 아니라 손잡이다**(2026-09-07 · REQ-CB-035). 앞문의 유휴 타임아웃이 25초보다
 * 짧으면 스트림이 조용히 끊기는데, 그때 고칠 수 있는 것이 재배포뿐이면 손잡이가 없는
 * 것과 같다(`NERV_LOG_LEVEL` 이 같은 이유로 배선됐다). 검사도 이 값을 낮춰 **계약을
 * 실제로 태운다** — `: ping` 코멘트가 아니라 `event: ping` 메시지라는 사실은 오래 문서
 * 셋이 틀리게 적고 있었고, 태우지 않으면 다시 갈린다.
 */
function keepaliveMs(): number {
  const raw = Number(process.env['NERV_SSE_KEEPALIVE_MS']);
  return Number.isFinite(raw) && raw > 0 ? raw : 25_000;
}

interface SseMessage {
  /** Event `type` — 클라이언트는 이 이름으로 듣는다 */
  type: string;
  /** event id — 클라이언트 측 중복 제거용 참조일 뿐이다(재개용이 아니다) */
  id: string;
  data: string;
}

@Controller('sse')
@UseGuards(SseAccessGuard)
export class SseController {
  private readonly logger = new Logger(SseController.name);

  /**
   * 사용자별 열린 스트림 수. **파드 단위로 센다** — 세는 대상이 이 프로세스의 소켓이라
   * 클러스터 전역 합계는 이 상한이 답하려는 물음이 아니다(MAX_SSE_PER_USER 주석).
   */
  private readonly open = new Map<string, number>();

  constructor(private readonly fanout: FanoutService) {}

  /**
   * EP-SSE-01 — project:{id} 룸과 동일한 이벤트 흐름.
   * 인가는 SseAccessGuard 가 이미 끝냈다(그 파일의 주석에 이유가 있다) — 여기는 스트림만 연다.
   */
  @Sse('projects/:proj')
  project(@Req() req: SseRequest): Observable<SseMessage> {
    const projectId = req.nervSseProjectId;
    if (projectId === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.project.unresolved'), {
        kind: 'unresolved_project',
      });
    }
    return this.stream(requirePrincipal(req).userId, [`project:${projectId}`]);
  }

  /** EP-SSE-02 — user:{id} 룸과 동일한 이벤트 흐름 */
  @Sse('me')
  me(@Req() req: SseRequest): Observable<SseMessage> {
    const principal = requirePrincipal(req);
    return this.stream(principal.userId, [`user:${principal.userId}`]);
  }

  private stream(userId: string, rooms: RoomName[]): Observable<SseMessage> {
    // **여는 순간 센다.** Observable 안에서 세면 이미 200 과 헤더가 나간 뒤라 429 를 줄 수
    // 없다 — 스트림을 열어 놓고 곧바로 닫는 것은 초과를 알리는 방법이 아니다.
    const current = this.open.get(userId) ?? 0;
    if (current >= MAX_SSE_PER_USER) {
      throw new NervError(
        NERV_ERROR.RATE_LIMIT,
        msg('error.quota.sse_connections', { limit: String(MAX_SSE_PER_USER) }),
        { kind: 'sse_connection_limit', limit: MAX_SSE_PER_USER },
        // 다시 시도할 시점은 서버가 모른다 — 남의 연결이 끊겨야 열린다. 창이 아니라
        // 사건을 기다리는 것이라, 짧게 부르지 말라는 뜻으로 한 창을 준다.
        60,
      );
    }
    this.open.set(userId, current + 1);

    return new Observable<SseMessage>((observer) => {
      const deliver = (envelope: BroadcastEnvelope): void => {
        observer.next({
          type: envelope.type,
          id: envelope.id,
          data: JSON.stringify(envelope),
        });
      };

      const off = this.fanout.add({ rooms: new Set(rooms), deliver });

      // keep-alive — 데이터가 없어도 연결을 살려둔다. rxjs 로 흘리면 Nest 가 코멘트가 아니라
      // 메시지로 내보내므로, 클라이언트가 무시할 수 있는 ping 타입으로 보낸다.
      const keepalive = setInterval(() => {
        observer.next({ type: 'ping', id: '', data: '{}' });
      }, keepaliveMs());

      return () => {
        clearInterval(keepalive);
        off();
        const left = (this.open.get(userId) ?? 1) - 1;
        // 0 이면 지운다 — 남겨 두면 사용자 수만큼 맵이 자란다
        if (left <= 0) this.open.delete(userId);
        else this.open.set(userId, left);
      };
    });
  }
}

function requirePrincipal(req: SseRequest): Principal {
  const principal = req.nervPrincipal;
  if (principal === undefined) {
    throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), { kind: 'missing' });
  }
  return principal;
}
