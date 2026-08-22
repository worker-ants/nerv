// SSE 스트림 — GET /sse/projects/{proj} · GET /sse/me (계약 정본 api.md §3.5)
//
// 브라우저 밖 소비자(CLI·외부 도구)용 **단방향** 채널이다. WebSocket 과 다른 점은 대상·방향·
// 인증뿐이고, 같은 봉투를 같은 방송 버스에서 받아 흘린다(§3).
//
// 규약 네 가지를 이 파일이 진다.
//   ① replay 없음 — Last-Event-ID 를 무시한다. 끊겼던 소비자는 재조회한다(D-14)
//   ② 봉투에는 식별자만 — 상세는 수신자가 자기 권한으로 다시 읽는다
//   ③ keep-alive 25초 코멘트 라인 — 프록시가 유휴 연결을 끊지 않게(§5.4·§6.3과 짝)
//   ④ PAT 는 프로젝트 바인딩만 검사한다 — 스코프별 필터링을 두지 않는 이유는 봉투에
//      식별자만 흐르기 때문이고, 최종 방어선은 상세 조회 시점의 권한 검사다

import { Controller, Req, Sse, UseGuards } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { NERV_ERROR } from '@nerv/schema';
import { Observable } from 'rxjs';
import { NervError } from '../../common/nerv-exception.filter.js';
import { SseAccessGuard } from './sse-access.guard.js';
import type { SseRequest } from './sse-access.guard.js';
import type { Principal } from '../auth/auth.service.js';
import type { BroadcastEnvelope } from './event-subscriber.service.js';
import { FanoutService } from './fanout.service.js';
import type { RoomName } from './fanout.service.js';

/** keep-alive 주기 — api.md §3.5. 에이전트 하트비트 60초와는 무관하다 */
const KEEPALIVE_MS = 25_000;

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

  constructor(private readonly fanout: FanoutService) {}

  /**
   * EP-SSE-01 — project:{id} 룸과 동일한 이벤트 흐름.
   * 인가는 SseAccessGuard 가 이미 끝냈다(그 파일의 주석에 이유가 있다) — 여기는 스트림만 연다.
   */
  @Sse('projects/:proj')
  project(@Req() req: SseRequest): Observable<SseMessage> {
    const projectId = req.nervSseProjectId;
    if (projectId === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, '프로젝트가 해소되지 않았습니다.', {
        kind: 'unresolved_project',
      });
    }
    return this.stream([`project:${projectId}`]);
  }

  /** EP-SSE-02 — user:{id} 룸과 동일한 이벤트 흐름 */
  @Sse('me')
  me(@Req() req: SseRequest): Observable<SseMessage> {
    const principal = requirePrincipal(req);
    return this.stream([`user:${principal.userId}`]);
  }

  private stream(rooms: RoomName[]): Observable<SseMessage> {
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
      }, KEEPALIVE_MS);

      return () => {
        clearInterval(keepalive);
        off();
      };
    });
  }
}

function requirePrincipal(req: SseRequest): Principal {
  const principal = req.nervPrincipal;
  if (principal === undefined) {
    throw new NervError(NERV_ERROR.UNAUTHENTICATED, '자격증명이 없습니다.', { kind: 'missing' });
  }
  return principal;
}
