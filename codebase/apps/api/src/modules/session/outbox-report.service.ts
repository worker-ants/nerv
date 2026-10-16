// 오프라인 큐 재전송 실패 보고 — POST /ingest/hooks/outbox-failed (2026-10-16 · E21-S01 · NFR-05 · api.md REQ-API-322)
// 정본: docs/04-mvp/plugin.md §3.4 · api.md §2.9
//
// **NFR-05 의 마지막 절반이다 — "충돌은 사람에게 보고된다".** 플러그인은 서버가 내려가 있던 동안 쓰기를
// `.nerv/outbox/` 에 쌓고, 서버가 돌아오면 원래 멱등 키로 다시 보낸다. 그때 서버가 그 쓰기를 거절하면(4xx ·
// 구조화 에러) 항목은 `outbox/failed/` 로 간다. 그 폴더는 그 기계에만 있어서, 예전에는 사람이 그 파일을 열어
// 보기 전까지 아무도 몰랐다 — 상태 보고 · 질문 · 증적이 조용히 사라진 것과 같다.
//
// 그래서 flush 가 옮긴 항목을 여기로 알린다. 서버는 그 사람의 세션을 대상으로 `session.outbox_failed` 를 남기고,
// 알림 워커가 그 사람에게 중요 알림을 만든다(spec-workflow §6.3).
//
// **훅이 아니지만 훅 수집기에 둔다.** 보내는 쪽은 훅과 같은 스크립트 묶음(포워더 옆의 `nerv-outbox`)이고 같은
// PAT · 같은 헤더를 쓴다. MCP 도구로 두면 모델이 그 도구를 보고 부를 수 있다 — 이것은 에이전트의 행동이 아니라
// 플러그인이 하는 일이다. `nerv_session_event` 의 새 종류로 두지 않은 이유는 그 도구가 세션 타임라인(activity)에
// 적는 길이라 이벤트도 알림도 만들지 않고, 에이전트가 매기는 `event_seq` 를 요구하기 때문이다.
//
// 표면(ingest.controller)은 번역만 하고 판정은 여기 한 곳이다(D-05).

import { Injectable } from '@nestjs/common';
import { msg, NERV_ERROR, NERV_EVENT_PHASE2, PAGE_LIMIT_MAX } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { looksLikeUuid } from '../../common/entity-ref.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { EventService } from '../event/event.service.js';

/** 보고 한 건 — 플러그인의 `outbox/failed/*.json` 한 파일에서 온다 */
export interface OutboxFailureItem {
  /** 다시 보내려던 도구(`nerv_task_update` …) — 큐 파일을 읽을 수 없었으면 없다 */
  tool: string | null;
  /** 원래의 멱등 키 — 같은 키는 한 번만 남긴다 */
  idempotency_key: string;
  /** 큐에 적힌 세션 — NERV 세션 id 또는 하네스의 세션 id. 비신뢰 값이라 자기 세션일 때만 대상으로 쓴다 */
  session_id: string | null;
  queued_at: string | null;
  failed_at: string | null;
  /** 재전송의 HTTP 상태 — 도구 실패는 200 + `isError` 라 200 이 흔하다 */
  status: number | null;
  /** 서버가 준 에러 코드(`NERV_PRECONDITION`) 또는 JSON-RPC 코드(`-32602`) */
  code: string | null;
  kind: string | null;
}

const TOOL_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const KIND_PATTERN = /^[a-z0-9_]{1,64}$/;
const KEY_MAX = 200;
const TIME_MAX = 40;

/** 모양이 틀린 것은 400 이다(api.md §1.4) — 보내는 쪽은 우리 스크립트이고, 다시 보내도 같다 */
function invalid(field: string): NervError {
  return new NervError(NERV_ERROR.PRECONDITION, msg('error.mcp.invalid_input'), {
    kind: 'invalid_input',
    field,
  });
}

function optionalString(value: unknown, field: string, ok: (v: string) => boolean): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !ok(value)) throw invalid(field);
  return value;
}

/** 시각은 다시 적는다 — 받은 문자열을 그대로 이벤트에 남기지 않는다 */
function optionalTime(value: unknown, field: string): string | null {
  const raw = optionalString(value, field, (v) => v.length <= TIME_MAX);
  if (raw === null) return null;
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) throw invalid(field);
  return new Date(at).toISOString();
}

/**
 * 본문을 읽는다. **모르는 칸은 버린다** — 큐 파일에는 메시지 원문도 있는데, 그것은 서버가 그때 만든 문장이고
 * 이벤트(append-only · 감사 로그)에 남길 것이 아니다(data-model §5.4 — 개인정보 금지 · ID 참조만).
 */
export function parseOutboxReport(body: unknown): OutboxFailureItem[] {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > PAGE_LIMIT_MAX) {
    throw invalid('items');
  }
  return items.map((raw, i) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw invalid(`items[${i}]`);
    const item = raw as Record<string, unknown>;
    const key = item['idempotency_key'];
    if (typeof key !== 'string' || key.trim() === '' || key.length > KEY_MAX) {
      throw invalid(`items[${i}].idempotency_key`);
    }
    const status = item['status'];
    if (
      status !== undefined &&
      status !== null &&
      (typeof status !== 'number' || !Number.isInteger(status) || status < 0 || status > 599)
    ) {
      throw invalid(`items[${i}].status`);
    }
    // JSON-RPC 에러 코드는 수다(`-32602`) — 문자열로 맞춰 둔다
    const code = typeof item['code'] === 'number' ? String(item['code']) : item['code'];
    return {
      tool: optionalString(item['tool'], `items[${i}].tool`, (v) => TOOL_PATTERN.test(v)),
      idempotency_key: key,
      session_id: optionalString(
        item['session_id'],
        `items[${i}].session_id`,
        (v) => v.length <= KEY_MAX,
      ),
      queued_at: optionalTime(item['queued_at'], `items[${i}].queued_at`),
      failed_at: optionalTime(item['failed_at'], `items[${i}].failed_at`),
      status: typeof status === 'number' ? status : null,
      code: optionalString(code, `items[${i}].code`, (v) => CODE_PATTERN.test(v)),
      kind: optionalString(item['kind'], `items[${i}].kind`, (v) => KIND_PATTERN.test(v)),
    };
  });
}

