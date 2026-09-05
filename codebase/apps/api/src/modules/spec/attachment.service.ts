// 스펙 첨부 — 정본: api.md §2.10 (REQ-API-069·070·071)
//
// **디자인 시안이 문서 밖에 있으면 문서가 아니다.** 지금까지 시안은 슬랙이나 피그마 링크로
// 떠돌았고, 그 링크는 스펙의 버전과 무관하게 바뀌었다 — "이 버전이 말하는 화면" 을 나중에
// 되짚을 수 없다는 뜻이다. 첨부를 문서에 매다는 이유가 그것이다.
//
// 두 경로가 있다: 사람은 **서버를 거쳐** 올리고(작고 즉시적이다), 에이전트는 **presigned
// 2단계**로 올린다 — MCP 응답에 수백 KB base64 를 실으면 그 세션의 컨텍스트 예산이
// 그것으로 찬다(사람 결정 2026-09-01).

import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_READ_MAX_BYTES,
  msg,
  NERV_ERROR,
  newId,
} from '@nerv/schema';
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
  // 텍스트 계열과 묶음(2026-09-04 · 사람 지시). 시안만이 아니라 **산출물**도 문서에
  // 매달린다 — 리포트 한 장(html), 로그·추출물(txt), 여러 파일 묶음(zip).
  //
  // `text/html` 을 받는 것이 위험해 보이지만 **이미 `image/svg+xml` 을 받고 있고**
  // 그쪽이 더 어려운 경우다(SVG 는 이미지로 위장한 스크립트다). 내려받기 경로가 둘 다
  // 같은 방어를 건다(EP-SPEC-22): `Content-Security-Policy: sandbox; default-src 'none'`
  // 로 스크립트를 막고 불투명 오리진에 가두며, `nosniff` 로 타입 추측을 끈다.
  'text/html': 'html',
  'text/plain': 'txt',
  'application/zip': 'zip',
};

/** 파일당 10MB — 스펙당 합계는 제한하지 않는다(사람 결정). 값의 정본은 상수 파일이다 */
export const MAX_BYTES = ATTACHMENT_MAX_BYTES;

/**
 * 도구로 **본문을 실어 줄 수 있는** 형식(REQ-API-089). 화이트리스트 전체가 아니라 그중
 * 텍스트뿐이다 — 이미지·PDF·zip 은 base64 로 실어도 모델이 할 수 있는 일이 없다.
 */
