// 멱등 키 — 정본: docs/04-mvp/api.md §1.5 (REQ-API-003 · 004 · 019)
//
// **표면이 둘인데 저장소는 하나다.** REST 헤더(`Idempotency-Key`)와 MCP 입력
// (`idempotency_key`)이 같은 행을 본다 — 아웃박스가 큐잉한 쓰기는 어느 표면으로 재전송될지
// 정해져 있지 않기 때문이다.
//
// 세 갈래로 갈린다(§1.5 표).
//   ① 처음 보는 키          → 실행하고 응답을 적어 둔다
//   ② 같은 키 + 같은 본문   → 최초 응답을 재생. `Idempotency-Replayed: true`
//   ③ 같은 키 + 다른 본문   → 409 `idempotency_mismatch`
//
// 문서가 적지 않은 네 번째가 하나 있다: **같은 키로 아직 도는 요청**. 재생할 응답이 아직
// 없으므로 재생할 수 없고, 실행하면 두 번 실행된다. 409(`idempotency_in_flight`)로 돌려주고
// 클라이언트가 잠시 뒤 다시 부르게 한다 — 그때는 ②가 된다.

import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { msg, newId, NERV_ERROR } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb } from './database.module.js';
import type { NervDb } from './database.module.js';
import { NervError } from './nerv-exception.filter.js';

/** 재생 응답임을 알리는 헤더(REQ-API-003). 클라이언트가 "내가 두 번 보냈구나"를 안다. */
export const REPLAYED_HEADER = 'Idempotency-Replayed';

export interface IdempotencyOutcome {
  /** 저장된 응답 — 있으면 그대로 재생한다 */
  replay: { statusCode: number; body: unknown } | null;
}

@Injectable()
export class IdempotencyService {
  constructor(@InjectDb() private readonly db: NervDb) {}

  /**
   * 요청의 지문. 같은 키에 다른 요청이 온 것을 알아보기 위한 값이라 **본문만으로는 부족**
   * 하다 — 같은 본문을 다른 경로로 보내는 것도 다른 요청이다.
   */
  static fingerprint(parts: { route: string; body: unknown }): string {
    return createHash('sha256')
      .update(parts.route)
      .update(' ')
      .update(stableJson(parts.body))
      .digest('hex');
  }

  /**
   * 자리를 잡는다. 처음이면 replay 가 null 이고 호출자가 실행한다.
   *
   * 경합은 유일 인덱스가 판정한다 — ON CONFLICT DO NOTHING 이 비면 남이 이겼다는 뜻이고,
   * 그때 비로소 기존 행을 읽어 ②·③·④ 중 하나로 간다. 먼저 SELECT 하고 없으면 INSERT 하는
   * 순서로는 두 요청이 나란히 통과한다.
   */
  async begin(input: {
    subject: string;
    key: string;
    fingerprint: string;
  }): Promise<IdempotencyOutcome> {
    const { rows: claimed } = await this.db.execute<{ id: string }>(sql`
      INSERT INTO idempotency_key (id, subject, key, request_hash)
      VALUES (${newId()}, ${input.subject}, ${input.key}, ${input.fingerprint})
      ON CONFLICT (subject, key) DO NOTHING
      RETURNING id
    `);
    if (claimed.length > 0) return { replay: null };

    const { rows } = await this.db.execute<{
      request_hash: string;
      status_code: number | null;
      response_body: unknown;
      completed_at: Date | null;
    }>(sql`
      SELECT request_hash, status_code, response_body, completed_at
        FROM idempotency_key
       WHERE subject = ${input.subject} AND key = ${input.key}
    `);
    const existing = rows[0];
    // 그 사이에 보존 잡이 지웠을 수 있다 — 그러면 이 요청이 처음이다
    if (existing === undefined) return { replay: null };

    if (existing.request_hash !== input.fingerprint) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.idempotency.mismatch'), {
        kind: 'idempotency_mismatch',
      });
    }
    if (existing.completed_at === null) {
      throw new NervError(
        NERV_ERROR.PRECONDITION,
        msg('error.idempotency.in_flight'),
        { kind: 'idempotency_in_flight' },
        1,
      );
    }
    return { replay: { statusCode: existing.status_code ?? 200, body: existing.response_body } };
  }

  /** 최초 실행이 끝났다 — 응답을 적어 둔다. 이 뒤의 같은 키는 ②로 간다. */
  async complete(input: {
    subject: string;
    key: string;
    statusCode: number;
    body: unknown;
  }): Promise<void> {
    await this.db.execute(sql`
      UPDATE idempotency_key
         SET status_code = ${input.statusCode},
             response_body = ${JSON.stringify(input.body ?? null)}::jsonb,
             completed_at = now()
       WHERE subject = ${input.subject} AND key = ${input.key}
    `);
  }

  /**
   * 최초 실행이 **실패했다** — 자리를 비운다.
   *
   * 실패한 응답을 재생하면 재시도가 영원히 같은 실패를 받는다. 멱등의 목적은 "부작용을 두 번
   * 만들지 않는 것" 이지 "실패를 박제하는 것" 이 아니다.
   */
  async abandon(input: { subject: string; key: string }): Promise<void> {
    await this.db.execute(sql`
      DELETE FROM idempotency_key
       WHERE subject = ${input.subject} AND key = ${input.key} AND completed_at IS NULL
    `);
  }
}

/**
 * 키 순서에 흔들리지 않는 직렬화. JSON.stringify 는 삽입 순서를 따르므로, 같은 본문을
 * 다른 순서로 보낸 재시도가 ③(다른 본문)으로 오판된다.
 */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
}
