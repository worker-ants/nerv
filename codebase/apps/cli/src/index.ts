// `nerv import spec|plan|docs|rebuild-map` 엔트리 — 정본: docs/04-mvp/importer.md §3.1
//
// 이 워크스페이스는 컨테이너가 아니라 **설치되는 클라이언트**다(codebase.md §1.3).
// 운영 서버는 임포트 대상 저장소의 체크아웃에 접근할 수 없으므로, 파일을 읽는 쪽이 파일이
// 있는 장비여야 한다 — 그것이 이 CLI 가 존재하는 이유 전부다.
//
// **dry-run 이 기본이다.** 서버에 쓰려면 `--apply` 를 명시해야 하고, dry-run 은 `--server`
// 없이도 완주한다(REQ-IMP-011) — CI 에서 스펙 저장소 PR 검사로도 쓸 수 있다.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { t } from './i18n.js';
import { parseOwnerMap } from './parse/plan.js';
import { runImport } from './run.js';
import { exitCode, renderJsonl, renderMarkdown, withHints } from './report/index.js';
import { ImportApiError } from './client/index.js';
import { ProfileError } from './profiles/index.js';
import type { ImportReport } from './report/index.js';

export interface CliOptions {
  command: 'spec' | 'plan' | 'review' | 'docs' | 'rebuild-map';
  profile?: string;
  profileFile?: string;
  root: string;
  project: string;
  server?: string;
  token?: string;
  apply: boolean;
  reportDir: string;
  mapPath: string;
  /** owner 라벨 → 사용자 id (E11-S02). 매핑 없는 라벨은 unassigned 로 적재된다 */
  ownerMap?: Record<string, string>;
  /** EP-IMP-02/03 한 배치의 파일 수 (importer.md §3.1) */
  batchSize: number;
}

const COMMANDS = ['spec', 'plan', 'review', 'docs', 'rebuild-map'] as const;

function isCommand(value: string | undefined): value is CliOptions['command'] {
  return (COMMANDS as readonly (string | undefined)[]).includes(value);
}

export function parseArgs(argv: string[]): CliOptions {
  // **`import` 은 생략할 수 없다.** 정본(importer.md §3.1)·이 파일의 머리말·CLI 자신의
  // usage 문구가 전부 `nerv import spec …` 이라고 말하는데 파서만 그 낱말을 몰랐다 —
  // 지시대로 친 사람은 usage 에러를 받고, **그 에러가 다시 되지 않는 형태를 알려 줬다**
  // (2026-09-06 대조). 두 형태를 다 받으면 같은 것에 이름이 둘이 된다(사전 §1 의 이유).
  const [group, ...tail] = argv;
  if (group !== 'import') {
    // 옛 형태(`nerv spec …`)를 친 사람에게는 usage 만 던지지 않고 무엇이 빠졌는지 말한다
    throw new Error(
      isCommand(group) ? t()('cli.err.needs_import', { command: group }) : t()('cli.usage'),
    );
  }
  const [command, ...rest] = tail;
  if (!isCommand(command)) {
    throw new Error(t()('cli.usage'));
  }

  const flags = new Map<string, string>();
  let apply = false;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] ?? '';
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg.startsWith('--')) {
      flags.set(arg.slice(2), rest[i + 1] ?? '');
      i += 1;
    }
  }

  const options: CliOptions = {
    command,
    root: flags.get('root') ?? process.cwd(),
    project: flags.get('project') ?? '',
    apply,
    // 기본 50 — 한 번에 보내면 본문 크기가 서버의 한도를 넘는다(importer.md §3.1).
    // 계약 상한(IMPORT_BATCH_MAX)은 보내는 자리에서 지킨다(run.ts `chunked`) — 사람이
    // 큰 값을 줘도 조용히 400 을 받지 않는다.
    batchSize: Math.max(1, Number.parseInt(flags.get('batch-size') ?? '50', 10) || 50),
    reportDir: flags.get('report-dir') ?? './nerv-import-report',
    mapPath: flags.get('map') ?? './nerv-import.map.json',
  };
  const ownerMapPath = flags.get('owner-map');
  if (ownerMapPath !== undefined && ownerMapPath !== '') {
    // 파일이 없으면 조용히 넘어가지 않는다 — 매핑을 주려던 사람이 전원 unassigned 를 받는다
    options.ownerMap = parseOwnerMap(readFileSync(ownerMapPath, 'utf8'));
  }

  const profile = flags.get('profile');
  const profileFile = flags.get('profile-file');
  const server = flags.get('server') ?? process.env['NERV_SERVER'];
  const token = flags.get('token') ?? process.env['NERV_TOKEN'];
  if (profile !== undefined) options.profile = profile;
  if (profileFile !== undefined) options.profileFile = profileFile;
  if (server !== undefined && server !== '') options.server = server;
  if (token !== undefined && token !== '') options.token = token;

  if (options.profile === undefined && options.profileFile === undefined) {
    options.profile = command === 'docs' ? 'nerv-docs' : 'clemvion';
  }
  if (options.profile !== undefined && options.profileFile !== undefined) {
    throw new Error(t()('cli.err.profile_conflict'));
  }
  if (options.apply && (options.server === undefined || options.token === undefined)) {
    throw new Error(t()('cli.err.apply_needs_server'));
  }
  return options;
}

