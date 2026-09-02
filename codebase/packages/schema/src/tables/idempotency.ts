// 멱등 키 저장소 — 정본: api.md §1.5 (REQ-API-003 · 004 · 019)
//
// **표면 둘이 한 저장소를 쓴다.** REST 의 `Idempotency-Key` 헤더와 MCP 의 `idempotency_key`
// 입력이 같은 행을 본다 — 오프라인 아웃박스가 큐잉한 쓰기는 재전송될 때 어느 표면으로
// 나갈지 정해져 있지 않기 때문이다. 표면마다 저장소가 다르면 "한 번만 실행된다"는 약속이
// 표면이 바뀌는 순간 깨진다.
//
// 행은 **주체 안에서** 유일하다. 키는 클라이언트가 만드는 값이라 남과 겹칠 수 있고,
// 전역 유일로 두면 남이 먼저 쓴 키로 내 요청이 남의 응답을 받는다.
//
// 24시간 뒤 지운다(§1.5) — 보존 잡이 치운다. 응답 본문을 영구 보관할 이유가 없고,
// 오래된 키의 재생은 재시도가 아니라 사고다.

import { index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, idPk, ts } from './_columns.js';

export const idempotencyKey = pgTable(
  'idempotency_key',
  {
    id: idPk(),
    /**
     * 주체 — `token:{id}` 또는 `user:{id}`. 프로젝트가 아니라 **자격증명**이 단위다:
     * 같은 사람이 두 토큰으로 보낸 재시도는 서로의 응답을 재생하면 안 된다.
     */
    subject: text('subject').notNull(),
    /** 클라이언트가 만든 키. 서버는 해석하지 않는다 */
    key: text('key').notNull(),
    /**
     * 요청의 지문 — 메서드·경로(또는 도구 이름)·본문의 해시. **다른 본문에 같은 키**를
     * 409 로 거절하기 위해 있다(REQ-API-004): 본문이 바뀐 재전송은 재시도가 아니라 다른
     * 요청이고, 그것을 재생하면 클라이언트는 하지도 않은 일의 응답을 받는다.
     */
    requestHash: text('request_hash').notNull(),
    /** 최초 응답의 HTTP 상태. 재생은 상태까지 같아야 한다 */
    statusCode: integer('status_code'),
    /** 최초 응답 본문. 완료 전에는 NULL — 그 사이의 재전송은 "처리 중"이다 */
    responseBody: jsonb('response_body'),
    /** 완료 시각. NULL 이면 최초 요청이 아직 돌고 있다 */
    completedAt: ts('completed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    // 같은 주체의 같은 키는 하나다. **INSERT 의 경합을 이 인덱스가 판정한다** — 두 요청이
    // 동시에 들어와도 하나만 이기고, 진 쪽은 이긴 쪽의 응답을 기다리거나 재생한다.
    uniqueIndex('idempotency_key_uq').on(t.subject, t.key),
    // 보존 잡이 24시간 지난 것을 지운다(§1.5)
    index('idempotency_key_created').on(t.createdAt),
  ],
);
