// 골격 화면 자리표시자 — 각 화면의 실물은 E08 의 스토리가 채운다.
// 라우팅 맵(screens.md §1.2)이 먼저 서 있어야 딥링크·가드·셸이 검증 가능하기 때문에
// E01-S03 은 경로와 셸까지를 세운다.

import { StatusBadge } from './status-badge.js';
import { PageBody, PageHeader } from './ui/primitives.js';

export interface PlaceholderScreenProps {
  title: string;
  /** 이 화면을 채우는 스토리 ID */
  story: string;
  /** 명세 소재 — screens.md §1.6 커버리지 표의 열 */
  spec: string;
}

export function PlaceholderScreen({
  title,
  story,
  spec,
}: PlaceholderScreenProps): React.JSX.Element {
  return (
    <PageBody>
      <PageHeader
        title={title}
        description={`명세: ${spec}`}
        meta={<StatusBadge token="idle" label={`${story} 대기`} />}
      />
    </PageBody>
  );
}
