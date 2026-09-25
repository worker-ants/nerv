// 도움말의 차례 — 스펙 상세의 트리처럼 사이드바와 본문 사이의 둘째 열에 선다
// (2026-09-25 — 사람 지시 · REQ-WEB-232 · screens.md §2.10)
//
// 차례는 셸 사이드바의 [도움말] 아래에 펼쳐져 있었다(REQ-WEB-225). 열 장이 사이드바의 바닥에 붙으니 조직·전역·
// 프로젝트 목록과 한 열에서 자리를 다퉜고 — 프로젝트가 많으면 차례가 화면 밖으로 밀렸다 — "도움말 안에서 고르는
// 것" 과 "앱 안에서 옮겨 가는 것" 이 한 목록에 섞였다. 한 화면 안의 깊은 구조는 그 화면의 둘째 열이 든다는 규칙
// (REQ-WEB-226)을 도움말에도 적용한다 — 열의 뼈대(띠 · 접기 · 좁은 폭의 겹침 패널)도 같은 한 벌이다.

import { Link } from '@tanstack/react-router';
import { useT } from '../../lib/i18n.js';
import { MANUAL_CHAPTERS } from '../../lib/manual.js';
import { NAV_ACTIVE, NAV_ITEM, RAIL_LABEL } from '../../components/nav-styles.js';
import { SideColumn } from '../../components/side-column.js';

/**
 * 열이 제자리에 서는 폭 — 사이드바(15rem)·열(16rem)·본문(33rem 바닥)이 함께 드는 가장 좁은 폭이다. 스펙 상세
 * (80rem)보다 좁은 까닭은 오른쪽 레일이 없어서다 — "이 문서 안" 은 더 넓은 폭(`xl`)에서야 선다.
 */
const COLUMN_QUERY = '(min-width: 64rem)';
const STORAGE_KEY = 'nerv.manual-column';

export function ManualColumn({
  activeChapter,
}: {
  activeChapter: string | undefined;
}): React.JSX.Element {
  const t = useT();
  return (
    <SideColumn
      name="manual"
      query={COLUMN_QUERY}
      storageKey={STORAGE_KEY}
      label={t('help.toc')}
      showLabel={t('help.column.show')}
      hideLabel={t('help.column.hide')}
      activeKey={activeChapter}
    >
      {(headerAction) => (
        <nav
          data-testid="manual-toc"
          aria-label={t('help.toc')}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 px-2 pb-1.5">
            <p className={RAIL_LABEL}>{t('help.title')}</p>
            {headerAction}
          </div>
          {/* 장이 열의 높이보다 많아지면 **이 목록만** 흐른다 — 머리와 접기 단추는 제자리다 */}
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain">
            {MANUAL_CHAPTERS.map((chapter) => (
              <Link
                key={chapter.id}
                to="/help/$chapter"
                params={{ chapter: chapter.id }}
                className={NAV_ITEM}
                activeProps={{ className: NAV_ACTIVE }}
              >
                <span className="flex-1 truncate">{t(chapter.titleKey)}</span>
              </Link>
            ))}
          </div>
        </nav>
      )}
    </SideColumn>
  );
}
