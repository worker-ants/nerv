// mermaid 다이어그램 — 그리기 · 배율 · 전체화면 (screens.md §3.1b · REQ-WEB-113 · 169 · 172 · 243)
//
// **두 곳이 같은 그림을 쓴다.** 스펙 편집기의 mermaid 블록(`features/spec-editor/mermaid-block.tsx`)과
// 도움말 본문의 상태도(2026-09-26 — 사람 지시 · REQ-WEB-243)다. 예전에는 그리는 코드가 편집기 노드뷰
// 안에만 있어서, 도움말의 ```mermaid 펜스는 코드 그대로 보였다. 그리기 · 배율 · 전체화면은 여기 한 곳에
// 두고, 편집기는 [코드]·[그림] 토글과 편집 자리만 더한다.
//
// mermaid 는 번들이 크다(~500KB). **동적 import** 라 다이어그램이 실제로 그려질 때만 내려받는다.

import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n.js';
import { useTheme } from '../lib/theme.js';
import { useModal } from './ui/modal.js';
import { Button } from './ui/primitives.js';

/** 같은 페이지에 여럿이 있어도 id 가 겹치지 않게 — mermaid 는 id 로 DOM 을 잡는다 */
let seq = 0;

/**
 * mermaid 가 **크기를 재면서 그리는 자리** — 화면 밖에 고정된 상자다(2026-09-24 실측).
 *
 * `mermaid.render(id, code)` 는 담을 곳을 주지 않으면 글자 폭을 재려고 `<body>` 끝에 임시 요소를 붙였다가
 * 다 그린 뒤 뗀다. 그 사이 문서가 그 높이만큼 늘어나 **페이지 스크롤바가 잠깐 깜빡였다**(REQ-WEB-156).
 * 재려면 레이아웃은 있어야 하므로 `display: none` 이 아니라, 문서 흐름 밖(`position: fixed`)의 보이지 않는
 * 자리에서 잰다.
 *
 * 그릴 때마다 **자기 칸**을 하나 받는다 — mermaid 는 받은 칸의 내용을 먼저 비우므로, 둘이 한 칸을 나눠
 * 쓰면 먼저 그리던 쪽이 지워진다.
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

export const MERMAID_PRE =
  'rounded-nerv border border-border bg-code-bg p-3 font-mono text-xs text-code-text';

/** 배율 한 칸 — 곱셈이라 어느 배율에서 눌러도 같은 비율로 움직인다. */
const STEP = 1.25;
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

/**
 * 코드 → SVG. `enabled` 가 거짓이면 그리지 않는다(빈 블록 · [코드] 보기).
 *
 * 앱의 테마를 따른다 — 밝은 화면에 검은 상자가 뜨면 그것부터 눈에 띈다. 테마가 바뀌면 다시 그린다.
 */
