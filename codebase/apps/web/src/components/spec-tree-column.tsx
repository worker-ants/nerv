// 스펙 트리의 둘째 열 — 스펙 상세에서만 선다 (2026-09-25 — 사람 결정 D1 · UI/UX 검토 OBS-01 · REQ-WEB-226)
//
// 트리는 사이드바의 마지막 블록이었다. 그래서 작업 보드·세션·리뷰에서도 그 화면과 상관없는 141편이
// 왼쪽 열 대부분을 차지했고, 스펙 목록에서는 같은 트리가 본문에 한 벌 더 서서 한 화면에 두 번 보였다.
// 사이드바가 모든 화면에 서게 된 뒤로(REQ-WEB-225) 사이드바는 "어느 프로젝트의 어느 화면" 까지만 말하고,
// 한 화면 안의 깊은 구조는 그 화면에서만 서는 둘째 열이 든다(리서치 패턴 5 — Jira·Plane·Sentry).
//
// **서는 곳은 스펙 상세뿐이다.** 스펙 목록의 본문 트리가 이 열의 전체 화면 판이라(§2.4), 목록에서 이 열을
// 세우면 같은 트리가 다시 두 벌이 된다.
//
// 열의 뼈대(띠 · 접기 · 좁은 폭의 겹침 패널)는 도움말의 차례와 같이 쓴다 — `side-column.tsx`.

import { useT } from '../lib/i18n.js';
import { SideColumn } from './side-column.js';
import { SpecTree } from './spec-tree.js';
import type { ProjectId } from '../lib/query-keys.js';

/** 열이 제자리에 서는 폭 — 사이드바(15rem)·열(16rem)·본문(26rem 바닥)·레일(17rem)이 함께 드는 가장 좁은 폭이다 */
const COLUMN_QUERY = '(min-width: 80rem)';
const STORAGE_KEY = 'nerv.spec-column';

export function SpecTreeColumn({
  projectSlug,
  projectId,
  activeKey,
  baseline,
}: {
  projectSlug: string;
  projectId?: ProjectId | undefined;
  activeKey: string | undefined;
  baseline?: string | undefined;
}): React.JSX.Element {
  const t = useT();
  return (
    <SideColumn
      name="spec"
      query={COLUMN_QUERY}
      storageKey={STORAGE_KEY}
      label={t('shell.spec_tree')}
      showLabel={t('specs.column.show')}
      hideLabel={t('specs.column.hide')}
      activeKey={activeKey}
    >
      {(headerAction) => (
        <SpecTree
          projectSlug={projectSlug}
          projectId={projectId}
          variant="rail"
          activeKey={activeKey}
          heading={t('shell.spec_tree')}
          baseline={baseline}
          titleFilter
          headerAction={headerAction}
        />
      )}
    </SideColumn>
  );
}
