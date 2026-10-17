// `nerv cutover report` — SoT 컷오버 M1 의 2주 보고 (importer.md §3.7 · 2026-10-16 · 사람 결정 D6 · E21-S03 · REQ-IMP-035)
//
// **두 출처를 한 번에 낸다.** 판정 불일치율과 리뷰 제출 실패율은 서버가 센다(EP-REV-10 — 로컬 훅이 게이트 판정에 자기 판정을 함께
// 보낸 비교의 기록). 대상 경로(`review/`)의 신규 커밋 수는 **서버가 모른다** — 서버는 대상 저장소에 접근하지 않고(scope.md §5) GitHub
// 웹훅은 커밋의 파일 목록을 읽지 않는다. 그래서 이 CLI 가 체크아웃에서 `git log` 로 센다. 임포터와 같은 까닭으로 원본 체크아웃이
// 있는 장비에서 돈다(§3.2).
//
// 종료 코드는 임포터와 같은 어휘다 — `0` 안정 조건(불일치율 < 1% · 제출 실패율 < 2% · 신규 커밋 0 · 2주 관측 완료) · `1` 보고는 끝났으나
// 사람이 볼 것(관찰 중 · 롤백 기준 도달 · 신규 커밋 · 관측 미완 · 비교 없음 · 커밋을 세지 못함) · `2` 중단(서버를 읽지 못해 보고를 만들지
// 못했다). 성공 기준 2-5(리뷰 입력 가운데 이전 리뷰 산출물 비율)는 재지 않는다 — 그 사실을 보고에 적는다.

import { execFileSync } from 'node:child_process';
import { t } from '../i18n.js';

export interface CutoverOptions {
  project: string;
  server: string;
  token: string;
  /** 체크아웃 경로 — 기본은 지금 디렉터리 */
  root: string;
  /** 신규 커밋을 셀 경로 — 기본 `review/` */
  path: string;
  since: string | null;
  until: string | null;
  json: boolean;
}

/** EP-REV-10 응답에서 이 보고가 읽는 칸 */
export interface ServerCutover {
  review_sot: string;
  review_sot_since: string | null;
  window: {
    since: string;
    until: string;
    days: number;
    observation_days: number;
    complete: boolean;
  };
  comparisons: { total: number; mismatches: number; rate: number | null };
  submissions: { accepted: number; failed: number; total: number; rate: number | null };
  status: 'no_data' | 'stable' | 'watch' | 'rollback';
  reasons: string[];
  thresholds: {
    stable_below_pct: number;
    rollback_mismatch_pct: number;
    rollback_submit_failure_pct: number;
  };
  recent_mismatches: {
    branch: string;
    head_sha: string;
    local: string;
    server: string;
    hook: string | null;
    created_at: string;
  }[];
}

export interface PathCommits {
  commits: number;
  files: number;
  bytes: number;
}

export class CutoverServerError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'CutoverServerError';
  }
}

function isoParam(flag: string, value: string | undefined): string | null {
  if (value === undefined || value === '') return null;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) throw new Error(t()('cli.cutover.err.bad_time', { flag, value }));
  return new Date(at).toISOString();
}

/** `nerv cutover report …` 의 `report` 뒤 인자를 읽는다 */
export function parseCutoverArgs(argv: string[]): CutoverOptions {
  const [command, ...rest] = argv;
  if (command !== 'report') throw new Error(t()('cli.cutover.usage'));
  const flags = new Map<string, string>();
  let json = false;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] ?? '';
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg.startsWith('--')) {
      flags.set(arg.slice(2), rest[i + 1] ?? '');
      i += 1;
    }
  }
  const project = flags.get('project') ?? '';
  if (project === '') throw new Error(t()('cli.cutover.usage'));
  const server = flags.get('server') ?? process.env['NERV_SERVER'] ?? '';
  const token = flags.get('token') ?? process.env['NERV_TOKEN'] ?? '';
  if (server === '' || token === '') throw new Error(t()('cli.cutover.err.needs_server'));
  return {
    project,
    server,
    token,
    root: flags.get('root') ?? process.cwd(),
    path: flags.get('path') ?? 'review/',
    since: isoParam('--since', flags.get('since')),
    until: isoParam('--until', flags.get('until')),
    json,
  };
}

