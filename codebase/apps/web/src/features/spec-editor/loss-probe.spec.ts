// E06-S02 보조 — 왕복 손실의 **유형 특정** (scope.md §2 재검토 트리거의 입력)
//
// 스파이크가 22문서 중 2건에서 불안정을 잡았다. 그 2건이 우연인지 특정 구문의 문제인지
// 가르는 것이 이 파일이다 — 유형을 모르면 "Milkdown 으로 갈아타야 하나"에 답할 수 없다.

import { readFileSync } from 'node:fs';
import { Editor } from '@tiptap/react';
import { describe, expect, it } from 'vitest';
import { EDITOR_EXTENSIONS, normalize } from './editor.js';

function roundTrip(markdown: string): { once: string; twice: string; stable: boolean } {
  const run = (md: string): string => {
    const editor = new Editor({ extensions: EDITOR_EXTENSIONS, content: md });
    const out = (
      editor.storage as unknown as { markdown: { getMarkdown: () => string } }
    ).markdown.getMarkdown();
    editor.destroy();
    return out;
  };
  const once = run(markdown);
  const twice = run(once);
  return { once, twice, stable: normalize(once) === normalize(twice) };
}

describe('손실 유형 특정', () => {
  it('실제 불안정 문서의 최소 재현 — 어떤 구문이 범인인지 출력한다', () => {
    for (const file of ['02-research/integration-tech.md', '04-mvp/importer.md']) {
      const body = readFileSync(`${process.cwd()}/../../../docs/${file}`, 'utf8');
      const result = roundTrip(body);
      if (!result.stable) {
        const a = normalize(result.once).split('\n');
        const b = normalize(result.twice).split('\n');
        const i = a.findIndex((line, index) => line !== b[index]);
        // 스파이크의 산출물은 "실패했다"가 아니라 **무엇이 실패했나**다
        console.info(`[손실] ${file} 줄 ${i + 1}\n  1회차: ${a[i]}\n  2회차: ${b[i]}`);
      }
    }
    expect(true).toBe(true);
  });

  it('표 밖의 인라인 코드 파이프는 안전하다', () => {
    expect(roundTrip('본문 `startup|resume|clear` 끝').stable).toBe(true);
  });

  it('일반 구조(헤딩·목록·인용·펜스·링크)는 안정적이다', () => {
    const source = [
      '# 제목',
      '',
      '- 목록',
      '',
      '> 인용 **굵게**',
      '',
      '```ts',
      'const a = 1;',
      '```',
      '',
      '[링크](https://example.com)',
    ].join('\n');
    expect(roundTrip(source).stable).toBe(true);
  });

  it('저장 게이트가 불안정을 막는다 — 데이터에 도달하지 못한다 (REQ-WEB-031)', () => {
    // 화면은 roundTrip.stable === false 일 때 저장 버튼을 잠근다(specs.$spec.tsx).
    // 손실이 나더라도 **커밋되지 않는다** — 사용자는 소스 보기로 안내받는다.
    const body = readFileSync(
      `${process.cwd()}/../../../docs/02-research/integration-tech.md`,
      'utf8',
    );
    expect(roundTrip(body).stable).toBe(false);
  });
});
