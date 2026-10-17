// E16-S02 — CI 레시피를 실제 서버에 돌린다 (plugin.md §8 · REQ-PLG-042 ~ 045 · 2026-10-17 사람 결정 D3)
//
// 레시피의 스크립트는 화면이 보여 주는 YAML 안에 있다(`@nerv/schema` ci-recipe.ts). 그 글을 렌더해 스크립트와 환경을
// 꺼내고, GitHub 가 넣어 줄 값(`${{ … }}`)만 이 시험이 넣는다. 서버는 진짜이고 git 저장소도 진짜다 — 판정의 응답
// 필드(`items[].kind · state · reasons · findings[].resolution`)가 바뀌면 레시피가 조용히 통과시키기 때문에, 계약은
// 실물로만 본다. 재시도의 `sleep` 은 PATH 앞의 빈 스크립트로 건너뛴다.

import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CI_GATE_CHECK_NAME, newId, renderCiGateWorkflow } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { ApprovalService } from '../../src/modules/approval/approval.service.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

const BRANCH = 'feat/gate';
const SLUG = 'gatekeep';
const ORG = 'nerv';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let url: string;
let projectId: string;
let userId: string;
let ciToken: string;
let reviewToken: string;
let work: string;
let repo: string;
let stubBin: string;
/** 저장소의 세 커밋 — base 에서 head(PR 브랜치)와 other(다른 브랜치)가 갈라진다 */
const sha = { base: '', head: '', other: '' };
let script: string;
let fixedEnv: Record<string, string>;
let runs = 0;

beforeAll(async () => {
  db = await createScratchDb('nerv_ci_recipe');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });

  const orgId = newId();
  projectId = newId();
  userId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,$2,'NERV')`, [orgId, ORG]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'gate@example.com','게이트','active')`,
    [userId],
  );
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,$3,'GTK','gatekeep')`,
    [projectId, orgId, SLUG],
  );
  // qa — 리뷰를 내고(review:submit) 발견을 처분한다(review:resolve). developer 는 처분 권한이 없다
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'qa')`,
    [newId(), orgId, projectId, userId],
  );

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  url = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  const auth = app.get(AuthService);
  // 레시피가 권하는 모양 — 읽기 권한뿐인 토큰(REQ-PLG-045)
  ciToken = (await auth.issueToken({ projectId, userId, name: 'ci', scopes: ['spec:read'] })).token;
  reviewToken = (
    await auth.issueToken({
      projectId,
      userId,
      name: 'reviewer',
      scopes: ['spec:read', 'review:submit', 'review:resolve'],
    })
  ).token;

  work = mkdtempSync(join(tmpdir(), 'nerv-ci-recipe-'));
  stubBin = join(work, 'bin');
  mkdirSync(stubBin);
  writeFileSync(join(stubBin, 'sleep'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(stubBin, 'sleep'), 0o755);

  repo = join(work, 'repo');
  mkdirSync(repo);
  const git = (...args: string[]): string => {
    const res = spawnSync(
      'git',
      ['-c', 'user.name=ci', '-c', 'user.email=ci@example.com', ...args],
      {
        cwd: repo,
        encoding: 'utf8',
      },
    );
    if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
    return res.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'base');
  sha.base = git('rev-parse', 'HEAD');
  git('checkout', '-q', '-b', BRANCH);
  git('commit', '-q', '--allow-empty', '-m', 'head');
  sha.head = git('rev-parse', 'HEAD');
  git('checkout', '-q', '-b', 'elsewhere', sha.base);
  git('commit', '-q', '--allow-empty', '-m', 'other');
  sha.other = git('rev-parse', 'HEAD');
  git('checkout', '-q', BRANCH);

  const workflow = parse(
    renderCiGateWorkflow({ serverUrl: url, projectSlug: SLUG, orgSlug: ORG }),
  ) as {
    jobs: Record<string, { steps: Array<{ run?: string; env?: Record<string, string> }> }>;
  };
  const step = workflow.jobs[CI_GATE_CHECK_NAME]?.steps.find((s) => s.run !== undefined);
  script = step?.run ?? '';
  // GitHub 가 채우는 값(`${{ … }}`)은 빼고 렌더가 넣은 값만 그대로 쓴다
  fixedEnv = Object.fromEntries(
    Object.entries(step?.env ?? {}).filter(([, value]) => !String(value).includes('${{')),
  );
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
  rmSync(work, { recursive: true, force: true });
});

