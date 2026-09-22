// 개발 시드 SQL 이 문서의 사본과 갈라지지 않았는가 (REQ-CB-048)
//
// **[4.3 데이터베이스](docs/04-mvp/database.md) §4 는 이 파일 전문을 코드 블록으로 싣는다.**
// 사람은 문서를 읽고 실행되는 것은 이 파일이라, 두 쪽이 갈라지면 문서가 **틀린 채로 확신을
// 준다.** 그리고 실제로 갈라져 있었다 — 2026-09-21 에 시드 본문에 넣은 mermaid 블록
// (REQ-WEB-169)이 문서에는 반영된 적이 없었고, **넉 달 가까이 아무도 몰랐다.**
//
// 못 잡은 이유는 그물의 모양이다. 규약 1 의 검사(`check-md-html.mjs`)가 세는 것은 버전 ·
// 절 번호 · 고정 ID 이고, **코드 블록 안쪽은 아무 검사도 보지 않는다.** 이 저장소는 같은
// 자리에서 같은 처방을 이미 한 번 골랐다 — 스킬과 [4.6 플러그인](docs/04-mvp/plugin.md) 은
// `plugin/plugin-package.spec.ts` 가 **바이트로** 대조한다. 여기도 같게 한다.
//
// 고치는 쪽은 언제나 **문서**다: SQL 파일이 정본이고 블록은 그 사본이다.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { seedSqlPath } from './seed.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const DOC = join(REPO, 'docs/04-mvp/database.md');

/**
 * §4 의 `sql` 블록 하나를 뽑는다.
 *
 * **앞에서부터 찾는다** — 이 문서에는 DDL 블록이 여럿이고, 뒤에서 찾거나 아무 `sql`
 * 블록이나 집으면 남의 절을 대조하게 된다. 시드 블록은 자기 첫 줄이 스스로를 밝힌다.
 */
function seedBlockFromDoc(): string {
  const lines = readFileSync(DOC, 'utf8').split('\n');
  const head = lines.findIndex((line) => line.startsWith('-- 개발 시드 — 정본:'));
  if (head === -1) throw new Error(`${DOC} 에 개발 시드 블록이 없다`);
  if (lines[head - 1]?.trim() !== '```sql') throw new Error('시드 블록의 여는 울타리가 없다');
  const end = lines.indexOf('```', head);
  if (end === -1) throw new Error('시드 블록의 닫는 울타리가 없다');
  return lines.slice(head, end).join('\n').trimEnd();
}

describe('개발 시드 SQL ↔ 문서 사본 (REQ-CB-048)', () => {
  it('바이트가 같다 — 갈라지면 문서를 고친다(정본은 SQL 파일이다)', () => {
    expect(seedBlockFromDoc()).toBe(readFileSync(seedSqlPath(), 'utf8').trimEnd());
  });
});
