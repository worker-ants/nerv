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
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Markdown } from 'tiptap-markdown';
import { useEffect, useState } from 'react';

/** 화이트리스트 — md 로 표현 가능한 것만(§3.1). 색·밑줄·이미지 업로드는 확장하지 않는다. */
export const EDITOR_EXTENSIONS = [
  // StarterKit 이 link 를 포함한다 — 따로 추가하면 확장 이름이 중복돼 경고가 나고
  // 마크 처리 순서가 흔들린다(실측: 왕복 스파이크에서 경고로 드러났다).
  StarterKit.configure({ link: { openOnClick: false } }),
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
  readOnly: boolean;
  onChange: (markdown: string, roundTrip: RoundTripResult) => void;
}

export function SpecEditor({ value, readOnly, onChange }: SpecEditorProps): React.JSX.Element {
  const [showSource, setShowSource] = useState(false);

  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: value,
    editable: !readOnly,
    onUpdate: ({ editor: instance }) => {
      const storage = instance.storage as { markdown?: { getMarkdown: () => string } };
      const serialized = storage.markdown?.getMarkdown() ?? '';
      onChange(serialized, roundTrip(instance, serialized));
    },
  });

  useEffect(() => {
    if (editor === null) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setShowSource((s) => !s)}
          className="rounded border border-border px-2 py-0.5"
        >
          {showSource ? '편집 보기' : '소스 보기'}
        </button>
        {/* 소스는 read-only 토글이다 — 소스를 직접 고치는 경로는 MVP 에 없다(§3.1) */}
        {showSource && <span className="text-text-faint">읽기 전용 — 편집은 터미널 경로로</span>}
      </div>

      {showSource ? (
        <pre
          data-testid="editor-source"
          className="max-h-[60vh] overflow-auto rounded border border-border bg-code-bg p-3 text-xs text-code-text"
        >
          {value}
        </pre>
      ) : (
        <EditorContent
          editor={editor}
          data-testid="editor-content"
          className="prose-nerv min-h-[40vh] rounded border border-border bg-bg-elev p-3"
        />
      )}
    </div>
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
