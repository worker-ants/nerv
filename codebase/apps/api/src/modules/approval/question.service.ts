// 질문 에스컬레이션 · 폴링 · awaiting_input 전이
// 정본: docs/03-proposal/agent-integration.md §2.3·§5.3 · spec-workflow §6.3
//
// **멱등 재호출이 곧 폴링이다.** 에이전트에게는 서버 push 채널이 없으므로(Codex 에 channel
// capability 가 없다) 같은 멱등 키로 다시 부르면 그 질문의 현재 상태를 돌려준다 —
// 그래서 에이전트가 별도 폴링 루프를 스스로 만들 필요가 없다.
//
// 질문이 생기면 세션은 awaiting_input 으로 **대기한다**(P7 의 핵심). 임의로 판단하고 진행하는
// 대신 멈추는 것이 이 기능의 값이다.

import { Injectable, Logger } from '@nestjs/common';
import { msg, newId, NERV_ERROR, NERV_EVENT } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { entityRef } from '../../common/entity-ref.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { EventService } from '../event/event.service.js';

type Tx = Parameters<Parameters<NervDb['transaction']>[0]>[0];

/**
 * long-poll 상한 — 하트비트 주기와 같은 값이다(agent-integration §2.3).
 * 요청 하나가 이보다 오래 붙잡혀 있으면 그건 대기가 아니라 누수다.
 */
const MAX_WAIT_SECONDS = 60;

export interface QuestionResult extends Record<string, unknown> {
  question_id: string;
  status: string;
  answer_key: string | null;
  answer_md: string | null;
  /** 이 호출이 새 질문을 만들었는가 — false 면 폴링이었다 */
  created: boolean;
}

@Injectable()
export class QuestionService {
  private readonly logger = new Logger(QuestionService.name);

  constructor(
    private readonly events: EventService,
    @InjectDb() private readonly db: NervDb,
  ) {}

  /**
   * nerv_question_create — 생성과 폴링이 **같은 호출**이다.
   * 멱등 키(idempotency_key)가 같으면 새로 만들지 않고 현재 상태를 준다.
   */
  async create(input: {
    projectId: string;
    sessionId: string;
    /** 출처(`context`) — 키든 UUID 든 받는다(api.md §1.4b). 사람이 원문으로 가는 길이다 */
    taskId?: string | null;
    specId?: string | null;
    findingId?: string | null;
    /** 왜 사람을 부르는가 — 5종 어휘(spec-workflow §4.7) */
    escalate?: string | null;
    title: string;
    bodyMd?: string | null;
    options?: string[];
    urgency?: 'blocking' | 'normal';
    idempotencyKey?: string | undefined;
    /** 답을 이만큼 기다린다(초) — 에이전트에게 서버 push 채널이 없어서 있는 손잡이다 */
    waitSeconds?: number | undefined;
  }): Promise<QuestionResult> {
    // 멱등 키가 있으면 그것으로, 없으면 (세션, 제목)으로 같은 질문을 찾는다
    const { rows: existing } = await this.db.execute<{
      id: string;
      status: string;
      answer_key: string | null;
      answer_md: string | null;
    }>(sql`
      SELECT id, status::text AS status, answer_key, answer_md
        FROM question
       WHERE project_id = ${input.projectId} AND agent_session_id = ${input.sessionId}
         AND title = ${input.title}
       ORDER BY asked_at DESC LIMIT 1
    `);
    const found = existing[0];
    if (found !== undefined) {
      // 폴링 — 새 카드를 만들지 않는다. 받은 요청이 같은 질문으로 덮이지 않게.
      const settled = await this.waitForAnswer(
        found.id,
        { status: found.status, answer_key: found.answer_key, answer_md: found.answer_md },
        input.waitSeconds,
      );
      return { ...settled, question_id: found.id, created: false };
    }

    const made = await this.events.transact(async (tx, emit) => {
      const questionId = newId();
      const urgency = input.urgency ?? 'blocking';

      const taskId = await this.resolveTaskId(tx, input.projectId, input.taskId ?? null);
      const specId = await this.resolveSpecId(tx, input.projectId, input.specId ?? null);
      const findingId = await this.resolveFindingId(tx, input.projectId, input.findingId ?? null);

      await tx.execute(sql`
        INSERT INTO question (id, project_id, agent_session_id, task_id, spec_id, finding_id,
                              escalate, title, body_md, options, urgency, status)
        VALUES (${questionId}, ${input.projectId}, ${input.sessionId}, ${taskId},
                ${specId}, ${findingId},
                ${input.escalate ?? null}::escalate_reason,
                ${input.title}, ${input.bodyMd ?? null},
                ${JSON.stringify(input.options ?? [])}::jsonb,
                ${urgency}::question_urgency, 'open')
      `);

      // blocking 질문은 세션을 세운다 — 임의로 판단하고 진행하지 않는다(P7)
      if (urgency === 'blocking') {
        await tx.execute(sql`
          UPDATE agent_session SET state = 'awaiting_input'
           WHERE id = ${input.sessionId} AND state IN ('pending', 'active')
        `);
      }

      await emit({
        type: NERV_EVENT.QUESTION_CREATED,
        projectId: input.projectId,
        subjectType: 'question',
        subjectId: questionId,
        actorSessionId: input.sessionId,
        isAgent: true,
        payload: { urgency, blocking: urgency === 'blocking', escalate: input.escalate ?? null },
      });

      return {
        question_id: questionId,
        status: 'open',
        answer_key: null,
        answer_md: null,
        created: true,
      };
    });

    // 만들자마자 기다릴 수도 있다 — blocking 질문에서는 그것이 자연스러운 흐름이다
    const settled = await this.waitForAnswer(
      made.question_id,
      { status: made.status, answer_key: made.answer_key, answer_md: made.answer_md },
      input.waitSeconds,
    );
    return { ...made, ...settled };
  }

