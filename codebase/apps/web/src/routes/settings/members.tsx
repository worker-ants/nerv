// /settings/members — S8 멤버·역할 (ui-wireframes §2.8 · FR-14)
//
// 역할 6종이 여기서 결정되고, 그 값이 플랫폼 전체 권한의 정본이다(membership.role).
// **권한 없는 버튼은 숨기지 않고 비활성 + 사유를 붙인다**(REQ-WEB-003) — 숨기면 사용자는
// 기능이 없다고 생각하고, 그 오해는 관리자에게 문의로 돌아온다.

import { useT } from '../../lib/i18n.js';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { rows, useMe, useMembers, useOrgInvitations } from '../../lib/queries.js';
import { rolesInOrg } from '../../lib/session.js';
import { useScope } from '../../lib/scope.js';
import { useRealtime } from '../../lib/realtime.js';
import {
  Button,
  EmptyState,
  Field,
  Input,
  Mono,
  PageHeader,
  SectionTitle,
  Select,
  Table,
  Td,
  Th,
  Tr,
} from '../../components/ui/primitives.js';

/**
 * 같은 사람·같은 스코프의 멤버십을 **한 줄로 묶는다**. 서버는 부여마다 행을 주므로
 * (0003_multi_role) 그대로 그리면 겸직인 사람이 표에 두 번 나온다.
 * `idByRole` 을 함께 만드는 이유는 역할을 끌 때 **그 역할의 행**을 지워야 하기 때문이다.
 */
interface MemberRow {
  key: string;
  display_name: string;
  email: string;
  project_slug: string | null;
  roles: string[];
  idByRole: Record<string, string>;
}

function groupByMember(raw: Record<string, unknown>[]): MemberRow[] {
  const out = new Map<string, MemberRow>();
  for (const r of raw) {
    const email = String(r['email']);
    const scope = String(r['project_slug'] ?? '');
    const key = `${email}@${scope}`;
    const row = out.get(key) ?? {
      key,
      display_name: String(r['display_name']),
      email,
      project_slug: (r['project_slug'] as string | null) ?? null,
      roles: [],
      idByRole: {},
    };
    const role = String(r['role']);
    if (!row.roles.includes(role)) row.roles.push(role);
    row.idByRole[role] = String(r['id']);
    out.set(key, row);
  }
  return [...out.values()];
}

export const Route = createFileRoute('/settings/members')({ component: MembersTab });

const ROLES = ['admin', 'planner', 'designer', 'developer', 'qa', 'viewer'] as const;

