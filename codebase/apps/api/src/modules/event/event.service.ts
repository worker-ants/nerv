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
import { sql } from 'drizzle-orm';
import { EVENTS_CHANNEL, NERV_EVENT_NAMES, newId } from '@nerv/schema';
import type { NervEventEnvelope, NervEventName } from '@nerv/schema';
import { event } from '@nerv/schema';
import { InjectDb } from '../../common/database.module.js';
import { cursorId, cursorTimestamp, decodeCursor, encodeCursor } from '../../common/cursor.js';
import { assertVocab } from '../../common/query-vocab.js';
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
      actor_user_id: input.actorUserId ?? null,
      is_agent: input.isAgent ?? false,
      occurred_at: occurredAt.toISOString(),
    };
  }

  /**
   * 커밋 후 Valkey `nerv_events` 로 방송한다.
   * 페이로드는 **참조만** 담는다 — 상세는 수신자가 자기 권한으로 재조회한다(database.md §3.2).
   */
  /**
   * EP-EVT-01 — 이벤트 피드. 항목마다 `is_agent` 로 사람/에이전트를 구분한다(FR-16 · D-08).
   * 그 구분이 없으면 "누가 이걸 했나"라는 감사의 첫 질문에 답할 수 없다.
   */
  async feed(input: {
    projectId: string;
    types?: string[] | null;
    subjectId?: string | null;
    limit?: number;
    before?: string | null;
  }): Promise<{ items: Record<string, unknown>[]; next_cursor: string | null }> {
    // **봉투를 준다**(2026-09-06 · REQ-API-120). 커서(`before`)는 처음부터 있었는데 응답이
    // 맨 배열이라 **"다음이 있는가" 를 클라이언트가 알 길이 없었다** — 전표는 `Page<X>` 라
    // 적고 있었으니 §1.6 선언이 이 자리에서도 거짓이었다.
    const limit = Math.min(input.limit ?? 50, 200);
    // 카탈로그 밖의 이름은 **거절이다**(REQ-API-126). 예전에는 그대로 `IN` 에 실려
    // `?type=spec.aproved` 가 빈 목록을 200 으로 돌려줬다 — 오타가 "그런 일이 없었다" 로
    // 읽히는 자리다. 이벤트 이름의 정본은 `@nerv/schema` 의 카탈로그다(REQ-CB-006).
    const types =
      input.types == null || input.types.length === 0
        ? null
        : assertVocab(input.types, NERV_EVENT_NAMES, 'type');
    const typeFilter =
      types === null
        ? sql``
        : sql` AND e.type IN (${sql.join(
            types.map((t) => sql`${t}`),
            sql`, `,
          )})`;
    const subject = input.subjectId == null ? sql`` : sql` AND e.subject_id = ${input.subjectId}`;
    // **커서는 (occurred_at, id) 다**(§1.6 · REQ-API-124). 시각 하나로만 seek 하면 같은 시각의
    // 행이 쪽 경계에 걸릴 때 남은 것이 어느 쪽에도 나오지 않는다 — 한 트랜잭션이 여러 건을
    // 내는 이벤트가 흔해서 실측 1,322건 중 332건(25%)이 같은 (project, occurred_at) 이었다.
    // `id` 는 uuidv7 이라 같은 ms 안에서도 삽입 순서다(ids.ts).
    //
    // 옛 형식(맨 타임스탬프)도 한 릴리스 동안 받는다 — 그 커서를 들고 있는 클라이언트에게
    // 500 이나 빈 목록을 주는 것보다 낫다. 다음 대조에서 걷는다.
    const cursor = decodeCursor(input.before ?? undefined);
    const cursorAt = cursorTimestamp(cursor?.[0]);
    const cursorRowId = cursorId(cursor?.[1]);
    const legacyAt = cursor === null ? cursorTimestamp(input.before) : null;
    const before =
      cursorAt !== null && cursorRowId !== null
        ? sql` AND (e.occurred_at, e.id) < (${cursorAt}::timestamptz, ${cursorRowId}::uuid)`
        : legacyAt !== null
          ? sql` AND e.occurred_at < ${legacyAt}::timestamptz`
          : sql``;

    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT e.id, e.type, e.subject_type::text AS subject_type, e.subject_id,
             e.from_state, e.to_state, e.payload, e.is_agent, e.occurred_at,
             u.display_name AS actor_name, se.hostname, se.agent_type::text AS agent_type,
             se.external_session_id
        FROM event e
   LEFT JOIN "user" u ON u.id = e.actor_user_id
   LEFT JOIN agent_session se ON se.id = e.actor_session_id
       WHERE e.project_id = ${input.projectId}${typeFilter}${subject}${before}
       ORDER BY e.occurred_at DESC, e.id DESC
       LIMIT ${limit + 1}
    `);
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    // 커서 이름이 `before` 다 — 이 목록의 축이 시각이기 때문이고, 전표도 그렇게 적는다.
    // 값은 **불투명**이다(§1.6): 정렬 기준을 바꿀 자유를 서버가 갖기 위해서다.
    return {
      items,
      next_cursor:
        rows.length > limit && last !== undefined
          ? encodeCursor([String(last['occurred_at']), String(last['id'])])
          : null,
    };
  }

  /**
   * 방송 — **봉투를 통째로 싣는다**(2026-08-29 정정).
   *
   * 예전에는 `{id, type, project_id}` 세 필드만 실었다. 그래서 받는 쪽의 `subject_id` 가
   * `undefined` 였고, 화면은 `['spec', undefined]` 를 무효화하고 있었다 — 아무것도 다시
   * 읽히지 않는다. 프로젝트 단위 키(트리·작업 목록)만 우연히 맞아떨어져서, 새로고침해야
   * 보이는 화면과 그렇지 않은 화면이 뒤섞인 채로 남아 있었다(실측 2026-08-29).
   *
   * **본문은 여전히 싣지 않는다**(D-14). 나가는 것은 식별자와 시각뿐이고, 받는 쪽은 그것으로
   * 자기 권한으로 다시 읽는다 — 봉투가 커진 것이 아니라 원래 계약(api.md §3.3)이 이것이다.
   */
  async broadcast(envelope: NervEventEnvelope): Promise<boolean> {
    return this.valkey.publish(EVENTS_CHANNEL, JSON.stringify(envelope));
  }
}
