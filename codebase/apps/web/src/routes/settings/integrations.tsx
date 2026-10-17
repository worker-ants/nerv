// S8 「연동」 탭 — Slack 채널과 CI 게이트 레시피 (2026-10-17 · 사람 결정 D1 · D2 · D3 · screens.md §2.8 · REQ-WEB-333 ~ 335)
//
// 연동은 프로젝트의 것이라 게이트 정책 탭처럼 고치는 프로젝트를 이 화면이 고른다(REQ-WEB-191). Slack 은 admin 이 사람으로만
// 바꾸고(서버가 판정한다 — REQ-API-355), CI 레시피는 누구나 받아 갈 수 있다(읽기 권한이면 저장소에 둘 파일을 볼 수 있다).
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CI_GATE_CHECK_NAME,
  CI_GATE_WORKFLOW_PATH,
  GatePolicySchema,
  renderCiGateWorkflow,
} from '@nerv/schema';
import { apiFetch } from '../../lib/api.js';
import { useApiError } from '../../lib/api-errors.js';
import { apiBase } from '../../lib/config.js';
import { relativeTime } from '../../lib/format.js';
import { useT } from '../../lib/i18n.js';
import { queryKeys } from '../../lib/query-keys.js';
import { rows, useMe, useMembers, useProject } from '../../lib/queries.js';
import { useRealtime } from '../../lib/realtime.js';
import { useScope } from '../../lib/scope.js';
import { rolesInProject } from '../../lib/session.js';
import {
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  SectionTitle,
  Select,
  Skeleton,
} from '../../components/ui/primitives.js';
import { ConfirmAction } from '../../components/ui/confirm-action.js';
import { ErrorState, failedWithoutData } from '../../components/query-state.js';
import { ReadOnlyNotice, scopeAdmins } from '../../components/read-only-notice.js';

export const Route = createFileRoute('/settings/integrations')({
  validateSearch: (search: Record<string, unknown>): { project?: string } =>
    typeof search['project'] === 'string' && search['project'] !== ''
      ? { project: search['project'] }
      : {},
  component: IntegrationsTab,
});

/** EP-PRJ-07 의 `slack` — 주소는 끝 네 글자뿐이다 */
export interface SlackStatus {
  enabled: boolean;
  webhook_prefix: string;
  connection: { hint: string; connected_at: string; connected_by: string | null } | null;
  last_delivery: {
    event_type: string;
    state: 'sent' | 'skipped' | 'failed';
    at: string;
    error: string | null;
  } | null;
  pending: number;
}

/**
 * 레시피가 물을 리뷰 종류 — 프로젝트의 done 게이트가 종류를 고르고 있으면 그것이고, 아니면 기본(`code`)이다. done 게이트가
 * 요구하는 리뷰를 머지 게이트도 요구해야 두 문이 같은 말을 한다.
 */
export function recipeKinds(gatePolicy: unknown): string | undefined {
  const parsed = GatePolicySchema.safeParse(gatePolicy ?? {});
  const coverage = parsed.success ? parsed.data.done_gate.review_coverage : false;
  return Array.isArray(coverage) && coverage.length > 0 ? coverage.join(',') : undefined;
}

