// EP-MIR-01·02 md 미러의 HTTP 경로 — 오류가 오류로 나간다 (2026-09-28 · REQ-API-236)
//
// 라우트 데코레이터(`@Header`)가 핸들러보다 먼저 content-type 을 md 로 정해서, 오류 봉투(JSON 객체)를
// Fastify 가 보내지 못하고 500 "invalid payload type" 이 됐다. 없는 버전 · 없는 키 · `?version=abc` 가
// 모두 500 이었다. 서비스만 부르던 테스트(mirror-retention.spec.ts)는 이것을 볼 수 없었다 — 여기서는
// 실제 HTTP 로 부른다. 파일 경로의 없음은 404(사람 결정 D5)이고, REST 의 같은 상황은 409 그대로다.

import { createHash } from 'node:crypto';
import { NERV_ERROR, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { SpecService } from '../../src/modules/spec/spec.service.js';
import { SpecExportService } from '../../src/modules/spec/spec-export.service.js';
import { NERV_DB } from '../../src/common/database.module.js';
import type { NervDb } from '../../src/common/database.module.js';
import type { StorageService } from '../../src/common/storage.service.js';
import { Readable } from 'node:stream';
import { zipEntries } from './zip-entries.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let token: string;
let projectId: string;
let userId: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_mirror_http');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  await seed();

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  token = (
    await app.get(AuthService).issueToken({
      projectId,
      userId,
      name: 'mirror',
      scopes: ['spec:read'],
    })
  ).token;

  const drafted = await app.get(SpecService).draftUpsert({
    roles: ['planner'],
    projectId,
    key: 'SPC-MIR-001',
    title: '미러: 제목에 쌍점',
    type: 'feature',
    bodyMd: '# 미러\n\n본문',
    userId,
  });
  await pool.query(
    `UPDATE spec_version SET status='approved', approved_at=now(), approved_by_user_id=$2,
            edit_lease_user_id=NULL, edit_lease_session_id=NULL, edit_lease_expires_at=NULL
      WHERE id = $1`,
    [drafted['spec_version_id'], userId],
  );
  await pool.query(`UPDATE spec SET current_version_id=$1 WHERE id=$2`, [
    drafted['spec_version_id'],
    drafted['spec_id'],
  ]);
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
});

async function get(
  url: string,
  extra: Record<string, string> = {},
): Promise<{
  status: number;
  type: string;
  text: string;
  headers: Record<string, unknown>;
  json: () => Record<string, unknown>;
}> {
  const res = await app.inject({
    method: 'GET',
    url,
    headers: { authorization: `Bearer ${token}`, ...extra },
  });
  return {
    status: res.statusCode,
    type: String(res.headers['content-type'] ?? ''),
    text: res.body,
    headers: res.headers,
    json: () => JSON.parse(res.body) as Record<string, unknown>,
  };
}

/** 선두 frontmatter 를 실제 YAML 파서로 읽는다 — 미러를 받는 쪽이 하는 일이다 */
function frontmatterOf(text: string): Record<string, unknown> {
  const end = text.indexOf('\n---\n', 3);
  expect(text.startsWith('---\n')).toBe(true);
  expect(end).toBeGreaterThan(0);
  return parseYaml(text.slice(4, end)) as Record<string, unknown>;
}

