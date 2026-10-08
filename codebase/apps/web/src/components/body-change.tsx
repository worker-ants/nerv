// 직전 버전과 견준 본문 크기 — 정본: docs/04-mvp/screens.md REQ-WEB-297 · 298
//
// **검토 요청 창과 승인 카드가 같은 줄을 쓴다**(2026-10-08). clemvion 용어 사전 v4 는 34.7KB 본문이 484바이트 조각이
// 된 채 검토 요청과 승인을 지나갔다 — 두 화면 모두 버전 번호와 변경 요약만 보여 줘서, 결재한 사람은 문서가 거의
// 비었다는 것을 볼 자리가 없었다. 숫자는 서버가 잰 그대로다(`bodyChange` · 사전 검토와 같은 판정). 줄었으면 색만이
// 아니라 **문장으로** 알린다(REQ-WEB-033).

import { bodyChangeDetail, BODY_SHRINK_REASONS, type BodyChange } from '@nerv/schema';
import { useT } from '../lib/i18n.js';
import { cn } from '../lib/utils.js';

export type BodyChangeView = BodyChange & { base_version_no: number; acknowledged: boolean };

/** 응답 · 이벤트에서 온 값을 읽는다 — 모양이 다르면(이 칸이 생기기 전의 결재 요청) 그리지 않는다 */
export function parseBodyChange(value: unknown): BodyChangeView | null {
  if (value === null || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const side = (raw: unknown): BodyChange['before'] | null => {
    if (raw === null || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    return typeof r['bytes'] === 'number' &&
      typeof r['headings'] === 'number' &&
      typeof r['requirements'] === 'number'
      ? { bytes: r['bytes'], headings: r['headings'], requirements: r['requirements'] }
      : null;
  };
  const before = side(v['before']);
  const after = side(v['after']);
  if (before === null || after === null || typeof v['base_version_no'] !== 'number') return null;
  const shrunk = Array.isArray(v['shrunk'])
    ? BODY_SHRINK_REASONS.filter((axis) => (v['shrunk'] as unknown[]).includes(axis))
    : [];
  return {
    before,
    after,
    requirements_kept: typeof v['requirements_kept'] === 'number' ? v['requirements_kept'] : 0,
    shrunk,
    base_version_no: v['base_version_no'],
    acknowledged: v['acknowledged'] === true,
  };
}

/**
 * 한 줄 — `직전 버전 v3 대비 · 크기 34.8KB → 0.5KB · 제목 27 → 1개`. 크게 줄었으면 그 아래 한 줄을 더한다:
 * 확인 없이 줄었으면 위험(빨강), 저장할 때 의도한 삭제로 확인했으면 주의(호박색).
 */
export function BodyChangeLine({
  change,
  className,
}: {
  change: BodyChangeView;
  className?: string;
}): React.JSX.Element {
  const t = useT();
  const shrunk = change.shrunk.length > 0;
  return (
    <div
      data-testid="body-change"
      data-shrunk={shrunk ? 'true' : 'false'}
      className={cn('flex flex-col gap-0.5', className)}
    >
      <span className={cn(shrunk ? 'font-medium text-text' : 'text-text-mute')}>
        {t('spec.body_change.line', {
          n: change.base_version_no,
          detail: bodyChangeDetail(t, change),
        })}
      </span>
      {shrunk && (
        <span
          data-testid="body-change-warning"
          className={cn(
            'rounded-nerv-sm px-1.5 py-0.5',
            change.acknowledged
              ? 'bg-status-waiting-soft text-status-waiting'
              : 'bg-status-danger-soft text-status-danger',
          )}
        >
          {change.acknowledged ? t('spec.body_change.shrunk_ack') : t('spec.body_change.shrunk')}
        </span>
      )}
    </div>
  );
}
