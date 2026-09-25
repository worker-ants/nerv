// /help — 제품 매뉴얼 셸 (screens.md §2.10)
//
// 차례는 **사이드바와 본문 사이의 둘째 열**에 선다(2026-09-25 사람 지시 · REQ-WEB-232 — 스펙 상세의 트리 열과
// 같은 한 벌). 매뉴얼은 처음부터 읽는 문서가 아니라 필요할 때 한 장을 펴는 문서라, 어느 장이 있는지가 늘
// 보여야 한다 — 목차로 돌아가야 다음 장이 보이는 구조에서는 사람이 두 번째 장을 열지 않는다. 열을 이 라우트가
// 세우는 까닭은 장을 옮겨도 이 라우트는 그대로라 열이 다시 그려지지 않기 때문이다(접음·스크롤이 남는다).

import { createFileRoute, Outlet, useParams } from '@tanstack/react-router';
import { ManualColumn } from '../../features/manual/manual-column.js';

export const Route = createFileRoute('/help')({ component: ManualShell });

function ManualShell(): React.JSX.Element {
  const { chapter } = useParams({ strict: false });
  return (
    // **본문이 자기 상자 안에서 흐른다**(2026-09-08 — 사람 지시 · REQ-WEB-157). S3 와 같은
    // 규약이다(§2.4 · REQ-WEB-156): 스크롤 상자가 페이지면 차례 위에서 굴린 바퀴가
    // 본문을 움직이고(차례가 더 흘릴 것이 없으면 스크롤은 페이지로 넘어간다), 그때 두 칸은
    // 나란히 놓인 두 칸이 아니다. 화면 높이를 확정하고 차례(둘째 열)·본문이 각자 자기 안에서
    // 흐른다. 묶는 것은 **사이드바가 서는 폭(`md`)부터**다 — 사이드바가 서랍으로 접힌 좁은 화면에는
    // 나란히 놓인 것이 없으니 가둘 이유도 없고, 페이지가 흐르는 편이 그 폭의 손에 맞는다.
    // 높이는 `dvh` 로 잰다: 모바일 브라우저의 주소창이 접히면 `vh` 는 실제 화면보다 크다.
    <div
      className="flex min-h-[calc(100dvh-var(--spacing-header))]
        md:h-[calc(100dvh-var(--spacing-header))] md:overflow-hidden"
    >
      {/* **차례는 둘째 열이다**(2026-09-25 사람 지시 · REQ-WEB-232). 셸 사이드바의 [도움말] 아래에 펼쳐지던
          동안 열 장이 프로젝트 목록과 한 열에서 자리를 다퉜다. 좁은 폭에서는 띠의 단추가 여는 겹침 패널이다
          (예전에는 좁으면 차례가 없었다 · NAV-14 — 그 길은 그대로 남는다) */}
      <ManualColumn activeChapter={chapter} />
      {/* 흐르는 것은 이 칸이다 — 차례는 제 열에서 제자리에 선다 */}
      <div data-testid="manual-content" className="min-w-0 flex-1 md:h-full md:overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