describe('md 미러의 HTTP 응답 (REQ-API-236)', () => {
  it('있는 문서는 markdown 으로 나간다', async () => {
    const res = await get('/api/projects/clemvion/specs/SPC-MIR-001.md');
    expect(res.status).toBe(200);
    expect(res.type).toContain('text/markdown');
    expect(res.text.startsWith('---\n')).toBe(true);
  });

  it('llms.txt 는 text/plain 이다', async () => {
    const res = await get('/api/projects/clemvion/llms.txt');
    expect(res.status).toBe(200);
    expect(res.type).toContain('text/plain');
    expect(res.text).toContain('SPC-MIR-001');
  });

  it('없는 버전은 404 다 — 500 이 아니고, 본문은 오류 봉투(JSON)다', async () => {
    const res = await get('/api/projects/clemvion/specs/SPC-MIR-001.md?version=9');
    expect(res.status).toBe(404);
    expect(res.type).toContain('application/json');
    expect(res.json()['code']).toBe(NERV_ERROR.PRECONDITION);
    expect((res.json()['details'] as Record<string, unknown>)['kind']).toBe('not_found');
  });

  it('없는 키도 404 다', async () => {
    const res = await get('/api/projects/clemvion/specs/SPC-NOPE.md');
    expect(res.status).toBe(404);
    expect(res.json()['code']).toBe(NERV_ERROR.PRECONDITION);
  });

  it.each(['abc', '0', '-1', '1.5'])(
    '?version=%s 는 400 이다 — 숫자로 바꾸지 않은 채 SQL 까지 가던 자리다',
    async (version) => {
      const res = await get(`/api/projects/clemvion/specs/SPC-MIR-001.md?version=${version}`);
      expect(res.status).toBe(400);
      expect((res.json()['details'] as Record<string, unknown>)['field']).toBe('version');
    },
  );

  it('REST 의 같은 상황은 409 그대로다 — 404 는 파일 경로만의 것이다', async () => {
    const res = await get('/api/v1/projects/clemvion/specs/SPC-MIR-001?v=9');
    expect(res.status).toBe(409);
    expect(res.json()['code']).toBe(NERV_ERROR.PRECONDITION);
  });
});

/**
 * frontmatter 의 트리 자리와 캐시 (2026-09-28 · REQ-API-245 · 246).
 *
 * 제목의 `: ` 하나가 YAML 파싱을 깨뜨렸다(clemvion 446편 중 2편). 미러를 받는 쪽은 문서 한 번의 GET 으로 영역
 * 폴더와 버전을 정하고, 받은 것과 같으면 본문을 다시 받지 않으려 한다.
 */
describe('md 미러의 frontmatter · ETag (REQ-API-245 · 246)', () => {
  const TITLE = '마켓 스킨: CPIK "연동" # 1 — [베타]';
  beforeAll(async () => {
    // 맨 위 영역(본문 없음) > 영역 > 기능 > 이 문서
    const make = async (key: string, type: string, parent: string | null): Promise<string> => {
      const id = newId();
      await pool.query(
        `INSERT INTO spec (id, project_id, type, key, title, parent_id)
         VALUES ($1,$2,$3::spec_type,$4,$4,(SELECT id FROM spec WHERE project_id=$2 AND key=$5))`,
        [id, projectId, type, key, parent],
      );
      return id;
    };
    await make('SPC-ROOT', 'area', null);
    await make('SPC-AREA', 'area', 'SPC-ROOT');
    await make('SPC-MID', 'feature', 'SPC-AREA');
    const drafted = await app.get(SpecService).draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'SPC-LEAF',
      title: TITLE,
      type: 'feature',
      bodyMd: '# 잎\n\n본문',
      userId,
    });
    await pool.query(
      `UPDATE spec SET parent_id = (SELECT id FROM spec WHERE project_id=$1 AND key='SPC-MID')
        WHERE id = $2`,
      [projectId, drafted['spec_id']],
    );
  });

  it('값은 YAML 로 그대로 읽히고, 앞의 일곱 키 뒤에 트리의 자리와 본문 지문이 붙는다', async () => {
    const res = await get('/api/projects/clemvion/specs/SPC-LEAF.md');
    expect(res.status).toBe(200);
    const front = frontmatterOf(res.text);
    expect(Object.keys(front)).toEqual([
      'id',
      'title',
      'type',
      'version',
      'status',
      'requirements',
      'basis_superseded',
      'parent',
      'ancestors',
      'area',
      'content_hash',
      'read_as',
      'task',
    ]);
    expect(front['title']).toBe(TITLE);
    expect(front['version']).toBe(1);
    expect(front['status']).toBe('draft');
    expect(front['parent']).toBe('SPC-MID');
    expect(front['ancestors']).toEqual(['SPC-ROOT', 'SPC-AREA', 'SPC-MID']);
    // 가장 가까운 area 조상이다 — 맨 위 영역이 아니다
    expect(front['area']).toBe('SPC-AREA');
    const rest = await get('/api/v1/projects/clemvion/specs/SPC-LEAF?basis=latest');
    expect(front['content_hash']).toBe(rest.json()['content_hash']);
  });

  it('맨 위 영역은 부모 · area 가 null 이고 조상이 비었다 — 본문 없는 노드도 읽힌다', async () => {
    const res = await get('/api/projects/clemvion/specs/SPC-ROOT.md');
    expect(res.status).toBe(200);
    const front = frontmatterOf(res.text);
    expect(front['parent']).toBeNull();
    expect(front['ancestors']).toEqual([]);
    expect(front['area']).toBeNull();
    expect(front['version']).toBeNull();
    expect(front['content_hash']).toBeNull();
    // 버전이 없으면 언제 바뀌었는지도 모른다
    expect(res.headers['last-modified']).toBeUndefined();
  });

  it('ETag 는 응답 바이트의 sha256 이고, 같은 값을 보내면 304 로 본문 없이 답한다', async () => {
    const first = await get('/api/projects/clemvion/specs/SPC-LEAF.md');
    const etag = String(first.headers['etag']);
    expect(etag).toMatch(/^"sha256-[0-9a-f]{64}"$/);
    expect(etag).toBe(`"sha256-${createHash('sha256').update(first.text, 'utf8').digest('hex')}"`);
    expect(String(first.headers['last-modified'])).toMatch(/GMT$/);
    expect(first.headers['cache-control']).toBe('private, no-cache');

    for (const sent of [etag, `W/${etag}`, `"other", ${etag}`, '*']) {
      const again = await get('/api/projects/clemvion/specs/SPC-LEAF.md', {
        'if-none-match': sent,
      });
      expect(again.status, sent).toBe(304);
      expect(again.text, sent).toBe('');
      expect(again.headers['etag']).toBe(etag);
    }

    const other = await get('/api/projects/clemvion/specs/SPC-LEAF.md', {
      'if-none-match': '"sha256-0000"',
    });
    expect(other.status).toBe(200);
  });

  it('frontmatter 만 바뀌어도 ETag 가 바뀐다 — 본문 지문(content_hash)은 그대로다', async () => {
    const before = await get('/api/projects/clemvion/specs/SPC-LEAF.md');
    await pool.query(`UPDATE spec SET parent_id = NULL WHERE project_id=$1 AND key='SPC-LEAF'`, [
      projectId,
    ]);
    const after = await get('/api/projects/clemvion/specs/SPC-LEAF.md', {
      'if-none-match': String(before.headers['etag']),
    });
    expect(after.status).toBe(200);
    expect(after.headers['etag']).not.toBe(before.headers['etag']);
    expect(frontmatterOf(after.text)['content_hash']).toBe(
      frontmatterOf(before.text)['content_hash'],
    );
    expect(frontmatterOf(after.text)['area']).toBeNull();
  });
});

