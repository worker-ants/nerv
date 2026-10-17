// 고정한 문서의 ★ — 스펙 트리 · 표의 제목 옆 (2026-10-17 사람 결정 · screens.md §1.3a · REQ-WEB-337)
//
// 핀은 퀵 스위처(⌘K)에서 고정하고 푼다. 이 표시는 **읽기 전용**이다 — 눌러서 고정 · 해제하는 단추가 아니다. 명세가 정한 것은
// 「목록 · 트리에도 ★로 표기한다」뿐이고, 줄마다 단추를 두면 트리의 링크와 겹쳐 줄이 무엇을 하는지 흐려진다. 그래서 글자로
// 뜻을 함께 준다(색 · 모양만으로 알리지 않는다 · REQ-WEB-033) — 화면 낭독기와 마우스를 올린 사람이 같은 말을 듣는다.

import { useT } from '../lib/i18n.js';
import { cn } from '../lib/utils.js';

export function PinMark({ className }: { className?: string }): React.JSX.Element {
  const t = useT();
  return (
    <span
      data-testid="pin-mark"
      role="img"
      aria-label={t('specs.pinned')}
      title={t('specs.pinned_hint')}
      className={cn('shrink-0 text-2xs text-status-waiting', className)}
    >
      ★
    </span>
  );
}
