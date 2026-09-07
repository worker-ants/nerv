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
import { commentStatus, msg, NERV_ERROR, NERV_EVENT, newId } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { assertVocab } from '../../common/query-vocab.js';
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
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.comment.anchor_required'), {
        kind: 'missing_anchor',
      });
    }
    if (input.bodyMd.trim() === '') {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.comment.body_required'), {
        kind: 'missing_body',
      });
    }

    return this.events.transact(async (tx, emit) => {
      const { rows } = await tx.execute<{ spec_id: string }>(sql`
        SELECT sv.spec_id FROM spec_version sv JOIN spec s ON s.id = sv.spec_id
         WHERE sv.id = ${input.specVersionId} AND s.project_id = ${input.projectId}
      `);
      const specId = rows[0]?.spec_id;
      if (specId === undefined) {
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.version_not_found'), {
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
        // **화면이 무효화할 키를 싣는다.** 화면의 쿼리 키 축은 고정 ID(스펙 키 — 형식은 프로젝트가 정한다)인데
        // 이벤트는 UUID 만 실어, 코멘트가 달려도 열어 둔 문서가 갱신되지 않았다 —
        // WS 가 붙어 있으니 폴백 폴링도 돌지 않아 새로고침 전까지 조용했다.
        subjectKey: await keyOfSpec(tx, specId),
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
    /** 어휘 판정은 아래 `assertVocab` 이 한다(REQ-API-126) */
    status?: string | null;
  }): Promise<Record<string, unknown>[]> {
    const statusFilter =
      input.status == null
        ? sql``
        : // 어휘의 정본은 `@nerv/schema` 다 — 모르는 값은 거절이지 500 이 아니다(REQ-API-112)
          sql` AND c.status = ${assertVocab([input.status], commentStatus.enumValues, 'status')[0]}::comment_status`;
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

  /**
   * EP-CMT-03 — 본문 수정. **작성자 본인만** 고친다.
   *
   * 남의 지적을 고칠 수 있으면 지적이 기록이 아니게 된다 — 해소는 `resolve` 로 하고
   * 그 권한은 다른 역할(`spec:draft`)에 있다. 두 동작을 나눈 이유가 그것이다.
   */
  async update(input: {
    projectId: string;
    commentId: string;
    bodyMd: string;
    userId: string;
  }): Promise<CommentResult> {
    if (input.bodyMd.trim() === '') {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.comment.body_required'), {
        kind: 'missing_body',
      });
    }
    const { rows } = await this.db.execute<{
      id: string;
      spec_id: string;
      anchor: string;
      status: string;
      author_user_id: string;
    }>(sql`
      SELECT id, spec_id, anchor, status::text AS status, author_user_id
        FROM spec_comment WHERE id = ${input.commentId} AND project_id = ${input.projectId}
    `);
    const comment = rows[0];
    if (comment === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.comment.not_found'), {
        kind: 'not_found',
        comment_id: input.commentId,
      });
    }
    if (comment.author_user_id !== input.userId) {
      throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.auth.author_only'), {
        kind: 'not_author',
      });
    }

    await this.db.execute(
      sql`UPDATE spec_comment SET body_md = ${input.bodyMd} WHERE id = ${input.commentId}`,
    );
    return {
      comment_id: comment.id,
      anchor: comment.anchor,
      status: comment.status,
      open_count: await this.openCount(this.db, comment.spec_id),
    };
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
        throw new NervError(NERV_ERROR.PRECONDITION, msg('error.comment.not_found'), {
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
        subjectKey: await keyOfSpec(tx, comment.spec_id),
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

/** 이벤트가 실을 고정 ID — 화면의 쿼리 키 축이 이것이다(screens.md §1.4) */
async function keyOfSpec(
  tx: Parameters<Parameters<NervDb['transaction']>[0]>[0],
  specId: string,
): Promise<string | null> {
  const { rows } = await tx.execute<{ key: string }>(
    sql`SELECT key FROM spec WHERE id = ${specId}`,
  );
  return rows[0]?.key ?? null;
}