/**
 * 작업의 기준으로 미러를 읽는다 (2026-09-28 · clemvion 요청 N4 · REQ-API-249).
 *
 * 구현 때 pull 도구와 CI 는 REST 만으로 작업의 기준 버전을 받는다. 판정이 한 벌이어야 한다 — 같은 작업에 대해
 * 문서 조회(REST · `nerv_spec_get` 이 부르는 서비스)와 미러가 같은 버전을 고르는지 한 번에 본다.
 */
describe('md 미러의 작업 기준 (REQ-API-249)', () => {
  const TASK = 'CLV-T-MIRTK1';
  beforeAll(async () => {
    // 작업은 v1 을 기준으로 만들어졌고, 그 뒤 v2 가 승인됐다
    const { rows: v1 } = await pool.query<{ id: string; h: string }>(
      `SELECT v.id, encode(v.content_hash, 'hex') AS h FROM spec_version v JOIN spec s ON s.id = v.spec_id
        WHERE s.key = 'SPC-MIR-001' AND v.version_no = 1`,
    );
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status, source_spec_version_id)
       VALUES ($1,$2,$3,'미러 작업','backlog',$4)`,
      [newId(), projectId, TASK, v1[0]!.id],
    );
    const v2 = await app.get(SpecService).draftUpsert({
      roles: ['planner'],
      projectId,
      specId: 'SPC-MIR-001',
      bodyMd: '# 미러 v2\n\n바뀐 본문',
      baseHash: v1[0]!.h,
      userId,
    });
    await pool.query(`UPDATE spec_version SET status='superseded' WHERE id = $1`, [v1[0]!.id]);
    await pool.query(
      `UPDATE spec_version SET status='approved', approved_at=now(), approved_by_user_id=$2,
              edit_lease_user_id=NULL, edit_lease_session_id=NULL, edit_lease_expires_at=NULL
        WHERE id = $1`,
      [v2['spec_version_id'], userId],
    );
  });

  it('?task= 는 문서 조회와 같은 버전을 고르고, 무엇으로 읽었는지 헤더와 frontmatter 에 준다', async () => {
    const plain = frontmatterOf((await get('/api/projects/clemvion/specs/SPC-MIR-001.md')).text);
    expect(plain['version']).toBe(2);
    expect(plain['read_as']).toBe('approved');
    expect(plain['task']).toBeNull();

    const res = await get(`/api/projects/clemvion/specs/SPC-MIR-001.md?task=${TASK}`);
    expect(res.status).toBe(200);
    expect(res.headers['x-nerv-read-as']).toBe('task_basis');
    const front = frontmatterOf(res.text);
    expect(front['version']).toBe(1);
    expect(front['read_as']).toBe('task_basis');
    expect(front['task']).toBe(TASK);

    const rest = await get(`/api/v1/projects/clemvion/specs/SPC-MIR-001?task=${TASK}`);
    expect(rest.json()['version_no']).toBe(front['version']);
    expect(rest.json()['read_as']).toBe(front['read_as']);
    const service = await app
      .get(SpecService)
      .get({ projectId, specKey: 'SPC-MIR-001', task: TASK });
    expect(service['version_no']).toBe(front['version']);
  });

  it('?basis=latest 도 받는다 — 선택자를 둘 주면 400, 없는 작업은 404 다', async () => {
    const latest = await get('/api/projects/clemvion/specs/SPC-MIR-001.md?basis=latest');
    expect(latest.status).toBe(200);
    expect(frontmatterOf(latest.text)['read_as']).toBe('latest');

    const both = await get(`/api/projects/clemvion/specs/SPC-MIR-001.md?version=1&task=${TASK}`);
    expect(both.status).toBe(400);
    const missing = await get('/api/projects/clemvion/specs/SPC-MIR-001.md?task=CLV-T-NOPE99');
    expect(missing.status).toBe(404);
  });
});

/**
 * 프로젝트 스펙 전체 내보내기 (2026-09-28 · clemvion 요청 N5 · 사람 결정 D7 · D8 · REQ-API-251).
 *
 * 문서마다 GET 하면 446번이고 분당 300건 한도에 걸렸다. zip 하나로 받고, 같은 기준이면 같은 바이트여야 한다.
 */
describe('EP-MIR-03 export.zip (REQ-API-251)', () => {
  async function download(query: string): Promise<{ status: number; type: string; zip: Buffer }> {
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/clemvion/export.zip${query}`,
      headers: { authorization: `Bearer ${token}` },
    });
    return {
      status: res.statusCode,
      type: String(res.headers['content-type'] ?? ''),
      zip: res.rawPayload,
    };
  }

  it('layout=tree 는 가장 가까운 area 폴더에 넣고, 문서는 md 미러와 같은 바이트다', async () => {
    const res = await download('?layout=tree');
    expect(res.status).toBe(200);
    expect(res.type).toContain('application/zip');
    const entries = zipEntries(res.zip);
    const paths = entries.map((e) => e.path);
    expect(paths.slice(0, 2)).toEqual(['manifest.json', 'llms.txt']);
    expect(paths).toContain('specs/SPC-AREA/SPC-AREA.md');
    expect(paths).toContain('specs/SPC-AREA/SPC-MID.md');
    expect(paths).toContain('specs/SPC-ROOT/SPC-ROOT.md');
    expect(paths).toContain('specs/SPC-MIR-001.md');

    const manifest = JSON.parse(entries[0]!.data.toString('utf8')) as {
      basis: string;
      layout: string;
      specs: { key: string; path: string; version: number | null; read_as: string }[];
      attachments: unknown[];
    };
    expect(manifest).toMatchObject({ basis: 'approved', layout: 'tree', attachments: [] });
    // 키 순서다 — 같은 기준이면 같은 바이트가 되는 첫째 조건
    const keys = manifest.specs.map((d) => d.key);
    expect(keys).toEqual([...keys].sort());
    const mir = manifest.specs.find((d) => d.key === 'SPC-MIR-001')!;
    expect(mir).toMatchObject({ version: 2, read_as: 'approved' });

    const mid = entries.find((e) => e.path === 'specs/SPC-AREA/SPC-MID.md')!;
    const single = await get('/api/projects/clemvion/specs/SPC-MID.md');
    expect(mid.data.toString('utf8')).toBe(single.text);
    // 목록의 링크가 zip 안의 경로다
    expect(entries[1]!.data.toString('utf8')).toContain('(./specs/SPC-AREA/SPC-MID.md)');
  });

  it('같은 기준이면 같은 바이트다 · flat 은 한 폴더다 · 승인본이 없는 문서는 현재 버전으로', async () => {
    const a = await download('');
    const b = await download('?basis=approved&layout=flat');
    expect(a.zip.equals(b.zip)).toBe(true);
    const manifest = JSON.parse(zipEntries(a.zip)[0]!.data.toString('utf8')) as {
      specs: { key: string; path: string; status: string | null; version: number | null }[];
    };
    expect(manifest.specs.every((d) => /^specs\/[^/]+\.md$/.test(d.path))).toBe(true);
    expect(manifest.specs.find((d) => d.key === 'SPC-LEAF')).toMatchObject({
      status: 'draft',
      version: 1,
    });
  });

  it('모르는 기준 · 배치 · include 는 400 이다', async () => {
    expect((await download('?basis=newest')).status).toBe(400);
    expect((await download('?layout=deep')).status).toBe(400);
    expect((await download('?include=comments')).status).toBe(400);
  });

  it('include=attachments 는 내보낸 본문이 가리키는 첨부만 넣고 목록에 id → 경로를 적는다', async () => {
    const { rows } = await pool.query<{ id: string; spec_id: string; v: string }>(
      `SELECT s.id AS spec_id, v.id AS v FROM spec s JOIN spec_version v ON v.spec_id = s.id
        WHERE s.key = 'SPC-LEAF' AND v.version_no = 1`,
    );
    const used = newId();
    const unused = newId();
    for (const [id, name] of [
      [used, '시안.png'],
      [unused, '안-쓰는.png'],
    ] as const) {
      await pool.query(
        `INSERT INTO attachment (id, project_id, spec_id, storage_key, filename, content_type, bytes,
                                 checksum, uploaded_by_user_id, committed_at)
         VALUES ($1,$2,$3,$4,$5,'image/png',4,'sha256:x',$6,now())`,
        [id, projectId, rows[0]!.spec_id, `k/${id}`, name, userId],
      );
    }
    // 승인본은 얼어 있다 — 초안(SPC-LEAF v1)의 본문에 주소를 넣는다
    await pool.query(`UPDATE spec_version SET body_md = body_md || $2 WHERE id = $1`, [
      rows[0]!.v,
      `\n\n![시안](/api/v1/projects/clemvion/attachments/${used})`,
    ]);
    // 스토리지는 흉내 낸다 — L2 는 S3 를 띄우지 않는다(attachment.spec.ts 와 같다)
    const storage = {
      get: (key: string) =>
        Promise.resolve({
          body: Readable.from([Buffer.from(key === `k/${used}` ? 'PNG!' : 'NOPE')]),
          contentType: 'image/png',
          bytes: 4,
        }),
    } as unknown as StorageService;
    const exporter = new SpecExportService(app.get<NervDb>(NERV_DB), app.get(SpecService), storage);
    const out = await exporter.archive({
      projectId,
      projectSlug: 'clemvion',
      basis: null,
      layout: null,
      include: ['attachments'],
    });
    const chunks: Buffer[] = [];
    for await (const chunk of out.stream) chunks.push(chunk as Buffer);
    const entries = zipEntries(Buffer.concat(chunks));
    const manifest = JSON.parse(entries[0]!.data.toString('utf8')) as {
      attachments: { id: string; path: string; referenced_by: string[] }[];
    };
    expect(manifest.attachments).toEqual([
      expect.objectContaining({
        id: used,
        path: `attachments/${used}/시안.png`,
        referenced_by: ['SPC-LEAF'],
      }),
    ]);
    const file = entries.find((e) => e.path === manifest.attachments[0]!.path)!;
    expect(file.data.toString()).toBe('PNG!');
    // 그림은 다시 압축하지 않는다
    expect(file.method).toBe(0);
  });
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  userId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'mira@example.com','미라','active')`,
    [userId],
  );
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'planner')`,
    [newId(), orgId, projectId, userId],
  );
}
