// 발견 레일 — 큐에서 고른 하나를 편다 (screens.md §2.6a · REQ-WEB-069)
//
// 카드는 **훑는** 자리라 값을 자른다: 경로는 `truncate` 로 잘리고, 갈래(category)와
// 심볼은 아예 안 나온다. 레일은 **고른 하나**를 자르지 않고 보이는 자리다 — 세션
// 모니터가 같은 규칙으로 서 있다(§2.5).
//
// 새 엔드포인트를 만들지 않는다: 목록 응답이 이미 이 전부를 싣고 있다.

import { statusLabelKey } from '@nerv/schema';
import { Link } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { queryKeys } from '../../lib/query-keys.js';
import { rows, useFindingComments } from '../../lib/queries.js';
import { useRealtime } from '../../lib/realtime.js';
import { StatusBadge } from '../../components/status-badge.js';
import { SEVERITY_TOKEN } from '../../components/status-token.js';
import { useT } from '../../lib/i18n.js';
import { relativeTime } from '../../lib/format.js';
import type { Row } from '../../lib/queries.js';

export function FindingRail({
  finding,
  projectSlug,
  projectId,
  canResolve,
  canPromote,
}: {
  finding: Row;
  projectSlug: string;
  projectId?: string | undefined;
  /** 처분과 **코멘트** 둘 다의 기준 — 서버가 코멘트에도 `review:resolve` 를 요구한다 */
  canResolve: boolean;
  /** 승격은 작업을 만드는 일이라 `task:update` 가 기준이다(처분과 다른 축) */
  canPromote: boolean;
}): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const findingId = String(finding['id']);
  const [draft, setDraft] = useState('');
  const comments = useFindingComments(projectSlug, findingId);

  const add = useMutation({
    mutationFn: (body: string) =>
      apiFetch(`/projects/${projectSlug}/findings/${findingId}/comments`, {
        method: 'POST',
        body: { body_md: body },
      }),
    onSuccess: () => {
      setDraft('');
      void queryClient.invalidateQueries({ queryKey: ['finding', findingId, 'comments'] });
    },
    onError: (error: Error) => pushToast({ tone: 'warn', message: error.message }),
  });

  const promote = useMutation({
    mutationFn: (): Promise<Record<string, unknown>> =>
      apiFetch<Record<string, unknown>>(`/projects/${projectSlug}/findings/${findingId}/task`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projectFindings(projectId ?? projectSlug),
      });
      pushToast({
        tone: 'ok',
        message:
          result['created'] === true
            ? t('reviews.promoted', { key: String(result['key'] ?? '') })
            : t('reviews.promoted_already'),
      });
    },
    onError: (error: Error) => pushToast({ tone: 'warn', message: error.message }),
  });
  const promoted = typeof finding['promoted_task_key'] === 'string';
  const severity = String(finding['severity']);
  const status = String(finding['status']);
  const specKey = finding['spec_key'];

  return (
    <div data-testid="finding-rail" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge
          token={SEVERITY_TOKEN[severity as 'info'] ?? 'idle'}
          label={t(`severity.${severity}` as 'severity.info')}
        />
        <StatusBadge token="idle" label={t(statusLabelKey('finding', status))} />
      </div>
      <h2 className="text-sm font-medium text-text">{String(finding['title'])}</h2>

      {/* 카드가 자르는 것들 — 여기서는 자르지 않는다 */}
      <dl className="flex flex-col gap-1.5 text-2xs">
        <Field label={t('reviews.rail.category')} value={str(finding['category'])} />
        <Field
          label={t('reviews.provenance.code')}
          value={
            str(finding['file_path']) === null
              ? null
              : `${String(finding['file_path'])}${finding['line_start'] == null ? '' : `:${String(finding['line_start'])}`}`
          }
          mono
        />
        <Field label={t('reviews.rail.symbol')} value={str(finding['symbol'])} mono />
        <Field
          label={t('reviews.provenance.commit')}
          value={`${String(finding['branch'])} @ ${String(finding['head_sha']).slice(0, 12)}`}
          mono
        />
        <Field
          label={t('reviews.rail.reviewed_at')}
          value={relativeTime(t, str(finding['reviewed_at']))}
        />
        <Field
          label={t('reviews.rail.found_at')}
          value={relativeTime(t, str(finding['created_at']))}
        />
      </dl>

      {typeof specKey === 'string' && (
        <div className="text-2xs">
          <span className="mr-1.5 text-text-faint">{t('reviews.provenance.spec')}</span>
          <Link
            to="/p/$proj/specs/$spec"
            params={{ proj: projectSlug, spec: specKey }}
            className="text-status-action hover:underline"
          >
            {specKey}
            {str(finding['spec_title']) === null ? '' : ` · ${String(finding['spec_title'])}`}
          </Link>
        </div>
      )}

      {str(finding['detail_md']) !== null && (
        <section>
          <h3 className="mb-1 text-2xs text-text-faint">{t('reviews.rail.detail')}</h3>
          <p className="text-sm whitespace-pre-wrap text-text-mute">
            {String(finding['detail_md'])}
          </p>
        </section>
      )}

      {str(finding['suggestion_md']) !== null && (
        <section>
          <h3 className="mb-1 text-2xs text-text-faint">{t('reviews.suggestion')}</h3>
          <p className="border-l-2 border-l-status-action pl-2.5 text-sm whitespace-pre-wrap text-text-mute">
            {String(finding['suggestion_md'])}
          </p>
        </section>
      )}

      {/* **피드백이 여기서 끝나지 않는다.** 예전에는 처분 버튼 셋뿐이라 "왜 아니라고
          했는지" 를 적을 자리가 없었고, 적어도 지적한 에이전트는 듣지 못했다.
          코멘트는 그 세션의 하트비트로 돌아간다(§6.7) */}
      <section data-testid="finding-comments">
        <h3 className="mb-1.5 text-2xs text-text-faint">{t('reviews.rail.comments')}</h3>
        <ul className="mb-2 flex flex-col gap-1.5">
          {rows(comments.data?.items).map((c) => (
            <li key={String(c['id'])} className="border-l-2 border-l-border pl-2.5">
              <p className="text-sm whitespace-pre-wrap text-text-mute">{String(c['body_md'])}</p>
              <p className="text-2xs text-text-faint">
                {c['is_agent'] === true ? '🤖 ' : '👤 '}
                {String(c['author_name'] ?? '')} · {relativeTime(t, str(c['created_at']))}
              </p>
            </li>
          ))}
        </ul>
        <textarea
          data-testid="comment-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('reviews.rail.comment_hint')}
          rows={2}
          className="w-full rounded-nerv-sm border border-border bg-bg-elev px-2 py-1.5 text-sm"
        />
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <button
            type="button"
            data-testid="comment-submit"
            disabled={!canResolve || draft.trim() === '' || add.isPending}
            title={canResolve ? undefined : t('reviews.no_permission')}
            onClick={() => add.mutate(draft)}
            className="rounded-nerv-sm border border-border px-2 py-0.5 text-2xs text-text-mute hover:border-border-strong hover:text-text disabled:opacity-50"
          >
            {t('reviews.rail.comment_submit')}
          </button>
          {/* **"나중에 하자" 가 갈 곳** — wont_fix 는 근거만 남기고 큐에서 사라진다 */}
          <button
            type="button"
            data-testid="promote-task"
            disabled={!canPromote || promoted || promote.isPending}
            title={canPromote ? undefined : t('reviews.no_permission')}
            onClick={() => promote.mutate()}
            className="rounded-nerv-sm border border-border px-2 py-0.5 text-2xs text-text-mute hover:border-border-strong hover:text-text disabled:opacity-50"
          >
            {promoted ? t('reviews.promote_done') : t('reviews.promote')}
          </button>
        </div>
      </section>

      {/* 처분 — **무엇을 했나가 아니라 왜 그렇게 정했나**가 여기 남는 값이다 */}
      {str(finding['resolution_rationale']) !== null && (
        <section data-testid="rail-resolution">
          <h3 className="mb-1 text-2xs text-text-faint">{t('reviews.rail.resolution')}</h3>
          <p className="text-sm whitespace-pre-wrap text-text-mute">
            {String(finding['resolution_rationale'])}
          </p>
          <p className="mt-1 text-2xs text-text-faint">
            {[
              // **무엇으로 고쳤는지**를 적는다(2026-08-30) — spec_drift 지적이 코드 커밋으로
              // 닫혔다면 그건 이상 신호인데, 종류를 적지 않으면 그 신호가 사라진다.
              finding['resolution_kind'] === 'spec_change' ? t('reviews.by_spec_change') : null,
              str(finding['resolved_by_name']),
              relativeTime(t, str(finding['resolved_at'])),
              str(finding['resolution_commit'])?.slice(0, 12),
            ]
              .filter((v) => v !== null && v !== '')
              .join(' · ')}
          </p>
        </section>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}): React.JSX.Element | null {
  // **없는 값은 줄을 만들지 않는다.** 카드에서는 "없음"이 뜻이 있지만(빈칸은 로딩으로
  // 읽힌다) 레일은 고른 하나의 전모라 빈 줄이 늘어서면 그게 소음이다.
  if (value === null || value === '') return null;
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 text-text-faint">{label}</dt>
      <dd
        className={mono ? 'min-w-0 font-mono break-all text-text-mute' : 'min-w-0 text-text-mute'}
      >
        {value}
      </dd>
    </div>
  );
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
