// mermaid 코드블록 — 읽을 때는 그림으로 (screens.md §3.1b · REQ-WEB-113)
//
// 에이전트가 스펙에 **아스키 아트로 다이어그램을 그리고 있었다**(사람 보고 2026-08-30).
// 시킨 대로 한 결과다: 아무도 다른 길을 말해 주지 않았다.
//
// 저장 쪽은 이미 되어 있었다 — TipTap 왕복에서 ```mermaid 펜스는 **언어 태그까지
// 무손실**이다(실측 2026-08-30). 그래서 필요한 것은 렌더 하나뿐이다.
//
// **읽을 때만 그린다.** 편집 중에는 문법이 깨진 상태가 대부분이라 미리보기가 계속
// 오류를 띄운다 — clemvion 이 mermaid 린트 훅을 붙였던 이유가 그것이다.
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

export function MermaidBlock(props: NodeViewProps): React.JSX.Element {
  const t = useT();
  const { resolved } = useTheme();
  const language = String(props.node.attrs['language'] ?? '');
  const isMermaid = language === 'mermaid';
  // 편집 가능한 동안에는 그리지 않는다 — 타이핑 중의 코드는 대부분 문법이 깨져 있다
  const draw = isMermaid && !props.editor.isEditable;
  const code = props.node.textContent;

  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const idRef = useRef(`mermaid-${(seq += 1)}`);

  useEffect(() => {
    if (!draw || code.trim() === '') return;
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
  }, [draw, code, resolved]);

  if (draw && svg !== null) {
    return (
      <NodeViewWrapper
        data-testid="mermaid-figure"
        className="my-4 flex justify-center overflow-x-auto rounded-nerv border border-border bg-bg-elev px-3 py-4"
      >
        {/* mermaid 의 출력은 SVG 문자열이다. securityLevel:'strict' 가 스크립트와
            외부 참조를 걷어낸 뒤의 것이라 그대로 붙인다 */}
        <div
          className="[&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper>
      {failed && (
        <p data-testid="mermaid-failed" className="mb-1 text-2xs text-status-waiting">
          {t('spec.mermaid_failed')}
        </p>
      )}
      {/* 코드 그대로 — 편집 중이거나 문법이 깨졌을 때의 자리다 */}
      <pre className="rounded-nerv border border-border bg-code-bg p-3 font-mono text-xs text-code-text">
        <NodeViewContent />
      </pre>
    </NodeViewWrapper>
  );
}
