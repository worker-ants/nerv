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

  it('표·목록·코드 블록을 구분해 낸다 (REQ-WEB-047)', () => {
    const { html } = renderDoc('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n- 하나\n\n```\ncode\n```');
    expect(html).toContain('<table>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<pre>');
  });
});
