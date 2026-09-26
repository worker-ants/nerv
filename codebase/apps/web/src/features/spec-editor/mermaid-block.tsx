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
// mermaid 는 번들이 크다(~500KB). **동적 import** 라 mermaid 블록이 실제로 그려질 때만
// 내려받는다 — 스펙 화면 전체가 그 비용을 지지 않는다.

import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../lib/i18n.js';
import { useTheme } from '../../lib/theme.js';
import { useModal } from '../../components/ui/modal.js';
import { Button } from '../../components/ui/primitives.js';

/** 같은 페이지에 여럿이 있어도 id 가 겹치지 않게 — mermaid 는 id 로 DOM 을 잡는다 */
let seq = 0;

/**
 * mermaid 가 **재면서 그리는 자리** — 화면 밖에 고정된 상자다(2026-09-24 실측).
 *
 * `mermaid.render(id, code)` 는 담을 곳을 주지 않으면 글자 폭을 재려고 `<body>` 끝에 임시
 * 요소(`#d<id>`)를 붙였다가 다 그린 뒤 뗀다. 그 사이 문서가 그 높이만큼(시드 문서에서 150px)
 * 자라 **페이지 스크롤바가 잠깐 깜빡였고**, 스펙 상세의 "흐르는 것은 본문 칸뿐이다" L3 가
 * 그 순간을 재면 빨갛게 떴다(15회 중 1회 — REQ-WEB-156). 재려면 레이아웃은 있어야 하므로
 * `display: none` 이 아니라, 문서 흐름 밖(`position: fixed`)의 보이지 않는 자리에서 잰다.
 *
 * 그릴 때마다 **자기 칸**을 하나 받는다 — mermaid 는 받은 칸의 내용을 먼저 비우므로, 둘이
 * 한 칸을 나눠 쓰면 먼저 그리던 쪽이 지워진다.
 */
function measuringSlot(): HTMLDivElement {
  let host = document.querySelector<HTMLDivElement>('[data-mermaid-host]');
  if (host === null) {
    host = document.createElement('div');
    host.dataset['mermaidHost'] = '';
    host.setAttribute('aria-hidden', 'true');
    Object.assign(host.style, {
      position: 'fixed',
      top: '0',
      left: '-100000px',
      visibility: 'hidden',
      pointerEvents: 'none',
    });
    document.body.appendChild(host);
  }
  const slot = document.createElement('div');
  host.appendChild(slot);
  return slot;
}

const PRE = 'rounded-nerv border border-border bg-code-bg p-3 font-mono text-xs text-code-text';

/** 배율 한 칸 — 곱셈이라 어느 배율에서 눌러도 같은 비율로 움직인다. */
const STEP = 1.25;
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

/**
 * 그림 자체 — SVG 문자열을 붙이고 배율을 건다.
 *
 * **`zoom` 으로 키운다. `transform: scale()` 이 아니다**(2026-09-22 실측). 변환은 그리기에만
 * 걸리고 **레이아웃 상자는 그대로**라, 확대해도 스크롤이 생기지 않아 커진 부분에 닿을 수가
 * 없었다 — 스크린샷으로 보기 전에는 몰랐던 자리다. `zoom` 은 상자까지 함께 키우므로 넘친
 * 만큼 그대로 밀린다. SVG 의 `width`/`height` 를 고쳐 쓰지 않는 것은 그대로다: mermaid 가
 * 계산해 둔 좌표계와 어긋나고, 다시 그리면 값이 되돌아온다.
 *
 * **가운데 정렬은 `mx-auto` 로 한다.** 스크롤 상자에 `justify-center` 를 걸면 넘쳤을 때
 * 내용의 **왼쪽이 앞으로 잘려** 되돌아갈 수 없다(자동 여백은 그 자리에서 0 이 된다).
 */