function IntegrationsTab(): React.JSX.Element {
  const t = useT();
  const me = useMe();
  const { orgSlug, projectSlug, projects, projectsLoaded } = useScope();
  const navigate = useNavigate();
  const { project: fromUrl } = Route.useSearch();
  const picked =
    fromUrl !== undefined && (!projectsLoaded || projects.some((p) => p['slug'] === fromUrl))
      ? fromUrl
      : null;
  const slug = picked ?? projectSlug ?? '';
  const project = useProject(slug);
  const members = useMembers(orgSlug);
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();
  const isAdmin = rolesInProject(me.data, orgSlug, slug === '' ? null : slug).includes('admin');
  const nameOf = (s: string): string =>
    String(projects.find((p) => p['slug'] === s)?.['name'] ?? s);

  const status = useQuery({
    queryKey: queryKeys.integrations(slug),
    queryFn: () => apiFetch<{ slack: SlackStatus }>(`/projects/${slug}/integrations`),
    enabled: slug !== '',
  });
  const slack = status.data?.slack;
  const [webhook, setWebhook] = useState('');
  const refresh = (): void =>
    void queryClient.invalidateQueries({ queryKey: queryKeys.integrations(slug) });

  const connect = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${slug}/integrations/slack`, {
        method: 'PUT',
        body: { webhook_url: webhook.trim() },
      }),
    onSuccess: () => {
      setWebhook('');
      refresh();
      pushToast({ tone: 'ok', message: t('settings.integrations.connected_toast') });
    },
    onError: onApiError,
  });
  const test = useMutation({
    mutationFn: () => apiFetch(`/projects/${slug}/integrations/slack/test`, { method: 'POST' }),
    onSuccess: () => pushToast({ tone: 'ok', message: t('settings.integrations.test_ok') }),
    onError: onApiError,
  });
  const disconnect = useMutation({
    mutationFn: () => apiFetch(`/projects/${slug}/integrations/slack`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      pushToast({ tone: 'ok', message: t('settings.integrations.disconnected_toast') });
    },
    onError: onApiError,
  });

  const server = apiBase() === '' ? window.location.origin : apiBase();
  const kinds = recipeKinds(project.data?.['gate_policy']);
  const recipe = renderCiGateWorkflow({
    serverUrl: server,
    projectSlug: slug,
    orgSlug: orgSlug ?? '',
    ...(kinds === undefined ? {} : { kinds }),
  });
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void navigator.clipboard.writeText(recipe).then(() => {
      setCopied(true);
      pushToast({ tone: 'ok', message: t('settings.integrations.copied') });
    });
  };

  const lastLine = (): string | null => {
    const last = slack?.last_delivery;
    if (last == null) return null;
    const when = relativeTime(t, last.at);
    if (last.state === 'sent') return t('settings.integrations.slack_last_sent', { when });
    if (last.state === 'skipped') return t('settings.integrations.slack_last_skipped', { when });
    return t('settings.integrations.slack_last_failed', { when, error: last.error ?? '' });
  };

  return (
    <section className="flex max-w-2xl flex-col gap-5">
      <PageHeader
        title={
          slug === ''
            ? t('settings.tab.integrations')
            : t('settings.integrations.title_project', { project: nameOf(slug) })
        }
      />
      <Field label={t('common.project')} hint={t('settings.integrations.project_hint')}>
        <Select
          data-testid="integrations-project"
          value={slug}
          onChange={(e) => {
            setWebhook('');
            setCopied(false);
            void navigate({ to: '/settings/integrations', search: { project: e.target.value } });
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

      <Card className="flex flex-col gap-3" data-testid="integrations-slack">
        <SectionTitle>{t('settings.integrations.slack_title')}</SectionTitle>
        <p className="text-xs text-text-mute">{t('settings.integrations.slack_lead')}</p>
        {failedWithoutData(status) ? (
          <ErrorState error={status.error} onRetry={() => void status.refetch()} />
        ) : slack === undefined ? (
          <Skeleton rows={2} />
        ) : !slack.enabled ? (
          <p
            role="status"
            data-testid="integrations-slack-disabled"
            className="text-sm text-status-waiting"
          >
            {t('settings.integrations.slack_disabled')}
          </p>
        ) : (
          <>
            <p data-testid="integrations-slack-state" className="text-sm">
              {slack.connection === null
                ? t('settings.integrations.slack_not_connected')
                : t('settings.integrations.slack_connected', {
                    hint: slack.connection.hint,
                    who: slack.connection.connected_by ?? '—',
                    when: relativeTime(t, slack.connection.connected_at),
                  })}
            </p>
            {lastLine() !== null && (
              <p
                data-testid="integrations-slack-last"
                className={
                  slack.last_delivery?.state === 'failed'
                    ? 'text-xs text-status-danger'
                    : 'text-xs text-text-mute'
                }
              >
                {lastLine()}
                {slack.pending > 0 &&
                  ` · ${t('settings.integrations.slack_pending', { count: slack.pending })}`}
              </p>
            )}
            {!isAdmin ? (
              <ReadOnlyNotice
                admins={
                  members.data === undefined
                    ? undefined
                    : scopeAdmins(rows(members.data), slug === '' ? null : slug)
                }
              >
                {t('settings.integrations.admin_only_pre')} <code className="font-mono">admin</code>{' '}
                {t('settings.integrations.admin_only_post')}
              </ReadOnlyNotice>
            ) : (
              <div className="flex flex-col gap-2">
                <Field
                  label={t('settings.integrations.webhook_label')}
                  hint={t('settings.integrations.webhook_hint', { prefix: slack.webhook_prefix })}
                >
                  <Input
                    data-testid="integrations-webhook"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={slack.webhook_prefix}
                    value={webhook}
                    onChange={(e) => setWebhook(e.target.value)}
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    data-testid="integrations-connect"
                    disabled={webhook.trim() === '' || connect.isPending}
                    title={
                      webhook.trim() === '' ? t('settings.integrations.webhook_empty') : undefined
                    }
                    onClick={() => connect.mutate()}
                  >
                    {slack.connection === null
                      ? t('settings.integrations.connect')
                      : t('settings.integrations.replace')}
                  </Button>
                  {slack.connection !== null && (
                    <>
                      <Button
                        size="sm"
                        data-testid="integrations-test"
                        disabled={test.isPending}
                        onClick={() => test.mutate()}
                      >
                        {t('settings.integrations.test')}
                      </Button>
                      <ConfirmAction
                        label={t('settings.integrations.disconnect')}
                        testId="integrations-disconnect"
                        message={t('settings.integrations.disconnect_confirm')}
                        confirmLabel={t('settings.integrations.disconnect')}
                        pending={disconnect.isPending}
                        onConfirm={() => disconnect.mutate()}
                      />
                    </>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      <Card className="flex flex-col gap-3" data-testid="integrations-ci">
        <SectionTitle>{t('settings.integrations.ci_title')}</SectionTitle>
        <p className="text-xs text-text-mute">{t('settings.integrations.ci_lead')}</p>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
          <li>{t('settings.integrations.ci_step_file', { path: CI_GATE_WORKFLOW_PATH })}</li>
          <li>{t('settings.integrations.ci_step_secret')}</li>
          <li>{t('settings.integrations.ci_step_required', { check: CI_GATE_CHECK_NAME })}</li>
        </ol>
        {slug === '' ? null : (
          <div className="flex flex-col gap-2">
            <pre
              data-testid="integrations-recipe"
              className="max-h-80 overflow-auto rounded-nerv border border-border bg-bg-sunken p-3 font-mono text-2xs"
            >
              {recipe}
            </pre>
            <div>
              <Button size="sm" data-testid="integrations-copy" onClick={copy}>
                {copied ? t('settings.integrations.copied') : t('settings.integrations.copy')}
              </Button>
            </div>
          </div>
        )}
        <p className="text-xs text-text-mute">{t('settings.integrations.ci_failopen')}</p>
      </Card>
    </section>
  );
}