/** EP-REV-10 을 부른다 — 4xx 는 다시 부르지 않는다(토큰 · 역할 문제는 사람이 고친다) */
export async function fetchCutover(options: CutoverOptions): Promise<ServerCutover> {
  const query = new URLSearchParams();
  if (options.since !== null) query.set('since', options.since);
  if (options.until !== null) query.set('until', options.until);
  const qs = query.toString();
  const url = `${options.server.replace(/\/$/, '')}/api/v1/projects/${options.project}/gates/reviews/cutover${qs === '' ? '' : `?${qs}`}`;
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(url, {
      headers: { authorization: `Bearer ${options.token}`, accept: 'application/json' },
    });
  } catch (error) {
    throw new CutoverServerError(null, error instanceof Error ? error.message : String(error));
  }
  if (!res.ok) {
    const envelope = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    throw new CutoverServerError(
      res.status,
      `HTTP ${res.status}${envelope.code === undefined ? '' : ` ${envelope.code}`}${
        envelope.message === undefined ? '' : ` — ${envelope.message}`
      }`,
    );
  }
  return (await res.json()) as ServerCutover;
}

/**
 * 창 안에 대상 경로를 건드린 커밋 · 파일 · 바이트를 센다(성공 기준 2-1 — 「컷오버 후 `review/` 경로 신규 커밋 파일 수 · 바이트」).
 *
 * 모든 로컬 · 원격 추적 브랜치(`--branches --remotes`)를 본다 — 리뷰 산출물은 작업 브랜치에 커밋되던 것이라 지금 브랜치만 보면 놓친다.
 * 시각은 커밋 시각(committer date)이다. 파일은 추가 · 수정된 경로(지운 것은 세지 않는다)이고, 바이트는 그 커밋이 남긴 새 내용(blob)의
 * 크기 합이다. git 저장소가 아니면 예외다 — 부른 쪽이 「세지 못했다」로 적는다.
 */
