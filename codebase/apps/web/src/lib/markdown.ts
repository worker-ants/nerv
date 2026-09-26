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
  /**
   * 다이어그램 원본 — `diagrams` 를 켰을 때만 찬다. `html` 안의 `data-diagram="N"` 자리가 N 번째 원본이다
   * (REQ-WEB-243). 켜지 않았으면 빈 배열이고 mermaid 펜스는 여느 코드블록이다.
   */
  readonly diagrams: readonly string[];
}

export interface RenderOptions {
  /**
   * 코드블록에 붙일 복사 단추의 글자. **없으면 단추를 붙이지 않는다** — 이 렌더러는
   * 매뉴얼 말고도 쓰이고, 복사할 이유가 없는 자리에 단추가 서면 그냥 잡음이다.
   */
  readonly copyLabel?: string;
  /**
   * ```mermaid 펜스를 **다이어그램 자리**로 바꾼다(2026-09-26 — 사람 지시 · REQ-WEB-243). 이 렌더러는
   * HTML 문자열을 내므로 그림을 직접 그리지 않는다 — 빈 자리(`<div data-diagram="N">`)만 남기고, 그 자리에
   * 무엇을 그릴지는 원본 목록(`diagrams`)으로 넘긴다. 도움말 화면이 그 자리에 다이어그램 컴포넌트를 붙인다.
   * 자리에는 원본을 넣지 않는다: 다이어그램 컴포넌트가 그리는 동안과 그리지 못했을 때 코드를 보인다.
   */
  readonly diagrams?: boolean;
}

/** 렌더 한 번에 딸려 다니는 값 — markdown-it 이 규칙에 그대로 넘긴다. */
interface DocEnv {
  copyLabel?: string;
  /** 켜져 있으면 mermaid 원본이 여기 쌓인다 — 순서가 곧 `data-diagram` 번호다 */
  diagrams?: string[];
}

const md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false });

/**
 * 코드블록에 복사 단추를 붙인다 — **매뉴얼의 코드블록은 복사하라고 있는 것이다.**
 *
 * 설치 장은 이 배치의 값으로 채워져 나오므로(`manual-vars.ts`) 그 블록들은 그대로
 * 붙여 넣으면 되는 글자다. 그런데 `pre` 안을 드래그로 긁으면 줄바꿈과 들여쓰기가
 * 섞여 들어온다 — 여러 줄짜리 명령이 특히 그렇다.
 *
 * 단추는 **글자만 우리 것이고 클릭은 본문 위임 핸들러가 받는다**(`help/$chapter.tsx`).
 * 여기서 이벤트를 심지 않는 이유는 이 결과가 `dangerouslySetInnerHTML` 로 붙기 때문이다 —
 * 붙는 HTML 에 스크립트가 낄 자리를 만들지 않는 것이 이 파일의 계약이다(`html: false`).
 */
const renderFence =
  md.renderer.rules.fence ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const diagrams = (env as DocEnv).diagrams;
  const token = tokens[idx];
  if (diagrams !== undefined && token !== undefined && token.info.trim() === 'mermaid') {
    diagrams.push(token.content);
    // 번호는 이 렌더러가 매긴다 — 본문의 원시 HTML 은 글자로 이스케이프되므로(`html: false`) 본문이 이
    // 자리를 흉내 낼 수 없다
    return `<div class="nerv-diagram" data-diagram="${diagrams.length - 1}"></div>\n`;
  }
  const html = renderFence(tokens, idx, options, env, self);
  const label = (env as DocEnv).copyLabel;
  if (label === undefined) return html;
  return (
    `<div class="nerv-code">${html}` +
    `<button type="button" class="nerv-copy" data-copy>${md.utils.escapeHtml(label)}</button></div>`
  );
};

/**
 * 본문을 HTML 로, `##` 목록을 목차로.
 *
 * 앵커 id 를 제목 글자가 아니라 **순서**(`sec-1`, `sec-2`…)로 짓는다. 제목에서 뽑으면
 * 같은 절의 앵커가 로케일마다 달라져, 한국어로 복사한 링크가 영어 화면에서 아무 데도
 * 가리키지 못한다 — 매뉴얼은 링크로 주고받는 문서라 그 차이가 바로 드러난다.
 */
export function renderDoc(source: string, options: RenderOptions = {}): RenderedDoc {
  const env: DocEnv = {
    ...(options.copyLabel === undefined ? {} : { copyLabel: options.copyLabel }),
    ...(options.diagrams === true ? { diagrams: [] } : {}),
  };
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

  const html = md.renderer.render(tokens, md.options, env);
  return { html, headings, diagrams: env.diagrams ?? [] };
}
