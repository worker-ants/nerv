// 부하 시험 본체 — 준비 → 부하 → 판정 (E21-S04 · NFR-02 · NFR-04 · 성공 기준 2-7)
//
// 한 번의 실행이 세 가지를 잰다.
//   ① 보드 반영 — 세션이 상태 전이(클레임 · 놓기)를 요청한 때부터 그 프로젝트를 보는 **모든** 소켓이 이벤트를
//      받을 때까지. 같은 프로세스의 시계 하나로 재므로 시계 차이가 없다. 성공 기준 0-5 를 재는 수단이기도 하다
//   ② 게이트 판정 — 세션의 push 훅과 프로젝트 CI 가 부르는 EP-REV-08 의 응답 시간
//   ③ 커버리지 질의 — 대시보드를 여는 사람이 부르는 EP-COV-01 의 응답 시간. 같은 화면이 함께 부르는 셋(프로젝트 ·
//      세션 · 작업)의 시간도 남긴다 — "페이지 로드를 막지 않는다" 를 판정 밖에서도 볼 수 있게
//
// 부하를 거는 쪽도 한 프로세스라서 그 이벤트 루프가 밀리면 지연이 부풀려진다. 그래서 루프 지연을 함께 남긴다 —
// 판정이 실패했는데 루프 지연도 크면 서버가 아니라 시험 도구를 먼저 의심한다.

import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { NERV_EVENT, RATE_LIMIT_INGEST_PER_MIN, WS_ERROR_EVENT } from '@nerv/schema';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { LOAD_THRESHOLDS } from './profile.js';
import type { LoadProfile } from './profile.js';
import { probeOutcome, summarize, verdict } from './stats.js';
import type { BoardProbe, Summary, Verdict } from './stats.js';
import { Target } from './target.js';

/** 세션 토큰의 권한 — 클레임 · 하트비트 · 놓기 · 리뷰 제출 · 판정 조회 */
const SESSION_SCOPES = ['spec:read', 'task:claim', 'task:update', 'review:submit'];
/** 프로젝트 준비 · CI 토큰의 권한 — 임포트는 admin + `import:write` 다(EP-IMP-02) */
const ADMIN_SCOPES = ['spec:read', 'task:claim', 'task:update', 'review:submit', 'import:write'];

/** 끝난 뒤 늦게 오는 이벤트를 기다리는 시간 — 보드 기준(5초)의 두 배 */
const GRACE_MS = LOAD_THRESHOLDS.boardMs * 2;

interface Project {
  id: string;
  slug: string;
  adminToken: string;
  sockets: number;
  sessions: Session[];
}

interface Session {
  index: number;
  project: Project;
  token: string;
  externalId: string;
  sessionId: string;
  branch: string;
  /** 마지막으로 리뷰를 낸 커밋 — CI 가 그 커밋의 판정을 묻는다 */
  lastHead: string | null;
}

export interface LoadResult {
  verdicts: Verdict[];
  info: Record<string, Summary>;
  probes: { total: number; ok: number; missing: number; aborted: number };
  errors: Record<string, number>;
  errorBodies: Record<string, string>;
  eventLoopP99Ms: number;
  report: string;
}

const sha = (): string => randomBytes(20).toString('hex');
const pad = (n: number): string => String(n + 1).padStart(2, '0');
const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)] as T;

