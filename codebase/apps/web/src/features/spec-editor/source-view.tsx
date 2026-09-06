// 소스 보기 — read-only md (screens.md §2.4 `SourceViewToggle` · §3.2 규칙 2)
//
// **저장이 막혔을 때 사람이 볼 수 있는 것이 있어야 한다.** REQ-WEB-031 은 왕복 검증이
// 실패하면 "저장을 차단하고 **소스 보기와 함께** 실패 리포트를 표시한다" 고 적는데,
// 2026-09-06 까지 그 소스 보기가 저장소에 없었다 — 차단만 있고 볼 것이 없는 화면이었다.
//
// 원문 그대로다. 에디터가 못 그리는 것(화이트리스트 밖 노드 · 표 안의 파이프)이 정확히
// 저장을 막는 것들이라, 그때 필요한 것은 렌더링이 아니라 **바이트**다.

import { useT } from '../../lib/i18n.js';
import { Button } from '../../components/ui/primitives.js';

export function SourceViewToggle({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const t = useT();
  return (
    <Button
      type="button"
      size="sm"
      variant={on ? 'primary' : 'ghost'}
      data-testid="source-view-toggle"
      aria-pressed={on}
      onClick={onToggle}
      title={t('spec.source_view_title')}
    >
      {t('spec.source_view')}
    </Button>
  );
}

export function SourceView({ body }: { body: string }): React.JSX.Element {
  return (
    <pre
      data-testid="source-view"
      className="overflow-x-auto rounded-nerv border border-border bg-bg-elev p-3 font-mono text-xs whitespace-pre-wrap"
    >
      {body}
    </pre>
  );
}
