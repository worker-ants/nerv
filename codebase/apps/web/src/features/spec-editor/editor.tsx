// TipTap 에디터 — 정본: screens.md §3.1~§3.2
//
// **저장 포맷은 markdown 이고 메타는 DB 컬럼이다**(D-09). 그래서 이 컴포넌트의 계약은
// "md 를 받아 md 를 돌려준다"이지 "리치 문서를 편집한다"가 아니다.
//
// 왕복 검증(§3.2 규칙 2)이 저장의 전제다: serialize(parse(serialize(doc))) 가 serialize(doc)
// 와 다르면 저장을 **막는다**. 직렬화가 안정적이지 않은 문서를 저장하면 웹과 터미널이 같은
// 초안을 오갈 때마다 정규화 차이만으로 diff 가 생기고, 그러면 버전 이력이 거짓말을 시작한다.
// 이 실측이 Milkdown 재검토 트리거의 입력이기도 하다(scope.md §2).

import { useT } from '../../lib/i18n.js';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Markdown } from 'tiptap-markdown';
import { useEffect, useRef, useState } from 'react';

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
  const t = useT();
  const [showSource, setShowSource] = useState(false);
  /**
   * 바깥에서 마지막으로 밀어 넣은 본문. 두 가지를 이걸로 가른다:
   *   ① 아직 한 번도 동기화하지 않았다 = 편집기가 만들어지는 중이다 → 그때의 갱신은 편집이 아니다
   *   ② 같은 내용이 다시 흘러들어왔다 → 문서를 갈아끼우지 않는다(커서가 앞으로 튄다)
   */
  const synced = useRef<string | null>(null);

  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: value,
    editable: !readOnly,
    onUpdate: ({ editor: instance }) => {
      // **사람이 치지 않은 갱신은 편집이 아니다.** 편집기를 만드는 과정에서 빈 문서로 한 번
      // 울리는데(실측), 그걸 그대로 올리면 부모의 draft 가 빈 문자열로 굳는다 —
      // 그러면 `draft ?? body` 가 영영 빈 값이라 **스펙 본문이 화면에 뜨지 않는다**.
      // 읽기 전용 편집기에는 애초에 사람의 입력이 도달할 수 없다.
      if (!instance.isEditable || synced.current === null) return;
      const storage = instance.storage as { markdown?: { getMarkdown: () => string } };
      const serialized = storage.markdown?.getMarkdown() ?? '';
      // **바깥에서 넣은 것과 같으면 편집이 아니다.** 문서가 아직 안 왔을 때 이 편집기는
      // 빈 값으로 만들어지는데(부모의 doc_status 기본값이 draft 라 editable 이다), 그때의
      // 빈 갱신이 부모의 draft 를 '' 로 굳힌다. `draft ?? body` 는 빈 문자열을 통과시키므로
      // 본문이 도착해도 화면은 영영 백지다 — 실측으로 두 번 잡은 결함이다.
      if (serialized === synced.current) return;
      onChange(serialized, roundTrip(instance, serialized));
    },
  });

  useEffect(() => {
    if (editor === null) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  // **본문은 나중에 도착한다.** `content: value` 는 에디터를 만들 때 한 번만 읽히는데,
  // 첫 렌더에서 value 는 아직 빈 문자열이다(쿼리가 안 끝났다). 이 동기화가 없으면
  // 스펙 본문이 영영 화면에 뜨지 않는다 — 실측으로 잡은 결함이다.
  //
  // 사용자가 타이핑한 결과가 value 로 되돌아오는 경로도 있어서(부모가 draft 를 들고 있다)
  // **지금 문서와 같은 내용이면 손대지 않는다** — 그러지 않으면 한 글자마다 커서가 앞으로
  // 튄다. emitUpdate:false 로 onChange 도 울리지 않는다: 바깥에서 온 값은 편집이 아니다.
  useEffect(() => {
    if (editor === null) return;
    const storage = editor.storage as { markdown?: { getMarkdown: () => string } };
    const current = storage.markdown?.getMarkdown() ?? '';
    synced.current = value;
    if (normalize(current) === normalize(value)) return;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setShowSource((s) => !s)}
          className="rounded-nerv-sm border border-border bg-bg-elev px-2 py-0.5 hover:bg-bg-hover"
        >
          {showSource ? t('spec.editor.rich') : t('spec.editor.source')}
        </button>
        {/* 소스는 read-only 토글이다 — 소스를 직접 고치는 경로는 MVP 에 없다(§3.1) */}
        {showSource && <span className="text-text-faint">{t('spec.editor.source_readonly')}</span>}
      </div>

      {showSource ? (
        <pre
          data-testid="editor-source"
          className="max-h-[60vh] overflow-auto rounded-nerv border border-border bg-code-bg p-4 font-mono text-xs whitespace-pre-wrap text-code-text"
        >
          {value}
        </pre>
      ) : (
        <EditorContent
          editor={editor}
          data-testid="editor-content"
          className="prose-nerv min-h-[40vh] rounded-nerv border border-border bg-bg-elev px-5 py-4 [&_.ProseMirror]:outline-none"
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