  /**
   * 답이 올 때까지 **이 요청 안에서** 기다린다(long-poll).
   *
   * 에이전트에게는 서버 push 채널이 없다(Codex 에 channel capability 가 없다) — 그래서
   * 기다리는 방법이 재호출뿐이면 에이전트는 자기만의 폴링 루프를 만들게 되고, 그 루프는
   * 매번 다르게 구현된다. 상한을 두는 이유는 요청 하나가 영원히 붙잡혀 있으면 안 되기
   * 때문이고, 상한값을 하트비트 주기와 같은 60초로 두어 **에이전트의 리듬과 맞춘다**.
   */
  private async waitForAnswer(
    questionId: string,
    current: Pick<QuestionResult, 'status' | 'answer_key' | 'answer_md'>,
    seconds: number | undefined,
  ): Promise<Pick<QuestionResult, 'status' | 'answer_key' | 'answer_md'>> {
    const budget = Math.min(Math.max(Math.floor(seconds ?? 0), 0), MAX_WAIT_SECONDS);
    // 이미 답이 있으면 기다릴 것이 없다 — 부른 쪽이 들고 온 값이 그대로 답이다
    if (budget === 0 || current.status !== 'open') return current;

    let status: string = current.status;
    let answerKey = current.answer_key;
    let answerMd = current.answer_md;
    for (let waited = 0; status === 'open' && waited < budget; waited += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const { rows } = await this.db.execute<{
        status: string;
        answer_key: string | null;
        answer_md: string | null;
      }>(sql`
        SELECT status::text AS status, answer_key, answer_md FROM question WHERE id = ${questionId}
      `);
      const row = rows[0];
      if (row === undefined) break;
      status = row.status;
      answerKey = row.answer_key;
      answerMd = row.answer_md;
    }
    return { status, answer_key: answerKey, answer_md: answerMd };
  }

  /** 출처의 Task — 키든 UUID 든(§1.4b). 못 찾으면 조용히 버리지 않고 말한다 */
  private async resolveTaskId(
    tx: Tx,
    projectId: string,
    ref: string | null,
  ): Promise<string | null> {
    return this.resolveRef(tx, projectId, ref, 'task', 'task');
  }

  private async resolveSpecId(
    tx: Tx,
    projectId: string,
    ref: string | null,
  ): Promise<string | null> {
    return this.resolveRef(tx, projectId, ref, 'spec', 'spec');
  }

