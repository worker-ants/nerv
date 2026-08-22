// 스펙 코멘트 — 헤딩 slug·REQ ref 앵커, open→resolved 추적 (E10-S03)
// 정본: data-model.md §2.2 · D-09 · agent-integration §2.3(`nerv_spec_comment_resolve`)
//
// **앵커가 이 기능의 전부다.** "3장이 이상해요"는 코멘트가 아니라 감상이다 — 어느 헤딩,
// 어느 요구사항인지 가리켜야 고칠 수 있고, 에이전트가 그 위치를 열어 이어서 작업할 수 있다.
// 그래서 앵커는 선택 필드가 아니고, 검색 결과·에디터·코멘트가 **같은 slug 규약**을 쓴다(D-09).
//
// 해소(resolve)는 작성자가 아니라 `spec:draft` 보유자가 한다 — 지적을 반영한 사람이
// 닫는 것이 맞고, 지적한 사람이 스스로 닫으면 반영 여부를 아무도 확인하지 않게 된다.

import { Injectable } from '@nestjs/common';
import { NERV_ERROR, NERV_EVENT, newId } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { EventService } from '../event/event.service.js';

export interface CommentResult extends Record<string, unknown> {
  comment_id: string;
  anchor: string;
  status: string;
  open_count: number;
}

@Injectable()
export class SpecCommentService {
  constructor(
    private readonly events: EventService,
    @InjectDb() private readonly db: NervDb,
  ) {}

  /** EP-CMT-02 — viewer 도 쓸 수 있다(spec-workflow §1.6). 지적은 권한이 아니라 참여다. */
  async add(input: {
    projectId: string;
    specVersionId: string;
    anchor: string;
    bodyMd: string;
    userId: string;
    sessionId?: string | null;
  }): Promise<CommentResult> {
    if (input.anchor.trim() === '') {
      throw new NervError(NERV_ERROR.PRECONDITION, '앵커가 필요합니다.', {
        kind: 'missing_anchor',
      });
    }
    if (input.bodyMd.trim() === '') {
      throw new NervError(NERV_ERROR.PRECONDITION, '본문이 필요합니다.', { kind: 'missing_body' });
    }

    return this.events.transact(async (tx, emit) => {
      const { rows } = await tx.execute<{ spec_id: string }>(sql`
        SELECT sv.spec_id FROM spec_version sv JOIN spec s ON s.id = sv.spec_id
         WHERE sv.id = ${input.specVersionId} AND s.project_id = ${input.projectId}
      `);
      const specId = rows[0]?.spec_id;
      if (specId === undefined) {
        throw new NervError(NERV_ERROR.PRECONDITION, '버전을 찾을 수 없습니다.', {
          kind: 'not_found',
          spec_version_id: input.specVersionId,
        });
      }

      const commentId = newId();
      await tx.execute(sql`
        INSERT INTO spec_comment (id, project_id, spec_id, spec_version_id, anchor,
                                  author_user_id, author_session_id, body_md)
        VALUES (${commentId}, ${input.projectId}, ${specId}, ${input.specVersionId}, ${input.anchor},
                ${input.userId}, ${input.sessionId ?? null}, ${input.bodyMd})
      `);

      await emit({
        type: NERV_EVENT.SPEC_COMMENT_ADDED,
        projectId: input.projectId,
        subjectType: 'spec',
        subjectId: specId,
        actorUserId: input.userId,
        actorSessionId: input.sessionId ?? null,
        isAgent: input.sessionId != null,
        payload: { comment_id: commentId, anchor: input.anchor },
      });

      return {
        comment_id: commentId,
        anchor: input.anchor,
        status: 'open',
        open_count: await this.openCount(tx, specId),
      };
    });
  }

  /** EP-CMT-01 */
  async list(input: {
    projectId: string;
    specKey: string;
    status?: 'open' | 'resolved' | null;
  }): Promise<Record<string, unknown>[]> {
    const statusFilter =
      input.status == null ? sql`` : sql` AND c.status = ${input.status}::comment_status`;
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT c.id, c.anchor, c.body_md, c.status::text AS status, c.author_user_id,
             c.author_session_id, c.resolved_by_user_id, c.created_at, c.resolved_at,
             sv.version_no
        FROM spec_comment c
        JOIN spec s ON s.id = c.spec_id
        JOIN spec_version sv ON sv.id = c.spec_version_id
       WHERE s.project_id = ${input.projectId} AND s.key = ${input.specKey}${statusFilter}
       ORDER BY c.created_at
    `);
    return rows;
  }

  /** 미해소 코멘트 수 — 제출 전 사전 검토와 S3 배지가 같은 값을 본다. */
  async openCountFor(specId: string): Promise<number> {
    return this.openCount(this.db, specId);
  }

  /**
   * EP-CMT-04 · `nerv_spec_comment_resolve` — open→resolved.
   *
   * 남은 open 수를 항상 돌려준다. 에이전트가 "다 처리했는지"를 스스로 알 수 있어야
   * 사람에게 되묻지 않고 마무리할 수 있기 때문이다(agent-integration §2.3).
   */
  async resolve(input: {
    projectId: string;
    commentId: string;
    resolutionNote?: string | null;
    resolvedInVersionId?: string | null;
    userId: string;
    sessionId?: string | null;
  }): Promise<CommentResult> {
    return this.events.transact(async (tx, emit) => {
      const { rows } = await tx.execute<{
        id: string;
        spec_id: string;
        status: string;
        anchor: string;
      }>(sql`
        SELECT id, spec_id, status::text AS status, anchor FROM spec_comment
         WHERE id = ${input.commentId} AND project_id = ${input.projectId}
      `);
      const comment = rows[0];
      if (comment === undefined) {
        throw new NervError(NERV_ERROR.PRECONDITION, '코멘트를 찾을 수 없습니다.', {
          kind: 'not_found',
          comment_id: input.commentId,
        });
      }
      // 이미 해소된 코멘트의 재호출은 성공이다 — 재시도가 실패로 보이면 안 된다(멱등).
      if (comment.status === 'resolved') {
        return {
          comment_id: comment.id,
          anchor: comment.anchor,
          status: 'resolved',
          open_count: await this.openCount(tx, comment.spec_id),
        };
      }

      await tx.execute(sql`
        UPDATE spec_comment
           SET status = 'resolved', resolved_by_user_id = ${input.userId},
               resolved_in_version_id = ${input.resolvedInVersionId ?? null},
               body_md = body_md || ${input.resolutionNote == null || input.resolutionNote === '' ? '' : `\n\n— 해소: ${input.resolutionNote}`},
               resolved_at = now()
         WHERE id = ${input.commentId}
      `);

      await emit({
        type: NERV_EVENT.COMMENT_RESOLVED,
        projectId: input.projectId,
        subjectType: 'spec',
        subjectId: comment.spec_id,
        actorUserId: input.userId,
        actorSessionId: input.sessionId ?? null,
        isAgent: input.sessionId != null,
        payload: { comment_id: comment.id, anchor: comment.anchor },
      });

      return {
        comment_id: comment.id,
        anchor: comment.anchor,
        status: 'resolved',
        open_count: await this.openCount(tx, comment.spec_id),
      };
    });
  }

  private async openCount(
    executor: { execute: NervDb['execute'] },
    specId: string,
  ): Promise<number> {
    const { rows } = await executor.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM spec_comment WHERE spec_id = ${specId} AND status = 'open'`,
    );
    return Number(rows[0]?.count ?? 0);
  }
}