/**
 * **리포트 없이 죽지 않는다**(2026-09-07 · REQ-IMP-025).
 *
 * 가장 흔한 실패 둘 — 토큰 만료·권한 부족(401/403)과 프로파일 이름 오타 — 이 예외로
 * 그대로 나가면 종료 코드 1 이 되고, 그것은 이 CLI 의 어휘에서 **"완료했으나 수동 확인"**
 * 이다. 아무것도 적재되지 않았는데 그렇게 읽히면 다음 사람은 report 를 뒤진다. 둘 다
 * 중단(2)이고, 그 사실이 리포트에 한 줄로 남아야 한다.
 *
 * 그 밖의 예외는 그대로 던진다 — 모르는 실패를 아는 실패처럼 적는 것이 더 나쁘다.
 */
function failureReport(options: CliOptions, error: unknown): ImportReport {
  const rule =
    error instanceof ImportApiError && (error.status === 401 || error.status === 403)
      ? ('server-unauthorized' as const)
      : error instanceof ProfileError
        ? ('profile-invalid' as const)
        : null;
  if (rule === null) throw error;
  return {
    profile: options.profile ?? options.profileFile ?? '',
    root: options.root,
    rootCommit: null,
    scanned: 0,
    converted: 0,
    entries: [
      {
        file: options.profileFile ?? options.root,
        line: null,
        rule,
        reason: error instanceof Error ? error.message : String(error),
        disposition: 'aborted',
      },
    ],
    expectation: [],
  };
}

export async function main(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  const report = withHints(
    await runImport(options).catch((error) => failureReport(options, error)),
  );

  mkdirSync(options.reportDir, { recursive: true });
  writeFileSync(join(options.reportDir, 'report.md'), renderMarkdown(report), 'utf8');
  writeFileSync(join(options.reportDir, 'report.jsonl'), renderJsonl(report), 'utf8');

  const rate = report.scanned === 0 ? 1 : report.converted / report.scanned;
  process.stdout.write(
    `${t()('cli.done', {
      mode: t()(options.apply ? 'cli.mode.apply' : 'cli.mode.dry_run'),
      scanned: report.scanned,
      converted: report.converted,
      rate: (rate * 100).toFixed(1),
      dir: options.reportDir,
    })}\n`,
  );
  return exitCode(report);
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  const code = await main(process.argv.slice(2));
  // **명시적으로 끝낸다.** `process.exitCode` 만 세우면 이벤트 루프가 빌 때까지 기다리는데,
  // fetch(undici)의 keep-alive 소켓이 살아 있어 서버 모드 실행이 수십 초를 매달려 있었다(실측).
  // 임포터는 단발 명령이라 매달릴 이유가 없다 — stdout 이 비워진 뒤 즉시 종료한다.
  process.stdout.write('', () => process.exit(code));
}