  /** Finding 은 안정 키가 없다 — UUID 로만 가리킨다(리뷰 센터도 짧은 id 를 보여줄 뿐이다) */
  private async resolveFindingId(
    tx: Tx,
    projectId: string,
    ref: string | null,
  ): Promise<string | null> {
    const parsed = entityRef(ref);
    if (parsed.id === null && parsed.key === null) return null;
    if (parsed.id === null) {
      throw new NervError(
        NERV_ERROR.PRECONDITION,
        msg('error.question.context_not_found', { field: 'context.finding_id' }),
        { kind: 'not_found', field: 'context.finding_id', value: ref },
      );
    }
    const { rows } = await tx.execute<{ id: string }>(
      sql`SELECT f.id FROM finding f JOIN review_session rs ON rs.id = f.review_session_id
           WHERE f.id = ${parsed.id} AND rs.project_id = ${projectId}`,
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new NervError(
        NERV_ERROR.PRECONDITION,
        msg('error.question.context_not_found', { field: 'context.finding_id' }),
        { kind: 'not_found', field: 'context.finding_id', value: ref },
      );
    }
    return id;
  }

  private async resolveRef(
    tx: Tx,
    projectId: string,
    ref: string | null,
    table: 'task' | 'spec',
    field: string,
  ): Promise<string | null> {
    const parsed = entityRef(ref);
    if (parsed.id === null && parsed.key === null) return null;
    const match = parsed.id !== null ? sql`id = ${parsed.id}` : sql`key = ${parsed.key ?? ''}`;
    const source = table === 'task' ? sql`task` : sql`spec`;
    const { rows } = await tx.execute<{ id: string }>(
      sql`SELECT id FROM ${source} WHERE project_id = ${projectId} AND ${match}`,
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new NervError(
        NERV_ERROR.PRECONDITION,
        msg('error.question.context_not_found', { field: `context.${field}_id` }),
        { kind: 'not_found', field: `context.${field}_id`, value: ref },
      );
    }
    return id;
  }

  /**
   * EP-QST-02 답변 — **사람이 한다.** 답변이 들어오면 세션을 다시 깨우고,
   * 그 답은 다음 하트비트 응답의 pending 으로도 전달된다(역채널 — agent-integration §2.4).
   */
  async answer(input: {
    projectId: string;
    questionId: string;
    userId: string;
    answerKey?: string | null;
    answerMd?: string | null;
  }): Promise<{ status: string; session_id: string }> {
    return this.events.transact(async (tx, emit) => {
      const { rows } = await tx.execute<{ agent_session_id: string; status: string }>(sql`
        UPDATE question
           SET status = 'answered', answer_key = ${input.answerKey ?? null},
               answer_md = ${input.answerMd ?? null},
               answered_by_user_id = ${input.userId}, answered_at = now()
         WHERE id = ${input.questionId} AND project_id = ${input.projectId} AND status = 'open'
        RETURNING agent_session_id, status::text AS status
      `);
      const question = rows[0];
      if (question === undefined) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.question.not_open'), {
          kind: 'not_open',
        });
      }

      // 세션을 깨운다 — awaiting_input 이었던 것만
      await tx.execute(sql`
        UPDATE agent_session SET state = 'active'
         WHERE id = ${question.agent_session_id} AND state = 'awaiting_input'
      `);

      await emit({
        type: NERV_EVENT.QUESTION_ANSWERED,
        projectId: input.projectId,
        subjectType: 'question',
        subjectId: input.questionId,
        actorUserId: input.userId,
        isAgent: false,
      });

      return { status: 'answered', session_id: question.agent_session_id };
    });
  }

  /**
   * 하트비트 역채널에 실을 pending 목록 — 답변된 질문·지시.
   * **서버 → 세션 방향의 유일한 보장된 채널**이라(§2.4) 여기 실리지 않으면 에이전트는 모른다.
   */
  async pendingFor(sessionId: string): Promise<Record<string, unknown>[]> {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT 'question_answered' AS kind, id AS question_id, title,
             answer_key, answer_md, answered_at::text AS answered_at
        FROM question
       WHERE agent_session_id = ${sessionId} AND status = 'answered'
         AND answered_at > now() - interval '1 hour'
       ORDER BY answered_at DESC LIMIT 10
    `);
    return rows;
  }
}