beforeEach(async () => {
  await pool.query('DELETE FROM resolution');
  await pool.query('DELETE FROM approval');
  await pool.query('DELETE FROM finding_occurrence');
  await pool.query('DELETE FROM finding');
  await pool.query('DELETE FROM reviewer_report');
  await pool.query('UPDATE review_session SET previous_session_id = NULL');
  await pool.query('DELETE FROM review_session');
});

interface GateRun {
  code: number | null;
  out: string;
  summary: string;
}

/**
 * 레시피의 스크립트를 PR 이벤트처럼 돌린다 — `env` 가 GitHub 의 값을 바꾼다.
 *
 * **비동기로 돌린다.** 서버가 이 프로세스 안에 있어서 `spawnSync` 로 기다리면 이벤트 루프가 멈춰 curl 이 답을 받지 못한다.
 */
function runGate(env: Record<string, string> = {}): Promise<GateRun> {
  runs += 1;
  const summary = join(work, `summary-${runs}.md`);
  const child = spawn('bash', ['-c', script], {
    cwd: repo,
    env: {
      PATH: `${stubBin}:${process.env['PATH'] ?? ''}`,
      HOME: process.env['HOME'] ?? work,
      ...fixedEnv,
      NERV_TOKEN: ciToken,
      EVENT_NAME: 'pull_request',
      PR_BRANCH: BRANCH,
      PR_HEAD: sha.head,
      QUEUE_REF: '',
      GH_TOKEN: '',
      GH_API: '',
      GH_REPO: '',
      GITHUB_STEP_SUMMARY: summary,
      ...env,
    },
  });
  let out = '';
  child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString()));
  return new Promise((done) =>
    child.on('close', (code) =>
      done({ code, out, summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '' }),
    ),
  );
}

/** 리뷰 라운드 하나 — 에이전트가 내는 것과 같은 REST(EP-REV-01) */
async function submit(findings: Array<{ severity: string; title: string }> = []): Promise<void> {
  const res = await fetch(`${url}/api/v1/projects/${SLUG}/reviews`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${reviewToken}` },
    body: JSON.stringify({
      branch: BRANCH,
      base_sha: sha.base,
      head_sha: sha.head,
      kind: 'code',
      reviewer: { role: 'code-reviewer', risk: 'low', body_md: '리뷰' },
      findings,
    }),
  });
  expect(res.status).toBeLessThan(300);
}

async function resolveFixed(title: string, commit: string): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM finding WHERE title = $1`, [
    title,
  ]);
  const res = await fetch(`${url}/api/v1/projects/${SLUG}/findings/${rows[0]?.id}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${reviewToken}` },
    body: JSON.stringify({ resolution: 'fixed', rationale: '고쳤다', commit_sha: commit }),
  });
  expect(res.status).toBeLessThan(300);
}

describe('CI 레시피 — PR head 의 판정이 passed · waived 가 아니면 막는다(REQ-PLG-042)', () => {
  it('리뷰가 없으면 막는다 — uncovered', async () => {
    const run = await runGate();
    expect(run.code).toBe(1);
    expect(run.out).toContain('code: uncovered');
    expect(run.summary).toContain('막음');
  });

  it('열린 critical 이 있으면 막고 이유를 체크 결과에 적는다', async () => {
    await submit([{ severity: 'critical', title: '토큰이 로그에 남는다' }]);
    const run = await runGate();
    expect(run.code).toBe(1);
    expect(run.out).toContain('code: pending — open_critical');
    expect(run.summary).toContain('open_critical');
  });

  it('깨끗한 라운드면 통과한다', async () => {
    await submit();
    const run = await runGate();
    expect(run.code).toBe(0);
    expect(run.summary).toContain('code: passed');
    expect(run.summary).toContain('통과');
  });

  it('브랜치 면제는 통과다 — waived', async () => {
    await app.get(ApprovalService).bypass({
      projectId,
      subjectType: 'gate_bypass',
      subjectId: projectId,
      userId,
      reason: '문서만 고친 브랜치다',
      actor: { userId, isAgent: false },
      branch: BRANCH,
      roles: ['admin'],
    });
    const run = await runGate();
    expect(run.code).toBe(0);
    expect(run.summary).toContain('code: waived');
  });

  it('다른 커밋의 라운드는 이 PR 의 판정이 아니다 — head_sha 를 넘긴다', async () => {
    await submit();
    const run = await runGate({ PR_HEAD: sha.other });
    expect(run.code).toBe(1);
    expect(run.out).toContain('code: uncovered');
  });
});