function MembersTab(): React.JSX.Element {
  const t = useT();
  const me = useMe();
  const { orgSlug, projectSlug } = useScope();
  const members = useMembers(orgSlug);
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  // **하나를 고르지 않는다.** 겸직이면 planner+developer 중 하나가 사라진다(0003_multi_role).
  // 조직 권한은 그 조직의 멤버십 **전부**를 합쳐 본다 — 한 행만 보면 조직 admin 이면서
  // 프로젝트에서 planner 인 사람이 admin 이 아니게 된다.
  const isAdmin = rolesInOrg(me.data, orgSlug).includes('admin');

  /**
   * 역할 하나를 켜고 끈다. **부여마다 행**이므로 켜기는 추가, 끄기는 삭제다 —
   * 한 행의 값을 바꾸던 예전 방식(PATCH)은 겸직에서 표현할 수가 없다.
   */
  const toggleRole = useMutation({
    mutationFn: (input: {
      userEmail: string;
      role: string;
      on: boolean;
      id: string | undefined;
    }) =>
      input.on
        ? apiFetch(`/memberships/${input.id ?? ''}`, { method: 'DELETE' })
        : apiFetch(`/orgs/${orgSlug ?? ''}/members`, {
            method: 'POST',
            body: { email: input.userEmail, role: input.role, project: projectSlug },
          }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org', orgSlug, 'members'] });
      pushToast({ tone: 'ok', message: t('settings.members.role_changed') });
    },
    onError: (error: Error) => pushToast({ tone: 'warn', message: error.message }),
  });

  return (
    <section>
      <PageHeader title={t('settings.tab.members')} />
      {!isAdmin && (
        <p className="mb-3 rounded-nerv border border-border bg-bg-sunken px-3 py-2 text-sm text-text-mute">
          {t('settings.members.admin_only_pre')} <code className="font-mono">admin</code>{' '}
          {t('settings.members.admin_only_post')}
        </p>
      )}
      {/* **부르는 자리와 관리하는 자리가 같아야 한다.** 멤버 표는 이미 있는 사람만 다루고,
          새 사람을 넣는 길은 화면에 아예 없었다 — 서버의 EP-MBR-02 는 기존 사용자만
          찾으므로 신규 사용자는 어느 쪽으로도 들어올 수 없었다(사람 지시 2026-08-27) */}
      <InviteSection orgSlug={orgSlug} projectSlug={projectSlug} canInvite={isAdmin} />

      {rows(members.data).length === 0 ? (
        <EmptyState icon="👥" title={t('settings.members.empty')} />
      ) : (
        <Table
          head={
            <>
              {/* **역할 칸이 가장 넓어야 한다**(정정 2026-08-23). 겸직이 되면서 칸 하나에
                  칩 여섯이 들어가는데 `w-32` 로 두어 네 줄로 접혔고 행 높이가 117px 가
                  됐다 — 표가 아니라 문단처럼 보인다. 이메일은 남는 폭을 다 먹고 있었다:
                  넓어서 좋을 것이 없는 열이다. */}
              <Th className="w-28">{t('settings.members.name')}</Th>
              <Th>{t('settings.members.email')}</Th>
              <Th className="w-32">{t('settings.members.scope')}</Th>
              <Th className="w-[23rem]">{t('settings.members.role')}</Th>
            </>
          }
        >
          {groupByMember(rows(members.data)).map((m) => (
            <Tr key={m.key}>
              <Td className="font-medium">{m.display_name}</Td>
              <Td className="text-text-mute">{m.email}</Td>
              <Td className="text-text-mute">{m.project_slug ?? t('settings.members.org_wide')}</Td>
              <Td>
                {/* **체크박스다.** 하나를 고르는 자리가 아니다 — 겸직이 흔한 형태라는 것이
                    clemvion 실측(복합 라벨 20건)이고, 데이터도 이제 그것을 담는다.
                    켜기는 멤버십 행 추가, 끄기는 그 행 삭제다 — 부여마다 행이라 이력이 남는다. */}
                <div className="flex flex-wrap gap-1">
                  {ROLES.map((role) => {
                    const on = m.roles.includes(role);
                    const last = on && m.roles.length === 1;
                    return (
                      <button
                        key={role}
                        type="button"
                        data-testid={`role-${role}`}
                        aria-pressed={on}
                        disabled={!isAdmin || last || toggleRole.isPending}
                        title={t(
                          last ? 'settings.members.last_role' : 'settings.members.role_admin_only',
                        )}
                        onClick={() =>
                          toggleRole.mutate({ userEmail: m.email, role, on, id: m.idByRole[role] })
                        }
                        className={cn(
                          'rounded-nerv-sm border px-1.5 py-0.5 text-2xs transition-colors',
                          on
                            ? 'border-border-strong bg-bg-elev font-medium text-text'
                            : 'border-border text-text-faint hover:text-text',
                          !isAdmin || last ? 'cursor-not-allowed opacity-60' : '',
                        )}
                      >
                        {on ? '✓ ' : ''}
                        {role}
                      </button>
                    );
                  })}
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
      )}
    </section>
  );
}

/**
 * 초대 구역 — 이메일·역할·스코프로 링크를 만들고, 보낸 초대를 회수한다(EP-INV-01~03).
 *
 * **링크는 만들 때 한 번만 보인다.** 서버는 해시만 갖고 있어 다시 보여 줄 수 없다(PAT 와
 * 같은 규율 · D-08) — 그래서 그 사실을 화면이 먼저 말하고, 복사 버튼을 붙인다.
 *
 * 메일 발송은 Phase 2 다. MVP 에서는 **admin 이 링크를 직접 전달한다** — 없는 기능을
 * 있는 것처럼 그리지 않는다.
 */
function InviteSection({
  orgSlug,
  projectSlug,
  canInvite,
}: {
  orgSlug: string | null;
  projectSlug: string | null;
  canInvite: boolean;
}): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const invitations = useOrgInvitations(canInvite ? orgSlug : null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('developer');
  const [scope, setScope] = useState<'org' | 'project'>('org');
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['org', orgSlug, 'invitations'] });
  };

  const send = useMutation({
    mutationFn: () =>
      apiFetch<{ token: string }>(`/orgs/${orgSlug ?? ''}/invitations`, {
        method: 'POST',
        body: { email, role, project: scope === 'project' ? projectSlug : null },
      }),
    onSuccess: (result) => {
      setLink(`${window.location.origin}/invite/${result.token}`);
      setCopied(false);
      setEmail('');
      refresh();
    },
    onError: (error: Error) => pushToast({ tone: 'warn', message: error.message }),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`/invitations/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: (error: Error) => pushToast({ tone: 'warn', message: error.message }),
  });

  if (!canInvite) return <></>;

  return (
    <section className="mb-6">
      <SectionTitle
        action={
          <Button size="sm" data-testid="invite-new" onClick={() => setOpen(!open)}>
            {open ? t('common.cancel') : t('invite.new')}
          </Button>
        }
      >
        {t('invite.title')}
      </SectionTitle>

      {open && (
        <form
          className="mb-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate();
          }}
        >
          <div className="min-w-56 flex-1">
            <Field label={t('invite.email')}>
              <Input
                type="email"
                required
                data-testid="invite-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-9"
              />
            </Field>
          </div>
          <Field label={t('invite.role')}>
            <Select value={role} onChange={(e) => setRole(e.target.value)} className="h-9">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('invite.scope')}>
            <Select
              value={scope}
              onChange={(e) => setScope(e.target.value === 'project' ? 'project' : 'org')}
              className="h-9"
            >
              <option value="org">{t('invite.scope_org')}</option>
              {projectSlug !== null && <option value="project">{projectSlug}</option>}
            </Select>
          </Field>
          <Button type="submit" variant="primary" disabled={send.isPending} className="h-9">
            {send.isPending ? t('invite.sending') : t('invite.send')}
          </Button>
        </form>
      )}

      {link !== null && (
        <div
          data-testid="invite-link"
          className="mb-3 rounded-nerv border border-border bg-status-action-soft px-3 py-2"
        >
          <p className="text-xs text-status-action">{t('invite.link_once')}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{link}</code>
            <Button
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(link).then(() => setCopied(true));
              }}
            >
              {copied ? t('invite.copied') : t('invite.copy')}
            </Button>
          </div>
        </div>
      )}

      {rows(invitations.data).length === 0 ? (
        <p className="text-sm text-text-faint">{t('invite.none')}</p>
      ) : (
        <ul className="flex flex-col">
          {rows(invitations.data).map((row) => (
            <li
              key={String(row['id'])}
              className="flex items-center gap-3 border-b border-border py-2 text-sm last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate">{String(row['email'])}</span>
              <Mono>{String(row['role'])}</Mono>
              <span className="w-28 text-xs text-text-faint">
                {row['project_slug'] === null ? t('invite.scope_org') : String(row['project_slug'])}
              </span>
              <span className="w-16 text-xs text-text-mute">
                {t(`invite.${String(row['state'])}` as never)}
              </span>
              {row['state'] === 'pending' && (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(String(row['id']))}
                >
                  {t('invite.revoke')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
