// event 행 삽입(도메인 트랜잭션 안) + 커밋 후 Valkey PUBLISH — REQ-CB-004
// 채널·페이로드 규약 정본: docs/04-mvp/database.md §3
//
// 트리거(pg_notify)를 쓰지 않기로 한 대가가 여기 있다. 트리거가 주던 "경로 무관 보장"은
// 세 겹으로 대체된다(database.md §3.1): ① event INSERT 경로가 이 서비스 하나뿐이라는 구조
// 강제(표면의 drizzle 직접 import 금지 — REQ-CB-003) ② 커밋 후 PUBLISH 를 같은 메서드에
// 묶는 이 파일 ③ 워커의 폴링 폴백.
//
// 그래서 도메인 서비스는 `transact()` 를 쓴다 — 트랜잭션 안에서 emit 한 이벤트가
// **커밋된 뒤에만** 방송되고, 롤백되면 한 건도 나가지 않는다. 손으로 순서를 맞출 여지를 없앤다.

import { Injectable, Logger } from '@nestjs/common';
import { EVENTS_CHANNEL, newId } from '@nerv/schema';
import type { NervEventEnvelope, NervEventName } from '@nerv/schema';
import { event } from '@nerv/schema';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { ValkeyService } from './valkey.service.js';

/** 도메인 서비스가 채우는 이벤트 입력. actor 쌍은 D-08(사람·에이전트 동시 기록)이다. */
export interface EventInput {
  type: NervEventName;
  projectId: string;
  subjectType: string;
  subjectId: string;
  subjectKey?: string | null;
  actorUserId?: string | null;
  actorSessionId?: string | null;
  isAgent?: boolean;
  fromState?: string | null;
  toState?: string | null;
  /** 개인정보 금지 — ID 참조만(data-model §5.4) */
  payload?: Record<string, unknown>;
  requestId?: string | null;
}

/** 트랜잭션 안에서 이벤트를 예약하는 함수. 실제 방송은 커밋 후다. */
export type EmitFn = (input: EventInput) => Promise<NervEventEnvelope>;

type Tx = Parameters<Parameters<NervDb['transaction']>[0]>[0];

@Injectable()
export class EventService {
  private readonly logger = new Logger(EventService.name);

  constructor(
    @InjectDb() private readonly db: NervDb,
    private readonly valkey: ValkeyService,
  ) {}

  /**
   * 상태 전이 한 건. 트랜잭션을 열고, 그 안에서 emit 된 이벤트를 같은 트랜잭션에 적재하고,
   * **커밋된 뒤에** 방송한다. fn 이 던지면 트랜잭션이 롤백되고 방송도 없다.
   */
  async transact<T>(fn: (tx: Tx, emit: EmitFn) => Promise<T>): Promise<T> {
    const pending: NervEventEnvelope[] = [];

    const result = await this.db.transaction(async (tx) => {
      const emit: EmitFn = async (input) => {
        const envelope = await this.append(tx, input);
        pending.push(envelope);
        return envelope;
      };
      return fn(tx, emit);
    });

    // 커밋 후 — 여기서 실패해도 요청은 성공이다(유실 허용, D-14)
    for (const envelope of pending) {
      await this.broadcast(envelope);
    }

    return result;
  }

  /** 도메인 트랜잭션 안에서 event 행을 남긴다. 전이와 이벤트의 원자성(규칙 6). */
  async append(tx: Tx, input: EventInput): Promise<NervEventEnvelope> {
    const id = newId();
    const occurredAt = new Date();

    await tx.insert(event).values({
      id,
      projectId: input.projectId,
      occurredAt,
      type: input.type,
      actorUserId: input.actorUserId ?? null,
      actorSessionId: input.actorSessionId ?? null,
      isAgent: input.isAgent ?? false,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      fromState: input.fromState ?? null,
      toState: input.toState ?? null,
      payload: input.payload ?? {},
      requestId: input.requestId ?? null,
    });

    return {
      id,
      type: input.type,
      project_id: input.projectId,
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      subject_key: input.subjectKey ?? null,
      occurred_at: occurredAt.toISOString(),
    };
  }

  /**
   * 커밋 후 Valkey `nerv_events` 로 방송한다.
   * 페이로드는 **참조만** 담는다 — 상세는 수신자가 자기 권한으로 재조회한다(database.md §3.2).
   */
  async broadcast(envelope: NervEventEnvelope): Promise<boolean> {
    const wire = JSON.stringify({
      id: envelope.id,
      type: envelope.type,
      project_id: envelope.project_id,
    });
    return this.valkey.publish(EVENTS_CHANNEL, wire);
  }
}
