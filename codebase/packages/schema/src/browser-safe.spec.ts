// 본 배럴(`@nerv/schema`)은 **브라우저도 읽는다** — apps/web 의 37개 파일이 여기서 import 한다.
//
// 이 파일이 있는 이유는 같은 결함이 두 번 났기 때문이다:
//   ① `migrate`·`seed` 재수출 → `pg` 가 번들에 들어가 `Buffer is not defined`
//   ② `displayKey` 의 `node:crypto` → 페이지 로드에서 `Module "node:crypto" has been
//      externalized for browser compatibility`
// 둘 다 **단위 테스트는 통과했다** — 노드에서 돌기 때문이다. 잡히는 자리는 브라우저뿐이라
// 여기서 소스를 직접 본다. 노드 전용 코드는 서브패스(`./migrate` · `./keys`)로 나간다.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = dirname(fileURLToPath(import.meta.url));
/** 서브패스로 이미 나간 것들 — 배럴이 이들을 재수출하지 않는지도 아래에서 본다 */
const NODE_ONLY = ['migrate.ts', 'migrate-entry.ts', 'seed.ts', 'keys.ts', 'keys-entry.ts'];

/** 배럴에서 도달 가능한 소스 파일을 `export *` 를 따라 모은다 */
function reachable(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  let text: string;
  try {
    text = readFileSync(entry, 'utf8');
  } catch {
    return seen; // 후보 경로였을 뿐 — 없는 파일을 목록에 넣으면 검사가 자기 발에 걸린다
  }
  seen.add(entry);
  for (const m of text.matchAll(/from '(\.[^']+)\.js'/g)) {
    const base = join(dirname(entry), m[1]!);
    reachable(`${base}.ts`, seen); // `./ids.js` → ids.ts
    reachable(join(base, 'index.ts'), seen); // `./tables/index.js` → tables/index.ts
  }
  return seen;
}

describe('@nerv/schema 본 배럴 — 브라우저 안전', () => {
  const files = [...reachable(join(SRC, 'index.ts'))].filter((f) => f.endsWith('.ts'));

  it('노드 내장 모듈을 끌어오지 않는다', () => {
    const offenders = files
      .map((f) => [f, readFileSync(f, 'utf8')] as const)
      .filter(([, t]) => /from 'node:/.test(t))
      .map(([f]) => f.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });

  it('`pg` 를 끌어오지 않는다 — 드라이버는 브라우저의 것이 아니다', () => {
    const offenders = files
      .map((f) => [f, readFileSync(f, 'utf8')] as const)
      .filter(([, t]) => /from 'pg'|require\('pg'\)/.test(t))
      .map(([f]) => f.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });

  it('노드 전용 파일은 배럴에서 도달할 수 없다', () => {
    const leaked = NODE_ONLY.filter((n) => files.includes(join(SRC, n)));
    expect(leaked).toEqual([]);
  });

  it('지켜야 할 노드 전용 파일이 실제로 존재한다 — 목록이 낡으면 이 검사가 빈 검사가 된다', () => {
    const present = readdirSync(SRC);
    for (const name of NODE_ONLY) expect(present).toContain(name);
  });
});
