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
import { rolesInProject } from '../../lib/session.js';
import { useScope } from '../../lib/scope.js';
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
  // 스코프는 헤더의 select 와 같은 규칙으로 정한다(scope.ts) — 예전에는 멤버십 한 행의
  // `project_slug` 를 썼고, 조직 단위 멤버십만 가진 admin 은 그 값이 `null` 이라
  // **자기 조직의 게이트 정책을 아예 열지 못했다**(실측 2026-08-24).
  const { orgSlug, projectSlug } = useScope();
  // 프로젝트가 없으면 편집할 정책도 없다 — 빈 slug 로 서버를 부르지 않는다(조용한 500 의 원인)
  const slug = projectSlug ?? '';
  const project = useProject(slug);
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  // `membership?.role` 은 **없는 필드**였다(멤버십이 나르는 것은 `roles` 배열이다).
  // `Membership` 이 `Record<string, unknown>` 을 확장해 타입이 잡지 못했고, 그래서
  // 이 탭은 누구에게나 읽기 전용이었다 — admin 에게도.
  const isAdmin = rolesInProject(me.data, orgSlug, projectSlug).includes('admin');

  const stored = GatePolicySchema.safeParse(project.data?.['gate_policy'] ?? {});
  const policy = stored.success ? stored.data : GatePolicySchema.parse({});

  const [boundaries, setBoundaries] = useState<string | null>(null);
  const [objectionHours, setObjectionHours] = useState<string | null>(null);
  const [dynamicEscalation, setDynamicEscalation] = useState<boolean | null>(null);

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${slug}`, {
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(slug) });
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
          disabled={!isAdmin || slug === '' || save.isPending}
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
