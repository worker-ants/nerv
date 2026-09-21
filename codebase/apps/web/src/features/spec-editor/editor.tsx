// TipTap 에디터 — 정본: screens.md §3.1~§3.2
//
// **저장 포맷은 markdown 이고 메타는 DB 컬럼이다**(D-09). 그래서 이 컴포넌트의 계약은
// "md 를 받아 md 를 돌려준다"이지 "리치 문서를 편집한다"가 아니다.
//
// 왕복 검증(§3.2 규칙 2)이 저장의 전제다: serialize(parse(serialize(doc))) 가 serialize(doc)
// 와 다르면 저장을 **막는다**. 직렬화가 안정적이지 않은 문서를 저장하면 웹과 터미널이 같은
// 초안을 오갈 때마다 정규화 차이만으로 diff 가 생기고, 그러면 버전 이력이 거짓말을 시작한다.
// 이 실측이 Milkdown 재검토 트리거의 입력이기도 하다(scope.md §2).

import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { CodeBlock } from '@tiptap/extension-code-block';
import { Image } from '@tiptap/extension-image';
import { Link } from '@tiptap/extension-link';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { apiHref } from '../../lib/config.js';
import { MermaidBlock } from './mermaid-block.js';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Markdown } from 'tiptap-markdown';
import { useEffect } from 'react';

/**
 * 본문에 남은 **API 상대 주소**를 그릴 때만 이 배치의 API 오리진에 붙인다 — REQ-WEB-166.
 *
 * 첨부를 본문에 넣으면 주소는 `/api/v1/projects/{slug}/attachments/{id}` 로 남는다
 * (docs/04-mvp/api.md REQ-API-089). **그 모양으로 남는 것이 옳다** —
 * 절대 주소를 박으면 문서가 배치에 묶여, 도메인을 바꾼 날 옛 스펙의 그림이 전부 깨진다.
 * 대신 브라우저가 그 주소를 **스스로 해소하는** 자리(`<img src>`·`<a href>`)에서만 붙인다:
 * 상대 경로면 화면이 뜬 오리진으로 가는데, 호스트를 가른 배치에는 그쪽에 API 가 없다.
 *
 * **바꾸는 것은 DOM 뿐이고 노드의 attrs 는 그대로다** — md 직렬화는 attrs 를 읽으므로
 * 왕복(§3.2 규칙 2)에 닿지 않는다. 한 호스트 배치에서는 `apiHref` 가 항등이라 이 함수가
 * 있어도 없어도 같다.
 */
function withApiOrigin<T extends Record<string, unknown>>(attrs: T, key: 'src' | 'href'): T {
  const value = attrs[key];
  if (typeof value !== 'string' || !value.startsWith('/api/')) return attrs;
  return { ...attrs, [key]: apiHref(value) };
}

