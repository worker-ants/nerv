// **문서가 인용하는 스키마 이름이 실재하는가** — api.md §1.7 (REQ-API-113)
//
// §1.7 은 "요청 열은 zod 스키마 이름이고 `packages/schema` export 와 1:1" 이라 못 박는다.
// 그 선언이 **오랫동안 거짓이었다**: 2026-09-05 감사에서 문서가 인용하는 이름 대부분이
// 코드 어디에도 없었고, 컨트롤러는 `Record<string, unknown>` 을 손으로 파싱했다.
//
// 없는 문서는 사람을 헤매게 하지만 **틀린 문서는 확신을 준다.** 그래서 이 검사는
// 스키마의 동작이 아니라 **선언의 참·거짓**을 센다 — 한 번 고친 선언이 다시 거짓이
// 되는 것은 검사가 막고, 새 스키마를 더하는 것은 사람이 한다.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as schema from './index.js';

const DOCS = join(dirname(fileURLToPath(import.meta.url)), '../../../../../docs/04-mvp/api.md');

/** 전표의 "요청" 열이 인용하는 `*Input`·`*Query` 이름 — 응답(`*Result`)은 계약의 이름이다 */
function citedInputNames(): string[] {
  const md = readFileSync(DOCS, 'utf8');
  const names = new Set<string>();
  // 전표 행에서만 센다 — 산문에 예시로 나오는 이름까지 세면 "만들지 않은 것" 과
  // "설명에 쓴 것" 이 섞인다. 열 위치로 자르지 않는 이유는 권한 열이 코드 스팬 안에
  // 파이프를 담을 수 있어서다.
  for (const line of md.split('\n')) {
    if (!/^\| EP-[A-Z]+-\d+ \|/.test(line)) continue;
    for (const m of line.matchAll(/`([A-Z][A-Za-z]*Input)`/g)) names.add(m[1]!);
  }
  return [...names].sort();
}

describe('api.md §1.7 — 문서가 인용하는 요청 스키마는 실재한다', () => {
  it('전표의 `*Input` 이름이 전부 `@nerv/schema` 에 있다', () => {
    const exported = new Set(Object.keys(schema));
    const missing = citedInputNames().filter((n) => !exported.has(n));
    // 남은 이름이 있으면 그것은 **아직 만들지 않은 스키마**다 — 목록을 그대로 보여준다.
    expect({ missing, total: citedInputNames().length }).toEqual({
      missing: [],
      total: citedInputNames().length,
    });
  });

  it('세는 대상이 실제로 있다 — 정규식이 조용히 0건을 세면 이 검사는 아무것도 안 한다', () => {
    expect(citedInputNames().length).toBeGreaterThan(20);
  });
});
