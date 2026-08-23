// /p/:proj/tasks/:task — 작업 상세 (screens.md §2.5)
//
// 여기서 done 전이를 한다. **게이트가 요구하는 것을 폼이 먼저 보여준다** — 스펙 영향 선언과
// 증적. 조건 5(스펙 영향)가 clemvion 에서 가장 잘 작동한 규칙의 이식이라, "없음"도 명시적으로
// 고르게 만든다. 빈 선언을 허용하면 규칙이 사라진다.

import { statusLabelKey } from '@nerv/schema';
import { useT } from '../../lib/i18n.js';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StatusBadge } from '../../components/status-badge.js';
import { TASK_TOKEN } from '../../components/status-token.js';
import { apiFetch, NervApiError } from '../../lib/api.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import { rows, useProject, useTask } from '../../lib/queries.js';
import {
  Button,
  Card,
  Input,
  Mono,
  PageBody,
  PageHeader,
  SectionTitle,
  Select,
  Textarea,
} from '../../components/ui/primitives.js';
import type { StatusToken } from '../../components/status-badge.js';

export const Route = createFileRoute('/p/$proj/tasks/$task')({ component: TaskDetail });

function TaskDetail(): React.JSX.Element {
  const t = useT();
  const { proj, task } = Route.useParams();
  const detail = useTask(proj, task);
  const project = useProject(proj);
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();

  const [specImpactNone, setSpecImpactNone] = useState(true);
  const [specImpactNote, setSpecImpactNote] = useState('');
  const [evidenceKind, setEvidenceKind] = useState('pr');
  const [evidenceLocator, setEvidenceLocator] = useState('');
  const [blockedReason, setBlockedReason] = useState('');
  /** 서버가 거부한 사유 — 카드 옆에 남긴다. 토스트는 사라지고 사람은 이유를 잊는다 */
  const [rejection, setRejection] = useState<{ message: string; missing: string[] } | null>(null);

  const data = detail.data ?? {};
  const status = String(data['status'] ?? '');
  const projectId = project.data?.['id'];

  const transition = useMutation({
    mutationFn: (next: 'done' | 'blocked' | 'in_progress') =>
      apiFetch<Record<string, unknown>>(
        `/projects/${proj}/tasks/${String(data['id'])}/transition`,
        {
          method: 'POST',
          body: {
            status: next,
            ...(next === 'done'
              ? {
                  spec_impact: specImpactNone ? { none: true } : { note: specImpactNote },
                  evidence:
                    evidenceLocator.trim() === ''
                      ? []
                      : [{ kind: evidenceKind, locator: evidenceLocator }],
                }
              : {}),
            ...(next === 'blocked' ? { blocked_reason: blockedReason } : {}),
          },
        },
      ),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(task) });
      if (typeof projectId === 'string') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) });
      }
      pushToast({
        tone: 'ok',
        message: t('task.status_changed', { status: String(result['status']) }),
      });
      setRejection(null);
    },
    onError: (error: Error) => {
      // 거부는 **화면에 남는다**(REQ-WEB-018). 상태는 그대로이고(낙관적 갱신을 하지 않으므로
      // 되돌릴 것도 없다) 무엇이 빠졌는지가 버튼 옆에 붙는다.
      const missing =
        error instanceof NervApiError && Array.isArray(error.body.details['missing'])
          ? (error.body.details['missing'] as string[])
          : [];
      setRejection({ message: error.message, missing });
      pushToast({ tone: 'warn', message: error.message });
    },
  });

  return (
    <PageBody>
      <Link
        to="/p/$proj/tasks"
        params={{ proj }}
        className="mb-2 inline-block text-xs text-text-mute hover:text-text"
      >
        {t('task.back_to_board')}
      </Link>
      <PageHeader
        title={String(data['title'] ?? task)}
        meta={
          <>
            <Mono>{task}</Mono>
            <StatusBadge
              token={(TASK_TOKEN[status as keyof typeof TASK_TOKEN] ?? 'idle') as StatusToken}
              label={t(statusLabelKey('task', status))}
            />
          </>
        }
      />

      <div className="flex flex-col gap-4">
        <Card>
          <SectionTitle>{t('task.brief')}</SectionTitle>
          <div className="grid gap-x-6 gap-y-3 text-sm md:grid-cols-2">
            <Element label={t('task.brief.goal')}>{String(data['goal_md'] ?? '—')}</Element>
            <Element label={t('task.brief.output')}>
              {String(data['output_format_md'] ?? '—')}
            </Element>
            <Element label={t('task.brief.tools')}>
              {String(data['tools_sources_md'] ?? '—')}
            </Element>
            <Element label={t('task.brief.boundaries')}>
              {String(data['boundaries_md'] ?? '—')}
            </Element>
          </div>
        </Card>

        <Card>
          <SectionTitle>{t('task.claims')}</SectionTitle>
          <ul className="flex flex-col gap-1">
            {rows(data['claims']).map((claim) => (
              <li key={String(claim['id'])} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">{String(claim['status'])}</span>
                <span className="font-mono">
                  {String(claim['hostname'] ?? t('task.claim_human'))}
                </span>
                <span className="text-text-mute">{String(claim['agent_type'] ?? '')}</span>
                <Mono>{String(claim['external_session_id'] ?? '')}</Mono>
              </li>
            ))}
            {rows(data['claims']).length === 0 && (
              <li className="text-sm text-text-faint">{t('common.none')}</li>
            )}
          </ul>
        </Card>

        <Card>
          <SectionTitle>{t('task.done_gate')}</SectionTitle>
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={specImpactNone}
                onChange={(e) => setSpecImpactNone(e.target.checked)}
              />
              {t('task.spec_impact_none')}
              <span className="text-xs text-text-faint">— {t('task.spec_impact_note')}</span>
            </label>
            {!specImpactNone && (
              <Textarea
                value={specImpactNote}
                onChange={(e) => setSpecImpactNote(e.target.value)}
                placeholder={t('task.spec_impact_placeholder')}
                rows={2}
              />
            )}
            <div className="flex gap-2">
              <Select value={evidenceKind} onChange={(e) => setEvidenceKind(e.target.value)}>
                {['pr', 'commit', 'test', 'code_path'].map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </Select>
              <Input
                value={evidenceLocator}
                onChange={(e) => setEvidenceLocator(e.target.value)}
                placeholder={t('task.evidence_placeholder')}
                className="min-w-0 flex-1"
              />
            </div>
            {rejection !== null && (
              <p
                role="alert"
                data-testid="transition-rejected"
                className="rounded-nerv-sm bg-status-danger-soft px-2 py-1.5 text-sm text-status-danger"
              >
                {t('task.transition_rejected', { message: rejection.message })}
                {rejection.missing.length > 0 &&
                  t('task.transition_missing', { missing: rejection.missing.join(', ') })}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Button
                variant="primary"
                disabled={status === 'done' || transition.isPending}
                onClick={() => transition.mutate('done')}
                title={
                  rejection === null
                    ? undefined
                    : t('task.last_rejection', { message: rejection.message })
                }
              >
                {t('task.to_done')}
              </Button>
              <span aria-hidden="true" className="h-5 w-px bg-border" />
              <Input
                value={blockedReason}
                onChange={(e) => setBlockedReason(e.target.value)}
                placeholder={t('task.blocked_reason')}
                className="w-56"
              />
              <Button
                variant="danger"
                disabled={blockedReason.trim() === '' || transition.isPending}
                onClick={() => transition.mutate('blocked')}
                title={t('task.blocked_reason_title')}
              >
                {t('task.to_blocked')}
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <SectionTitle>{t('task.evidence')}</SectionTitle>
          <ul className="flex flex-col">
            {rows(data['evidence']).map((e) => (
              <li
                key={String(e['id'])}
                className="flex gap-2 border-b border-border py-1.5 text-xs last:border-0"
              >
                <span className="w-20 shrink-0 font-mono text-text-faint">{String(e['kind'])}</span>
                <span className="truncate">{String(e['locator'])}</span>
              </li>
            ))}
            {rows(data['evidence']).length === 0 && (
              <li className="text-sm text-text-faint">{t('common.not_yet')}</li>
            )}
          </ul>
        </Card>
      </div>
    </PageBody>
  );
}

/** 위임 명세 한 요소 — 라벨은 작게, 본문은 그대로. 4요소가 나란히 보여야 빈 칸이 눈에 띈다 */
function Element({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-0.5 text-2xs font-medium tracking-wide text-text-faint uppercase">
        {label}
      </div>
      <div className="whitespace-pre-wrap">{children}</div>
    </div>
  );
}