@Injectable()
export class OutboxReportService {
  constructor(
    private readonly events: EventService,
    @InjectDb() private readonly db: NervDb,
  ) {}

  /**
   * 보고를 남긴다 — 세션마다 이벤트 하나.
   *
   * **대상은 그 사람의 세션이다.** 큐 파일의 `session_id` 는 비신뢰 값이라, 이 프로젝트의 **이 사람의** 세션일 때만
   * 대상으로 쓴다(`findByExternalId` · `requireSession` 과 같은 규칙 — D-08). 아니면 프로젝트가 대상이다: 남의 세션에
   * 실패를 붙이지 않고, 그래도 보고는 버리지 않는다.
   *
   * **같은 멱등 키는 한 번만 남긴다.** 보고가 도착했는데 응답이 끊기면 플러그인은 다음 flush 에서 다시 보낸다. 같은
   * 사람 · 같은 대상의 지난 보고를 보고 이미 있는 키는 뺀다. 남은 것이 없으면 이벤트를 내지 않는다.
   */
  async report(input: {
    projectId: string | null;
    userId: string;
    body: unknown;
  }): Promise<{ ok: true; recorded: number; duplicates: number }> {
    // 훅은 PAT 로만 온다 — PAT 는 늘 프로젝트에 속한다(agent-integration §6.5)
    if (input.projectId === null) {
      throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.hook_missing'), {
        kind: 'missing',
      });
    }
    const projectId = input.projectId;
    const items = parseOutboxReport(input.body);

    const groups = new Map<string, { sessionId: string | null; items: OutboxFailureItem[] }>();
    const resolved = new Map<string, string | null>();
    for (const item of items) {
      const ref = item.session_id ?? '';
      if (!resolved.has(ref)) {
        resolved.set(ref, await this.ownSession(projectId, input.userId, item.session_id));
      }
      const sessionId = resolved.get(ref) ?? null;
      const group = groups.get(sessionId ?? '') ?? { sessionId, items: [] };
      group.items.push(item);
      groups.set(sessionId ?? '', group);
    }

    let recorded = 0;
    let duplicates = 0;
    for (const group of groups.values()) {
      const subjectType = group.sessionId === null ? 'project' : 'agent_session';
      const subjectId = group.sessionId ?? projectId;
      const fresh = await this.events.transact(async (tx, emit) => {
        // 같은 대상의 보고 둘이 겹치면 둘 다 "아직 없다" 를 읽는다 — 대상 · 사람마다 줄 세운다
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`outbox_failed:${subjectId}:${input.userId}`}, 0))`,
        );
        // `event_subject` 인덱스로 읽는다 — 대상 하나의 이벤트만 본다
        const { rows } = await tx.execute<{ key: string }>(sql`
          SELECT DISTINCT item->>'idempotency_key' AS key
            FROM event e
           CROSS JOIN LATERAL jsonb_array_elements(e.payload->'items') AS item
           WHERE e.subject_type = ${subjectType} AND e.subject_id = ${subjectId}
             AND e.type = ${NERV_EVENT_PHASE2.SESSION_OUTBOX_FAILED}
             AND e.project_id = ${projectId}
             AND e.actor_user_id = ${input.userId}
        `);
        const seen = new Set(rows.map((r) => r.key));
        const kept: OutboxFailureItem[] = [];
        for (const item of group.items) {
          if (seen.has(item.idempotency_key)) continue;
          seen.add(item.idempotency_key);
          kept.push(item);
        }
        if (kept.length === 0) return kept;
        await emit({
          type: NERV_EVENT_PHASE2.SESSION_OUTBOX_FAILED,
          projectId,
          subjectType,
          subjectId,
          actorUserId: input.userId,
          actorSessionId: group.sessionId,
          isAgent: true,
          payload: {
            count: kept.length,
            // 세션 id 는 대상이 이미 말한다 — 비신뢰 값을 그대로 남기지 않는다
            items: kept.map((item) => ({
              tool: item.tool,
              idempotency_key: item.idempotency_key,
              queued_at: item.queued_at,
              failed_at: item.failed_at,
              status: item.status,
              code: item.code,
              kind: item.kind,
            })),
          },
        });
        return kept;
      });
      recorded += fresh.length;
      duplicates += group.items.length - fresh.length;
    }
    return { ok: true, recorded, duplicates };
  }

  /** 이 프로젝트의 이 사람의 세션인가 — NERV 세션 id 와 하네스 세션 id 를 둘 다 받는다 */
  private async ownSession(
    projectId: string,
    userId: string,
    ref: string | null,
  ): Promise<string | null> {
    if (ref === null || ref.trim() === '') return null;
    const value = ref.trim();
    const match = looksLikeUuid(value)
      ? sql`(id = ${value}::uuid OR external_session_id = ${value})`
      : sql`external_session_id = ${value}`;
    const { rows } = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM agent_session
       WHERE project_id = ${projectId} AND user_id = ${userId} AND ${match}
       ORDER BY started_at DESC LIMIT 1
    `);
    return rows[0]?.id ?? null;
  }
}
