// 권한으로 잠근 단추는 사유를 단다 — 셈으로 지킨다 (2026-09-25 · UI/UX 검토 SYS-08 · REQ-WEB-003)
//
// 비활성 단추 일흔 남짓 가운데 권한으로 잠긴 것에도 사유가 없거나(고장인지 권한인지 알 수 없다) `title` 로만
// 달려 있었다(hover 뿐 — 키보드·터치에 닿지 않는다). 한 번 다 고쳐 두어도 다음 화면이 같은 모양으로 들어온다.
// 그래서 소스를 센다: `disabled` 식에 권한 판정(`!can…` · `!isAdmin` · `!orgAdmin` …)이 들어간 `<Button>` 은
// `disabledReason` 을, `<ConfirmAction>` 은 사유 자리(`title`)를 가져야 한다.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : sources(p);
    return /\.tsx$/.test(name) && !/\.spec\.tsx$/.test(name) ? [p] : [];
  });
}

/** 여는 태그 전체 — 중괄호 안의 `>`(`() =>` · 비교)는 태그를 닫지 않는다 */
function openingTag(source: string, start: number): string {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0 && source[i - 1] !== '=') return source.slice(start, i + 1);
  }
  return source.slice(start);
}

const PERMISSION = /!\s*(can[A-Z]\w*|is(?:Org)?Admin|orgAdmin|privileged)\b/;

describe('권한으로 잠근 단추는 사유를 단다 (REQ-WEB-003)', () => {
  it('disabled 에 권한 판정이 있으면 disabledReason(ConfirmAction 은 title)이 있다', () => {
    const missing: string[] = [];
    let counted = 0;
    for (const file of sources(SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/<(Button|ConfirmAction)\b/g)) {
        const tag = openingTag(source, match.index ?? 0);
        const disabled = /\bdisabled=\{([^}]*)\}/.exec(tag)?.[1] ?? '';
        if (!PERMISSION.test(disabled)) continue;
        counted++;
        const reasoned =
          match[1] === 'ConfirmAction' ? /\btitle=/.test(tag) : /\bdisabledReason=/.test(tag);
        if (!reasoned) {
          const line = source.slice(0, match.index).split('\n').length;
          missing.push(`${file.slice(SRC.length + 1)}:${line}`);
        }
      }
    }
    // 전제 — 세는 대상이 있다(0 이면 위 식이 아무것도 잡지 못하는 것이다)
    expect(counted).toBeGreaterThan(5);
    expect(missing).toEqual([]);
  });
});