/** 화이트리스트 — md 로 표현 가능한 것만(§3.1). 색·밑줄·이미지 업로드는 확장하지 않는다. */
export const EDITOR_EXTENSIONS = [
  // **StarterKit 의 것을 갈아 끼운다 — 더하지 않는다.** StarterKit 은 link 도 codeBlock 도
  // 자기 안에 갖고 있어서, 같은 이름을 **더하면** 확장 이름이 중복돼 경고가 나고 마크
  // 처리 순서가 흔들린다(실측: 왕복 스파이크에서 경고로 드러났다). 그래서 둘은 `false` 로
  // 빼고 바로 아래에서 같은 이름으로 다시 세운다 — 이름이 하나뿐이라 순서도 그대로다.
  //
  // 갈아 끼우는 이유는 각각 하나씩이다: codeBlock 은 노드뷰(2026-08-30 — `language` 가
  // `mermaid` 면 읽을 때 그림으로 그린다), link 는 renderHTML(아래). **둘 다 md 직렬화는
  // 건드리지 않는다** — 직렬화는 노드·마크의 attrs 를 읽고, 우리가 바꾸는 것은 DOM 뿐이다.
  StarterKit.configure({ link: false, codeBlock: false }),
  Link.extend({
    renderHTML(props) {
      const patched = { ...props, HTMLAttributes: withApiOrigin(props.HTMLAttributes, 'href') };
      return this.parent?.(patched) ?? ['a', patched.HTMLAttributes, 0];
    },
  }).configure({
    // **읽기 전용 본문에서는 브라우저의 기본 동작이 링크를 연다**(그때만 contenteditable 이
    // 아니다). 편집 중에는 누른 자리에 커서가 서야 하므로 tiptap 의 클릭 핸들러는 달지 않는다.
    openOnClick: false,
  }),
  CodeBlock.extend({
    addNodeView: () => ReactNodeViewRenderer(MermaidBlock),
  }),
  // **이미지가 조용히 사라지고 있었다**(실측 2026-09-01). StarterKit 에 image 노드가 없어서
  // `![시안](…)` 이 파싱 단계에서 버려졌고, 사람이 그 문서를 열어 한 글자만 고치면 그
  // 순간 모든 이미지가 삭제됐다 — 저장은 성공하면서. §3.2 규칙 4("화이트리스트 밖 구문은
  // 본문을 재작성하지 않는다")를 이미지가 어기고 있었던 것이다.
  //
  // **주소는 그릴 때 이 배치의 것이 된다**(2026-09-21 · REQ-WEB-166 — `withApiOrigin` 주석).
  Image.extend({
    renderHTML(props) {
      const patched = { ...props, HTMLAttributes: withApiOrigin(props.HTMLAttributes, 'src') };
      return this.parent?.(patched) ?? ['img', patched.HTMLAttributes];
    },
  }).configure({ inline: true, allowBase64: false }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  Markdown.configure({ html: false, breaks: false, transformPastedText: true }),
];

export interface RoundTripResult {
  stable: boolean;
  serialized: string;
  reserialized: string;
}

export interface SpecEditorProps {
  value: string;
}

/**
 * 본문을 그린다 — **읽기 전용이다**(2026-09-22 사람 결정 · screens.md §3.1 개정 · REQ-WEB-173).
 *
 * 웹에서 본문을 고치는 경로를 걷어냈으므로 이 컴포넌트는 **md 를 화면으로** 옮기기만 한다.
 * 없어진 것 셋과 그 이유:
 *   - `onChange`·`readOnly` — 고칠 면이 없으니 바깥에 돌려줄 것도, 가를 축도 없다
 *   - 자체 소스 토글 — 그 자리는 이제 라우트의 **탭**이다(본문 보기: 뷰어 · 소스)
 *   - 스펙 링크 고르개 — 본문에 무언가를 넣는 수단은 전부 편집 경로의 것이었다
 *
 * **직렬화는 이제 아무 데도 쓰이지 않는다.** 웹이 md 를 되돌려 보내지 않으므로 왕복 손실이
 * 데이터에 닿을 경로가 사라졌다(scope.md §2.2 점화 기록 ② 갱신) — `roundTrip`·`normalize`
 * 는 스파이크 기록을 위해 남는다.
 */
export function SpecEditor({ value }: SpecEditorProps): React.JSX.Element {
  const editor = useEditor({ extensions: EDITOR_EXTENSIONS, content: value, editable: false });

  // **본문은 나중에 도착한다.** `content: value` 는 에디터를 만들 때 한 번만 읽히는데,
  // 첫 렌더에서 value 는 아직 빈 문자열이다(쿼리가 안 끝났다). 이 동기화가 없으면
  // 스펙 본문이 영영 화면에 뜨지 않는다 — 실측으로 잡은 결함이다.
  useEffect(() => {
    if (editor === null) return;
    const storage = editor.storage as { markdown?: { getMarkdown: () => string } };
    const current = storage.markdown?.getMarkdown() ?? '';
    if (normalize(current) === normalize(value)) return;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  // **읽을 때는 상자에 넣지 않는다**(2026-08-23 재검토). 테두리는 "여기가 고칠 수 있는
  // 면"이라는 표시인데 이제 그런 면이 없다 — 상자에 넣으면 페이지 안에 페이지가 있는
  // 꼴이 되고, 그것이 문서를 텍스트 덩어리로 만든다.
  return (
    <EditorContent
      editor={editor}
      data-testid="editor-content"
      className="prose-nerv min-h-[40vh] px-0 py-1 [&_.ProseMirror]:outline-none"
    />
  );
}

/**
 * 왕복 안정성 검사 — 같은 serializer 로 두 번 돌려 결과가 같은지 본다.
 * 다르면 저장을 막는 쪽이 옳다: 여기서 통과시키면 손실이 조용히 커밋된다.
 */
export function roundTrip(
  editor: { storage: unknown; commands?: unknown },
  serialized: string,
): RoundTripResult {
  const storage = editor.storage as {
    markdown?: {
      parser: { parse: (md: string) => unknown };
      serializer: { serialize: (doc: unknown) => string };
    };
  };
  const markdown = storage.markdown;
  if (markdown === undefined) return { stable: true, serialized, reserialized: serialized };
  try {
    const reserialized = markdown.serializer.serialize(markdown.parser.parse(serialized));
    return { stable: normalize(reserialized) === normalize(serialized), serialized, reserialized };
  } catch {
    // 파싱 실패는 불안정으로 친다 — 판단할 수 없으면 막는 쪽이 안전하다.
    return { stable: false, serialized, reserialized: '' };
  }
}

/** 줄 끝 공백·문서 끝 개행은 의미 차이가 아니다 — 그것으로 저장을 막지 않는다. */
export function normalize(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
}