export function useMermaidSvg(
  code: string,
  enabled: boolean,
): { svg: string | null; failed: boolean } {
  const { resolved } = useTheme();
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const idRef = useRef(`mermaid-${(seq += 1)}`);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void (async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({
          startOnLoad: false,
          theme: resolved === 'dark' ? 'dark' : 'default',
          securityLevel: 'strict',
          // **원본 크기로 그린다**(REQ-WEB-172). 기본값 `true` 는 SVG 를 담긴 칸에 맞춰 줄이는데, 그러면 큰
          // 다이어그램일수록 글자가 작아진다 — 넘치는 것은 스크롤과 배율이 받는다. 다이어그램 종류마다 따로
          // 있는 값이라 최상위에 한 번 적는다.
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
  }, [enabled, code, resolved]);

  return { svg, failed };
}

/**
 * 그림 자체 — SVG 문자열을 붙이고 배율을 건다.
 *
 * **`zoom` 으로 키운다. `transform: scale()` 이 아니다**(2026-09-22 실측). 변환은 그리기에만 적용되고
 * **레이아웃 상자는 그대로**라, 확대해도 스크롤이 생기지 않아 커진 부분을 볼 수 없었다. `zoom` 은 상자까지
 * 함께 키우므로 넘친 만큼 스크롤된다. SVG 의 `width`/`height` 를 고쳐 쓰지 않는 것은 그대로다: mermaid 가
 * 계산해 둔 좌표계와 어긋나고, 다시 그리면 값이 되돌아온다.
 *
 * **가운데 정렬은 `mx-auto` 로 한다.** 스크롤 상자에 `justify-center` 를 걸면 넘쳤을 때 내용의 **왼쪽이
 * 잘려** 되돌아갈 수 없다(자동 여백은 그 자리에서 0 이 된다).
 */
export function MermaidFigure({
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
          : // 원본 크기로 그리므로 넘칠 수 있다 — 그때 스크롤되는 것은 이 상자다(REQ-WEB-172)
            'min-w-0 overflow-auto rounded-nerv border border-border bg-bg-elev px-3 py-4'
      }
    >
      {/* mermaid 의 출력은 SVG 문자열이다. securityLevel:'strict' 가 스크립트와
          외부 참조를 제거한 뒤의 것이라 그대로 붙인다 */}
      <div
        className="mx-auto w-fit [&_svg]:h-auto"
        style={{ zoom: scale }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}

/** 배율 컨트롤 — [−] [맞추기] [+] 와 전체화면. 글자 없이 읽히도록 이름은 `aria-label` 에. */
export function MermaidControls({
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
        {full ? '✕' : '⤡'}
      </button>
    </>
  );
}

/**
 * 전체화면으로 본 그림 — 공용 모달 규칙을 쓴다(REQ-WEB-224). 닫으면 [전체화면] 단추로 포커스가 돌아간다.
 *
 * **전체화면은 문서를 떠나지 않고 큰 그림을 보는 방법이다**(REQ-WEB-172). 본문 칸은 큰 그림을 담기에 좁고,
 * 새 탭으로 열면 읽던 위치를 잃는다. 배율은 본문 안과 **따로 기억한다**: 전체화면에서 키운 배율이 닫은 뒤
 * 좁은 칸에 그대로 남으면, 사람이 한 적 없는 일이 일어난 것으로 보인다.
 */
export function MermaidFullscreen({
  svg,
  onClose,
}: {
  svg: string;
  onClose: () => void;
}): React.JSX.Element {
  const t = useT();
  const [scale, setScale] = useState(1);
  const panelRef = useRef<HTMLDivElement>(null);
  const { onKeyDown } = useModal(true, panelRef, onClose);
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('spec.mermaid_fullscreen')}
      data-testid="mermaid-fullscreen"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-bg focus:outline-none"
      onKeyDown={onKeyDown}
    >
      <div className="flex shrink-0 items-center justify-end gap-1 border-b border-border px-3 py-2">
        <MermaidControls scale={scale} onScale={setScale} onFullscreen={onClose} full />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <MermaidFigure svg={svg} scale={scale} bare />
      </div>
    </div>
  );
}

/**
 * 읽기 전용 다이어그램 — 도움말 본문의 상태도(REQ-WEB-243).
 *
 * 그리는 동안과 그리지 못했을 때는 **코드를 보인다** — 빈 자리로 두면 그 자리에 무엇이 있었는지 알 수 없다.
 * `label` 은 보조기기가 읽는 이름이다: SVG 의 도형만으로는 그림이 무엇을 보여 주는지 알 수 없다.
 */
export function MermaidDiagram({
  code,
  label,
}: {
  code: string;
  label?: string;
}): React.JSX.Element {
  const t = useT();
  const { svg, failed } = useMermaidSvg(code, code.trim() !== '');
  const [scale, setScale] = useState(1);
  const [full, setFull] = useState(false);

  return (
    <figure data-testid="mermaid-diagram" aria-label={label} className="relative my-5">
      {svg !== null ? (
        <>
          <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1">
            <MermaidControls
              scale={scale}
              onScale={setScale}
              onFullscreen={() => setFull(true)}
              full={false}
            />
          </div>
          <MermaidFigure svg={svg} scale={scale} />
          {full && <MermaidFullscreen svg={svg} onClose={() => setFull(false)} />}
        </>
      ) : (
        <>
          {failed && (
            <p data-testid="mermaid-failed" className="mb-1 text-2xs text-status-waiting">
              {t('spec.mermaid_failed')}
            </p>
          )}
          <pre className={MERMAID_PRE}>{code}</pre>
        </>
      )}
    </figure>
  );
}
