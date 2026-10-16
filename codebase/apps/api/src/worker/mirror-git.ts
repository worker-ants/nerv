// git 미러 — 승인본 미러 폴더를 git 저장소로 두고, 원격이 있으면 fast-forward 로만 push 한다 (2026-10-16 · E21-S02)
//
// 정본: docs/04-mvp/codebase.md §6.2a · REQ-CB-062 · 063 · 설계는 docs/03-proposal/architecture.md §2.4(b) ·
// 미러 쪽 편집의 규칙은 docs/03-proposal/roadmap.md §7.4 규칙 1(받아들이지 않고 경고한다)
//
// **git 은 인자 배열로만 부른다** — 셸을 거치지 않는다. 인자에 들어가는 값은 운영자가 env 로 준 셋(원격 · 브랜치 · 작성자)과
// 서버가 만든 것(커밋 SHA · `safePathSegment` 를 거친 경로)뿐이다. 사람이 쓴 것(스펙 본문 · 제목 · 이름)은 파일 내용과
// 커밋 메시지로만 가고, 커밋 메시지는 표준 입력으로 넘긴다. 경로도 표준 입력의 NUL 구분 목록으로 넘기고
// `--literal-pathspecs` 로 패턴 해석을 끈다.
//
// **저장소는 언제나 이 폴더다.** `--git-dir` · `--work-tree` 를 명시하고 위치를 정하는 `GIT_*` 환경변수를 지운다 — 미러
// 폴더를 다른 저장소 안에 두어도(예: 개발 루프의 `./.nerv/mirror`) 그 저장소를 찾아 올라가 거기에 커밋하지 않는다.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MIRROR_GIT_DEFAULT_AUTHOR, MIRROR_GIT_DEFAULT_BRANCH } from '@nerv/schema';

export interface MirrorGitConfig {
  /** push 할 원격 — 없으면 로컬 커밋까지만 한다. 자격증명이 들어 있을 수 있어 로그 · 이벤트에 넣지 않는다 */
  remote: string | null;
  /** 원격 브랜치 이름 */
  branch: string;
  author: { name: string; email: string };
}

/** 미러 설정이 틀렸다 — 잡이 실패로 남는다(조용히 기본값으로 가면 운영자는 자기 오타를 영영 모른다) */
export class MirrorGitConfigError extends Error {}

function trimmedOrNull(raw: string | undefined): string | null {
  const value = (raw ?? '').trim();
  return value === '' ? null : value;
}

/** `이름 <메일>` — git 의 `--author` 와 같은 모양 */
const AUTHOR = /^([^<>\r\n]+?)\s*<([^<>\s]+)>$/;
/** 브랜치 이름 — 영문 · 숫자 · `.` `_` `/` `-` 만 받는다. 그 글자 안에서 `git check-ref-format` 이 거절하는 모양은 아래에서 본다 */
const BRANCH = /^[A-Za-z0-9._/-]+$/;

/** `git check-ref-format` 의 규칙 가운데 위 글자들로 만들 수 있는 것 — `..` · 빈 칸 · `.` 으로 시작하는 칸 · `.lock` · `.` 끝 */
function isBranchName(branch: string): boolean {
  if (!BRANCH.test(branch) || branch.startsWith('-')) return false;
  if (branch.includes('..') || branch.endsWith('.')) return false;
  return branch
    .split('/')
    .every((part) => part !== '' && !part.startsWith('.') && !part.endsWith('.lock'));
}

/**
 * env 에서 미러 설정을 읽는다(codebase.md §5.2). **이름을 리터럴로 적는다** — `.env` 전표 게이트가 그 리터럴로 소비자를 센다.
 */