/** 응답 본문에서 목록을 꺼낸다 — 봉투(`{ items }`)와 맨 배열을 모두 받는다 */
function itemsOf(body: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
  const items = (body as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? (items as Array<Record<string, unknown>>) : [];
}

class Recorder {
  readonly samples = new Map<string, number[]>();
  readonly errors = new Map<string, number>();
  /** 실패마다 처음 받은 응답 본문 — 400 이 쌓이면 무엇이 틀렸는지 결과 파일에서 바로 본다 */
  readonly firstBodies = new Map<string, string>();

  add(name: string, ms: number): void {
    const list = this.samples.get(name) ?? [];
    list.push(ms);
    this.samples.set(name, list);
  }

  /** 기대한 상태가 아니면 이름 · 상태로 센다 — 429 가 섞이면 부하가 아니라 한도를 잰 것이다 */
  fail(name: string, status: number | string, body?: unknown): void {
    const key = `${name} ${status}`;
    this.errors.set(key, (this.errors.get(key) ?? 0) + 1);
    if (body !== undefined && !this.firstBodies.has(key)) {
      this.firstBodies.set(key, JSON.stringify(body).slice(0, 500));
    }
  }

  values(name: string): number[] {
    return this.samples.get(name) ?? [];
  }
}

class Board {
  readonly all: BoardProbe[] = [];
  private readonly latest = new Map<string, BoardProbe & { projectId: string }>();

  /** 요청을 보내기 **직전**에 건다 — 응답보다 이벤트가 먼저 올 수 있다 */
  expect(project: Project, type: string, subjectId: string): BoardProbe {
    const probe = {
      projectId: project.id,
      sentAt: performance.now(),
      aborted: false,
      expected: project.sockets,
      received: new Map<number, number>(),
    };
    this.latest.set(`${type}:${subjectId}`, probe);
    this.all.push(probe);
    return probe;
  }

  receive(
    socket: number,
    envelope: { type?: string; subject_id?: string; project_id?: string },
  ): void {
    const probe = this.latest.get(`${envelope.type}:${envelope.subject_id}`);
    if (probe === undefined || probe.projectId !== envelope.project_id) return;
    if (!probe.received.has(socket)) probe.received.set(socket, performance.now());
  }
}

export async function runLoad(
  profile: LoadProfile,
  log: (line: string) => void = console.log,
): Promise<LoadResult> {
  if (profile.hooksPerMin >= RATE_LIMIT_INGEST_PER_MIN) {
    throw new Error(
      `세션당 훅 ${profile.hooksPerMin}/분은 수집 한도(${RATE_LIMIT_INGEST_PER_MIN}/분) 이상입니다`,
    );
  }
  const target = new Target(profile.url);
  const rec = new Recorder();
  const board = new Board();
  const loop = monitorEventLoopDelay({ resolution: 20 });
  const tokenIds: string[] = [];
  const sockets: Socket[] = [];

  // ── 준비 ────────────────────────────────────────────────────────────────
  await target.signIn(profile.email, profile.password);
  const runId = Date.now().toString(36);
  const orgSlug = `load-${runId}`;
  await target.ok('POST', '/api/v1/orgs', { body: { slug: orgSlug, name: `부하 시험 ${runId}` } });
  target.org = orgSlug;
  log(
    `준비: 조직 ${orgSlug} — 프로젝트 ${profile.projects} · 세션 ${profile.sessions} · 소켓 ${profile.sockets}`,
  );

  const issue = async (project: string, name: string, scopes: string[]): Promise<string> => {
    const body = await target.ok<{ id?: string; token?: string }>('POST', '/api/v1/me/tokens', {
      body: { project, org: orgSlug, name, scopes },
    });
    if (body.id !== undefined) tokenIds.push(body.id);
    if (body.token === undefined) throw new Error('토큰 발급 응답에 token 이 없습니다');
    return body.token;
  };

  const projects: Project[] = [];
  for (let p = 0; p < profile.projects; p += 1) {
    const slug = `load-${pad(p)}`;
    const created = await target.ok<{ id: string }>('POST', `/api/v1/orgs/${orgSlug}/projects`, {
      body: { slug, key: `L${pad(p)}`, name: `부하 ${pad(p)}` },
    });
    projects.push({
      id: created.id,
      slug,
      adminToken: await issue(slug, 'load-admin', ADMIN_SCOPES),
      sockets: 0,
      sessions: [],
    });
  }

  for (const project of projects) await seedProject(target, profile, project);

  const sessions: Session[] = [];
  for (let s = 0; s < profile.sessions; s += 1) {
    const project = projects[s % projects.length] as Project;
    const session: Session = {
      index: s,
      project,
      token: await issue(project.slug, `load-session-${pad(s)}`, SESSION_SCOPES),
      externalId: randomUUID(),
      sessionId: '',
      branch: `load/s${pad(s)}`,
      lastHead: null,
    };
    const started = await target.ok<{ session_id?: string }>('POST', '/ingest/hooks/session', {
      token: session.token,
      headers: hookHeaders(session),
      body: { session_id: session.externalId, cwd: `/load/s${pad(s)}` },
    });
    if (started.session_id === undefined)
      throw new Error('세션 시작 훅 응답에 session_id 가 없습니다');
    session.sessionId = started.session_id;
    project.sessions.push(session);
    sessions.push(session);
  }

  for (let s = 0; s < profile.sockets; s += 1) {
    const project = projects[s % projects.length] as Project;
    sockets.push(await openSocket(profile.url, target.sessionCookie, project, s, board));
  }
  log(
    `준비 끝: 작업 ${projects.length * Math.ceil(profile.sessions / projects.length) * profile.tasksPerSession}개 안팎 · 소켓 ${sockets.length}개 연결`,
  );

  // ── 부하 ────────────────────────────────────────────────────────────────
  loop.enable();
  const endAt = performance.now() + profile.durationSec * 1000;
  const running = (): boolean => performance.now() < endAt;
  const progress = setInterval(() => {
    const left = Math.max(0, Math.round((endAt - performance.now()) / 1000));
    log(
      `  … 남은 ${left}초 · 탐침 ${board.all.length} · 판정 ${rec.values('gate').length} · 커버리지 ${rec.values('coverage').length}`,
    );
  }, 60_000);

  const workers: Array<Promise<void>> = [];
  for (const session of sessions) {
    workers.push(hookLoop(target, profile, session, rec, running));
    workers.push(claimLoop(target, profile, session, rec, board, running));
  }
  for (const project of projects) workers.push(ciLoop(target, profile, project, rec, running));
  for (let v = 0; v < profile.viewers; v += 1)
    workers.push(viewerLoop(target, profile, projects, rec, running));
  await Promise.all(workers);
  clearInterval(progress);
  loop.disable();
  await sleep(GRACE_MS);

  // ── 판정 ────────────────────────────────────────────────────────────────
  const latencies: number[] = [];
  let missing = 0;
  let aborted = 0;
  for (const probe of board.all) {
    const outcome = probeOutcome(probe);
    if (outcome === null) aborted += 1;
    else if (outcome.kind === 'ok') latencies.push(outcome.latencyMs);
    else missing += 1;
  }

  const verdicts = [
    verdict('보드 반영(NFR-02)', LOAD_THRESHOLDS.boardMs, latencies, missing),
    verdict('게이트 판정(2-7)', LOAD_THRESHOLDS.gateMs, rec.values('gate')),
    verdict('커버리지 질의(D6)', LOAD_THRESHOLDS.coverageMs, rec.values('coverage')),
  ];
  const info: Record<string, Summary> = {};
  for (const name of ['page', 'ingest', 'claim', 'heartbeat', 'review', 'release']) {
    info[name] = summarize(rec.values(name));
  }
  const result: LoadResult = {
    verdicts,
    info,
    probes: { total: board.all.length, ok: latencies.length, missing, aborted },
    errors: Object.fromEntries(rec.errors),
    errorBodies: Object.fromEntries(rec.firstBodies),
    eventLoopP99Ms: Math.round(loop.percentile(99) / 1e6),
    report: resolve(profile.report),
  };

  for (const socket of sockets) socket.disconnect();
  if (profile.cleanup) await cleanup(target, projects, sessions, tokenIds);

  mkdirSync(dirname(result.report), { recursive: true });
  const { password: _password, ...shown } = profile;
  writeFileSync(
    result.report,
    `${JSON.stringify({ at: new Date().toISOString(), org: orgSlug, profile: shown, ...result }, null, 2)}\n`,
  );
  printResult(result, log);
  return result;
}

/** 훅 수집이 세션을 알아보는 헤더 — 플러그인의 포워더가 싣는 것과 같다 */
function hookHeaders(session: Session): Record<string, string> {
  return {
    'x-nerv-host': `load-host-${pad(session.index)}`,
    'x-nerv-agent': 'claude-code',
    'x-nerv-branch': session.branch,
  };
}

/** 프로젝트 하나의 데이터 — 승인된 스펙과 요구사항(임포트) · `ready` 작업 */
async function seedProject(target: Target, profile: LoadProfile, project: Project): Promise<void> {
  const items: Array<Record<string, unknown>> = [
    {
      source_path: 'load/area.md',
      key: 'LOAD',
      type: 'area',
      title: '부하 영역',
      body_md: '# 부하 영역\n',
      doc_status: 'approved',
      sort_key: '0',
    },
  ];
  for (let f = 0; f < profile.specsPerProject; f += 1) {
    const requirements = Array.from({ length: profile.requirementsPerSpec }, (_, r) => ({
      ref: `REQ-F${pad(f)}-${String(r + 1).padStart(3, '0')}`,
      text: `WHEN 사용자가 ${r + 1}번 동작을 하면, THE SYSTEM SHALL 결과를 기록한다`,
      ordinal: r,
    }));
    items.push({
      source_path: `load/f${pad(f)}.md`,
      key: `LOAD-F${pad(f)}`,
      parent_key: 'LOAD',
      type: 'feature',
      title: `기능 ${pad(f)}`,
      body_md: `# 기능 ${pad(f)}\n\n${requirements.map((r) => `- ${r.ref} ${r.text}`).join('\n')}\n`,
      doc_status: 'approved',
      sort_key: pad(f),
      requirements,
    });
  }
  await target.ok('POST', `/api/v1/projects/${project.slug}/import/specs`, {
    token: project.adminToken,
    body: { profile: 'load', kind: 'document', items },
  });

  const perProject = Math.ceil(profile.sessions / profile.projects) * profile.tasksPerSession;
  for (let t = 0; t < perProject; t += 1) {
    const task = await target.ok<{ id?: string; task_id?: string }>(
      'POST',
      `/api/v1/projects/${project.slug}/tasks`,
      {
        token: project.adminToken,
        body: {
          title: `부하 작업 ${t + 1}`,
          body_md: '부하 시험이 만든 작업이다.',
          goal_md: '클레임과 리뷰를 반복한다.',
          output_format_md: '리뷰 라운드 하나.',
          tools_sources_md: '부하 시험 스크립트.',
          boundaries_md: '실제 코드는 바꾸지 않는다.',
        },
      },
    );
    const taskId = task.id ?? task.task_id;
    if (taskId === undefined) throw new Error('작업 생성 응답에 id 가 없습니다');
    await target.ok('POST', `/api/v1/projects/${project.slug}/tasks/${taskId}/transition`, {
      token: project.adminToken,
      body: { status: 'ready' },
    });
  }
}

async function openSocket(
  url: string,
  cookie: string,
  project: Project,
  index: number,
  board: Board,
): Promise<Socket> {
  const socket = io(url, {
    path: '/ws',
    transports: ['websocket'],
    extraHeaders: { cookie, origin: url },
    reconnection: true,
  });
  socket.onAny(
    (_name: string, envelope: { type?: string; subject_id?: string; project_id?: string }) =>
      board.receive(index, envelope ?? {}),
  );
  const room = `project:${project.id}`;
  const join = (): Promise<void> =>
    new Promise((done, fail) => {
      socket.emit('join', { room }, (ack: { ok?: boolean; code?: string }) =>
        ack?.ok === true ? done() : fail(new Error(`룸 참가 거절: ${ack?.code ?? '응답 없음'}`)),
      );
    });
  // 재연결하면 룸을 다시 잡는다 — 웹 클라이언트와 같다(lib/ws.ts)
  socket.on('connect', () => void join().catch(() => undefined));
  await new Promise<void>((done, fail) => {
    let reason = '응답 없음';
    socket.on('connect_error', (error: Error) => (reason = `connect_error ${error.message}`));
    socket.on(
      WS_ERROR_EVENT,
      (body: { code?: string }) => (reason = `${WS_ERROR_EVENT} ${body?.code ?? ''}`),
    );
    // 핸들러가 던지면 ack 대신 이것이 온다 — 그때 join 은 끝내 답하지 않는다
    socket.on(
      'exception',
      (body: unknown) => (reason = `exception ${JSON.stringify(body).slice(0, 200)}`),
    );
    const timer = setTimeout(() => fail(new Error(`소켓 연결 시간 초과 — ${reason}`)), 15_000);
    socket.once('connect', () => {
      join().then(
        () => {
          clearTimeout(timer);
          done();
        },
        (error: unknown) => {
          clearTimeout(timer);
          fail(error);
        },
      );
    });
  });
  project.sockets += 1;
  return socket;
}

/** PostToolUse 훅 — 세션당 분당 `hooksPerMin` 건. 보드는 움직이지 않지만 수집 경로의 부하다 */
async function hookLoop(
  target: Target,
  profile: LoadProfile,
  session: Session,
  rec: Recorder,
  running: () => boolean,
): Promise<void> {
  const every = 60_000 / profile.hooksPerMin;
  await sleep(Math.random() * every);
  let n = 0;
  while (running()) {
    n += 1;
    const res = await target
      .request('POST', '/ingest/hooks/tool', {
        token: session.token,
        headers: hookHeaders(session),
        body: {
          session_id: session.externalId,
          tool_name: 'Edit',
          tool_input: { file_path: `src/s${pad(session.index)}/f${n % 20}.ts` },
          tool_response: { success: true },
        },
      })
      .catch(() => null);
    if (res === null) rec.fail('ingest', 'network');
    else if (res.status !== 202) rec.fail('ingest', res.status, res.body);
    else rec.add('ingest', res.ms);
    await sleep(every);
  }
}

/**
 * 클레임 한 바퀴 — 잡기(★task.claimed) → 하트비트 → 리뷰 제출 → push 훅의 게이트 판정 → 놓기(★claim.released).
 * 별표 둘이 보드 반영 탐침이다.
 */
async function claimLoop(
  target: Target,
  profile: LoadProfile,
  session: Session,
  rec: Recorder,
  board: Board,
  running: () => boolean,
): Promise<void> {
  const base = `/api/v1/projects/${session.project.slug}`;
  const cycleMs = profile.cycleSec * 1000;
  await sleep(Math.random() * cycleMs);
  while (running()) {
    const cycleEnd = performance.now() + cycleMs;
    const next = await target
      .request(`GET`, `${base}/tasks/next?limit=10`, { token: session.token })
      .catch(() => null);
    const candidates = next !== null && next.status === 200 ? itemsOf(next.body) : [];
    let taskId: string | null = null;
    let claimId: string | null = null;
    for (const candidate of candidates.sort(() => Math.random() - 0.5)) {
      const id = String(candidate['id'] ?? '');
      if (id === '') continue;
      const probe = board.expect(session.project, NERV_EVENT.TASK_CLAIMED, id);
      const res = await target
        .request<{ claimId?: string; claim_id?: string }>('POST', `${base}/tasks/${id}/claim`, {
          token: session.token,
          body: {
            session_id: session.sessionId,
            scope: { file_globs: [`src/s${pad(session.index)}/**`] },
          },
        })
        .catch(() => null);
      if (res !== null && res.status >= 200 && res.status < 300) {
        rec.add('claim', res.ms);
        taskId = id;
        claimId = res.body.claimId ?? res.body.claim_id ?? null;
        break;
      }
      probe.aborted = true;
      // 다른 세션이 먼저 잡은 것(409)은 정상이다 — 같은 큐를 여럿이 본다
      if (res === null) rec.fail('claim', 'network');
      else if (res.status !== 409) rec.fail('claim', res.status, res.body);
    }
    if (taskId === null || claimId === null) {
      await sleep(5_000);
      continue;
    }

    // 하트비트 — 한 바퀴의 절반 동안 10초마다
    while (running() && performance.now() < cycleEnd - cycleMs / 2) {
      await sleep(10_000);
      const beat = await target
        .request('POST', `${base}/claims/${claimId}/heartbeat`, {
          token: session.token,
          body: { progress: 'load' },
        })
        .catch(() => null);
      if (beat === null) rec.fail('heartbeat', 'network');
      else if (beat.status >= 300) rec.fail('heartbeat', beat.status, beat.body);
      else rec.add('heartbeat', beat.ms);
    }

    const head = sha();
    const review = await target
      .request('POST', `${base}/reviews`, {
        token: session.token,
        body: {
          branch: session.branch,
          base_sha: sha(),
          head_sha: head,
          changeset: [`src/s${pad(session.index)}/a.ts`],
          kind: 'code',
          task_id: taskId,
          session_id: session.sessionId,
          reviewer: { role: 'code-reviewer', risk: 'low', body_md: '부하 시험 리뷰' },
          summary: '부하 시험 리뷰',
          findings: [],
        },
      })
      .catch(() => null);
    if (review === null) rec.fail('review', 'network');
    else if (review.status >= 300) rec.fail('review', review.status, review.body);
    else {
      rec.add('review', review.ms);
      session.lastHead = head;
    }

    await gateCheck(target, session, rec);

    const probe = board.expect(session.project, NERV_EVENT.CLAIM_RELEASED, claimId);
    const release = await target
      .request('POST', `${base}/claims/${claimId}/release`, {
        token: session.token,
        body: { reason: 'handoff', state_note: '부하 시험 — 한 바퀴를 끝냈다' },
      })
      .catch(() => null);
    if (release === null || release.status >= 300) {
      probe.aborted = true;
      rec.fail('release', release?.status ?? 'network', release?.body);
    } else rec.add('release', release.ms);

    const rest = cycleEnd - performance.now();
    if (rest > 0 && running()) await sleep(rest);
  }
}

/** EP-REV-08 — CI 레시피처럼 브랜치와 PR head 를 넘긴다 */
async function gateCheck(target: Target, session: Session, rec: Recorder): Promise<void> {
  if (session.lastHead === null) return;
  const query = new URLSearchParams({ branch: session.branch, head_sha: session.lastHead });
  const res = await target
    .request(
      'GET',
      `/api/v1/projects/${session.project.slug}/gates/reviews/check?${query.toString()}`,
      {
        token: session.project.adminToken,
      },
    )
    .catch(() => null);
  if (res === null) rec.fail('gate', 'network');
  else if (res.status !== 200) rec.fail('gate', res.status, res.body);
  else rec.add('gate', res.ms);
}

/** 프로젝트 CI — `ciEverySec` 마다 그 프로젝트의 한 브랜치를 묻는다 */
async function ciLoop(
  target: Target,
  profile: LoadProfile,
  project: Project,
  rec: Recorder,
  running: () => boolean,
): Promise<void> {
  const every = profile.ciEverySec * 1000;
  await sleep(Math.random() * every);
  while (running()) {
    const ready = project.sessions.filter((s) => s.lastHead !== null);
    if (ready.length > 0) await gateCheck(target, pick(ready), rec);
    await sleep(every);
  }
}

/** 대시보드를 여는 사람 — 커버리지 화면이 함께 부르는 넷을 동시에 보낸다 */
async function viewerLoop(
  target: Target,
  profile: LoadProfile,
  projects: readonly Project[],
  rec: Recorder,
  running: () => boolean,
): Promise<void> {
  const every = profile.viewEverySec * 1000;
  await sleep(Math.random() * every);
  while (running()) {
    const base = `/api/v1/projects/${pick(projects).slug}`;
    const started = performance.now();
    const calls = await Promise.all(
      [`${base}/coverage`, base, `${base}/sessions`, `${base}/tasks`].map((path) =>
        target.request('GET', path).catch(() => null),
      ),
    );
    const [coverage, ...page] = calls;
    if (coverage === null || coverage === undefined) rec.fail('coverage', 'network');
    else if (coverage.status !== 200) rec.fail('coverage', coverage.status, coverage.body);
    else rec.add('coverage', coverage.ms);
    if (page.every((res) => res !== null && res.status === 200))
      rec.add('page', performance.now() - started);
    else rec.fail('page', page.map((res) => res?.status ?? 'network').join('/'));
    await sleep(every);
  }
}

/** 만든 것을 거둔다 — 세션 종료 · 토큰 폐기 · 프로젝트 보관(지우지 않는다 · EP-PRJ-05) */
async function cleanup(
  target: Target,
  projects: readonly Project[],
  sessions: readonly Session[],
  tokenIds: readonly string[],
): Promise<void> {
  for (const session of sessions) {
    await target
      .request('POST', '/ingest/hooks/session-end', {
        token: session.token,
        headers: hookHeaders(session),
        body: { session_id: session.externalId, reason: 'other' },
      })
      .catch(() => undefined);
  }
  for (const id of tokenIds)
    await target.request('DELETE', `/api/v1/me/tokens/${id}`).catch(() => undefined);
  for (const project of projects) {
    await target.request('POST', `/api/v1/projects/${project.slug}/archive`).catch(() => undefined);
  }
}

function printResult(result: LoadResult, log: (line: string) => void): void {
  const fmt = (v: number | null): string => (v === null ? '—' : `${Math.round(v)}ms`);
  log('');
  log('판정                     기준      n      p50     p95     p99     max    결과');
  for (const v of result.verdicts) {
    const s = v.summary;
    log(
      `${v.name.padEnd(22)} ${String(v.limitMs).padStart(6)}ms ${String(s.n).padStart(6)} ${fmt(s.p50).padStart(8)} ${fmt(s.p95).padStart(7)} ${fmt(s.p99).padStart(7)} ${fmt(s.max).padStart(7)}    ${v.pass ? '통과' : '실패'}${v.missing > 0 ? ` (받지 못함 ${v.missing})` : ''}`,
    );
  }
  log('');
  for (const [name, s] of Object.entries(result.info)) {
    log(`  ${name.padEnd(10)} n=${s.n} p50=${fmt(s.p50)} p95=${fmt(s.p95)} max=${fmt(s.max)}`);
  }
  log(
    `  탐침 ${result.probes.total}(받음 ${result.probes.ok} · 받지 못함 ${result.probes.missing} · 요청 실패 ${result.probes.aborted})`,
  );
  log(`  시험 도구의 이벤트 루프 지연 p99 ${result.eventLoopP99Ms}ms`);
  const errors = Object.entries(result.errors);
  log(
    errors.length === 0
      ? '  실패한 요청 없음'
      : `  실패한 요청: ${errors.map(([k, n]) => `${k}×${n}`).join(' · ')}`,
  );
  for (const [key, body] of Object.entries(result.errorBodies)) log(`    ${key}: ${body}`);
  log(`  결과 파일: ${result.report}`);
}
