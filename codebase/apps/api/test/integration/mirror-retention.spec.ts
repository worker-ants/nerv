// EP-MIR-01·02 md 미러 · 보존 정책 집행 · md 미러 파일 생성
//
// 세 가지가 같은 축을 공유한다: **DB 가 진실이고 파일은 표현이다**(D-09) ·
// **결론은 영구, 재생성 가능한 입력은 TTL**(D-07 · spec-workflow §5.6).

import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EventService } from '../../src/modules/event/event.service.js';
import { ExportJob } from '../../src/worker/jobs/export.job.js';
import { RetentionJob } from '../../src/worker/jobs/retention.job.js';
import { SpecCheckService } from '../../src/modules/spec/spec-check.service.js';
import { SpecRelationService } from '../../src/modules/spec/spec-relation.service.js';
import { SpecCommentService } from '../../src/modules/spec/spec-comment.service.js';
import { AttachmentService } from '../../src/modules/spec/attachment.service.js';
import { SpecService } from '../../src/modules/spec/spec.service.js';
import { ValkeyService } from '../../src/modules/event/valkey.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let specs: SpecService;
let retention: RetentionJob;
let exporter: ExportJob;
let projectId: string;
let userId: string;
let sessionId: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_mirror');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  const drizzleDb = drizzle(pool);
  const silent = {
    publish: async () => false,
    subscribe: async () => undefined,
  } as unknown as ValkeyService;
  const events = new EventService(drizzleDb, silent);
  specs = new SpecService(
    events,
    new SpecCheckService(drizzleDb),
    new SpecRelationService(drizzleDb),
    new SpecCommentService(events, drizzleDb),
    new AttachmentService(null as never, drizzleDb),
    drizzleDb,
  );
  retention = new RetentionJob(drizzleDb);
  exporter = new ExportJob(specs, drizzleDb);
  await seed();
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query('UPDATE spec SET current_version_id = NULL');
  await pool.query('DELETE FROM activity');
  await pool.query('DELETE FROM requirement');
  await pool.query('DELETE FROM spec_version');
  await pool.query('DELETE FROM spec');
  await pool.query('DELETE FROM notification');
  await pool.query('TRUNCATE event');
});

async function approvedSpec(key: string, body: string): Promise<void> {
  const result = await specs.draftUpsert({
    roles: ['planner'],
    projectId,
    key,
    title: key,
    type: 'feature',
    bodyMd: body,
    userId,
  });
  await pool.query(
    `UPDATE spec_version SET status='approved', approved_at=now(), approved_by_user_id=$2,
            edit_lease_user_id=NULL, edit_lease_session_id=NULL, edit_lease_expires_at=NULL
      WHERE id = $1`,
    [result['spec_version_id'], userId],
  );
  await pool.query(`UPDATE spec SET current_version_id=$1 WHERE id=$2`, [
    result['spec_version_id'],
    result['spec_id'],
  ]);
}

describe('EP-MIR-01 — md 미러', () => {
  it('frontmatter 에 출처를 실어 파일이 홀로 서게 한다', async () => {
    await approvedSpec(
      'SPC-CWC-007',
      '# 웹챗 위젯\n\nREQ-CWC-031 WHEN 방문자가 위젯을 열면 THE SYSTEM SHALL 대화를 복원한다',
    );
    const markdown = await specs.mirrorMarkdown({ projectId, specKey: 'SPC-CWC-007' });

    expect(markdown.startsWith('---\n')).toBe(true);
    expect(markdown).toContain('id: SPC-CWC-007');
    expect(markdown).toContain('status: approved');
    expect(markdown).toContain('version: 1');
    // 본문은 원문 그대로다 — 미러가 문서를 다시 쓰지 않는다
    expect(markdown).toContain('# 웹챗 위젯');
  });

  it('requirement ref 목록을 싣는다 — 파일만 봐도 무엇을 약속했는지 안다', async () => {
    await approvedSpec('SPC-REQ-LIST', '# 문서');
    const { rows } = await pool.query<{ id: string; spec_id: string }>(
      `SELECT id, spec_id FROM spec_version ORDER BY created_at DESC LIMIT 1`,
    );
    await pool.query(
      `INSERT INTO requirement (id, project_id, spec_id, ref, statement_md, priority,
                                introduced_in_version_id, current_version_id)
       VALUES ($1,$2,$3,'REQ-AAA-1','문장','must',$4,$4)`,
      [newId(), projectId, rows[0]?.spec_id, rows[0]?.id],
    );
    const markdown = await specs.mirrorMarkdown({ projectId, specKey: 'SPC-REQ-LIST' });
    expect(markdown).toContain('requirements: [REQ-AAA-1]');
  });
});