export function mirrorGitConfig(env: NodeJS.ProcessEnv = process.env): MirrorGitConfig {
  const remote = trimmedOrNull(env['NERV_MIRROR_GIT_REMOTE']);
  const branch = trimmedOrNull(env['NERV_MIRROR_GIT_BRANCH']) ?? MIRROR_GIT_DEFAULT_BRANCH;
  const author = trimmedOrNull(env['NERV_MIRROR_GIT_AUTHOR']) ?? MIRROR_GIT_DEFAULT_AUTHOR;

  // 옵션으로 읽히는 값은 받지 않는다 — 인자 배열이라도 `-` 로 시작하면 git 이 옵션으로 해석한다
  if (remote !== null && (remote.startsWith('-') || /\s/.test(remote))) {
    // eslint-disable-next-line no-restricted-syntax -- 운영자용 설정 오류(REQ-CB-022)
    throw new MirrorGitConfigError('NERV_MIRROR_GIT_REMOTE 가 원격 주소의 모양이 아니다');
  }
  if (!isBranchName(branch)) {
    throw new MirrorGitConfigError(`NERV_MIRROR_GIT_BRANCH 가 브랜치 이름이 아니다: ${branch}`);
  }
  const match = AUTHOR.exec(author);
  if (match === null) {
    // eslint-disable-next-line no-restricted-syntax -- 운영자용 설정 오류(REQ-CB-022)
    throw new MirrorGitConfigError('NERV_MIRROR_GIT_AUTHOR 는 `이름 <메일>` 모양이어야 한다');
  }
  return {
    remote,
    branch,
    author: { name: (match[1] ?? '').trim(), email: match[2] ?? '' },
  };
}

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** 저장소의 위치를 정하는 환경변수 — 물려받으면 엉뚱한 저장소에 쓴다(훅 안에서 돈 테스트가 그렇다) */
const LOCATION_ENV = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
];

/** 원격 주소에 든 자격증명(`https://사용자:토큰@…`)을 지운다 — 오류 문장이 그것을 되풀이할 수 있다 */
export function redactRemote(text: string, remote: string | null): string {
  let out = text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, '$1***@');
  // eslint-disable-next-line no-restricted-syntax -- 운영자용 로그의 자리표시(REQ-CB-022)
  if (remote !== null && remote !== '') out = out.split(remote).join('<원격>');
  return out;
}

/** 원격이 앞서 있는지 — 미러 쪽 편집의 판정 결과 */
export type PushOutcome =
  | { kind: 'no_remote' }
  /** 커밋이 아직 없다 — 내보낸 프로젝트가 없었다 */
  | { kind: 'empty' }
  | { kind: 'up_to_date'; head: string }
  | { kind: 'pushed'; head: string; remote_head: string | null }
  | {
      kind: 'diverged';
      head: string;
      remote_head: string;
      /** 원격에만 있는 커밋 수 — NERV 가 만들지 않은 것 */
      foreign_commits: number;
      /** 그 커밋들이 바꾼 경로(공통 조상 기준) — 조상이 없으면 null */
      foreign_paths: string[] | null;
      /** NERV 가 마지막으로 push 한 커밋 — 원격을 이리로 되돌리면 다음 판에 이어서 push 한다 */
      last_pushed: string | null;
    };

/** 원격에 브랜치가 없을 때 fetch 가 남기는 문장(LC_ALL=C) */
const MISSING_REMOTE_REF = /couldn't find remote ref/i;

export class MirrorGit {
  private readonly root: string;
  private readonly gitDir: string;

  constructor(
    root: string,
    private readonly config: MirrorGitConfig,
    /** fetch · push 의 시한(ms) — 원격이 답하지 않아도 잡 루프를 붙잡지 않는다 */
    private readonly networkTimeoutMs: number,
  ) {
    this.root = resolve(root);
    this.gitDir = join(this.root, '.git');
  }

  /** 이 폴더가 이미 저장소인가 — 위쪽 폴더의 저장소는 세지 않는다 */
  get initialized(): boolean {
    return existsSync(this.gitDir);
  }

  /**
   * 저장소를 준비한다. 없으면 만들고 HEAD 를 설정한 브랜치로 둔다. **아직 커밋이 없고 원격이 있으면** 원격의 이력을
   * 이어받는다 — 볼륨을 잃은 워커가 원격의 이력을 처음부터 다시 쓰지 않게(그러면 원격과 갈라져 push 가 멈춘다). 저장소를
   * 만든 판에서 원격이 답하지 않았어도 다음 판이 다시 이어받는다(커밋이 없는 동안은 매 판 본다).
   */
  async ensureRepo(): Promise<void> {
    if (!this.initialized) {
      await this.git(['init', '--quiet'], { bare: true });
      await this.git(['symbolic-ref', 'HEAD', `refs/heads/${this.config.branch}`]);
    }
    if (this.config.remote === null || (await this.head()) !== null) return;
    const remoteHead = await this.fetchRemote();
    if (remoteHead === null) return;
    // 작업 트리는 건드리지 않는다 — 곧 내보내기가 새로 쓴다. HEAD 와 인덱스만 원격의 것으로 둔다
    await this.git(['update-ref', 'HEAD', remoteHead]);
    await this.git(['read-tree', remoteHead]);
  }

