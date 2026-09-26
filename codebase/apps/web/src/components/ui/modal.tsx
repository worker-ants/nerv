// 모달 한 벌 — Esc · Tab 가둠 · 첫 포커스 · 연 자리로 복귀 (2026-09-25 — UI/UX 검토 SYS-06 · REQ-WEB-224)
//
// **모달 넷이 손으로 짜여 저마다 달랐다.** 스펙 메타는 Esc 로 닫히지 않았고 aria-modal 도 첫 포커스도
// 없어 Tab 이 뒤의 페이지로 빠졌다. 기준선은 Esc 는 됐지만 aria-modal 이 없었다. 퀵 스위처는 입력칸에
// 있을 때만 Esc 가 먹었고, 다이어그램 전체화면은 또 다른 모양이었다. 넷 다 포커스를 가두지 않았고 닫은
// 뒤 연 단추로 돌려주지 않았다 — 키보드로 일하던 사람은 닫을 때마다 문서 맨 앞에서 다시 시작했다.
//
// 네이티브 `<dialog>` 를 쓰지 않은 이유: 검사가 도는 jsdom 에 `HTMLDialogElement` 가 없고, 퀵 스위처·
// 다이어그램처럼 모양이 다른 자리도 같은 규칙을 써야 한다. 규칙은 이 훅 하나에 있다.

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { cn } from '../../lib/utils.js';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 모달의 키보드 규칙. `active` 인 동안 첫 포커스를 주고(이미 안에 포커스가 있으면 두고 — `autoFocus`
 * 를 존중한다), 끝나면 연 자리로 돌려준다. 돌려받은 `onKeyDown` 을 모달의 바깥 틀에 단다.
 */
export function useModal(
  active: boolean,
  panelRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  initialFocus?: RefObject<HTMLElement | null>,
): { onKeyDown: (e: React.KeyboardEvent) => void } {
  const openerRef = useRef<Element | null>(null);
  const wasActive = useRef(false);
  // **연 자리는 렌더에서 잡는다** — 안쪽 칸의 `autoFocus` 는 커밋 중에 포커스를 옮겨, 효과에서 읽으면 이미
  // 모달 안이다(기준선 대화상자가 그랬다: 닫으면 포커스가 문서 맨 앞으로 떨어졌다)
  if (active && !wasActive.current) openerRef.current = document.activeElement;
  wasActive.current = active;

  useEffect(() => {
    if (!active) return;
    const panel = panelRef.current;
    if (panel !== null && !panel.contains(document.activeElement)) {
      const first = initialFocus?.current ?? panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
      first.focus();
    }
    return () => {
      // **연 자리로 돌려준다** — 사라진 자리(닫으며 지운 단추)면 두지 않는다. 값은 비우지 않는다: 개발 모드의
      // StrictMode 가 효과를 한 번 걷었다 다시 세울 때 비워 두면 진짜로 닫을 때 돌아갈 곳을 잃는다
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      // 안쪽의 확인 단계(ConfirmAction)는 자기가 먼저 먹는다 — 여기까지 오면 모달의 차례다
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || panelRef.current === null) return;
    // **Tab 을 안에 가둔다** — 뒤의 페이지로 새면 aria-modal 이 거짓말이 된다
    const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (
      e.shiftKey &&
      (document.activeElement === first || document.activeElement === panelRef.current)
    ) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return { onKeyDown };
}

/** 가운데 뜨는 모달 — 뒷막을 누르거나 Esc 면 닫힌다. 패널이 `role=dialog` 다 */
export function Modal({
  label,
  onClose,
  testId,
  className,
  initialFocus,
  children,
}: {
  /** 보조기기가 읽는 이름 */
  label: string;
  onClose: () => void;
  testId?: string;
  className?: string;
  initialFocus?: RefObject<HTMLElement | null>;
  children: React.ReactNode;
}): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const { onKeyDown } = useModal(true, panelRef, onClose, initialFocus);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text/20 p-4 backdrop-blur-xs"
      onClick={onClose}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-testid={testId}
        tabIndex={-1}
        className={cn(
          'w-full max-w-md rounded-nerv-lg border border-border bg-bg-elev p-5 shadow-modal focus:outline-none',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
