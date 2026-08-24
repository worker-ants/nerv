// 문서 본문 렌더 — markdown → HTML(`prose-nerv`)
//
// 제품 매뉴얼이 쓰는 유일한 렌더 경로다. 파서를 새로 짜지 않는다: `markdown-it` 은
// 이미 의존성 트리에 있고(스펙 편집기의 `tiptap-markdown` 이 쓴다) 같은 버전을 명시적
// 의존으로 올린 것뿐이라, 새로 들어온 패키지는 없다.
//
// **`html: false` 가 이 파일의 안전 계약이다.** 본문에 섞인 원시 HTML 은 태그가 아니라
// 글자로 이스케이프된다 — 그래서 렌더 결과를 `dangerouslySetInnerHTML` 로 붙여도 되고,
// 매뉴얼 md 가 스크립트를 실어 나를 길이 없다. 이 값을 켜는 순간 그 계약이 깨진다.

import MarkdownIt from 'markdown-it';

export interface DocHeading {
  /** 앵커 id — 로케일과 무관하게 **순서**로 짓는다(아래 renderDoc 주석) */
  readonly id: string;
  readonly text: string;
}

export interface RenderedDoc {
  readonly html: string;
  /** 문서 안 목차 — `##` 만 담는다. `###` 까지 담으면 목차가 본문만큼 길어진다 */
  readonly headings: readonly DocHeading[];
}

const md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false });

/**
 * 본문을 HTML 로, `##` 목록을 목차로.
 *
 * 앵커 id 를 제목 글자가 아니라 **순서**(`sec-1`, `sec-2`…)로 짓는다. 제목에서 뽑으면
 * 같은 절의 앵커가 로케일마다 달라져, 한국어로 복사한 링크가 영어 화면에서 아무 데도
 * 가리키지 못한다 — 매뉴얼은 링크로 주고받는 문서라 그 차이가 바로 드러난다.
 */
export function renderDoc(source: string): RenderedDoc {
  const env = {};
  const tokens = md.parse(source, env);
  const headings: DocHeading[] = [];

  for (const [index, token] of tokens.entries()) {
    if (token.type !== 'heading_open' || token.tag !== 'h2') continue;
    const inline = tokens[index + 1];
    const id = `sec-${headings.length + 1}`;
    token.attrSet('id', id);
    // 목차는 글자만 쓴다 — 제목 안의 `**`·`` ` `` 는 마크업이지 이름이 아니다
    headings.push({ id, text: (inline?.content ?? '').replace(/[*`]/g, '') });
  }

  return { html: md.renderer.render(tokens, md.options, env), headings };
}
