// 스펙 첨부 — api.md §2.10 (REQ-API-069~071)
//
// **MinIO 는 스택에 처음부터 있었다** — compose·k8s 둘 다에. 아무도 쓰지 않았을 뿐이다.
// 이 스위트는 그 배선의 첫 소비자를 지킨다: 형식·상한·2단계 확정·권한.
//
// 스토리지 자체는 여기서 흉내 낸다(L2 는 Postgres 를 진짜로 쓰지만 S3 까지 띄우지 않는다).
// **판정 로직이 검사 대상**이고, S3 왕복은 계약이 단순해서 스텁으로 충분하다.

process.env['NERV_EMBED_URL'] = 'http://127.0.0.1:1/v1';

import { NERV_ERROR, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AttachmentService, MAX_BYTES } from '../../src/modules/spec/attachment.service.js';
import { StorageService } from '../../src/common/storage.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let attachments: AttachmentService;
let projectId: string;
let userId: string;
let specId: string;

/** 스토리지 스텁 — 넣은 것을 기억하고, head 는 넣힌 크기를 돌려준다 */
class FakeStorage {
  readonly objects = new Map<string, { bytes: number; contentType: string }>();
  presignPut = async (key: string, contentType: string): Promise<string> => {
    void contentType;
    return `https://storage.test/${key}?sig=x`;
  };
  put = async (key: string, body: Buffer, contentType: string): Promise<void> => {
    this.objects.set(key, { bytes: body.byteLength, contentType });
  };
  head = async (key: string): Promise<{ bytes: number; contentType: string } | null> =>
    this.objects.get(key) ?? null;
  remove = async (key: string): Promise<void> => {
    this.objects.delete(key);
  };
}
let storage: FakeStorage;

beforeAll(async () => {
  db = await createScratchDb('nerv_attach');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  storage = new FakeStorage();
  attachments = new AttachmentService(storage as unknown as StorageService, drizzle(pool) as never);

  const orgId = newId();
  projectId = newId();
  userId = newId();
  specId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'o','O')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'a@b.c','규아','active')`,
    [userId],
  );
  await pool.query(`INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'p','P','p')`, [
    projectId,
    orgId,
  ]);
  await pool.query(
    `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'feature','SPC-ATT','첨부')`,
    [specId, projectId],
  );
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query('DELETE FROM attachment');
  storage.objects.clear();
});

describe('사람 경로 — 서버가 받아서 넣는다', () => {
  it('올리면 목록에 나오고 본문에 붙일 주소를 준다', async () => {
    const out = await attachments.upload({
      projectId,
      specKey: 'SPC-ATT',
      userId,
      filename: '로그인-시안.png',
      contentType: 'image/png',
      body: Buffer.from('PNGDATA'),
    });
    // 주소를 함께 주는 이유 — 파일만 매달고 끝나면 문서를 읽는 사람은 그림을 못 본다
    expect(String(out['url'])).toContain('/attachments/');
    const listed = await attachments.list({ projectId, specKey: 'SPC-ATT' });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.['filename']).toBe('로그인-시안.png');
    expect(listed[0]?.['is_agent']).toBe(false);
  });

  it.each([['text/html'], ['application/zip'], ['application/x-sh']])(
    '%s 는 받지 않는다 — 화이트리스트다',
    async (contentType) => {
      await expect(
        attachments.upload({
          projectId,
          specKey: 'SPC-ATT',
          userId,
          filename: 'x',
          contentType,
          body: Buffer.from('x'),
        }),
      ).rejects.toMatchObject({ details: { kind: 'unsupported_type' } });
    },
  );

  it('SVG 는 받는다 — 시안에 가장 유용하다(스크립트는 서빙이 막는다)', async () => {
    await expect(
      attachments.upload({
        projectId,
        specKey: 'SPC-ATT',
        userId,
        filename: 'flow.svg',
        contentType: 'image/svg+xml',
        body: Buffer.from('<svg/>'),
      }),
    ).resolves.toBeDefined();
  });

  it('10MB 를 넘으면 막는다', async () => {
    await expect(
      attachments.upload({
        projectId,
        specKey: 'SPC-ATT',
        userId,
        filename: 'big.png',
        contentType: 'image/png',
        body: Buffer.alloc(MAX_BYTES + 1),
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.PRECONDITION, details: { kind: 'too_large' } });
  });
});

describe('에이전트 경로 — presigned 2단계', () => {
  async function presigned(): Promise<Record<string, unknown>> {
    return attachments.presign({
      projectId,
      specKey: 'SPC-ATT',
      userId,
      sessionId: null,
      filename: 'agent.svg',
      contentType: 'image/svg+xml',
    });
  }

  it('올릴 자리를 준다 — 응답에 파일을 싣지 않는다', async () => {
    const out = await presigned();
    expect(String(out['upload_url'])).toContain('https://storage.test/');
    expect(out['method']).toBe('PUT');
  });

  it('확정 전에는 목록에 없다 — 올리다 만 것과 올린 것을 구별한다', async () => {
    await presigned();
    expect(await attachments.list({ projectId, specKey: 'SPC-ATT' })).toHaveLength(0);
  });

  it('올리지 않고 확정하면 막는다 — 말만 듣고 확정하지 않는다', async () => {
    const out = await presigned();
    await expect(
      attachments.commit({ projectId, attachmentId: String(out['attachment_id']) }),
    ).rejects.toMatchObject({ details: { kind: 'not_uploaded' } });
  });

  it('올린 뒤 확정하면 목록에 나오고 크기가 채워진다', async () => {
    const out = await presigned();
    const { rows } = await pool.query<{ storage_key: string }>(
      `SELECT storage_key FROM attachment WHERE id = $1`,
      [String(out['attachment_id'])],
    );
    await storage.put(rows[0]!.storage_key, Buffer.from('<svg/>'), 'image/svg+xml');

    const committed = await attachments.commit({
      projectId,
      attachmentId: String(out['attachment_id']),
    });
    expect(committed['bytes']).toBe(6);
    const listed = await attachments.list({ projectId, specKey: 'SPC-ATT' });
    expect(listed).toHaveLength(1);
  });

  it('상한은 확정에서 지켜진다 — presigned PUT 은 크기를 못 막는다', async () => {
    const out = await presigned();
    const { rows } = await pool.query<{ storage_key: string }>(
      `SELECT storage_key FROM attachment WHERE id = $1`,
      [String(out['attachment_id'])],
    );
    await storage.put(rows[0]!.storage_key, Buffer.alloc(MAX_BYTES + 1), 'image/svg+xml');

    await expect(
      attachments.commit({ projectId, attachmentId: String(out['attachment_id']) }),
    ).rejects.toMatchObject({ details: { kind: 'too_large' } });
    // 넘친 것은 **치운다** — 스토리지에 고아로 남기지 않는다
    expect(storage.objects.size).toBe(0);
    expect(await attachments.list({ projectId, specKey: 'SPC-ATT' })).toHaveLength(0);
  });
});
