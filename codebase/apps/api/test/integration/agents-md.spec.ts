// 프로젝트의 AGENTS.md — EP-PRJ-06 · REQ-API-326 (2026-10-16 · 사람 결정 ① · Phase 2 E20-S03)
//
// 서버는 본문만 만들고 저장소에 쓰는 것은 `nerv-init` 이다(4.6 §5.3). 여기서 보는 것:
//   ① 권한 — 프로젝트 멤버의 `spec:read`(에이전트 토큰 포함). 다른 프로젝트 · 권한 없는 토큰 · 인증 없음은 거절
//   ② 본문 — 서버 주소(`NERV_API_URL`) · 프로젝트 키 · 규약 스펙 목록(bootstrap 과 같은 접은 목록) · 규약 버전
//   ③ 규약 버전 — 규약 스펙의 새 버전이 승인되면(접힌 하위 규약이어도) 바뀌고, 초안 · 다른 종류의 승인 · 다시 받기는 그대로다

import { AGENTS_MD_BEGIN, AGENTS_MD_END, agentsMdVersionOf, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

const API_URL = 'https://api.nerv.test';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let projectId: string;
let otherProjectId: string;
let userId: string;
let readToken: string;
let narrowToken: string;
let otherToken: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_agentsmd');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  const orgId = newId();
  projectId = newId();
  otherProjectId = newId();
  userId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'hana@example.com','하나','active')`,
    [userId],
  );
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','클렘비온'),
                                                             ($3,$2,'other','OTH','other')`,
    [projectId, orgId, otherProjectId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'developer'),
                                                                          ($5,$2,$6,$4,'developer')`,
    [newId(), orgId, projectId, userId, newId(), otherProjectId],
  );

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  process.env['NERV_API_URL'] = `${API_URL}/`;
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const auth = app.get(AuthService);
  const issue = async (project: string, scopes: string[]): Promise<string> =>
    (await auth.issueToken({ projectId: project, userId, name: 'codex', scopes: scopes as never }))
      .token;
  readToken = await issue(projectId, ['spec:read', 'agent-session:launch']);
  narrowToken = await issue(projectId, ['agent-session:launch']);
  otherToken = await issue(otherProjectId, ['spec:read']);
});

afterAll(async () => {
  delete process.env['NERV_API_URL'];
  await app.close();
  await pool.end();
  await db.drop();
});

async function get(
  token: string | null,
  project = 'clemvion',
): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${project}/agents-md`,
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  });
  return { status: res.statusCode, body: res.body, headers: res.headers };
}

const ids = new Map<string, string>();
async function spec(key: string, type: string, parent: string | null, title = `${key} 제목`) {
  ids.set(key, newId());
  await pool.query(
    `INSERT INTO spec (id, project_id, type, key, title, parent_id) VALUES ($1,$2,$3::spec_type,$4,$5,$6)`,
    [ids.get(key), projectId, type, key, title, parent === null ? null : ids.get(parent)],
  );
}
/** 버전 하나를 넣는다 — 승인이면 같은 문서의 앞 승인본은 대체된다(서버의 승인과 같은 모양) */
async function version(key: string, no: number, status: 'draft' | 'approved') {
  if (status === 'approved') {
    await pool.query(
      `UPDATE spec_version SET status = 'superseded' WHERE spec_id = $1 AND status = 'approved'`,
      [ids.get(key)],
    );
  }
  await pool.query(
    `INSERT INTO spec_version (id, spec_id, version_no, status, body_md, content_hash, author_user_id, approved_at)
     VALUES ($1,$2,$3,$4::spec_version_status,$5::text, sha256(convert_to($5::text, 'UTF8')), $6, $7)`,
    [
      newId(),
      ids.get(key),
      no,
      status,
      `# ${key} v${no}`,
      userId,
      status === 'approved' ? new Date() : null,
    ],
  );
}

describe('EP-PRJ-06 — 권한', () => {
  it('인증이 없으면 401 이다', async () => {
    expect((await get(null)).status).toBe(401);
  });

  it('spec:read 가 없는 토큰은 403 이다', async () => {
    expect((await get(narrowToken)).status).toBe(403);
  });

  it('다른 프로젝트에 묶인 토큰으로는 이 프로젝트를 받지 못한다', async () => {
    expect((await get(otherToken)).status).toBe(403);
  });

  it('프로젝트 멤버의 에이전트 토큰은 받는다 — text/markdown 과 규약 버전 헤더', async () => {
    const res = await get(readToken);
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toMatch(/^text\/markdown/);
    expect(res.headers['x-nerv-conventions-version']).toBe(agentsMdVersionOf(res.body));
    expect(String(res.headers['cache-control'])).toContain('no-cache');
  });
});

