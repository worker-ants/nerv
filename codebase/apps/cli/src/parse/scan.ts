// 스캔 — 프로파일의 glob 으로 원본 파일을 모으고 제외를 적용한다(importer.md §2.1).
//
// **원본은 READ-ONLY 다.** 임포터는 대상 저장소에 어떤 쓰기도 하지 않는다(codebase.md §1.3).

import { readdirSync, readFileSync, statSync } from 'node:fs';
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
