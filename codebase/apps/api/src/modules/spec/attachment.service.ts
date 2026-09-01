// 스펙 첨부 — 정본: api.md §2.10 (REQ-API-069·070·071)
//
// **디자인 시안이 문서 밖에 있으면 문서가 아니다.** 지금까지 시안은 슬랙이나 피그마 링크로
// 떠돌았고, 그 링크는 스펙의 버전과 무관하게 바뀌었다 — "이 판이 말하는 화면" 을 나중에
// 되짚을 수 없다는 뜻이다. 첨부를 문서에 매다는 이유가 그것이다.
//
// 두 경로가 있다: 사람은 **서버를 거쳐** 올리고(작고 즉시적이다), 에이전트는 **presigned
// 2단계**로 올린다 — MCP 응답에 수백 KB base64 를 실으면 그 세션의 컨텍스트 예산이
// 그것으로 찬다(사람 결정 2026-09-01).

import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ATTACHMENT_MAX_BYTES, msg, NERV_ERROR, newId } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { StorageService } from '../../common/storage.service.js';

/**
 * 받는 형식 — **화이트리스트다**(무엇을 뺄까가 아니라 무엇만 넣을까).
 *
 * SVG 를 허용한다(사람 결정) — 시안에 가장 유용하다. 스크립트 위험은 **서빙 쪽**이 막는다:
 * `<img src>` 로 부른 SVG 는 스크립트를 실행하지 않고, 직접 열었을 때를 위해 응답에
 * CSP sandbox 와 `nosniff` 를 붙인다(REQ-API-070).
 */
export const ALLOWED_TYPES: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
};

/** 파일당 10MB — 스펙당 합계는 제한하지 않는다(사람 결정). 값의 정본은 상수 파일이다 */
export const MAX_BYTES = ATTACHMENT_MAX_BYTES;

@Injectable()
export class AttachmentService {
  constructor(
    private readonly storage: StorageService,
    @InjectDb() private readonly db: NervDb,
  ) {}