describe('고친 커밋이 이 PR 에 들어 있는가(REQ-PLG-043)', () => {
  it('고쳤다고 적은 커밋이 PR head 의 조상이 아니면 막는다', async () => {
    await submit([{ severity: 'warning', title: '재시도 상한이 없다' }]);
    await resolveFixed('재시도 상한이 없다', sha.other);
    const run = await runGate();
    expect(run.code).toBe(1);
    expect(run.out).toContain(`고친 커밋(${sha.other.slice(0, 7)})이 이 PR 에 없다`);
  });

  it('조상이면 통과한다', async () => {
    await submit([{ severity: 'warning', title: '재시도 상한이 없다' }]);
    await resolveFixed('재시도 상한이 없다', sha.head);
    const run = await runGate();
    expect(run.code).toBe(0);
  });
});

describe('머지 큐 — 큐 커밋이 아니라 그 PR 의 head 로 판정한다(REQ-PLG-044)', () => {
  let github: Server;
  let githubUrl: string;
  const seen: Array<{ path: string; auth: string | undefined }> = [];

  beforeAll(async () => {
    github = createServer((req, res) => {
      seen.push({ path: req.url ?? '', auth: req.headers['authorization'] });
      if (req.url === '/repos/owner/repo/pulls/7') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ number: 7, head: { ref: BRANCH, sha: sha.head } }));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((done) => github.listen(0, '127.0.0.1', done));
    githubUrl = `http://127.0.0.1:${(github.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise((done) => github.close(done));
  });

  it('ref 의 PR 번호로 브랜치와 head 를 찾아 판정한다', async () => {
    await submit();
    const run = await runGate({
      EVENT_NAME: 'merge_group',
      QUEUE_REF: `refs/heads/gh-readonly-queue/main/pr-7-${sha.base}`,
      PR_BRANCH: '',
      PR_HEAD: '',
      GH_API: githubUrl,
      GH_REPO: 'owner/repo',
      GH_TOKEN: 'ghs_test',
    });
    expect(run.out).not.toContain('::error');
    expect(run.code).toBe(0);
    expect(seen).toContainEqual({ path: '/repos/owner/repo/pulls/7', auth: 'Bearer ghs_test' });
  });
});

describe('판정을 받지 못하면 — D-14(REQ-PLG-045)', () => {
  /** 닫힌 포트 — 연결이 바로 거절된다 */
  const dead = 'http://127.0.0.1:9';

  it('NERV 가 답하지 않으면 경고를 남기고 통과시킨다(fail-open)', async () => {
    const run = await runGate({ NERV_URL: dead });
    expect(run.code).toBe(0);
    expect(run.out).toContain('::warning');
    expect(run.summary).toContain('D-14 fail-open');
  });

  it('NERV_GATE_FAIL_CLOSED=1 이면 그때도 막는다', async () => {
    const run = await runGate({ NERV_URL: dead, NERV_GATE_FAIL_CLOSED: '1' });
    expect(run.code).toBe(1);
  });

  it('토큰이 틀려 거절되면(4xx) 늘 막는다 — 설정 오류는 판정 불가가 아니다', async () => {
    const run = await runGate({ NERV_TOKEN: 'nerv_wrong' });
    expect(run.code).toBe(1);
    expect(run.out).toContain('HTTP 401');
  });
});
