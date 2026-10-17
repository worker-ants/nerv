// `nerv replay` — 리뷰 회귀 코퍼스 리플레이 (importer.md §3.8 · 로드맵 §4.5 · 2026-10-17 · 사람 결정 D5 · E16-S03 · REQ-IMP-036 ~ 038)
//
// clemvion 의 과거 리뷰 세션 디렉터리를 서버의 게이트 판정에 다시 돌려 정답 라벨과 견준다 — 성공 기준 2-2(forced 리뷰어 미충족
// 160/160 · 오탐 0)와 2-3(CRITICAL → `BLOCK: NO` 하향 24/24).
//
// **임포터를 쓰지 않는다**(D5). review 임포터는 결론(`SUMMARY.md` 의 발견 표)만 옮기고 역할별 md 는 옮기지 않는다 — 그래서 「체커는
// CRITICAL 인데 SUMMARY 는 `BLOCK: NO`」를 볼 수 없다. 이 명령은 역할별 md 에서 **역할과 그 역할의 CRITICAL 줄만** 읽어 역할마다
// 리뷰 제출(EP-REV-01)로 보내고, 게이트 판정(EP-REV-08)이 돌려준 것으로 판정한다. 대상은 **일회용 프로젝트**다 — 리플레이가 만든
// 라운드와 발견은 그 프로젝트와 함께 버린다(이 명령은 지우지 않는다).
//
// **필수 역할은 세션마다 `meta.json` 의 `agents_forced` 다**(D5 · 2026-10-17 — 고정된 역할 목록은 근거를 찾지 못했다). 서버의 정책
// (`review_roles`)은 프로젝트에 하나라 세션마다 바꿀 수 없다. 그래서 미충족 판정은 서버가 기록한 「보고한 역할」(`roles.reported`)과
// 그 세션의 `agents_forced` 를 견준다. 정책이 그 세션의 목록과 같으면 서버 자신의 `missing_roles` 와 어긋나는지도 센다 — 어긋나면
// 서버 판정의 결함이다.
//
// 종료 코드는 임포터와 같은 어휘다 — `0` 두 기준 모두 라벨과 같음 · `1` 놓친 것이나 오탐이 있음 · `2` 중단(읽지 못함 · 서버 오류).

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { t } from '../i18n.js';

export interface ReplayOptions {
  /** clemvion 체크아웃 — 그 아래 `review/<kind>/YYYY/MM/DD/HH_MM_SS/` 를 훑는다 */
  root: string;
  /** 정답 라벨 JSON(아래 `ReplayLabels`) */
  labels: string;
  project: string;
  org: string | null;
  server: string;
  token: string;
  /** 체크아웃이 이 커밋이어야 한다(2026-07-17 전수 조사 시점) — 다르면 중단한다 */
  expectSha: string | null;
  json: boolean;
}

/**
 * 정답 라벨 — 경로는 `root` 기준 세션 디렉터리(`review/code/2026/07/01/12_00_00`). 모집단을 주지 않으면 훑은 세션 전부가
 * 모집단이다. 2-2 는 커밋된 575 세션, 2-3 은 732 세션이 모집단이다(로드맵 §4.5).
 */
export interface ReplayLabels {
  forced_unmet: string[];
  verdict_downgrade: string[];
  forced_population?: string[];
  downgrade_population?: string[];
}

export type Risk = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface RoleReport {
  role: string;
  risk: Risk;
  /** 그 역할이 `[CRITICAL]` 로 적은 줄 — 발견의 제목이 된다 */
  criticals: string[];
}

export interface ReplaySession {
  path: string;
  kind: string;
  forced: string[];
  roles: RoleReport[];
  /** `SUMMARY.md` 가 `**BLOCK: YES**` 로 막았는가 */
  summaryBlocks: boolean;
}

/** 역할 md 가 아닌 파일 — 세션 디렉터리의 다른 산출물이다(importer.md §2.7) */
const NOT_ROLE = new Set(['SUMMARY.md', 'RESOLUTION.md', 'README.md']);
const SESSION_DIR = /^review\/([a-z_]+)\/\d{4}\/\d{2}\/\d{2}\/\d{2}_\d{2}_\d{2}$/;

