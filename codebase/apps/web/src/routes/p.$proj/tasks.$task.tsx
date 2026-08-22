// /p/:proj/tasks/:task — 작업 상세 (screens.md §2.5)
//
// 여기서 done 전이를 한다. **게이트가 요구하는 것을 폼이 먼저 보여준다** — 스펙 영향 선언과
// 증적. 조건 5(스펙 영향)가 clemvion 에서 가장 잘 작동한 규칙의 이식이라, "없음"도 명시적으로
// 고르게 만든다. 빈 선언을 허용하면 규칙이 사라진다.

import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StatusBadge } from '../../components/status-badge.js';
import { TASK_TOKEN } from '../../components/status-token.js';
import { apiFetch, NervApiError } from '../../lib/api.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import { rows, useProject, useTask } from '../../lib/queries.js';
import type { StatusToken } from '../../components/status-badge.js';

export const Route = createFileRoute('/p/$proj/tasks/$task')({ component: TaskDetail });

function TaskDetail(): React.JSX.Element {
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
      pushToast({ tone: 'ok', message: `상태를 ${String(result['status'])} 로 바꿨습니다.` });
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
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <header className="flex flex-wrap items-center gap-2">
        <Link to="/p/$proj/tasks" params={{ proj }} className="text-sm text-link underline">
          ← 보드
        </Link>
        <h1 className="text-lg font-semibold">{String(data['title'] ?? task)}</h1>
        <span className="font-mono text-xs text-text-faint">{task}</span>
        <StatusBadge
          token={(TASK_TOKEN[status as keyof typeof TASK_TOKEN] ?? 'idle') as StatusToken}
          label={status}
        />
      </header>

      <section className="grid gap-2 rounded-md border border-border bg-bg-elev p-3 text-sm md:grid-cols-2">
        <Field label="① 목표">{String(data['goal_md'] ?? '—')}</Field>
        <Field label="② 산출물 형식">{String(data['output_format_md'] ?? '—')}</Field>
        <Field label="③ 도구·출처">{String(data['tools_sources_md'] ?? '—')}</Field>
        <Field label="④ 경계">{String(data['boundaries_md'] ?? '—')}</Field>
      </section>

      <section className="rounded-md border border-border bg-bg-elev p-3 text-sm">
        <h2 className="mb-2 font-semibold text-text-mute">활성 클레임</h2>
        <ul className="flex flex-col gap-1">
          {rows(data['claims']).map((claim) => (
            <li key={String(claim['id'])} className="flex flex-wrap gap-2 text-xs">
              <span>{String(claim['status'])}</span>
              <span className="font-mono">{String(claim['hostname'] ?? '사람')}</span>
              <span>{String(claim['agent_type'] ?? '')}</span>
              <span className="text-text-faint">{String(claim['external_session_id'] ?? '')}</span>
            </li>
          ))}
          {rows(data['claims']).length === 0 && <li className="text-text-faint">없습니다.</li>}
        </ul>
      </section>

      <section className="rounded-md border border-border bg-bg-elev p-3 text-sm">
        <h2 className="mb-2 font-semibold text-text-mute">완료 처리 (done 게이트)</h2>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={specImpactNone}
              onChange={(e) => setSpecImpactNone(e.target.checked)}
            />
            스펙 영향 없음
          </label>
          {!specImpactNone && (
            <textarea
              value={specImpactNote}
              onChange={(e) => setSpecImpactNote(e.target.value)}
              placeholder="어떤 스펙이 어떻게 바뀌어야 하는지"
              rows={2}
              className="rounded border border-border bg-bg px-2 py-1"
            />
          )}
          <div className="flex gap-2">
            <select
              value={evidenceKind}
              onChange={(e) => setEvidenceKind(e.target.value)}
              className="rounded border border-border bg-bg px-2 py-1"
            >
              {['pr', 'commit', 'test', 'code_path'].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <input
              value={evidenceLocator}
              onChange={(e) => setEvidenceLocator(e.target.value)}
              placeholder="증적 위치 (PR URL · 커밋 SHA · 테스트 ID)"
              className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1"
            />
          </div>
          {rejection !== null && (
            <p
              role="alert"
              data-testid="transition-rejected"
              className="text-sm text-status-danger"
            >
              전이 거부 — {rejection.message}
              {rejection.missing.length > 0 && ` (누락: ${rejection.missing.join(', ')})`}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={status === 'done' || transition.isPending}
              onClick={() => transition.mutate('done')}
              title={rejection === null ? undefined : `직전 거부: ${rejection.message}`}
              className="rounded bg-status-done px-2 py-1 text-white disabled:opacity-50"
            >
              완료로 전이
            </button>
            <input
              value={blockedReason}
              onChange={(e) => setBlockedReason(e.target.value)}
              placeholder="막힌 사유"
              className="rounded border border-border bg-bg px-2 py-1"
            />
            <button
              type="button"
              disabled={blockedReason.trim() === '' || transition.isPending}
              onClick={() => transition.mutate('blocked')}
              className="rounded border border-status-danger px-2 py-1 text-status-danger disabled:opacity-50"
              title="사유 없는 blocked 는 백로그 부패의 씨앗이다"
            >
              막힘으로 전이
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-md border border-border bg-bg-elev p-3 text-sm">
        <h2 className="mb-2 font-semibold text-text-mute">증적</h2>
        <ul className="flex flex-col gap-1 text-xs">
          {rows(data['evidence']).map((e) => (
            <li key={String(e['id'])} className="flex gap-2">
              <span className="font-mono">{String(e['kind'])}</span>
              <span className="truncate">{String(e['locator'])}</span>
            </li>
          ))}
          {rows(data['evidence']).length === 0 && (
            <li className="text-text-faint">아직 없습니다.</li>
          )}
        </ul>
      </section>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <div className="text-xs text-text-faint">{label}</div>
      <div className="whitespace-pre-wrap">{children}</div>
    </div>
  );
}
