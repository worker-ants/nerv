// /settings/gates — S8 게이트 정책 (api.md §2.1a · D-06 · FR-14)
//
// MVP 편집 항목은 `spec_gate.*` 3키다 — `failopen`·`retention` 은 표시만 한다(§2.1a).
// **admin 아닌 역할에는 API 와 UI 양쪽이 거부한다**: 여기서는 비활성 + 사유, 서버에서는 403.
// 둘 중 하나만 있으면 게이트가 우회 가능해지거나 사용자가 이유 없이 막힌다.

import { useT } from '../../lib/i18n.js';
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
  const t = useT();
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
      pushToast({ tone: 'ok', message: t('settings.gates.saved') });
    },
    onError: (error: Error) => pushToast({ tone: 'warn', message: error.message }),
  });

  return (
    <section className="flex max-w-2xl flex-col gap-5">
      <PageHeader title={t('settings.tab.gates')} description={t('settings.gates.lead')} />
      {!isAdmin && (
        <p className="rounded-nerv border border-border bg-status-waiting-soft px-3 py-2 text-sm text-status-waiting">
          {t('settings.gates.admin_only_pre')} <code className="font-mono">admin</code>{' '}
          {t('settings.gates.admin_only_post')}
        </p>
      )}

      <Card className="flex flex-col gap-4">
        <Field label={t('settings.gates.boundaries')} hint={t('settings.gates.boundaries_hint')}>
          <Input
            value={boundaries ?? policy.spec_gate.tier_boundaries.join(', ')}
            onChange={(e) => setBoundaries(e.target.value)}
            disabled={!isAdmin}
          />
        </Field>
        <Field label={t('settings.gates.objection_hours')}>
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
            {t('settings.gates.dynamic')}
            <span className="block text-xs text-text-mute">{t('settings.gates.dynamic_hint')}</span>
          </span>
        </label>
        <Button
          variant="primary"
          className="self-start"
          disabled={!isAdmin || save.isPending}
          onClick={() => save.mutate()}
          title={isAdmin ? undefined : t('settings.gates.admin_only_title')}
        >
          {t('common.save')}
        </Button>
      </Card>

      <Card>
        <SectionTitle>{t('settings.gates.failopen')}</SectionTitle>
        <p className="text-sm text-text-mute">
          {t('settings.gates.failopen_body', {
            count: policy.failopen.escalate_count,
            hours: policy.failopen.window_hours,
          })}
        </p>
      </Card>
    </section>
  );
}
