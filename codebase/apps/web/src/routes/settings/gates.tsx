// /settings/gates — S8 게이트 정책 (api.md §2.1a · D-06 · FR-14)
//
// MVP 편집 항목은 `spec_gate.*` 두 키다(`tier_boundaries` · `dynamic_escalation`) — `failopen`·`retention` 은 표시만 한다(§2.1a).
// **admin 아닌 역할에는 API 와 UI 양쪽이 거부한다**: 여기서는 비활성 + 사유, 서버에서는 403.
// 둘 중 하나만 있으면 게이트가 우회 가능해지거나 사용자가 이유 없이 막힌다.

import { useT } from '../../lib/i18n.js';
import { useApiError } from '../../lib/api-errors.js';
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
  Select,
} from '../../components/ui/primitives.js';
import { ErrorState, failedWithoutData } from '../../components/query-state.js';

export const Route = createFileRoute('/settings/gates')({ component: GatesTab });

function GatesTab(): React.JSX.Element {
  const t = useT();
  const me = useMe();
  // 소속은 헤더의 select 와 같은 규칙으로 정한다(scope.ts) — 예전에는 멤버십 한 행의
  // `project_slug` 를 썼고, 조직 단위 멤버십만 가진 admin 은 그 값이 `null` 이라
  // **자기 조직의 게이트 정책을 아예 열지 못했다**(실측 2026-08-24).
  const { orgSlug, projectSlug, projects } = useScope();
  /**
   * **고치는 프로젝트를 이 화면이 고른다**(2026-09-24 · REQ-WEB-191). 게이트 정책은 프로젝트의
   * 것인데, 예전에는 대상이 헤더가 **기억한** 프로젝트였고 제목 어디에도 이름이 없었다 —
   * admin 이 마지막으로 들렀던 프로젝트의 정책을 모르고 바꿀 수 있었다. 기억은 초깃값일 뿐이다.
   */
  const [picked, setPicked] = useState<string | null>(null);
  // 프로젝트가 없으면 편집할 정책도 없다 — 빈 slug 로 서버를 부르지 않는다(조용한 500 의 원인)
  const slug = picked ?? projectSlug ?? '';
  const project = useProject(slug);
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();
  // `membership?.role` 은 **없는 필드**였다(멤버십이 나르는 것은 `roles` 배열이다).
  // `Membership` 이 `Record<string, unknown>` 을 확장해 타입이 잡지 못했고, 그래서
  // 이 탭은 누구에게나 읽기 전용이었다 — admin 에게도.
  const isAdmin = rolesInProject(me.data, orgSlug, slug === '' ? null : slug).includes('admin');
  const projectName = String(projects.find((p) => p['slug'] === slug)?.['name'] ?? slug);

  // **받아 오기 전에는 저장하지 않는다**(REQ-WEB-198). 저장 본문은 정책 전체를 펼쳐 보내므로
  // (`...policy`), 불러오는 중·실패 중에 보이던 **기본 정책**을 누르면 그 프로젝트의 정책이
  // 통째로 기본값으로 덮였다.
  const loaded = project.data !== undefined;
  const stored = GatePolicySchema.safeParse(project.data?.['gate_policy'] ?? {});
  const policy = stored.success ? stored.data : GatePolicySchema.parse({});

  const [boundaries, setBoundaries] = useState<string | null>(null);
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
              dynamic_escalation: dynamicEscalation ?? policy.spec_gate.dynamic_escalation,
            },
          },
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectBySlug(slug) });
      pushToast({ tone: 'ok', message: t('settings.gates.saved') });
    },
    onError: onApiError,
  });

  return (
    <section className="flex max-w-2xl flex-col gap-5">
      <PageHeader
        title={
          slug === ''
            ? t('settings.tab.gates')
            : t('settings.gates.title_project', { project: projectName })
        }
      />
      <Field label={t('common.project')} hint={t('settings.gates.project_hint')}>
        <Select
          data-testid="gates-project"
          value={slug}
          onChange={(e) => {
            setPicked(e.target.value);
            // 다른 프로젝트의 값을 들고 가면 그 프로젝트에 **옛 프로젝트의 경계**가 저장된다
            setBoundaries(null);
            setDynamicEscalation(null);
          }}
          className="max-w-xs"
        >
          {projects.map((p) => (
            <option key={String(p['slug'])} value={String(p['slug'])}>
              {String(p['name'])} ({String(p['slug'])})
            </option>
          ))}
        </Select>
      </Field>
      {!isAdmin && (
        <p className="rounded-nerv border border-border bg-status-waiting-soft px-3 py-2 text-sm text-status-waiting">
          {t('settings.gates.admin_only_pre')} <code className="font-mono">admin</code>{' '}
          {t('settings.gates.admin_only_post')}
        </p>
      )}

      {failedWithoutData(project) && (
        <ErrorState error={project.error} onRetry={() => void project.refetch()} />
      )}

      <Card className="flex flex-col gap-4">
        {/* 없으면 비활성 필드가 **고장으로** 읽힌다 — 무엇이 편집 대상인지 먼저 말한다 */}
        <p className="text-xs text-text-mute">{t('settings.gates.lead')}</p>
        <Field label={t('settings.gates.boundaries')} hint={t('settings.gates.boundaries_hint')}>
          <Input
            value={boundaries ?? policy.spec_gate.tier_boundaries.join(', ')}
            onChange={(e) => setBoundaries(e.target.value)}
            disabled={!isAdmin}
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
          disabled={!isAdmin || slug === '' || !loaded || save.isPending}
          onClick={() => save.mutate()}
          title={
            !isAdmin
              ? t('settings.gates.admin_only_title')
              : loaded
                ? undefined
                : t('settings.gates.loading_locked')
          }
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
