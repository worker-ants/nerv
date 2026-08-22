// /p/:proj/specs/:spec → S3 스펙 상세. 쿼리: ?v=<version_no> ?diff=v3..v4
// 리소스 지목은 항상 안정 ID 다 — 경로·제목이 바뀌어도 링크가 깨지지 않는다(FR-01 · D-09).
import { createFileRoute } from '@tanstack/react-router';
import { PlaceholderScreen } from '../../components/placeholder-screen.js';

export const Route = createFileRoute('/p/$proj/specs/$spec')({
  component: () => (
    <PlaceholderScreen title="S3 스펙 상세" story="E08-S04" spec="ui-wireframes §2.3" />
  ),
});
