// §2.2 트리가 전수인가 — codebase.md 가 "전문" 이라 선언한 것을 지킨다
//
// **트리가 전수가 아니면 "여기 없는 것은 없는 것" 이라는 읽기가 틀린다.** 2026-09-07 실측:
// 51개 파일이 빠져 있었고 그중에는 모듈 넷(`plugin`·`review`·`invitation`·`webhook`)이
// 통째로 있었다. 트리는 사람이 손으로 쓰는 문서라 코드가 자랄 때 조용히 낡는다 —
// 그 낡음을 사람이 알아채는 유일한 계기가 이 검사다.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(import.meta.dirname);
const DOC = resolve(import.meta.dirname, '../../../../docs/04-mvp/codebase.md');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    // 검사 파일은 트리에 적지 않는다 — 그것은 §4.3 의 소관이다
    return entry.endsWith('.ts') && !entry.endsWith('.spec.ts') ? [relative(SRC, full)] : [];
  });
}

describe('§2.2 `apps/api/src` 트리 전문 (codebase.md)', () => {
  const doc = readFileSync(DOC, 'utf8');
  const section = doc.slice(doc.indexOf('### 2.2'), doc.indexOf('### 2.3'));

  it('실물 파일이 전부 트리에 있다', () => {
    const listed = new Set(section.match(/[a-z0-9._-]+\.ts/g) ?? []);
    const missing = sourceFiles(SRC)
      .map((rel) => rel.split('/').at(-1) as string)
      .filter((name) => !listed.has(name));
    expect([...new Set(missing)].sort()).toEqual([]);
  });

  it('트리에 적힌 파일이 전부 실재한다 — 없어진 것을 계속 적어 두지 않는다', () => {
    const real = new Set(sourceFiles(SRC).map((rel) => rel.split('/').at(-1) as string));
    const listed = [...new Set(section.match(/[a-z0-9._-]+\.ts/g) ?? [])];
    // 산문이 인용하는 다른 트리의 파일(`packages/schema/…`)은 트리 블록 밖이라 걸리지 않는다
    const block = section.slice(
      section.indexOf('```text'),
      section.indexOf('```', section.indexOf('```text') + 7),
    );
    // 글롭(`*.tools.ts`)은 파일이 아니다 — 이름만 잘라 보면 `.tools.ts` 로 남는다
    const inTree = listed.filter((name) => !name.startsWith('.') && block.includes(name));
    expect(inTree.filter((name) => !real.has(name))).toEqual([]);
  });
});
