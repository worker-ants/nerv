// /p/:proj/sessions → S5 세션 모니터.
// Phase 0 은 읽기 전용 축소판(E05-S03) → Phase 1 에 steer/stop 승격(E08-S06).
import { createFileRoute } from '@tanstack/react-router';
import { SessionBoard } from '../../features/session-monitor/session-board.js';

export const Route = createFileRoute('/p/$proj/sessions/')({
  component: SessionsScreen,
});

function SessionsScreen(): React.JSX.Element {
  const { proj } = Route.useParams();
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-lg font-semibold">S5 세션 모니터</h1>
      {/* projectId 는 프로젝트 셸이 해소해 컨텍스트로 내려준다(E08-S03). 지금은 slug 를 키로 쓴다 */}
      <SessionBoard projectSlug={proj} projectId={proj} />
    </section>
  );
}