  /** 지금 커밋 — 아직 없으면 null */
  async head(): Promise<string | null> {
    const r = await this.git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], {
      allowFail: true,
    });
    return r.code === 0 ? r.stdout.trim() : null;
  }

  /** 지금 커밋의 파일 하나 — 없으면 null(첫 커밋 전 · 그 경로가 없다) */
  async showHead(path: string): Promise<string | null> {
    const r = await this.git(['cat-file', 'blob', `HEAD:${path}`], { allowFail: true });
    return r.code === 0 ? r.stdout : null;
  }

  /** git 이 추적하는 파일 — 지난 판들이 커밋한 것이다 */
  async trackedFiles(): Promise<string[]> {
    const r = await this.git(['ls-files', '-z']);
    return r.stdout.split('\0').filter((p) => p !== '');
  }

  /**
   * 내보낸 파일과 사라진 파일을 스테이징하고, 바뀐 것이 있으면 커밋한다. 돌려주는 값은 커밋했는가다.
   * 추적하지 않는 남의 파일(운영자가 둔 것)은 더하지도 지우지도 않는다 — 넘긴 경로만 본다.
   */
  async commit(paths: readonly string[], message: string): Promise<boolean> {
    if (paths.length > 0) {
      await this.git(['add', '--all', '--pathspec-from-file=-', '--pathspec-file-nul'], {
        input: paths.join('\0'),
      });
    }
    const staged = await this.git(['diff', '--cached', '--quiet'], { allowFail: true });
    if (staged.code === 0) return false;
    if (staged.code !== 1) throw this.failure(['diff', '--cached'], staged);
    await this.git(['commit', '--quiet', '--no-verify', '-F', '-'], { input: message });
    return true;
  }

  /**
   * 원격 브랜치를 받아 `refs/nerv/remote` 에 둔다. 원격에 그 브랜치가 없으면 null 이다(첫 push 전).
   */
  async fetchRemote(): Promise<string | null> {
    const remote = this.config.remote;
    if (remote === null) return null;
    const r = await this.git(
      [
        'fetch',
        '--quiet',
        '--no-tags',
        '--no-write-fetch-head',
        remote,
        `+refs/heads/${this.config.branch}:refs/nerv/remote`,
      ],
      { allowFail: true, network: true },
    );
    if (r.code !== 0) {
      if (MISSING_REMOTE_REF.test(r.stderr)) {
        await this.git(['update-ref', '-d', 'refs/nerv/remote'], { allowFail: true });
        return null;
      }
      throw this.failure(['fetch'], r);
    }
    const ref = await this.git(['rev-parse', '--verify', '--quiet', 'refs/nerv/remote^{commit}']);
    return ref.stdout.trim();
  }

  /**
   * **fast-forward 일 때만 push 한다**(roadmap §7.4 규칙 1). 원격에 이 저장소에 없는 커밋이 있으면 — 누군가 미러를 직접
   * 고쳤다 — 덮어쓰지 않고(`--force` 를 쓰지 않는다) 멈춘 채 그 사실을 돌려준다. 받아들이지도 않는다: 그 커밋은 이 저장소로
   * 합쳐지지 않고, 미러의 내용은 늘 NERV 의 승인본이다.
   */
  async push(): Promise<PushOutcome> {
    const remote = this.config.remote;
    if (remote === null) return { kind: 'no_remote' };
    const head = await this.head();
    if (head === null) return { kind: 'empty' };
    const remoteHead = await this.fetchRemote();
    if (remoteHead === head) {
      await this.git(['update-ref', 'refs/nerv/pushed', head]);
      return { kind: 'up_to_date', head };
    }
    if (remoteHead !== null && !(await this.isAncestor(remoteHead, head))) {
      const count = await this.git(['rev-list', '--count', remoteHead, '--not', head]);
      const diff = await this.git(['diff', '--name-only', '-z', `${head}...${remoteHead}`], {
        allowFail: true,
      });
      const pushed = await this.git(['rev-parse', '--verify', '--quiet', 'refs/nerv/pushed'], {
        allowFail: true,
      });
      return {
        kind: 'diverged',
        head,
        remote_head: remoteHead,
        foreign_commits: Number(count.stdout.trim()),
        foreign_paths: diff.code === 0 ? diff.stdout.split('\0').filter((p) => p !== '') : null,
        last_pushed: pushed.code === 0 ? pushed.stdout.trim() : null,
      };
    }
    // 강제하지 않는다 — fetch 와 push 사이에 원격이 움직였으면 거절되고 다음 판이 갈라짐으로 본다
    await this.git(['push', '--quiet', remote, `HEAD:refs/heads/${this.config.branch}`], {
      network: true,
    });
    await this.git(['update-ref', 'refs/nerv/pushed', head]);
    return { kind: 'pushed', head, remote_head: remoteHead };
  }

  private async isAncestor(ancestor: string, of: string): Promise<boolean> {
    const r = await this.git(['merge-base', '--is-ancestor', ancestor, of], { allowFail: true });
    if (r.code === 0) return true;
    if (r.code === 1) return false;
    throw this.failure(['merge-base'], r);
  }

  private failure(args: readonly string[], r: GitResult): Error {
    const detail = redactRemote(r.stderr.trim(), this.config.remote).split('\n')[0] ?? '';
    return new Error(`git ${args[0] ?? ''} 실패(종료 코드 ${r.code}) — ${detail}`);
  }

  /** git 한 번. `bare` 면 저장소 위치 인자 없이 이 폴더에서 돈다(`init` 만 그렇다) */
  private git(
    args: readonly string[],
    options: { input?: string; allowFail?: boolean; network?: boolean; bare?: boolean } = {},
  ): Promise<GitResult> {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of LOCATION_ENV) delete env[key];
    // 자격증명을 묻느라 멈추지 않는다 · 오류 문장을 언어에 매이지 않게 · 작성자는 설정의 것
    env['GIT_TERMINAL_PROMPT'] = '0';
    env['LC_ALL'] = 'C';
    env['GIT_AUTHOR_NAME'] = this.config.author.name;
    env['GIT_AUTHOR_EMAIL'] = this.config.author.email;
    env['GIT_COMMITTER_NAME'] = this.config.author.name;
    env['GIT_COMMITTER_EMAIL'] = this.config.author.email;

    const common = [
      // 훅 · 서명 · 다른 사용자 소유 폴더 검사가 미러를 막지 않게 한다(볼륨은 다른 uid 가 만들었을 수 있다)
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'commit.gpgsign=false',
      '-c',
      `safe.directory=${this.root}`,
      '--literal-pathspecs',
    ];
    const location =
      options.bare === true ? [] : ['--git-dir', this.gitDir, '--work-tree', this.root];
    const argv = [...common, ...location, ...args];

    return new Promise((resolvePromise, reject) => {
      const child = spawn('git', argv, { cwd: this.root, env, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer =
        options.network === true
          ? setTimeout(() => {
              timedOut = true;
              child.kill('SIGKILL');
            }, this.networkTimeoutMs)
          : null;
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => (stdout += chunk));
      child.stderr.on('data', (chunk: string) => (stderr += chunk));
      child.on('error', (error) => {
        if (timer !== null) clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        if (timer !== null) clearTimeout(timer);
        if (timedOut) {
          reject(
            new Error(`git ${args[0] ?? ''} 이 ${this.networkTimeoutMs}ms 안에 끝나지 않았다`),
          );
          return;
        }
        const result = { code: code ?? -1, stdout, stderr };
        if (result.code !== 0 && options.allowFail !== true) {
          reject(this.failure(args, result));
          return;
        }
        resolvePromise(result);
      });
      child.stdin.end(options.input ?? '');
    });
  }
}
