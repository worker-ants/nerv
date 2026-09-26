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
// **그림은 항상 칸 폭에 맞춰 줄어들고 있었다**(2026-09-22 — 사람 보고 · REQ-WEB-172).
// mermaid 의 `useMaxWidth` 기본값이 `true` 라 출력 SVG 가 담긴 칸에 맞춰 축소되므로,
// 노드가 많은 다이어그램은 **글자를 읽을 수 없는 크기**로 그려졌다 — 스펙 상세는 2열이라
// 본문 칸이 더 좁다. 그리고 상자에 걸어 둔 `overflow-x-auto` 는 넘칠 일이 없어 **한 번도
// 동작한 적이 없었다**. 셋을 준다: 원본 크기로 그리고(넘치면 스크롤), 배율 컨트롤을 두고,
// 전체화면으로 연다 — 큰 그림을 보려고 문서를 떠나지 않아도 되는 것이 요점이다.
//
// **그리기 · 배율 · 전체화면은 `components/mermaid-diagram.tsx` 에 있다**(2026-09-26 · REQ-WEB-243) — 도움말의
// 상태도도 같은 그림을 쓴다. 이 파일은 편집기 노드뷰의 몫인 [코드]·[그림] 토글과 편집 자리만 갖는다.

import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useState } from 'react';
import { useT } from '../../lib/i18n.js';
import { Button } from '../../components/ui/primitives.js';
import {
  MERMAID_PRE,
  MermaidControls,
  MermaidFigure,
  MermaidFullscreen,
  useMermaidSvg,
} from '../../components/mermaid-diagram.js';

export function MermaidBlock(props: NodeViewProps): React.JSX.Element {
  const t = useT();
  const language = String(props.node.attrs['language'] ?? '');
  const isMermaid = language === 'mermaid';
  const code = props.node.textContent;

  // **기본은 그림이다.** 사람이 이 블록에서 [코드]를 누른 동안에만 원본이 보인다 —
  // 블록마다의 상태이고 문서에 저장되지 않는다(보는 방식이지 문서의 내용이 아니다).
  const [showCode, setShowCode] = useState(false);
  /** 배율 — **보는 방식이지 문서의 내용이 아니라** 저장되지 않는다([코드] 토글과 같은 규칙) */
  const [scale, setScale] = useState(1);
  const [full, setFull] = useState(false);

  // 빈 블록은 그릴 것이 없다 — ```mermaid 를 막 친 순간이 그것이라, 그때 오류를 띄우면
  // 사람은 자기가 틀린 줄 안다
  const wants = isMermaid && !showCode && code.trim() !== '';
  const { svg, failed } = useMermaidSvg(code, wants);

  // mermaid 가 아닌 코드블록은 **건드리지 않는다** — 토글도 붙이지 않는다
  if (!isMermaid) {
    return (
      <NodeViewWrapper>
        <pre className={MERMAID_PRE}>
          <NodeViewContent />
        </pre>
      </NodeViewWrapper>
    );
  }

  const drawn = wants && svg !== null;

  return (
    <NodeViewWrapper data-testid="mermaid-block" className="relative my-4">
      {/* 컨트롤은 **편집 내용이 아니다** — `contentEditable={false}` 가 그 경계다.
          그림 위에 얹지 않고 오른쪽 위 모서리에 둔다: 도형과 겹치면 둘 다 읽기 어렵다 */}
      <div
        contentEditable={false}
        className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1"
      >
        {drawn && (
          <MermaidControls
            scale={scale}
            onScale={setScale}
            onFullscreen={() => setFull(true)}
            full={false}
          />
        )}
        <Button
          size="xs"
          variant="subtle"
          data-testid="mermaid-toggle"
          aria-pressed={showCode}
          title={showCode ? t('spec.mermaid_figure_title') : t('spec.mermaid_code_title')}
          onClick={() => setShowCode((on) => !on)}
          className="bg-bg-elev"
        >
          {showCode ? t('spec.mermaid_figure') : t('spec.mermaid_code')}
        </Button>
      </div>

      {failed && !showCode && (
        <p data-testid="mermaid-failed" className="mb-1 text-2xs text-status-waiting">
          {t('spec.mermaid_failed')}
        </p>
      )}

      {drawn ? (
        <>
          <MermaidFigure svg={svg} scale={scale} />
          {full && <MermaidFullscreen svg={svg} onClose={() => setFull(false)} />}
        </>
      ) : (
        // 코드 그대로 — [코드]를 눌렀거나, 문법이 깨졌거나, 아직 빈 블록일 때의 자리다.
        // **여기에만 `NodeViewContent` 가 있다**: 편집할 수 있는 자리가 곧 보이는 자리다.
        <pre className={MERMAID_PRE}>
          <NodeViewContent />
        </pre>
      )}
    </NodeViewWrapper>
  );
}
