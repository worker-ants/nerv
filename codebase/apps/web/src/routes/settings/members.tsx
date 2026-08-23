// /settings/members — S8 멤버·역할 (ui-wireframes §2.8 · FR-14)
//
// 역할 6종이 여기서 결정되고, 그 값이 플랫폼 전체 권한의 정본이다(membership.role).
// **권한 없는 버튼은 숨기지 않고 비활성 + 사유를 붙인다**(REQ-WEB-003) — 숨기면 사용자는
// 기능이 없다고 생각하고, 그 오해는 관리자에게 문의로 돌아온다.

import { useT } from '../../lib/i18n.js';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { rows, useMe, useMembers } from '../../lib/queries.js';
import { primaryMembership } from '../../lib/session.js';
import { useRealtime } from '../../lib/realtime.js';
import {
  EmptyState,
  PageHeader,
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
  const membership = me.data === undefined ? null : primaryMembership(me.data);
  const orgSlug = membership?.org_slug ?? null;
  const projectSlug = membership?.project_slug ?? null;
  const members = useMembers(orgSlug);
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  // **하나를 고르지 않는다.** 겸직이면 planner+developer 중 하나가 사라진다(0003_multi_role)
  const isAdmin = (membership?.roles ?? []).includes('admin');

  /**
   * 역할 하나를 켜고 끈다. **부여마다 행**이므로 켜기는 추가, 끄기는 삭제다 —
   * 한 행의 값을 바꾸던 예전 방식(PATCH)은 겸직에서 표현할 수가 없다.
   */
  const toggleRole = useMutation({
    mutationFn: (input: { userEmail: string; role: string; on: boolean; id: string | undefined }) =>
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
      <PageHeader title={t('settings.tab.members')} description={t('settings.members.lead')} />
      {!isAdmin && (
        <p className="mb-3 rounded-nerv border border-border bg-bg-sunken px-3 py-2 text-sm text-text-mute">
          {t('settings.members.admin_only_pre')} <code className="font-mono">admin</code>{' '}
          {t('settings.members.admin_only_post')}
        </p>
      )}
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
              <Td className="text-text-mute">
                {m.project_slug ?? t('settings.members.org_wide')}
              </Td>
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
