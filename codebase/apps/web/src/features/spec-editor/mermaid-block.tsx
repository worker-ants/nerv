// mermaid 코드블록 — 기본은 그림 (screens.md §3.1b · REQ-WEB-113 · REQ-WEB-169)
//
// 에이전트가 스펙에 **아스키 아트로 다이어그램을 그리고 있었다**(사람 보고 2026-08-30).
// 시킨 대로 한 결과다: 아무도 다른 길을 말해 주지 않았다.
//
// 저장 쪽은 이미 되어 있었다 — TipTap 왕복에서 ```mermaid 펜스는 **언어 태그까지
// 무손실**이다(실측 2026-08-30). 그래서 필요한 것은 렌더 하나뿐이다.
//
// **그리는 축이 틀려 있었다**(2026-09-21 — 사람 보고 · REQ-WEB-169). 예전 조건은
// `!editor.isEditable` 이었는데, 그 값은 "내가 지금 이 블록을 치고 있는가" 가 아니라
// **"이 문서가 초안인가"** 다(`editable = docStatus === 'draft' && 리스 없음`). 그래서
// **초안은 누가 열든 코드로 보였다** — 그런데 초안이야말로 에이전트가 다이어그램을 써 넣는
// 자리이고, 읽는 사람은 편집 중이 아니다. 이 기능을 만든 계기 자체가 초안에서 일어난 일이다.
//
// 이제 **기본은 그림이고**(문서 상태와 무관하다) 블록마다 [코드]·[그림] 토글이 있다
// (2026-09-21 사람 결정). 옛 조건이 막으려던 것 — 타이핑 중의 깨진 문법에 오류가 계속 뜨는
// 것 — 은 토글이 더 잘 막는다: 고치는 동안에는 [코드] 쪽에 있으므로 그릴 일이 없다.
//
// **그릴 때는 편집 내용을 내놓지 않는다**(`NodeViewContent` 를 그리지 않는다). contentDOM 이
// 없는 노드뷰를 ProseMirror 는 잎처럼 다루므로, 그림 안에 커서가 숨어들지 않는다 — 감춘 채로
// 두면 사람이 화살표로 내려가다 **보이지 않는 자리에 캐럿을 잃는다**. 원본은 문서 모델에
// 그대로 있고(직렬화가 읽는 것은 DOM 이 아니다) [코드]를 누르면 다시 편집할 수 있다.
//
// mermaid 는 번들이 크다(~500KB). **동적 import** 라 mermaid 블록이 실제로 그려질 때만
// 내려받는다 — 스펙 화면 전체가 그 비용을 지지 않는다.

import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../lib/i18n.js';
import { useTheme } from '../../lib/theme.js';

/** 같은 페이지에 여럿이 있어도 id 가 겹치지 않게 — mermaid 는 id 로 DOM 을 잡는다 */
let seq = 0;

const PRE = 'rounded-nerv border border-border bg-code-bg p-3 font-mono text-xs text-code-text';

export function MermaidBlock(props: NodeViewProps): React.JSX.Element {
  const t = useT();
  const { resolved } = useTheme();
  const language = String(props.node.attrs['language'] ?? '');
  const isMermaid = language === 'mermaid';
  const code = props.node.textContent;

  // **기본은 그림이다.** 사람이 이 블록에서 [코드]를 누른 동안에만 원본이 선다 —
  // 블록마다의 상태이고 문서에 저장되지 않는다(보는 방식이지 문서의 내용이 아니다).
  const [showCode, setShowCode] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const idRef = useRef(`mermaid-${(seq += 1)}`);

  // 빈 블록은 그릴 것이 없다 — ```mermaid 를 막 친 순간이 그것이라, 그때 오류를 띄우면
  // 사람은 자기가 틀린 줄 안다
  const wants = isMermaid && !showCode && code.trim() !== '';

  useEffect(() => {
    if (!wants) return;
    let alive = true;
    void (async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({
          startOnLoad: false,
          // 앱의 테마를 따른다 — 밝은 화면에 검은 상자가 뜨면 그것부터 눈에 띈다
          theme: resolved === 'dark' ? 'dark' : 'default',
          securityLevel: 'strict',
        });
        const { svg: out } = await mermaid.render(idRef.current, code);
        if (alive) {
          setSvg(out);
          setFailed(false);
        }
      } catch {
        // **코드를 감추지 않는다.** 문법이 틀렸을 때 그림도 글도 없으면 그 자리는 사라진다
        if (alive) {
          setSvg(null);
          setFailed(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [wants, code, resolved]);

  // mermaid 가 아닌 코드블록은 **건드리지 않는다** — 토글도 붙이지 않는다
  if (!isMermaid) {
    return (
      <NodeViewWrapper>
        <pre className={PRE}>
          <NodeViewContent />
        </pre>
      </NodeViewWrapper>
    );
  }

  const drawn = wants && svg !== null;

  return (
    <NodeViewWrapper data-testid="mermaid-block" className="relative my-4">
      {/* 토글은 **편집 내용이 아니다** — `contentEditable={false}` 가 그 경계다.
          그림 위에 얹지 않고 오른쪽 위 모서리에 둔다: 도형과 겹치면 둘 다 읽기 어렵다 */}
      <div contentEditable={false} className="absolute top-1.5 right-1.5 z-10">
        <button
          type="button"
          data-testid="mermaid-toggle"
          aria-pressed={showCode}
          title={showCode ? t('spec.mermaid_figure_title') : t('spec.mermaid_code_title')}
          onClick={() => setShowCode((on) => !on)}
          className="rounded-nerv-sm border border-border bg-bg-elev px-1.5 py-0.5 text-2xs text-text-mute hover:border-border-strong hover:text-text"
        >
          {showCode ? t('spec.mermaid_figure') : t('spec.mermaid_code')}
        </button>
      </div>

      {failed && !showCode && (
        <p data-testid="mermaid-failed" className="mb-1 text-2xs text-status-waiting">
          {t('spec.mermaid_failed')}
        </p>
      )}

      {drawn ? (
        <div
          data-testid="mermaid-figure"
          className="flex justify-center overflow-x-auto rounded-nerv border border-border bg-bg-elev px-3 py-4"
        >
          {/* mermaid 의 출력은 SVG 문자열이다. securityLevel:'strict' 가 스크립트와
              외부 참조를 걷어낸 뒤의 것이라 그대로 붙인다 */}
          <div
            className="[&_svg]:h-auto [&_svg]:max-w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      ) : (
        // 코드 그대로 — [코드]를 눌렀거나, 문법이 깨졌거나, 아직 빈 블록일 때의 자리다.
        // **여기에만 `NodeViewContent` 가 있다**: 편집할 수 있는 자리가 곧 보이는 자리다.
        <pre className={PRE}>
          <NodeViewContent />
        </pre>
      )}
    </NodeViewWrapper>
  );
}
