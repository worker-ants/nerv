// 문서 렌더 — 안전 계약과 목차 규약.
//
// 파서 자체는 markdown-it 소관이라 문법을 전수로 보지 않는다. 여기서 지키는 것은 **우리가
// 정한 것** 둘이다: 원시 HTML 이 태그가 되지 않는다는 것과, 앵커가 로케일과 무관하다는 것.

import { describe, expect, it } from 'vitest';
import { renderDoc } from './markdown.js';

describe('renderDoc', () => {
  it('원시 HTML 은 태그가 아니라 글자다 — 이 계약이 dangerouslySetInnerHTML 을 떠받친다', () => {
    const { html } = renderDoc('<script>alert(1)</script>\n\n<b>굵게</b>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('`##` 은 순서로 앵커를 받는다 — 제목 글자에서 뽑으면 로케일마다 앵커가 달라진다', () => {
    const ko = renderDoc('## 시작하기\n\n본문\n\n## 다음 절\n\n본문');
    const en = renderDoc('## Getting started\n\nBody\n\n## Next\n\nBody');
    expect(ko.headings.map((h) => h.id)).toEqual(['sec-1', 'sec-2']);
    expect(en.headings.map((h) => h.id)).toEqual(['sec-1', 'sec-2']);
    expect(ko.html).toContain('id="sec-1"');
  });

  it('목차는 `##` 만 담는다 — `###` 까지 담으면 목차가 본문만큼 길어진다', () => {
    const { headings } = renderDoc('## 절\n\n### 하위\n\n## 다른 절');
    expect(headings.map((h) => h.text)).toEqual(['절', '다른 절']);
  });

  it('제목의 마크업은 이름이 아니다 — 목차에는 글자만 남는다', () => {
    const { headings } = renderDoc('## **굵은** `코드` 제목');
    expect(headings[0]?.text).toBe('굵은 코드 제목');
  });

  it('복사 단추는 글자를 줬을 때만 붙는다 — 복사할 이유가 없는 자리의 단추는 잡음이다', () => {
    const plain = renderDoc('```\ncode\n```');
    expect(plain.html).not.toContain('data-copy');

    const withButton = renderDoc('```\ncode\n```', { copyLabel: '복사' });
    expect(withButton.html).toContain('class="nerv-code"');
    expect(withButton.html).toContain('data-copy');
    expect(withButton.html).toContain('>복사</button>');
  });

  it('단추 글자도 이스케이프된다 — 붙는 HTML 에 태그가 낄 자리를 만들지 않는다', () => {
    const { html } = renderDoc('```\ncode\n```', { copyLabel: '<b>복사</b>' });
    expect(html).not.toContain('<b>복사</b>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('인라인 코드에는 단추가 붙지 않는다 — 한 낱말을 복사하려고 단추를 두지 않는다', () => {
    const { html } = renderDoc('본문 안의 `코드` 한 낱말', { copyLabel: '복사' });
    expect(html).not.toContain('data-copy');
  });

  it('표·목록·코드 블록을 구분해 낸다 (REQ-WEB-047)', () => {
    const { html } = renderDoc('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n- 하나\n\n```\ncode\n```');
    expect(html).toContain('<table>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<pre>');
  });
});