/** `### 위험도` 다음의 첫 낱말 — 역할 리포트 말미의 형식(clemvion-analysis.md §5 표) */
export function parseRoleReport(role: string, markdown: string): RoleReport {
  const lines = markdown.split('\n');
  let risk: Risk = 'low';
  for (let i = 0; i < lines.length; i += 1) {
    if (/^#{2,4}\s*위험도/.test(lines[i] ?? '')) {
      const next = `${lines[i + 1] ?? ''} ${lines[i + 2] ?? ''}`;
      const found = /(NONE|LOW|MEDIUM|HIGH|CRITICAL)/i.exec(next);
      if (found !== null) risk = found[1]!.toLowerCase() as Risk;
    }
  }
  const criticals = lines
    .filter((line) => /\[CRITICAL\]/i.test(line))
    .map((line) =>
      line
        .replace(/^[\s*>|#-]+/, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200),
    )
    .filter((line) => line !== '');
  return { role, risk, criticals };
}

function readJson(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 세션 디렉터리 하나를 읽는다 — 역할 md 는 그 디렉터리 바로 아래의 `*.md` 다(`_prompts/` 는 보지 않는다) */
export function readSession(root: string, path: string): ReplaySession | null {
  const match = SESSION_DIR.exec(path);
  if (match === null) return null;
  const dir = join(root, path);
  const meta = readJson(join(dir, 'meta.json'));
  const forcedRaw = meta['agents_forced'];
  const forced = Array.isArray(forcedRaw)
    ? forcedRaw.filter((v): v is string => typeof v === 'string')
    : [];
  const roles: RoleReport[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.md') || NOT_ROLE.has(name)) continue;
    roles.push(parseRoleReport(name.slice(0, -3), readFileSync(join(dir, name), 'utf8')));
  }
  const summary = existsSync(join(dir, 'SUMMARY.md'))
    ? readFileSync(join(dir, 'SUMMARY.md'), 'utf8')
    : '';
  return {
    path,
    kind: match[1]!,
    forced,
    roles,
    summaryBlocks: /\*\*BLOCK:\s*YES/i.test(summary),
  };
}

/** `review/<kind>/Y/M/D/H_M_S` 를 모두 찾는다 — 정렬해서 돌려준다(실행마다 같은 순서) */
export function scanSessions(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string, depth: number): void => {
    const abs = join(root, rel);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) return;
    if (depth === 5) {
      if (SESSION_DIR.test(rel)) out.push(rel);
      return;
    }
    for (const name of readdirSync(abs).sort()) {
      if (name.startsWith('_') || name.startsWith('.')) continue;
      walk(rel === '' ? name : `${rel}/${name}`, depth + 1);
    }
  };
  walk('review', 0);
  return out.map((p) => p.replace(/\\/g, '/')).sort();
}

/** 세션마다 겹치지 않는 가짜 커밋 — 리뷰 라운드는 커밋 SHA 를 요구한다(REQ-API-321) */
export function replayShas(path: string): { base: string; head: string } {
  const sha = (seed: string): string => createHash('sha1').update(seed).digest('hex');
  return { base: sha(`base:${path}`), head: sha(`head:${path}`) };
}

export interface GateItem {
  kind: string;
  state: string;
  reasons: string[];
  roles?: { required: string[]; reported: string[]; missing: string[] };
}

export interface SessionVerdict {
  path: string;
  forcedUnmet: boolean;
  downgrade: boolean;
  /** 서버 정책이 그 세션의 forced 와 같을 때 서버의 `missing_roles` 가 우리 판정과 어긋났는가 */
  serverDisagrees: boolean;
}

/** 서버가 돌려준 판정으로 세션 하나를 판정한다 — 순수 함수(L1 이 본다) */
export function judgeSession(session: ReplaySession, item: GateItem | undefined): SessionVerdict {
  const reported = new Set(item?.roles?.reported ?? []);
  const forcedUnmet = session.forced.some((role) => !reported.has(role));
  const required = item?.roles?.required ?? [];
  const policyMatches =
    required.length === session.forced.length &&
    required.every((role) => session.forced.includes(role));
  const serverMissing = (item?.reasons ?? []).includes('missing_roles');
  return {
    path: session.path,
    forcedUnmet,
    // 역할이 CRITICAL 을 적었는데(서버에 열린 critical 이 남았다) SUMMARY 는 막지 않았다
    downgrade: (item?.reasons ?? []).includes('open_critical') && !session.summaryBlocks,
    serverDisagrees: policyMatches && session.forced.length > 0 && serverMissing !== forcedUnmet,
  };
}

export interface CriterionResult {
  population: number;
  labeled: number;
  detected: number;
  missed: string[];
  falsePositives: string[];
  pass: boolean;
}

/** 라벨과 견준다 — 놓친 것 0 · 오탐 0 이면 통과 */
export function compare(
  population: readonly string[],
  labeled: readonly string[],
  detected: ReadonlySet<string>,
): CriterionResult {
  const inPopulation = new Set(population);
  const truth = new Set(labeled.filter((p) => inPopulation.has(p)));
  const found = [...detected].filter((p) => inPopulation.has(p));
  const missed = [...truth].filter((p) => !detected.has(p)).sort();
  const falsePositives = found.filter((p) => !truth.has(p)).sort();
  return {
    population: inPopulation.size,
    labeled: truth.size,
    detected: found.length,
    missed,
    falsePositives,
    pass: missed.length === 0 && falsePositives.length === 0,
  };
}

export class ReplayServerError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'ReplayServerError';
  }
}

