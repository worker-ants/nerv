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
import { NERV_ERROR, NERV_EVENT, newId } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { EventService } from '../event/event.service.js';

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
    taskId?: string | null;
    title: string;
    bodyMd?: string | null;
    options?: string[];
    urgency?: 'blocking' | 'normal';
    idempotencyKey?: string | undefined;
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
      // 폴링 — 새 카드를 만들지 않는다. 승인함이 같은 질문으로 덮이지 않게.
      return {
        question_id: found.id,
        status: found.status,
        answer_key: found.answer_key,
        answer_md: found.answer_md,
        created: false,
      };
    }

    return this.events.transact(async (tx, emit) => {
      const questionId = newId();
      const urgency = input.urgency ?? 'blocking';

      await tx.execute(sql`
        INSERT INTO question (id, project_id, agent_session_id, task_id, title, body_md,
                              options, urgency, status)
        VALUES (${questionId}, ${input.projectId}, ${input.sessionId}, ${input.taskId ?? null},
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
        payload: { urgency, blocking: urgency === 'blocking' },
      });

      return {
        question_id: questionId,
        status: 'open',
        answer_key: null,
        answer_md: null,
        created: true,
      };
    });
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
        throw new NervError(NERV_ERROR.PRECONDITION, '열린 질문이 아닙니다.', {
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