export const READABLE_TYPES: ReadonlySet<string> = new Set(['text/html', 'text/plain']);

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
             (a.uploaded_by_session_id IS NOT NULL) AS is_agent,
             -- **받는 주소를 함께 준다**(2026-09-04 · 실사용 보고). id 만 주면 주소를
             -- 조립하는 규칙을 아는 쪽만 받을 수 있다 — 웹은 알았고 에이전트는 몰라서
             -- 스토리지(:9000)를 직접 두드리다 403 을 받았다. 서버 경로로 안내한다:
             -- 권한 검사와 CSP sandbox·nosniff 가 그 경로에만 걸린다(REQ-API-070).
             '/api/v1/projects/' || p.slug || '/attachments/' || a.id AS url
        FROM attachment a
        JOIN spec s ON s.id = a.spec_id
        JOIN project p ON p.id = s.project_id
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
    this.assertStorage();
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
    // 확정 응답이 **받는 주소를 준다**(2026-09-04 · REQ-API-089). 스킬은 "확정하면 응답의
    // `url` 을 본문에 넣으라" 고 지시하는데 이 응답에 그 필드가 없었다 — 실사용 에이전트가
    // 목록을 따로 불러 메웠다. 지시가 가리키는 필드는 지시가 가리키는 자리에 있어야 한다.
    return {
      attachment_id: input.attachmentId,
      bytes: head.bytes,
      committed: true,
      url: `/api/v1/projects/${await this.projectSlug(input.projectId)}/attachments/${input.attachmentId}`,
    };
  }

  /** 라우트의 `:proj` 는 슬러그로만 해소된다 — 주소를 만드는 자리는 전부 이것을 쓴다. */
  private async projectSlug(projectId: string): Promise<string> {
    const { rows } = await this.db.execute<{ slug: string }>(sql`
      SELECT slug FROM project WHERE id = ${projectId}
    `);
    return rows[0]?.slug ?? projectId;
  }

  /** 스트리밍용 — 멤버십은 컨트롤러의 가드가 이미 봤다 */
  /**
   * `nerv_spec_attachment_read` — **텍스트만, 상한을 두고** 본문을 실어 준다(REQ-API-089).
   *
   * 이 도구는 규약의 예외라 경계를 좁게 잡는다. MCP 응답에 파일을 싣지 않는 것이 2단계
   * 업로드를 만든 이유였고(컨텍스트 예산), 그 이유는 내려받기에도 그대로 유효하다.
   * 그래서 **가능하면 `url` 로 받아 파일로 다루는 것이 낫다** — 이 도구는 Bash 가 없는
   * 세션(도구가 제한된 서브에이전트 등)을 위한 길이다.
   *
   * 텍스트가 아닌 것은 **거부한다.** 이미지·PDF·zip 을 base64 로 실으면 그 한 번으로
   * 세션의 예산이 사라지고, 모델이 그것으로 할 수 있는 일도 없다.
   */
  async read(input: { projectId: string; attachmentId: string }): Promise<Record<string, unknown>> {
    this.assertStorage();
    const found = await this.open(input);
    if (found === null) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.attachment.not_found'), {
        kind: 'not_found',
        attachment_id: input.attachmentId,
      });
    }
    if (!READABLE_TYPES.has(found.contentType)) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.attachment.not_text'), {
        kind: 'not_text',
        content_type: found.contentType,
        // 막으면서 길을 함께 준다 — 거절만 하면 호출자는 방법이 없다고 읽는다
        readable: [...READABLE_TYPES],
        url: `/api/v1/projects/${await this.projectSlug(input.projectId)}/attachments/${input.attachmentId}`,
      });
    }

    const object = await this.storage.get(found.storageKey);
    if (object === null) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.attachment.not_found'), {
        kind: 'not_found',
        attachment_id: input.attachmentId,
      });
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of object.body) {
      const buf = chunk as Buffer;
      bytes += buf.byteLength;
      // 상한까지만 모은다 — 다 읽고 자르면 큰 파일에서 메모리가 먼저 아프다
      if (chunks.reduce((n, c) => n + c.byteLength, 0) < ATTACHMENT_READ_MAX_BYTES) {
        chunks.push(buf);
      }
    }
    const all = Buffer.concat(chunks);
    const truncated = bytes > ATTACHMENT_READ_MAX_BYTES;

    return {
      attachment_id: input.attachmentId,
      filename: found.filename,
      content_type: found.contentType,
      bytes,
      // **잘랐으면 잘랐다고 말한다.** 조용히 자르면 모델은 그것이 전부라고 읽고,
      // 없는 내용을 근거로 판단한다.
      truncated,
      ...(truncated
        ? {
            url: `/api/v1/projects/${await this.projectSlug(input.projectId)}/attachments/${input.attachmentId}`,
          }
        : {}),
      content: all.subarray(0, ATTACHMENT_READ_MAX_BYTES).toString('utf8'),
    };
  }

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

  /**
   * 스토리지가 **설정되어 있는가**. 없으면 여기서 말한다.
   *
   * 예전에는 `presign` 이 바로 `presignPut` 을 불렀고, 설정이 없으면 스토리지 서비스가
   * 던지는 날 `Error` 가 `NERV_UNAVAILABLE`(`kind:'internal'`)로 나갔다 — 실사용 보고
   * 2026-09-04. 그 코드는 규약상 **"의존 구성요소 장애, 나중에 재시도"** 라서 스킬은
   * `.nerv/outbox/` 에 큐잉하고 다시 시도한다. 그런데 설정 누락은 **재시도로 풀리지 않는다.**
   * 에이전트는 영원히 다시 걸고, 사람은 왜 안 되는지 알 길이 없다.
   *
   * 그래서 `kind` 로 가른다: 재시도할 것과 사람이 고쳐야 할 것은 다른 사실이다.
   */
  private assertStorage(): void {
    if (this.storage.available) return;
    throw new NervError(NERV_ERROR.UNAVAILABLE, msg('error.attachment.storage_unset'), {
      kind: 'storage_unconfigured',
      // 무엇이 없는지 말한다 — 이 셋이 다 있어야 첨부가 열린다(.env 전표 §5.2)
      missing: ['NERV_S3_ENDPOINT', 'NERV_S3_ACCESS_KEY', 'NERV_S3_SECRET_KEY'],
    });
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
    const slug = await this.projectSlug(input.projectId);
    return {
      attachment_id: input.id,
      filename: input.filename,
      content_type: input.contentType,
      bytes: input.bytes,
      // 본문에 그대로 붙일 수 있는 주소 — 사람도 에이전트도 이것을 마크다운에 넣는다.
      //
      // **슬러그다.** 예전에는 `projectId`(UUID)를 넣었고 그 주소는 409 였다(실측
      // 2026-09-04) — 라우트의 `:proj` 는 슬러그로만 해소된다. 즉 에이전트가 응답대로
      // 본문에 넣은 링크가 전부 죽어 있었다. 깨진 링크가 달린 시안은 시안이 없는 것보다
      // 나쁘다 — 사람이 그것을 찾아 헤맨다.
      url: `/api/v1/projects/${slug}/attachments/${input.id}`,
    };
  }
}