async function call(
  options: ReplayOptions,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<unknown> {
  const url = `${options.server.replace(/\/$/, '')}/api/v1/projects/${options.project}${path}`;
  for (let attempt = 0; ; attempt += 1) {
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${options.token}`,
          accept: 'application/json',
          ...(options.org === null ? {} : { 'x-nerv-org': options.org }),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new ReplayServerError(null, error instanceof Error ? error.message : String(error));
    }
    // 쿼터(PAT 분당 300)에 걸리면 기다렸다 다시 — 세션이 수백이라 한 번에 보내면 반드시 걸린다
    if (res.status === 429 && attempt < 5) {
      const after = Number(res.headers.get('retry-after'));
      await new Promise((done) =>
        setTimeout(done, (Number.isFinite(after) && after > 0 ? after : 5) * 1000),
      );
      continue;
    }
    if (!res.ok) {
      const envelope = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
      throw new ReplayServerError(
        res.status,
        `${method} ${path} → HTTP ${res.status}${envelope.code === undefined ? '' : ` ${envelope.code}`}${
          envelope.message === undefined ? '' : ` — ${envelope.message}`
        }`,
      );
    }
    return res.json();
  }
}

/** 세션 하나를 서버에 다시 돌린다 — 역할마다 제출하고 판정을 묻는다 */
export async function replaySession(
  options: ReplayOptions,
  session: ReplaySession,
): Promise<GateItem | undefined> {
  const { base, head } = replayShas(session.path);
  const branch = `replay/${session.path}`;
  for (const role of session.roles) {
    await call(options, 'POST', '/reviews', {
      branch,
      base_sha: base,
      head_sha: head,
      kind: session.kind,
      reviewer: { role: role.role, risk: role.risk, body_md: `replay:${session.path}` },
      findings: role.criticals.map((title) => ({ severity: 'critical', title })),
    });
  }
  const query = new URLSearchParams({ branch, head_sha: head, kind: session.kind });
  const check = (await call(options, 'GET', `/gates/reviews/check?${query.toString()}`)) as {
    items?: GateItem[];
  };
  return check.items?.find((item) => item.kind === session.kind);
}

export interface ReplayReport {
  sessions: number;
  forced: CriterionResult;
  downgrade: CriterionResult;
  serverDisagreements: string[];
}

/** `nerv replay …` 의 인자를 읽는다 */
export function parseReplayArgs(argv: string[]): ReplayOptions {
  const flags = new Map<string, string>();
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg.startsWith('--')) {
      flags.set(arg.slice(2), argv[i + 1] ?? '');
      i += 1;
    }
  }
  const root = flags.get('root') ?? process.cwd();
  const labels = flags.get('labels') ?? '';
  const project = flags.get('project') ?? '';
  if (labels === '' || project === '') throw new Error(t()('cli.replay.usage'));
  const server = flags.get('server') ?? process.env['NERV_SERVER'] ?? '';
  const token = flags.get('token') ?? process.env['NERV_TOKEN'] ?? '';
  if (server === '' || token === '') throw new Error(t()('cli.replay.err.needs_server'));
  const org = flags.get('org') ?? '';
  const expectSha = flags.get('expect-sha') ?? '';
  return {
    root,
    labels,
    project,
    org: org === '' ? null : org,
    server,
    token,
    expectSha: expectSha === '' ? null : expectSha,
    json,
  };
}

export function renderReplay(report: ReplayReport): string {
  const line = (name: string, r: CriterionResult): string =>
    t()('cli.replay.criterion', {
      name,
      population: r.population,
      labeled: r.labeled,
      detected: r.detected,
      missed: r.missed.length,
      false_positives: r.falsePositives.length,
      verdict: t()(r.pass ? 'cli.replay.pass' : 'cli.replay.fail'),
    });
  const out = [
    t()('cli.replay.title', { sessions: report.sessions }),
    line('2-2', report.forced),
    line('2-3', report.downgrade),
  ];
  for (const [name, r] of [
    ['2-2', report.forced],
    ['2-3', report.downgrade],
  ] as const) {
    for (const path of r.missed) out.push(t()('cli.replay.missed', { name, path }));
    for (const path of r.falsePositives) out.push(t()('cli.replay.false_positive', { name, path }));
  }
  for (const path of report.serverDisagreements)
    out.push(t()('cli.replay.server_disagrees', { path }));
  return `${out.join('\n')}\n`;
}

export async function runReplay(argv: string[]): Promise<number> {
  let options: ReplayOptions;
  try {
    options = parseReplayArgs(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  try {
    if (options.expectSha !== null) {
      const head = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: options.root,
        encoding: 'utf8',
      }).trim();
      if (!head.startsWith(options.expectSha)) {
        throw new Error(
          t()('cli.replay.err.wrong_sha', { expected: options.expectSha, actual: head }),
        );
      }
    }
    const labels = JSON.parse(readFileSync(options.labels, 'utf8')) as ReplayLabels;
    const paths = scanSessions(options.root);
    const forcedUnmet = new Set<string>();
    const downgrade = new Set<string>();
    const disagreements: string[] = [];
    for (const [index, path] of paths.entries()) {
      const session = readSession(options.root, path);
      if (session === null) continue;
      const verdict = judgeSession(session, await replaySession(options, session));
      if (verdict.forcedUnmet) forcedUnmet.add(path);
      if (verdict.downgrade) downgrade.add(path);
      if (verdict.serverDisagrees) disagreements.push(path);
      if (!options.json && (index + 1) % 50 === 0) {
        process.stderr.write(
          `${t()('cli.replay.progress', { done: index + 1, total: paths.length })}\n`,
        );
      }
    }
    const report: ReplayReport = {
      sessions: paths.length,
      forced: compare(labels.forced_population ?? paths, labels.forced_unmet, forcedUnmet),
      downgrade: compare(labels.downgrade_population ?? paths, labels.verdict_downgrade, downgrade),
      serverDisagreements: disagreements,
    };
    process.stdout.write(
      options.json ? `${JSON.stringify(report, null, 2)}\n` : renderReplay(report),
    );
    return report.forced.pass && report.downgrade.pass && disagreements.length === 0 ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `${t()('cli.replay.err.aborted', { message: error instanceof Error ? error.message : String(error) })}\n`,
    );
    return 2;
  }
}
