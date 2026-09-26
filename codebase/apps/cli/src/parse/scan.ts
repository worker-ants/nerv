// 스캔 — 프로파일의 glob 으로 원본 파일을 모으고 제외를 적용한다(importer.md §2.1).
//
// **원본은 READ-ONLY 다.** 임포터는 대상 저장소에 어떤 쓰기도 하지 않는다(codebase.md §1.3).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

export interface ScannedFile {
  /** root 기준 상대 경로 — 자연 키의 한 축이다(§3.3) */
  path: string;
  content: string;
  contentHash: string;
}

/** glob 부분집합 — `**` · `*` · `{a,b}` 만 지원한다. 프로파일이 쓰는 만큼이다. */
export function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i] ?? '';
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` 는 0개 이상의 디렉터리
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
      continue;
    }
    if (c === '{') {
      const close = pattern.indexOf('}', i);
      if (close > i) {
        out += `(?:${pattern
          .slice(i + 1, close)
          .split(',')
          .map((s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
          .join('|')})`;
        i = close;
        continue;
      }
    }
    out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

export function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegExp(p).test(path));
}

export function scan(root: string, include: string[], exclude: string[] = []): ScannedFile[] {
  if (include.length === 0) return [];
  const files: ScannedFile[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === '.git' || entry === 'node_modules') continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      const rel = relative(root, full).split(sep).join('/');
      if (!matchesAny(rel, include)) continue;
      if (exclude.length > 0 && matchesAny(rel, exclude)) continue;

      const content = readFileSync(full, 'utf8');
      files.push({
        path: rel,
        content,
        contentHash: createHash('sha256').update(content, 'utf8').digest('hex'),
      });
    }
  };

  walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * **저장소 색인 — `code:` glob 의 실존 검사**(importer.md §2.3 · REQ-IMP-032 · 2026-09-26).
 *
 * clemvion 의 `code:` 는 "이 문서를 구현한 파일" 의 glob 목록이다. 규약 스스로 "stale glob 은
 * 본 가드만으로 검출 불가"(R-1)라 적은 약점이 있어, 임포트 직후 값으로 드러낸다 — 아무 파일도
 * 가리키지 않는 glob 은 `stale` 로 적재하고 수동 확인 큐에 올린다. 원본 저장소를 보는 쪽은
 * CLI 뿐이라 판정도 여기서 한다(서버는 파일 시스템을 모른다).
 *
 * 저장소를 **한 번만** 걷는다(clemvion 은 `.git`·`node_modules` 를 빼고 28만 파일이다) — glob
 * 마다 걸으면 691 × 28만이다. 걸은 목록을 정렬해 두고, glob 의 고정 접두로 범위를 좁혀
 * 맞춰 본다. glob 문법은 `globToRegExp` 와 같다 — `[slug]` 같은 Next.js 경로의 대괄호는
 * 글자 그대로다(문자 집합으로 읽으면 멀쩡한 경로가 미매치로 나온다).
 */
export class RepoIndex {
  private files: string[] | null = null;

  constructor(private readonly root: string) {}

  /** glob 이 가리키는 파일이나 디렉터리가 하나라도 있는가 */
  exists(glob: string): boolean {
    const pattern = glob.trim().replace(/^\.\//, '').replace(/\/+$/, '');
    if (pattern === '') return false;
    const wildcard = pattern.search(/[*{]/);
    // 와일드카드가 없으면 그 경로 자체 — 파일이든 디렉터리든 있으면 된다
    if (wildcard === -1) return existsSync(join(this.root, pattern));
    const prefix = pattern.slice(0, pattern.lastIndexOf('/', wildcard) + 1);
    const matcher = globToRegExp(pattern);
    const files = this.list();
    for (let i = lowerBound(files, prefix); i < files.length; i += 1) {
      const file = files[i] ?? '';
      if (!file.startsWith(prefix)) break;
      if (matcher.test(file)) return true;
    }
    return false;
  }

  private list(): string[] {
    if (this.files !== null) return this.files;
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else out.push(relative(this.root, full).split(sep).join('/'));
      }
    };
    walk(this.root);
    // 정렬은 **코드 단위 순서**다 — 접두 범위 탐색(`lowerBound`)이 `<` 비교와 같은 순서를 요구한다
    this.files = out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return this.files;
  }
}

/** 정렬된 목록에서 `target` 이상인 첫 자리 */
function lowerBound(sorted: string[], target: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] ?? '') < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