function Figure({
  svg,
  scale,
  bare = false,
}: {
  svg: string;
  scale: number;
  bare?: boolean;
}): React.JSX.Element {
  return (
    <div
      data-testid={bare ? 'mermaid-figure-full' : 'mermaid-figure'}
      className={
        bare
          ? 'min-w-fit'
          : // 원본 크기로 그리므로 넘칠 수 있다 — 그때 미는 것은 이 상자다(REQ-WEB-172)
            'min-w-0 overflow-auto rounded-nerv border border-border bg-bg-elev px-3 py-4'
      }
    >
      {/* mermaid 의 출력은 SVG 문자열이다. securityLevel:'strict' 가 스크립트와
          외부 참조를 걷어낸 뒤의 것이라 그대로 붙인다 */}
      <div
        className="mx-auto w-fit [&_svg]:h-auto"
        style={{ zoom: scale }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}

/** 배율 컨트롤 — [−] [맞추기] [+] 와 전체화면. 글자 없이 읽히도록 이름은 `aria-label` 에. */
function MermaidControls({
  scale,
  onScale,
  onFullscreen,
  full,
}: {
  scale: number;
  onScale: (next: number) => void;
  onFullscreen: () => void;
  full: boolean;
}): React.JSX.Element {
  const t = useT();
  const btn =
    'flex size-6 items-center justify-center rounded-nerv-sm border border-border bg-bg-elev text-2xs text-text-mute hover:border-border-strong hover:text-text disabled:opacity-40';
  return (
    <>
      <button
        type="button"
        data-testid="mermaid-zoom-out"
        aria-label={t('spec.mermaid_zoom_out')}
        title={t('spec.mermaid_zoom_out')}
        disabled={scale <= MIN_SCALE}
        onClick={() => onScale(Math.max(MIN_SCALE, scale / STEP))}
        className={btn}
      >
        −
      </button>
      {/* 지금 배율을 **숫자로** 적는다 — 몇 번 눌렀는지 세게 하지 않는다 */}
      <Button
        size="xs"
        variant="subtle"
        data-testid="mermaid-zoom-fit"
        aria-label={t('spec.mermaid_zoom_fit')}
        title={t('spec.mermaid_zoom_fit')}
        onClick={() => onScale(1)}
        className="bg-bg-elev tabular-nums"
      >
        {Math.round(scale * 100)}%
      </Button>
      <button
        type="button"
        data-testid="mermaid-zoom-in"
        aria-label={t('spec.mermaid_zoom_in')}
        title={t('spec.mermaid_zoom_in')}
        disabled={scale >= MAX_SCALE}
        onClick={() => onScale(Math.min(MAX_SCALE, scale * STEP))}
        className={btn}
      >
        +
      </button>
      <button
        type="button"
        data-testid="mermaid-fullscreen-toggle"
        aria-label={full ? t('spec.mermaid_fullscreen_close') : t('spec.mermaid_fullscreen')}
        title={full ? t('spec.mermaid_fullscreen_close') : t('spec.mermaid_fullscreen')}
        onClick={onFullscreen}
        className={btn}
      >
        {full ? '\u2715' : '\u2921'}
      </button>
    </>
  );
}

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
  /**
   * 배율 — **보는 방식이지 문서의 내용이 아니라** 저장되지 않는다([코드] 토글과 같은 규칙).
   * 본문 안과 전체화면이 **각자 기억한다**: 전체화면에서 키운 배율이 닫은 뒤 좁은 칸에
   * 그대로 남으면, 사람이 한 적 없는 일이 일어난 것으로 보인다.
   */
  const [scale, setScale] = useState(1);
  const [full, setFull] = useState(false);
  const [fullScale, setFullScale] = useState(1);
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
          // **원본 크기로 그린다**(REQ-WEB-172). 기본값 `true` 는 SVG 를 담긴 칸에 맞춰
          // 줄이는데, 그러면 큰 다이어그램일수록 글자가 작아진다 — 넘치는 것은 스크롤과
          // 배율이 받는다. 다이어그램 종류마다 따로 있는 값이라 최상위에 한 번 적는다.
          flowchart: { useMaxWidth: false },
          sequence: { useMaxWidth: false },
          gantt: { useMaxWidth: false },
          class: { useMaxWidth: false },
          state: { useMaxWidth: false },
          er: { useMaxWidth: false },
          journey: { useMaxWidth: false },
          pie: { useMaxWidth: false },
        });
        const slot = measuringSlot();
        const { svg: out } = await mermaid
          .render(idRef.current, code, slot)
          .finally(() => slot.remove());
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
          <Figure svg={svg} scale={scale} />
          {/* **전체화면은 문서를 떠나지 않는 길이다**(REQ-WEB-172). 2열 본문 칸은 큰 그림을
              담을 틀이 아니고, 그렇다고 새 탭으로 내보내면 읽던 자리를 잃는다. */}
          {full && (
            <FullscreenDialog label={t('spec.mermaid_fullscreen')} onClose={() => setFull(false)}>
              <div className="flex shrink-0 items-center justify-end gap-1 border-b border-border px-3 py-2">
                <MermaidControls
                  scale={fullScale}
                  onScale={setFullScale}
                  onFullscreen={() => setFull(false)}
                  full
                />
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-4">
                <Figure svg={svg} scale={fullScale} bare />
              </div>
            </FullscreenDialog>
          )}
        </>
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

/**
 * 다이어그램 전체화면 — 공용 모달 규칙을 쓴다(REQ-WEB-224). Esc 가 안쪽에서만 먹었고 포커스를 가두거나
 * 돌려주지 않았다 — 닫으면 [전체화면] 단추로 돌아간다.
 */
function FullscreenDialog({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const { onKeyDown } = useModal(true, panelRef, onClose);
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      data-testid="mermaid-fullscreen"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-bg focus:outline-none"
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}
