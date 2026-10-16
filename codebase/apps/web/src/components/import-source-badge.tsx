// 「출처: 임포트」 — 서버가 파생하지 않은 구현 상태의 표시 (2026-10-15 · 사람 결정 · REQ-WEB-317)
//
// 작업이 없는 요구사항은 파생할 재료가 없어 임포트가 문서에서 읽어 넣은 값이 그대로 남는다. 그 값을 `unimplemented` 로 덮지
// 않는 대신, 파생한 값과 섞여 읽히지 않게 출처를 표시한다(D-03 — 값을 지워서가 아니라 어디서 왔는지 보여서 지킨다).
// 판정은 서버의 `impl_status_source` 다(REQ-API-312) — 화면은 작업 수를 세어 다시 판정하지 않는다.

import { useT } from '../lib/i18n.js';
import { StatusBadge } from './status-badge.js';

/** 출처가 임포트일 때만 그린다 — 파생한 값에는 아무것도 붙이지 않는다(늘 붙는 표시는 아무 뜻이 없다) */
export function ImportSourceBadge({ source }: { source: unknown }): React.JSX.Element | null {
  const t = useT();
  if (source !== 'import') return null;
  return (
    <StatusBadge
      token="idle"
      mark={null}
      size="sm"
      data-testid="import-source"
      title={t('coverage.source_import_hint')}
      label={t('coverage.source_import')}
    />
  );
}