describe('EP-MIR-02 — llms.txt', () => {
  it('트리 색인을 낸다 — 에이전트의 첫 지도', async () => {
    await approvedSpec('SPC-A', '# A');
    await approvedSpec('SPC-B', '# B');
    const text = await specs.llmsTxt({ projectId, projectName: 'clemvion' });

    expect(text.startsWith('# clemvion')).toBe(true);
    expect(text).toContain('[SPC-A](./specs/SPC-A.md)');
    expect(text).toContain('[SPC-B](./specs/SPC-B.md)');
  });
});

describe('보존 정책 집행 (spec-workflow §5.6)', () => {
  it('오래된 Activity 원문만 지운다 — 세션 요약은 영구다 (D-07)', async () => {
    // activity 는 월 파티션이다 — 과거 데이터를 넣으려면 그 달의 파티션이 있어야 한다.
    // 운영에서는 시간이 지나며 만들어지지만 테스트는 명시적으로 만든다(§2.14).
    await pool.query(
      `SELECT nerv_ensure_month_partitions((current_date - interval '200 days')::date)`,
    );
    await pool.query(
      `INSERT INTO activity (id, session_id, project_id, seq, type, title, created_at)
       VALUES ($1,$2,$3,1,'action','오래된 것', now() - interval '200 days'),
              ($4,$2,$3,2,'action','최근 것', now())`,
      [newId(), sessionId, projectId, newId()],
    );

    const report = await retention.run();
    expect(report.activities_deleted).toBe(1);

    const { rows } = await pool.query<{ title: string }>(`SELECT title FROM activity`);
    expect(rows.map((r) => r.title)).toEqual(['최근 것']);

    // 세션 자체는 남는다 — "무엇을 했나"의 결론은 버리지 않는다
    const { rows: sessions } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM agent_session`,
    );
    expect(sessions[0]?.n).toBe(1);
  });

  it('프로젝트 정책이 기본값을 덮는다 — 규제 요건은 프로젝트마다 다르다', async () => {
    await pool.query(
      `SELECT nerv_ensure_month_partitions((current_date - interval '2 days')::date)`,
    );
    await pool.query(`UPDATE project SET retention = '{"activity_days": 1}'::jsonb WHERE id = $1`, [
      projectId,
    ]);
    await pool.query(
      `INSERT INTO activity (id, session_id, project_id, seq, type, title, created_at)
       VALUES ($1,$2,$3,3,'action','이틀 전', now() - interval '2 days')`,
      [newId(), sessionId, projectId],
    );

    const report = await retention.run();
    expect(report.activities_deleted).toBe(1);
    await pool.query(`UPDATE project SET retention = '{}'::jsonb WHERE id = $1`, [projectId]);
  });

  it('정책이 깨져 있어도 잡이 멈추지 않는다 — 오타 하나가 보존 전체를 멈추면 안 된다', async () => {
    await pool.query(`UPDATE project SET retention = '{"activity_dayz": 1}'::jsonb WHERE id = $1`, [
      projectId,
    ]);
    const report = await retention.run();
    expect(report.projects_scanned).toBe(1);
    await pool.query(`UPDATE project SET retention = '{}'::jsonb WHERE id = $1`, [projectId]);
  });
});

describe('md 미러 파일 생성 (export.job)', () => {
  it('경로가 없으면 아무것도 하지 않는다 — 임의 위치에 파일을 흩뿌리지 않는다', async () => {
    delete process.env['NERV_EXPORT_DIR'];
    const report = await exporter.run();
    expect(report.files).toBe(0);
    expect(report.skipped).toContain('미설정');
  });

  it('승인된 스펙만 파일로 나간다 — draft 가 승인된 것처럼 읽히면 안 된다', async () => {
    await approvedSpec('SPC-PUB', '# 공개 문서');
    await specs.draftUpsert({
      roles: ['planner'],
      projectId,
      key: 'SPC-DRAFT',
      title: 'draft',
      type: 'feature',
      bodyMd: '# 아직 초안',
      userId,
    });

    const dir = mkdtempSync(join(tmpdir(), 'nerv-export-'));
    process.env['NERV_EXPORT_DIR'] = dir;
    try {
      const report = await exporter.run();
      expect(report.files).toBeGreaterThanOrEqual(2); // llms.txt + 승인 스펙

      expect(existsSync(join(dir, 'clemvion/specs/SPC-PUB.md'))).toBe(true);
      expect(existsSync(join(dir, 'clemvion/specs/SPC-DRAFT.md'))).toBe(false);
      expect(readFileSync(join(dir, 'clemvion/llms.txt'), 'utf8')).toContain('SPC-PUB');
    } finally {
      delete process.env['NERV_EXPORT_DIR'];
    }
  });
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  userId = newId();
  sessionId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'a@example.com','A','active')`,
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
  await pool.query(
    `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state)
     VALUES ($1,$2,$3,'claude-code','mac-07','complete')`,
    [sessionId, projectId, userId],
  );
}