  /** 목록 — **확정된 것만**. 올리다 만 행은 목록에 없다 */
  async list(input: { projectId: string; specKey: string }): Promise<Record<string, unknown>[]> {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT a.id, a.filename, a.content_type, a.bytes, a.created_at,
             u.display_name AS uploaded_by,
             (a.uploaded_by_session_id IS NOT NULL) AS is_agent
        FROM attachment a
        JOIN spec s ON s.id = a.spec_id
        JOIN "user" u ON u.id = a.uploaded_by_user_id
       WHERE s.project_id = ${input.projectId} AND s.key = ${input.specKey}
         AND a.committed_at IS NOT NULL
       ORDER BY a.created_at
    `);
    return rows;
  }

  /** 사람 경로 — 서버가 받아서 넣는다 */
  async upload(input: {
    projectId: string;
    specKey: string;
    userId: string;
    filename: string;
    contentType: string;
    body: Buffer;
  }): Promise<Record<string, unknown>> {
    this.assertType(input.contentType);
    if (input.body.byteLength > MAX_BYTES) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.attachment.too_large'), {
        kind: 'too_large',
        bytes: input.body.byteLength,
        limit: MAX_BYTES,
      });
    }
    const spec = await this.resolveSpec(input.projectId, input.specKey);
    const id = newId();
    const key = this.storageKey(input.projectId, spec, id, input.contentType);
    await this.storage.put(key, input.body, input.contentType);

    return this.insert({
      id,
      projectId: input.projectId,
      specId: spec,
      storageKey: key,
      filename: input.filename,
      contentType: input.contentType,
      bytes: input.body.byteLength,
      checksum: createHash('sha256').update(input.body).digest('hex'),
      userId: input.userId,
      sessionId: null,
      committed: true,
    });
  }

  /**
   * 에이전트 경로 ① — 올릴 자리를 준다.
   *
   * 행을 **미리 만들되 확정하지 않는다**: 그래야 올리다 만 것과 올린 것을 구별할 수 있고,
   * 고아 오브젝트를 나중에 청소할 근거가 남는다.
   */
  async presign(input: {
    projectId: string;
    specKey: string;
    userId: string;
    sessionId?: string | null;
    filename: string;
    contentType: string;
  }): Promise<Record<string, unknown>> {
    this.assertType(input.contentType);
    const spec = await this.resolveSpec(input.projectId, input.specKey);
    const id = newId();
    const key = this.storageKey(input.projectId, spec, id, input.contentType);
    const url = await this.storage.presignPut(key, input.contentType);

    await this.insert({
      id,
      projectId: input.projectId,
      specId: spec,
      storageKey: key,
      filename: input.filename,
      contentType: input.contentType,
      bytes: 0,
      checksum: '',
      userId: input.userId,
      sessionId: input.sessionId ?? null,
      committed: false,
    });
    return { attachment_id: id, upload_url: url, method: 'PUT', content_type: input.contentType };
  }

  /**
   * 에이전트 경로 ② — 올렸다고 말한다. **서버가 실제로 확인한다.**
   *
   * 말만 듣고 확정하면 "올렸다는데 없는" 첨부가 목록에 뜬다 — 링크가 깨진 시안은
   * 시안이 없는 것보다 나쁘다(사람이 그것을 찾아 헤맨다).
   */
  async commit(input: {
    projectId: string;
    attachmentId: string;
  }): Promise<Record<string, unknown>> {
    const { rows } = await this.db.execute<{ storage_key: string; committed_at: unknown }>(sql`
      SELECT storage_key, committed_at FROM attachment
       WHERE id = ${input.attachmentId} AND project_id = ${input.projectId}
    `);
    const row = rows[0];
    if (row === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.attachment.not_found'), {
        kind: 'not_found',
      });
    }
    const head = await this.storage.head(row.storage_key);
    if (head === null) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.attachment.not_uploaded'), {
        kind: 'not_uploaded',
      });
    }
    if (head.bytes > MAX_BYTES) {
      // 상한은 presign 이 아니라 **여기서** 지켜진다 — presigned PUT 은 크기를 못 막는다
      await this.storage.remove(row.storage_key);
      await this.db.execute(sql`DELETE FROM attachment WHERE id = ${input.attachmentId}`);
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.attachment.too_large'), {
        kind: 'too_large',
        bytes: head.bytes,
        limit: MAX_BYTES,
      });
    }
    await this.db.execute(sql`
      UPDATE attachment SET committed_at = now(), bytes = ${head.bytes}
       WHERE id = ${input.attachmentId}
    `);
    return { attachment_id: input.attachmentId, bytes: head.bytes, committed: true };
  }

  /** 스트리밍용 — 멤버십은 컨트롤러의 가드가 이미 봤다 */
  async open(input: { projectId: string; attachmentId: string }): Promise<{
    storageKey: string;
    filename: string;
    contentType: string;
  } | null> {
    const { rows } = await this.db.execute<{
      storage_key: string;
      filename: string;
      content_type: string;
    }>(sql`
      SELECT storage_key, filename, content_type FROM attachment
       WHERE id = ${input.attachmentId} AND project_id = ${input.projectId}
         AND committed_at IS NOT NULL
    `);
    const row = rows[0];
    return row === undefined
      ? null
      : { storageKey: row.storage_key, filename: row.filename, contentType: row.content_type };
  }

  async remove(input: { projectId: string; attachmentId: string }): Promise<{ ok: true }> {
    const found = await this.open(input);
    if (found !== null) await this.storage.remove(found.storageKey);
    await this.db.execute(
      sql`DELETE FROM attachment WHERE id = ${input.attachmentId} AND project_id = ${input.projectId}`,
    );
    return { ok: true };
  }

  private assertType(contentType: string): void {
    if (ALLOWED_TYPES[contentType] === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.attachment.type'), {
        kind: 'unsupported_type',
        content_type: contentType,
        allowed: Object.keys(ALLOWED_TYPES),
      });
    }
  }

  private storageKey(projectId: string, specId: string, id: string, contentType: string): string {
    return `${projectId}/${specId}/${id}.${ALLOWED_TYPES[contentType] ?? 'bin'}`;
  }

  private async resolveSpec(projectId: string, specKey: string): Promise<string> {
    const { rows } = await this.db.execute<{ id: string }>(
      sql`SELECT id FROM spec WHERE project_id = ${projectId} AND key = ${specKey}`,
    );
    const found = rows[0];
    if (found === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.spec.not_found'), {
        kind: 'not_found',
        spec: specKey,
      });
    }
    return found.id;
  }

  private async insert(input: {
    id: string;
    projectId: string;
    specId: string;
    storageKey: string;
    filename: string;
    contentType: string;
    bytes: number;
    checksum: string;
    userId: string;
    sessionId: string | null;
    committed: boolean;
  }): Promise<Record<string, unknown>> {
    await this.db.execute(sql`
      INSERT INTO attachment (id, project_id, spec_id, storage_key, filename, content_type,
                              bytes, checksum, uploaded_by_user_id, uploaded_by_session_id,
                              committed_at)
      VALUES (${input.id}, ${input.projectId}, ${input.specId}, ${input.storageKey},
              ${input.filename}, ${input.contentType}, ${input.bytes}, ${input.checksum},
              ${input.userId}, ${input.sessionId},
              ${input.committed ? sql`now()` : sql`NULL`})
    `);
    return {
      attachment_id: input.id,
      filename: input.filename,
      content_type: input.contentType,
      bytes: input.bytes,
      // 본문에 그대로 붙일 수 있는 주소 — 사람도 에이전트도 이것을 마크다운에 넣는다
      url: `/api/v1/projects/${input.projectId}/attachments/${input.id}`,
    };
  }
}
