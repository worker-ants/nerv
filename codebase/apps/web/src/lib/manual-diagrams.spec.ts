// 매뉴얼의 상태도 (2026-09-26 — 사람 지시 · REQ-WEB-243)
//
// 도움말은 ```mermaid 펜스를 그림으로 그린다. 문법이 틀리면 화면에는 코드와 "그리지 못했습니다" 만 남는데,
// 그 사실은 누가 그 장을 열어 보기 전까지 드러나지 않는다. 여기서 실제 파서로 전부 읽는다.

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '@nerv/schema';
import { MANUAL_CHAPTERS } from './manual.js';
import { renderDoc } from './markdown.js';

const diagramsOf = (body: string): readonly string[] =>
  renderDoc(body, { diagrams: true }).diagrams;

describe('매뉴얼의 다이어그램', () => {
  it('상태도가 있는 장은 두 언어에 같은 수만큼 있다', () => {
    const counts = MANUAL_CHAPTERS.map((chapter) => ({
      id: chapter.id,
      ko: diagramsOf(chapter.body.ko).length,
      en: diagramsOf(chapter.body.en).length,
    }));
    for (const count of counts) expect(count.en, count.id).toBe(count.ko);
    // 스펙(문서 · 구현) · 작업 · 세션 · 초대 — 상태의 흐름이 있는 곳마다 한 장씩
    expect(Object.fromEntries(counts.map((c) => [c.id, c.ko]))).toMatchObject({
      specs: 2,
      tasks: 1,
      sessions: 1,
      settings: 1,
    });
  });

  it('모든 다이어그램이 mermaid 문법에 맞다 — 틀리면 화면에 코드만 남는다', async () => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    const broken: string[] = [];
    for (const chapter of MANUAL_CHAPTERS) {
      for (const locale of LOCALES) {
        for (const [index, code] of diagramsOf(chapter.body[locale]).entries()) {
          const ok = await mermaid.parse(code, { suppressErrors: true });
          if (ok === false) broken.push(`${chapter.id}/${locale}#${index}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('보조기기가 읽을 제목이 있다 — 도형만으로는 무엇을 그린 그림인지 알 수 없다', () => {
    const untitled: string[] = [];
    for (const chapter of MANUAL_CHAPTERS) {
      for (const locale of LOCALES) {
        for (const [index, code] of diagramsOf(chapter.body[locale]).entries()) {
          if (!/^\s*accTitle: .+/m.test(code)) untitled.push(`${chapter.id}/${locale}#${index}`);
        }
      }
    }
    expect(untitled).toEqual([]);
  });
});
