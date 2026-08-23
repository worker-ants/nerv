// /settings/gates — S8 게이트 정책 (api.md §2.1a · D-06 · FR-14)
//
// MVP 편집 항목은 `spec_gate.*` 3키다 — `failopen`·`retention` 은 표시만 한다(§2.1a).
// **admin 아닌 역할에는 API 와 UI 양쪽이 거부한다**: 여기서는 비활성 + 사유, 서버에서는 403.
// 둘 중 하나만 있으면 게이트가 우회 가능해지거나 사용자가 이유 없이 막힌다.

import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { GatePolicySchema } from '@nerv/schema';
import { apiFetch } from '../../lib/api.js';
import { useMe, useProject } from '../../lib/queries.js';
import { primaryMembership } from '../../lib/session.js';
import { useRealtime } from '../../lib/realtime.js';
import { queryKeys } from '../../lib/query-keys.js';
import {
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  SectionTitle,
} from '../../components/ui/primitives.js';

export const Route = createFileRoute('/settings/gates')({ component: GatesTab });

function GatesTab(): React.JSX.Element {
  const me = useMe();
  const membership = me.data === undefined ? null : primaryMembership(me.data);
  const projectSlug = membership?.project_slug ?? '';
  const project = useProject(projectSlug);
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const isAdmin = membership?.role === 'admin';

  const stored = GatePolicySchema.safeParse(project.data?.['gate_policy'] ?? {});
  const policy = stored.success ? stored.data : GatePolicySchema.parse({});

  const [boundaries, setBoundaries] = useState<string | null>(null);
  const [objectionHours, setObjectionHours] = useState<string | null>(null);
  const [dynamicEscalation, setDynamicEscalation] = useState<boolean | null>(null);

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${projectSlug}`, {
        method: 'PATCH',
        body: {
          gate_policy: {
            ...policy,
            spec_gate: {
              tier_boundaries: (boundaries ?? policy.spec_gate.tier_boundaries.join(','))
                .split(',')
                .map((v) => Number(v.trim())),
              t1_objection_hours: Number(objectionHours ?? policy.spec_gate.t1_objection_hours),
              dynamic_escalation: dynamicEscalation ?? policy.spec_gate.dynamic_escalation,
            },
          },
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectSlug) });
      pushToast({ tone: 'ok', message: '게이트 정책을 저장했습니다.' });
    },
    onError: (error: Error) => pushToast({ tone: 'warn', message: error.message }),
  });

  return (
    <section className="flex max-w-2xl flex-col gap-5">
      <PageHeader
        title="게이트 정책"
        description="MVP 편집 항목은 spec_gate 3키입니다 — 나머지는 표시 전용입니다."
      />
      {!isAdmin && (
        <p className="rounded-nerv border border-border bg-status-waiting-soft px-3 py-2 text-sm text-status-waiting">
          게이트 정책 편집은 <code className="font-mono">admin</code> 역할만 가능합니다 — 아래는
          현재 값입니다.
        </p>
      )}

      <Card className="flex flex-col gap-4">
        <Field
          label="티어 경계 (T1/T2/T3 진입 점수)"
          hint="4축 합산: 부수효과 · 민감도 · 되돌림 · 폭발 반경"
        >
          <Input
            value={boundaries ?? policy.spec_gate.tier_boundaries.join(', ')}
            onChange={(e) => setBoundaries(e.target.value)}
            disabled={!isAdmin}
          />
        </Field>
        <Field label="T1 이의제기 창(시간)">
          <Input
            type="number"
            value={objectionHours ?? String(policy.spec_gate.t1_objection_hours)}
            onChange={(e) => setObjectionHours(e.target.value)}
            disabled={!isAdmin}
            className="w-32"
          />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={dynamicEscalation ?? policy.spec_gate.dynamic_escalation}
            onChange={(e) => setDynamicEscalation(e.target.checked)}
            disabled={!isAdmin}
            className="mt-1"
          />
          <span>
            동적 강화
            <span className="block text-xs text-text-mute">
              재시도·롤백 이력이 있으면 티어를 한 단계 올린다
            </span>
          </span>
        </label>
        <Button
          variant="primary"
          className="self-start"
          disabled={!isAdmin || save.isPending}
          onClick={() => save.mutate()}
          title={isAdmin ? undefined : '이 편집은 admin 역할만 가능합니다'}
        >
          저장
        </Button>
      </Card>

      <Card>
        <SectionTitle>fail-open 관측 · 표시 전용</SectionTitle>
        <p className="text-sm text-text-mute">
          연속 {policy.failopen.escalate_count}회 · {policy.failopen.window_hours}시간 창에서
          격상합니다. 판정 불가일 때 막지 않고 진행하되 기록하고, 반복되면 올린다(D-14).
        </p>
      </Card>
    </section>
  );
}
