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
import { parseOwnerMap } from './parse/plan.js';
import { runImport } from './run.js';
import { exitCode, renderJsonl, renderMarkdown } from './report/index.js';

export interface CliOptions {
  command: 'spec' | 'plan' | 'docs' | 'rebuild-map';
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
}

export function parseArgs(argv: string[]): CliOptions {
  const [command, ...rest] = argv;
  if (command !== 'spec' && command !== 'plan' && command !== 'docs' && command !== 'rebuild-map') {
    throw new Error(
      '사용법: nerv import <spec|plan|docs|rebuild-map> --root <경로> --project <slug> [--apply]',
    );
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
    throw new Error('--profile 과 --profile-file 은 함께 쓸 수 없습니다.');
  }
  if (options.apply && (options.server === undefined || options.token === undefined)) {
    throw new Error(
      '--apply 에는 --server 와 --token(또는 env NERV_SERVER/NERV_TOKEN)이 필요합니다.',
    );
  }
  return options;
}

export async function main(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  const report = await runImport(options);

  mkdirSync(options.reportDir, { recursive: true });
  writeFileSync(join(options.reportDir, 'report.md'), renderMarkdown(report), 'utf8');
  writeFileSync(join(options.reportDir, 'report.jsonl'), renderJsonl(report), 'utf8');

  const rate = report.scanned === 0 ? 1 : report.converted / report.scanned;
  process.stdout.write(
    `${options.apply ? '적재' : 'dry-run'} 완료 — 스캔 ${report.scanned} · 변환 ${report.converted}` +
      ` (${(rate * 100).toFixed(1)}%) · 리포트 ${options.reportDir}\n`,
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
