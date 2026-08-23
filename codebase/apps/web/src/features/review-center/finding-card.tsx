// finding 카드 — S6 리뷰 센터(screens.md §2.6a · ui-wireframes §2.6 ②③④⑥)
//
// **원시 diff 가 아니라 정리된 결론이다.** QA 의 하루는 "AI 가 찾은 것을 다시 읽는" 것이
// 아니라 무엇이 위험한지 고르는 것이라, 카드가 답해야 하는 질문은 세 개뿐이다 —
// 얼마나 위험한가 · 어디서 온 것인가 · 무엇을 하면 되는가.

import { statusLabelKey } from '@nerv/schema';
import { Link } from '@tanstack/react-router';
import { StatusBadge } from '../../components/status-badge.js';
import { SEVERITY_TOKEN } from '../../components/status-token.js';
import { useT } from '../../lib/i18n.js';
import type { Row } from '../../lib/queries.js';
import { cn } from '../../lib/utils.js';

export interface FindingCardProps {
  finding: Row;
  projectSlug: string;
  canResolve: boolean;
  onResolve: (finding: Row, action: 'fixed' | 'dismissed' | 'wont_fix') => void;
}

export function FindingCard({
  finding,
  projectSlug,
  canResolve,
  onResolve,
}: FindingCardProps): React.JSX.Element {
  const t = useT();
  const severity = String(finding['severity']);
  const status = String(finding['status']);
  const token = SEVERITY_TOKEN[severity as 'info'] ?? 'idle';
  const occurrences = Number(finding['occurrence_count'] ?? 1);
  const specKey = finding['spec_key'];
  const tags = Array.isArray(finding['tags']) ? (finding['tags'] as string[]) : [];

  return (
    <article
      data-testid="finding-card"
      data-severity={severity}
      className={cn(
        // 주의가 필요한 것만 좌측 룰로 튄다(§2.4d) — 전부 튀면 아무것도 튀지 않는다
        'border-b border-border px-4 py-3 last:border-b-0',
        severity === 'critical' && 'border-l-2 border-l-status-danger',
      )}
    >
      <div className="flex flex-wrap items-start gap-2">
        <StatusBadge token={token} label={t(`severity.${severity}` as 'severity.info')} />
        <h3 className="min-w-0 flex-1 text-sm font-medium text-text">{String(finding['title'])}</h3>
        {status !== 'open' && (
          <StatusBadge token="idle" label={t(statusLabelKey('finding', status))} />
        )}
      </div>

      {/* provenance 3종 — 셋이 다 있어야 P5(리뷰 출처 추적 곤란)가 닫힌다(REQ-WEB-062).
       **없는 출처는 빈칸이 아니라 "없음"이다** — 빈칸은 "아직 안 불러왔나"로 읽힌다 */}
      {/* **폭을 값의 길이에 맞춰 나눈다.** 균등하게 셋으로 자르면 경로가 잘리고, 경로에만
          몰아 주면 이번엔 `브랜치 @ 커밋` 이 잘린다(실측 2026-08-23, 두 번 고쳤다).
          비율은 실제 값의 글자 수에서 나온다: 경로 ~45자 · 커밋 줄 ~27자 · 스펙 ~25자 */}
      <dl className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-0.5 text-2xs text-text-mute @2xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
        <Provenance label={t('reviews.provenance.code')}>
          {finding['file_path'] == null
            ? t('reviews.provenance.none')
            : `${String(finding['file_path'])}${finding['line_start'] == null ? '' : `:${String(finding['line_start'])}`}`}
        </Provenance>
        <Provenance label={t('reviews.provenance.commit')}>
          {`${String(finding['branch'])} @ ${String(finding['head_sha']).slice(0, 7)}`}
        </Provenance>
        <Provenance label={t('reviews.provenance.spec')}>
          {typeof specKey === 'string' ? (
            <Link
              to="/p/$proj/specs/$spec"
              params={{ proj: projectSlug, spec: specKey }}
              className="text-status-action hover:underline"
            >
              {specKey}
              {typeof finding['requirement_ref'] === 'string'
                ? ` / ${String(finding['requirement_ref'])}`
                : ''}
            </Link>
          ) : (
            t('reviews.provenance.none')
          )}
        </Provenance>
      </dl>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-2xs text-text-faint">
        {/* 표시 키를 만들지 않는다 — 타입 문자를 늘리는 것은 새 결정이다(§2.6a ①).
            대신 **짧은 id 라고 밝히고** 준다: 밝히지 않으면 사람은 그것을 전체 id 로
            오해하고 어딘가에 붙여 넣는다.

            **뒤 8자다.** UUIDv7 의 앞 48비트(=12자)는 시각이라 같은 리뷰에서 나온
            발견들은 앞자리가 통째로 같다 — 앞 8자를 쓰면 세 발견이 전부 `01990a66` 로
            보인다(실측 2026-08-23, 시드 화면). 구별되는 것은 난수 쪽뿐이다. */}
        <span className="font-mono">
          {t('reviews.short_id')} {shortId(String(finding['id']))}
        </span>
        {occurrences > 1 && (
          <span data-testid="finding-occurrences">
            {t('reviews.occurrence', {
              count: occurrences,
              round: Number(finding['round_no'] ?? 1),
            })}
          </span>
        )}
        {tags.map((tag) => (
          <span key={tag} className="rounded-nerv-sm bg-bg-sunken px-1.5 py-0.5 font-mono">
            {tag}
          </span>
        ))}
      </div>

      {status === 'open' && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(['fixed', 'dismissed', 'wont_fix'] as const).map((action) => (
            <button
              key={action}
              type="button"
              data-testid={`resolve-${action}`}
              disabled={!canResolve}
              title={canResolve ? undefined : t('reviews.no_permission')}
              onClick={() => onResolve(finding, action)}
              className={cn(
                'rounded-nerv-sm border border-border px-2 py-0.5 text-2xs text-text-mute transition-colors',
                canResolve
                  ? 'hover:border-border-strong hover:text-text'
                  : 'cursor-not-allowed opacity-60',
              )}
            >
              {t(`reviews.action.${action}` as 'reviews.action.fixed')}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function Provenance({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 gap-1.5">
      <dt className="shrink-0 text-text-faint">{label}</dt>
      <dd className="min-w-0 truncate font-mono">{children}</dd>
    </div>
  );
}

/**
 * 사람이 대화에서 가리키는 짧은 손잡이. **UUID 의 뒤쪽**을 쓴다 —
 * UUIDv7 앞 48비트는 생성 시각이라 같은 순간에 만들어진 레코드끼리 앞자리가 같다.
 */
function shortId(id: string): string {
  return id.replaceAll('-', '').slice(-8);
}
