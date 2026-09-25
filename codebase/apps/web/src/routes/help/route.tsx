// /help — 제품 매뉴얼 셸 (screens.md §2.10)
//
// 차례는 **셸의 왼쪽 열**에 선다(2026-09-25 사람 결정 D1 · REQ-WEB-225). 매뉴얼은 처음부터 읽는
// 문서가 아니라 필요할 때 한 장을 펴는 문서라, 어느 장이 있는지가 늘 보여야 한다 — 목차로 돌아가야
// 다음 장이 보이는 구조에서는 사람이 두 번째 장을 열지 않는다. 이 라우트는 본문 상자만 든다.

import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/help')({ component: ManualShell });

function ManualShell(): React.JSX.Element {
  return (
    // **본문이 자기 상자 안에서 흐른다**(2026-09-08 — 사람 지시 · REQ-WEB-157). S3 와 같은
    // 규약이다(§2.4 · REQ-WEB-156): 스크롤 상자가 페이지면 차례 위에서 굴린 바퀴가
    // 본문을 움직이고(차례가 더 흘릴 것이 없으면 스크롤은 페이지로 넘어간다), 그때 두 칸은
    // 나란히 놓인 두 칸이 아니다. 화면 높이를 확정하고 차례(셸 사이드바)·본문이 각자 자기 안에서
    // 흐른다. 묶는 것은 **사이드바가 서는 폭(`md`)부터**다 — 사이드바가 서랍으로 접힌 좁은 화면에는
    // 나란히 놓인 것이 없으니 가둘 이유도 없고, 페이지가 흐르는 편이 그 폭의 손에 맞는다.
    // 높이는 `dvh` 로 잰다: 모바일 브라우저의 주소창이 접히면 `vh` 는 실제 화면보다 크다.
    <div
      className="flex min-h-[calc(100dvh-var(--spacing-header))]
        md:h-[calc(100dvh-var(--spacing-header))] md:overflow-hidden"
    >
      {/* **차례는 셸의 왼쪽 열에 있다**(2026-09-25 사람 결정 D1 · REQ-WEB-225). 여기 따로 세운 같은 폭의 열이
          셸 사이드바와 나란히 서면 왼쪽 열이 둘이 된다 — 사이드바의 [도움말]이 도움말 화면에서 차례로 펼쳐진다.
          좁은 화면에서는 서랍에 같은 차례가 선다(예전에는 좁으면 차례가 없었다 · NAV-14) */}
      {/* 흐르는 것은 이 칸이다 — 차례는 사이드바에서 제자리에 선다 */}
      <div data-testid="manual-content" className="min-w-0 flex-1 md:h-full md:overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