describe('EP-PRJ-06 — 본문과 규약 버전', () => {
  it('서버 주소 · 프로젝트 키 · 규약 목록을 담고 구역 표시로 감싼다', async () => {
    await spec('CLV-VIS', 'vision', null, '제품 비전');
    await spec('CLV-CONV', 'convention', 'CLV-VIS', '코딩 규약');
    await spec('CLV-CONV-A', 'convention', 'CLV-CONV');
    await spec('CLV-FEAT', 'feature', 'CLV-VIS');
    await version('CLV-VIS', 1, 'approved');
    await version('CLV-CONV', 1, 'approved');
    await version('CLV-CONV-A', 1, 'approved');
    await version('CLV-FEAT', 1, 'approved');

    const { body } = await get(readToken);
    const lines = body.trimEnd().split('\n');
    expect(lines[0]).toBe(AGENTS_MD_BEGIN);
    expect(lines.at(-1)).toBe(AGENTS_MD_END);
    // 주소는 NERV_API_URL 에서 온다 — 끝의 `/` 는 뗀다. 요청의 Host 는 읽지 않는다
    expect(body).toContain('NERV 서버 `https://api.nerv.test` 의 프로젝트 `clemvion`(키 `CLV`)다');
    expect(body).toContain('# NERV — 클렘비온');
    expect(body).toContain('- `CLV-VIS` 제품 비전 — vision · 승인 v1');
    // bootstrap 과 같은 접은 목록이다 — 하위 규약은 꼭대기 한 줄로 접힌다
    expect(body).toContain('- `CLV-CONV` 코딩 규약 — convention · 승인 v1 · 하위 규약 1편');
    expect(body).not.toContain('`CLV-CONV-A`');
    expect(body).not.toContain('CLV-FEAT');
    expect(body).toMatch(
      /출처: nerv:\/\/project\/clemvion\/conventions@v[0-9a-f]{12} · 생성 \d{4}-\d{2}-\d{2}/,
    );
  });

  it('규약 스펙의 승인이 버전을 바꾼다 — 접힌 하위 규약이어도 · 초안과 다른 종류는 바꾸지 않는다', async () => {
    const v0 = agentsMdVersionOf((await get(readToken)).body);
    // 다시 받아도 같다
    expect(agentsMdVersionOf((await get(readToken)).body)).toBe(v0);

    // 초안은 규약이 아니다
    await version('CLV-CONV', 2, 'draft');
    expect(agentsMdVersionOf((await get(readToken)).body)).toBe(v0);
    // 기능 문서의 승인은 규약이 아니다
    await version('CLV-FEAT', 2, 'approved');
    expect(agentsMdVersionOf((await get(readToken)).body)).toBe(v0);

    // 접힌 하위 규약의 승인 — 목록 줄은 그대로지만 규약은 바뀌었다
    await version('CLV-CONV-A', 2, 'approved');
    const v1 = agentsMdVersionOf((await get(readToken)).body);
    expect(v1).not.toBe(v0);

    // 목록에 보이는 규약의 승인 — 줄의 승인 번호도 바뀐다
    await pool.query(`DELETE FROM spec_version WHERE spec_id = $1 AND status = 'draft'`, [
      ids.get('CLV-CONV'),
    ]);
    await version('CLV-CONV', 2, 'approved');
    const res = await get(readToken);
    expect(agentsMdVersionOf(res.body)).not.toBe(v1);
    expect(res.body).toContain('- `CLV-CONV` 코딩 규약 — convention · 승인 v2 · 하위 규약 1편');
  });

  it('규약 스펙을 보관하면 목록에서 빠지고 버전이 바뀐다', async () => {
    const before = agentsMdVersionOf((await get(readToken)).body);
    await pool.query(`UPDATE spec SET archived_at = now() WHERE id = $1`, [ids.get('CLV-CONV')]);
    const res = await get(readToken);
    expect(agentsMdVersionOf(res.body)).not.toBe(before);
    expect(res.body).not.toContain('`CLV-CONV` 코딩 규약');
  });
});