export function countPathCommits(
  root: string,
  path: string,
  since: string,
  until: string,
): PathCommits {
  const log = execFileSync(
    'git',
    [
      'log',
      '--branches',
      '--remotes',
      `--since=${since}`,
      `--until=${until}`,
      '--no-renames',
      '--raw',
      '--no-abbrev',
      '--format=C%x09%H',
      '--',
      path,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const commits = new Set<string>();
  const files = new Set<string>();
  const blobs = new Set<string>();
  for (const line of log.split('\n')) {
    if (line.startsWith('C\t')) {
      commits.add(line.slice(2).trim());
      continue;
    }
    // `:100644 100644 <옛 blob> <새 blob> M\t<경로>`
    if (!line.startsWith(':')) continue;
    const [meta, file] = line.split('\t');
    const parts = (meta ?? '').split(' ');
    const status = parts[4] ?? '';
    const blob = parts[3] ?? '';
    if (file === undefined || status.startsWith('D')) continue;
    files.add(file);
    if (!/^0+$/.test(blob)) blobs.add(blob);
  }
  let bytes = 0;
  if (blobs.size > 0) {
    const sizes = execFileSync('git', ['cat-file', '--batch-check=%(objectsize)'], {
      cwd: root,
      encoding: 'utf8',
      input: `${[...blobs].join('\n')}\n`,
      maxBuffer: 64 * 1024 * 1024,
    });
    for (const size of sizes.split('\n')) {
      const n = Number.parseInt(size, 10);
      if (Number.isFinite(n)) bytes += n;
    }
  }
  return { commits: commits.size, files: files.size, bytes };
}

const STATUS_KEY = {
  no_data: 'cli.cutover.status.no_data',
  stable: 'cli.cutover.status.stable',
  watch: 'cli.cutover.status.watch',
  rollback: 'cli.cutover.status.rollback',
} as const;

const VERDICT_KEY = { pass: 'gate.verdict.pass', block: 'gate.verdict.block' } as const;

const percent = (rate: number | null): string =>
  rate === null ? '—' : `${(Math.round(rate * 10_000) / 100).toFixed(2)}%`;

/** 결론 — 롤백 기준이면 롤백, 서버 지표가 안정이고 신규 커밋 0 이고 2주를 채웠으면 안정, 그 밖은 확인할 것 */
export function cutoverOutcome(
  server: ServerCutover,
  git: PathCommits | null,
): 'ok' | 'rollback' | 'check' {
  if (server.status === 'rollback') return 'rollback';
  if (server.status === 'stable' && git !== null && git.commits === 0 && server.window.complete) {
    return 'ok';
  }
  return 'check';
}

/** 사람이 읽는 보고(CLI 로케일 — §3.5a) */
export function renderCutover(
  options: Pick<CutoverOptions, 'project' | 'path'>,
  server: ServerCutover,
  git: PathCommits | { error: string },
): string {
  const tr = t();
  const lines: string[] = [tr('cli.cutover.title', { project: options.project }), ''];
  lines.push(
    tr('cli.cutover.stage', {
      stage: server.review_sot,
      since: server.review_sot_since ?? tr('cli.cutover.never'),
    }),
    tr('cli.cutover.window', {
      since: server.window.since,
      until: server.window.until,
      days: server.window.days,
      total: server.window.observation_days,
    }),
  );
  if (!server.window.complete) {
    lines.push(tr('cli.cutover.window_incomplete', { total: server.window.observation_days }));
  }
  lines.push(
    tr('cli.cutover.mismatch', {
      mismatches: server.comparisons.mismatches,
      total: server.comparisons.total,
      rate: percent(server.comparisons.rate),
      stable: server.thresholds.stable_below_pct,
      rollback: server.thresholds.rollback_mismatch_pct,
    }),
    tr('cli.cutover.submit', {
      failed: server.submissions.failed,
      total: server.submissions.total,
      rate: percent(server.submissions.rate),
      rollback: server.thresholds.rollback_submit_failure_pct,
    }),
    'error' in git
      ? tr('cli.cutover.commits_unknown', { path: options.path, reason: git.error })
      : tr('cli.cutover.commits', {
          path: options.path,
          commits: git.commits,
          files: git.files,
          bytes: git.bytes,
        }),
    tr('cli.cutover.input_ratio'),
    tr('cli.cutover.status', { status: tr(STATUS_KEY[server.status]) }),
  );
  if (server.recent_mismatches.length > 0) {
    lines.push('', tr('cli.cutover.recent'));
    for (const row of server.recent_mismatches) {
      const local = row.local === 'pass' ? 'pass' : 'block';
      const verdict = row.server === 'pass' ? 'pass' : 'block';
      lines.push(
        tr('cli.cutover.recent_row', {
          at: row.created_at,
          branch: row.branch,
          sha: row.head_sha.slice(0, 7),
          local: tr(VERDICT_KEY[local]),
          hook: row.hook === null ? '' : ` (${row.hook})`,
          server: tr(VERDICT_KEY[verdict]),
        }),
      );
    }
  }
  const outcome = cutoverOutcome(server, 'error' in git ? null : git);
  lines.push(
    '',
    outcome === 'ok'
      ? tr('cli.cutover.overall.ok')
      : outcome === 'rollback'
        ? tr('cli.cutover.overall.rollback')
        : tr('cli.cutover.overall.check'),
  );
  return `${lines.join('\n')}\n`;
}

/**
 * 명령 하나를 끝까지 돈다 — 출력과 종료 코드를 돌려준다. 서버를 읽지 못하면 보고를 만들 수 없어 `2`(중단)다. 커밋을 세지 못한 것은
 * 보고의 한 줄이고 `1` 이다(서버 지표는 그대로 쓸모가 있다).
 */
export async function runCutover(
  argv: string[],
  write: (text: string) => void = (text) => process.stdout.write(text),
): Promise<number> {
  let options: CutoverOptions;
  try {
    options = parseCutoverArgs(argv);
  } catch (error) {
    write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  let server: ServerCutover;
  try {
    server = await fetchCutover(options);
  } catch (error) {
    write(
      `${t()('cli.cutover.err.server', {
        message: error instanceof Error ? error.message : String(error),
      })}\n`,
    );
    return 2;
  }
  let git: PathCommits | { error: string };
  try {
    git = countPathCommits(options.root, options.path, server.window.since, server.window.until);
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    git = { error: raw.split('\n')[0] ?? raw };
  }
  const outcome = cutoverOutcome(server, 'error' in git ? null : git);
  if (options.json) {
    write(
      `${JSON.stringify(
        {
          project: options.project,
          path: options.path,
          server,
          git,
          input_ratio: null,
          outcome,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    write(renderCutover(options, server, git));
  }
  return outcome === 'ok' ? 0 : 1;
}
