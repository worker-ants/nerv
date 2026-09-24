// /settings/members — S8 멤버·역할 (ui-wireframes §2.8 · FR-14)
//
// 역할 6종이 여기서 결정되고, 그 값이 플랫폼 전체 권한의 정본이다(membership.role).
// **권한 없는 버튼은 숨기지 않고 비활성 + 사유를 붙인다**(REQ-WEB-003) — 숨기면 사용자는
// 기능이 없다고 생각하고, 그 오해는 관리자에게 문의로 돌아온다.

import { useT } from '../../lib/i18n.js';
import { useApiError } from '../../lib/api-errors.js';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { relativeTime } from '../../lib/format.js';
import {
  rows,
  useMe,
  useMembers,
  useOrgInvitations,
  useOrgTokens,
  useProjects,
} from '../../lib/queries.js';
import { canManageScope } from '../../lib/session.js';
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
  Skeleton,
  Table,
  Td,
  Th,
  Tr,
} from '../../components/ui/primitives.js';
import { ErrorState, failedWithoutData } from '../../components/query-state.js';
import { ReadOnlyNotice, scopeAdmins } from '../../components/read-only-notice.js';
import { ConfirmAction } from '../../components/ui/confirm-action.js';

/**
 * 같은 사람·같은 소속의 멤버십을 **한 줄로 묶는다**. 서버는 부여마다 행을 주므로
 * (0003_multi_role) 그대로 그리면 겸직인 사람이 표에 두 번 나온다.
 * `idByRole` 을 함께 만드는 이유는 역할을 끌 때 **그 역할의 행**을 지워야 하기 때문이다.
 */
interface MemberRow {
  key: string;
  user_id: string;
  display_name: string;
  email: string;
  project_slug: string | null;
  /** 화면은 이름을 그린다 — slug 는 주소의 것이다(REQ-WEB-191) */
  project_name: string | null;
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
      user_id: String(r['user_id'] ?? ''),
      display_name: String(r['display_name']),
      email,
      project_slug: (r['project_slug'] as string | null) ?? null,
      project_name: (r['project_name'] as string | null) ?? null,
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

/**
 * 한 사람의 소속 전부 — **사람마다 한 묶음**(2026-09-24 사람 결정 · REQ-WEB-194).
 *
 * 범위마다 한 줄이던 동안 같은 사람이 표 여기저기 흩어졌고(실측: 지민·관리자가 각 두 줄),
 * 프로젝트 줄은 그 사람이 **조직 전체에서 가진 역할**을 숨겼다 — 프로젝트 줄에 viewer 만 보이면
 * 조직 전체 planner 인 사실이 가려진다(권한은 합집합이다 · 0003_multi_role). 와이어프레임의
 * 사람 × 프로젝트 매트릭스는 프로젝트가 늘면 가로로 넓어져서, 묶음 안에 범위 줄을 두는 모양을
 * 택했다(열이 늘지 않는다).
 */
interface MemberGroup {
  user_id: string;
  email: string;
  display_name: string;
  /** 조직 전체 줄이 먼저, 프로젝트 줄은 이름순 */
  scopes: MemberRow[];
  /** 조직 전체에서 가진 역할 — 프로젝트 줄에 "상속" 으로 보인다 */
  orgRoles: string[];
}

export function groupByPerson(members: MemberRow[]): MemberGroup[] {
  const out = new Map<string, MemberGroup>();
  for (const m of members) {
    const g = out.get(m.email) ?? {
      user_id: m.user_id,
      email: m.email,
      display_name: m.display_name,
      scopes: [],
      orgRoles: [],
    };
    g.scopes.push(m);
    if (m.project_slug === null) g.orgRoles.push(...m.roles);
    out.set(m.email, g);
  }
  for (const g of out.values()) {
    g.scopes.sort((a, b) =>
      a.project_slug === null
        ? -1
        : b.project_slug === null
          ? 1
          : (a.project_name ?? a.project_slug).localeCompare(b.project_name ?? b.project_slug),
    );
  }
  return [...out.values()];
}

/** 이 사람의 멤버십 행 id 전부 — 한 범위 줄의 것만 고르려면 `scopes` 를 좁혀 넘긴다 */
function membershipIds(scopes: readonly MemberRow[]): string[] {
  return scopes.flatMap((m) => Object.values(m.idByRole));
}

/** 살아 있는 토큰 — 폐기·만료된 것은 이미 끊겼다 */
function liveTokensOf(tokens: readonly Record<string, unknown>[], userId: string): string[] {
  return tokens
    .filter(
      (token) =>
        token['owner_id'] === userId &&
        token['revoked_at'] === null &&
        !(
          typeof token['expires_at'] === 'string' &&
          new Date(token['expires_at']).getTime() <= Date.now()
        ),
    )
    .map((token) => String(token['id']));
}

export const Route = createFileRoute('/settings/members')({ component: MembersTab });

const ROLES = ['admin', 'planner', 'designer', 'developer', 'qa', 'viewer'] as const;

function MembersTab(): React.JSX.Element {
  const t = useT();
  const me = useMe();
  const { orgSlug, orgName, projects } = useScope();
  const members = useMembers(orgSlug);
  const memberRows = rows(members.data);
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();
  // **줄마다 판정한다**(2026-09-24 사람 결정 · REQ-API-169). 조직 전체 줄은 조직 admin 만,
  // 프로젝트 줄은 조직 admin 또는 그 프로젝트의 admin 이다 — 서버와 같은 규칙이다. 예전에는
  // 조직 어디서든 admin 이면 모든 줄이 열렸고, 서버도 그렇게 허락했다.
  const orgAdmin = canManageScope(me.data, orgSlug, null);
  const canEdit = (projectSlug: string | null): boolean =>
    canManageScope(me.data, orgSlug, projectSlug);
  // 부를 수 있는 범위 — 조직 admin 이면 조직 전체와 모든 프로젝트, 아니면 자기가 admin 인 프로젝트
  const invitable = projects.filter((p) => canEdit(String(p['slug'])));
  const canInvite = orgAdmin || invitable.length > 0;
  // 부를 수 있는지는 내 멤버십과 프로젝트 목록이 온 뒤에야 안다 — 그 전에 "잠겼다" 고 말하면
  // admin 에게도 잠긴 구역이 먼저 번쩍인다(REQ-WEB-198 과 같은 부류)
  const projectList = useProjects(orgSlug);
  const inviteKnown = me.data !== undefined && projectList.data !== undefined;
  // 내보낼 때 그 사람의 토큰도 함께 끊는다 — 조직 전체 토큰 표는 조직 admin 만 읽는다(REQ-API-172)
  const orgTokens = useOrgTokens(orgSlug, orgAdmin);
  const myId = me.data?.id;
  /** 조직 admin 인 사람 — **한 명이면 그 사람의 admin 은 뗄 수 없다**(REQ-API-174) */
  const orgAdminIds = new Set(
    memberRows
      .filter((r) => r['role'] === 'admin' && (r['project_slug'] ?? null) === null)
      .map((r) => String(r['user_id'] ?? '')),
  );
  const lastOrgAdmin = (userId: string): boolean =>
    orgAdminIds.size === 1 && orgAdminIds.has(userId);

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
      /** **그 줄의 범위** — 헤더가 기억한 프로젝트가 아니다(2026-09-24 · REQ-WEB-191) */
      projectSlug: string | null;
    }) =>
      input.on
        ? apiFetch(`/memberships/${input.id ?? ''}`, { method: 'DELETE' })
        : apiFetch(`/orgs/${orgSlug ?? ''}/members`, {
            method: 'POST',
            // 예전에는 `useScope()` 의 프로젝트를 보냈다 — 조직 전체 줄의 칩을 누르면 **마지막으로
            // 본 프로젝트**에 새 멤버십이 생기고, 켠 칩은 다른 줄에 나타났다
            body: { email: input.userEmail, role: input.role, project: input.projectSlug },
          }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org', orgSlug, 'members'] });
      pushToast({ tone: 'ok', message: t('settings.members.role_changed') });
    },
    onError: onApiError,
  });

  /**
   * **내보내기**(2026-09-24 — UI/UX 검토 · REQ-WEB-201). 떠난 사람을 표에서 내보낼 길이 없었다 —
   * 칩을 하나씩 끄면 마지막 칩이 "마지막 역할은 뗄 수 없습니다" 로 잠겼고, 매뉴얼은 "멤버 자체를
   * 지웁니다" 라고 적었지만 그 단추는 어디에도 없었다. 그 사람의 토큰도 끊는다 — 멤버십이 없으면
   * 토큰의 권한은 이미 0 이지만(권한은 사람의 부분집합이다 · D-08), 살아 있는 토큰이 표에 남으면
   * 끊긴 것인지 아무도 모른다.
   *
   * 한 번에 지우는 서버 경로는 없다 — 있는 두 문(EP-MBR-04 · EP-TOK-03)을 차례로 부른다. 중간에
   * 실패하면 거기서 멈추고 표를 다시 읽어, 무엇이 남았는지를 표가 말한다.
   */
  const offboard = useMutation({
    mutationFn: async (input: { membershipIds: string[]; tokenIds: string[] }) => {
      for (const id of input.tokenIds) {
        await apiFetch(`/me/tokens/${id}`, { method: 'DELETE' });
      }
      for (const id of input.membershipIds) {
        await apiFetch(`/memberships/${id}`, { method: 'DELETE' });
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['org', orgSlug, 'members'] });
      void queryClient.invalidateQueries({ queryKey: ['org', orgSlug, 'tokens'] });
    },
    onSuccess: () => pushToast({ tone: 'ok', message: t('settings.members.offboard_done') }),
    onError: onApiError,
  });

  return (
    <section>
      {/* 이 표가 **어느 조직의 것인지** 제목이 말한다 — 헤더의 조직 칸만 보고는 알 수 없다 */}
      <PageHeader title={t('settings.members.title_org', { org: orgName ?? '' })} />
      {!orgAdmin && (
        <ReadOnlyNotice
          className="mb-3"
          admins={members.data === undefined ? undefined : scopeAdmins(memberRows, null)}
        >
          {t('settings.members.scope_rule')}
        </ReadOnlyNotice>
      )}
      {/* **부르는 자리와 관리하는 자리가 같아야 한다.** 멤버 표는 이미 있는 사람만 다루고,
          새 사람을 넣는 길은 화면에 아예 없었다 — 서버의 EP-MBR-02 는 기존 사용자만
          찾으므로 신규 사용자는 어느 쪽으로도 들어올 수 없었다(사람 지시 2026-08-27) */}
      <InviteSection
        orgSlug={orgSlug}
        orgName={orgName}
        orgWide={orgAdmin}
        projects={invitable}
        canInvite={canInvite}
        known={inviteKnown}
      />

      {/* **"멤버가 없습니다" 는 받아 온 뒤에만 말한다**(REQ-WEB-198) — 로딩 검사가 없던 동안
          이 탭에 들어갈 때마다 그 문장이 먼저 번쩍였고, 실패하면 그대로 남았다 */}
      {members.data === undefined ? (
        failedWithoutData(members) ? (
          <ErrorState error={members.error} onRetry={() => void members.refetch()} />
        ) : (
          <Skeleton rows={4} />
        )
      ) : memberRows.length === 0 ? (
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
              <Th className="w-32" />
            </>
          }
        >
          {groupByPerson(groupByMember(memberRows)).flatMap((person) =>
            person.scopes.map((m, index) => (
              <Tr
                key={m.key}
                // 묶음의 경계를 선으로 — 한 사람의 줄들이 한눈에 한 덩어리로 읽힌다
                className={index === 0 ? 'border-t-2 border-t-border-strong' : ''}
              >
                {/* 이름·이메일은 묶음의 첫 줄에만 — 같은 사람을 줄마다 다시 적으면 다른 사람처럼 읽힌다 */}
                <Td className="font-medium">
                  {index === 0 && <span data-testid="member-person">{person.display_name}</span>}
                </Td>
                <Td className="text-text-mute">{index === 0 ? person.email : ''}</Td>
                <Td className="text-text-mute">
                  <span data-testid="member-scope">
                    <ScopeText slug={m.project_slug} name={m.project_name} />
                  </span>
                </Td>
                <Td>
                  {/* **체크박스다.** 하나를 고르는 자리가 아니다 — 겸직이 흔한 형태라는 것이
                      clemvion 실측(복합 라벨 20건)이고, 데이터도 이제 그것을 담는다.
                      켜기는 멤버십 행 추가, 끄기는 그 행 삭제다 — 부여마다 행이라 이력이 남는다. */}
                  <div className="flex flex-wrap gap-1">
                    {ROLES.map((role) => {
                      const on = m.roles.includes(role);
                      // 조직 전체에서 이미 가진 역할 — 이 프로젝트 줄에 켜지 않아도 **이미 있다**.
                      // 꺼진 칩으로 그리면 그 권한이 없는 것처럼 읽힌다(REQ-WEB-194)
                      const inherited =
                        !on && m.project_slug !== null && person.orgRoles.includes(role);
                      const last = on && m.roles.length === 1;
                      // 조직의 마지막 admin 은 뗄 수 없다 — 서버도 거절한다(REQ-API-174)
                      const lastAdmin =
                        on &&
                        role === 'admin' &&
                        m.project_slug === null &&
                        lastOrgAdmin(person.user_id);
                      const editable = canEdit(m.project_slug);
                      const locked = inherited || !editable || last || lastAdmin;
                      const toggle = (): void =>
                        toggleRole.mutate({
                          userEmail: m.email,
                          role,
                          on,
                          id: m.idByRole[role],
                          projectSlug: m.project_slug,
                        });
                      const chip = (props: {
                        onClick: () => void;
                        ref?: React.Ref<HTMLButtonElement>;
                      }): React.JSX.Element => (
                        <button
                          key={role}
                          ref={props.ref}
                          type="button"
                          data-testid={`role-${role}`}
                          data-inherited={inherited || undefined}
                          aria-pressed={on}
                          disabled={locked || toggleRole.isPending}
                          // **사유는 잠긴 칩에만 단다**(REQ-WEB-003). 조건 없이 달던 동안 admin 이
                          // 누를 수 있는 칩 위에도 "admin 만 가능합니다" 가 떴다
                          title={
                            !locked
                              ? undefined
                              : t(
                                  inherited
                                    ? 'settings.members.role_inherited'
                                    : lastAdmin
                                      ? 'settings.members.last_org_admin'
                                      : last
                                        ? 'settings.members.last_role'
                                        : m.project_slug === null
                                          ? 'settings.members.role_org_admin_only'
                                          : 'settings.members.role_admin_only',
                                )
                          }
                          onClick={props.onClick}
                          className={cn(
                            'rounded-nerv-sm border px-1.5 py-0.5 text-2xs transition-colors',
                            on
                              ? 'border-border-strong bg-bg-elev font-medium text-text'
                              : inherited
                                ? 'cursor-default border-dashed border-border-strong text-text-mute'
                                : 'border-border text-text-faint hover:text-text',
                            !inherited && (!editable || last || lastAdmin)
                              ? 'cursor-not-allowed opacity-60'
                              : '',
                          )}
                        >
                          {on ? '✓ ' : inherited ? '↳ ' : ''}
                          {role}
                        </button>
                      );
                      // **내 admin 을 끄는 것은 한 번 더 묻는다**(REQ-WEB-200) — 끄는 즉시 이
                      // 화면의 편집이 잠기고, 되돌리려면 다른 admin 에게 부탁해야 한다
                      if (on && role === 'admin' && person.user_id === myId && !locked) {
                        return (
                          <ConfirmAction
                            key={role}
                            testIdBase="self-admin"
                            message={t('settings.members.self_admin_confirm')}
                            detail={t('settings.members.self_admin_detail')}
                            confirmLabel={t('settings.members.self_admin_off')}
                            pending={toggleRole.isPending}
                            onConfirm={toggle}
                            trigger={({ open, ref }) => chip({ onClick: open, ref })}
                          />
                        );
                      }
                      return chip({ onClick: toggle });
                    })}
                  </div>
                </Td>
                <Td className="text-right">
                  <MemberExit
                    person={person}
                    row={m}
                    first={index === 0}
                    orgAdmin={orgAdmin}
                    canEditRow={canEdit(m.project_slug)}
                    isSelf={person.user_id === myId}
                    lastAdmin={lastOrgAdmin(person.user_id)}
                    tokens={rows(orgTokens.data)}
                    pending={offboard.isPending}
                    onConfirm={(input) => offboard.mutate(input)}
                  />
                </Td>
              </Tr>
            )),
          )}
        </Table>
      )}
    </section>
  );
}

/**
 * 한 줄의 나가는 문 — 조직 admin 에게는 묶음의 첫 줄에 **[내보내기…]**(모든 범위 + 토큰),
 * 프로젝트 admin 에게는 자기 프로젝트 줄에 **[이 프로젝트에서 빼기]**(그 줄의 역할 전부).
 * 자기 자신과 조직의 마지막 admin 은 비활성 + 사유다(REQ-WEB-003).
 */
function MemberExit({
  person,
  row,
  first,
  orgAdmin,
  canEditRow,
  isSelf,
  lastAdmin,
  tokens,
  pending,
  onConfirm,
}: {
  person: MemberGroup;
  row: MemberRow;
  first: boolean;
  orgAdmin: boolean;
  canEditRow: boolean;
  isSelf: boolean;
  lastAdmin: boolean;
  tokens: readonly Record<string, unknown>[];
  pending: boolean;
  onConfirm: (input: { membershipIds: string[]; tokenIds: string[] }) => void;
}): React.JSX.Element | null {
  const t = useT();
  if (orgAdmin) {
    if (!first) return null;
    const ids = membershipIds(person.scopes);
    const tokenIds = liveTokensOf(tokens, person.user_id);
    return (
      <ConfirmAction
        label={t('settings.members.offboard')}
        testId="member-offboard"
        disabled={isSelf || lastAdmin}
        title={t(isSelf ? 'settings.members.offboard_self' : 'settings.members.last_org_admin')}
        message={t('settings.members.offboard_confirm', { name: person.display_name })}
        detail={t('settings.members.offboard_detail', {
          memberships: ids.length,
          tokens: tokenIds.length,
        })}
        confirmLabel={t('settings.members.offboard_run')}
        pending={pending}
        onConfirm={() => onConfirm({ membershipIds: ids, tokenIds })}
      />
    );
  }
  if (row.project_slug === null || !canEditRow) return null;
  const ids = membershipIds([row]);
  return (
    <ConfirmAction
      label={t('settings.members.remove_from_project')}
      testId="member-remove-project"
      disabled={isSelf}
      title={t('settings.members.offboard_self')}
      message={t('settings.members.remove_from_project_confirm', {
        name: person.display_name,
        project: row.project_name ?? row.project_slug,
      })}
      detail={t('settings.members.remove_from_project_detail', { roles: ids.length })}
      confirmLabel={t('settings.members.remove_from_project')}
      pending={pending}
      onConfirm={() => onConfirm({ membershipIds: ids, tokenIds: [] })}
    />
  );
}

/**
 * 초대 구역 — 이메일·역할·소속으로 링크를 만들고, 보낸 초대를 회수한다(EP-INV-01~03).
 *
 * **링크는 만들 때 한 번만 보인다.** 서버는 해시만 갖고 있어 다시 보여 줄 수 없다(PAT 와
 * 같은 규율 · D-08) — 그래서 그 사실을 화면이 먼저 말하고, 복사 버튼을 붙인다.
 *
 * 메일 발송은 Phase 2 다. MVP 에서는 **admin 이 링크를 직접 전달한다** — 없는 기능을
 * 있는 것처럼 그리지 않는다.
 */
function InviteSection({
  orgSlug,
  orgName,
  orgWide,
  projects,
  canInvite,
  known,
}: {
  orgSlug: string | null;
  orgName: string | null;
  /** 조직 전체로 부를 수 있는가 — 조직 admin 만(REQ-API-169) */
  orgWide: boolean;
  /** 부를 수 있는 프로젝트 — 조직 admin 이면 전부, 아니면 자기가 admin 인 것 */
  projects: Record<string, unknown>[];
  canInvite: boolean;
  /** 부를 수 있는지 판정할 재료가 왔는가 */
  known: boolean;
}): React.JSX.Element | null {
  const t = useT();
  const onApiError = useApiError();
  const queryClient = useQueryClient();
  const invitations = useOrgInvitations(canInvite ? orgSlug : null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('developer');
  /**
   * 적용 범위 — `''` 이면 조직 전체, 아니면 프로젝트 slug.
   *
   * **그 조직의 프로젝트 전부에서 고른다**(2026-09-24 · REQ-WEB-191). 예전에는 "조직 전체" 와
   * 헤더가 기억한 프로젝트 **하나**뿐이라, 다른 프로젝트로 부르려면 헤더를 바꿔야 했고 그 사실을
   * 어디서도 말하지 않았다(실측: sudoku 가 목록에 없었다).
   */
  const [scope, setScope] = useState<string | null>(null);
  const firstProject = typeof projects[0]?.['slug'] === 'string' ? String(projects[0]['slug']) : '';
  const chosen = scope ?? (orgWide ? '' : firstProject);
  const scopeName = (slug: string): string =>
    slug === ''
      ? t('invite.scope_org')
      : String(projects.find((p) => p['slug'] === slug)?.['name'] ?? slug);
  /** 방금 만든 초대의 요약 — 링크만 보이면 누구를 어디로 불렀는지 다시 물어야 한다 */
  const [summary, setSummary] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  /** 서버가 메일을 줄 세웠는가 — 메일이 꺼진 배치에서는 false 이고, 그때는 링크가 유일한 길이다 */
  const [mailed, setMailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['org', orgSlug, 'invitations'] });
  };

  const send = useMutation({
    mutationFn: () =>
      apiFetch<{ token: string; queued: boolean }>(`/orgs/${orgSlug ?? ''}/invitations`, {
        method: 'POST',
        body: { email, role, project: chosen === '' ? null : chosen },
      }),
    onSuccess: (result) => {
      setSummary(
        t('invite.created_summary', {
          email,
          org: orgName ?? '',
          scope: scopeName(chosen),
          role,
        }),
      );
      setLink(`${window.location.origin}/invite/${result.token}`);
      setMailed(result.queued);
      setCopied(false);
      setEmail('');
      refresh();
    },
    onError: onApiError,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`/invitations/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: onApiError,
  });

  // **숨기지 않는다**(REQ-WEB-003 · 2026-09-24). 예전에는 부를 수 없는 사람에게 이 구역이 통째로
  // 사라져, 초대라는 기능이 있는지조차 알 수 없었다 — 단추는 비활성 + 사유로 선다
  if (!canInvite) {
    if (!known) return null;
    return (
      <section className="mb-6">
        <SectionTitle
          action={
            <Button size="sm" data-testid="invite-new" disabled title={t('invite.locked')}>
              {t('invite.new')}
            </Button>
          }
        >
          {t('invite.title')}
        </SectionTitle>
        <p className="text-sm text-text-faint">{t('invite.locked')}</p>
      </section>
    );
  }

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
          {/* **어느 조직으로 부르는지** 폼이 말한다 — 조직은 헤더에서 고르고 여기서는 보이기만 한다 */}
          <Field label={t('common.org')}>
            <span data-testid="invite-org" className="flex h-9 items-center text-sm text-text-mute">
              {orgName}
            </span>
          </Field>
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
          <Field
            label={t('invite.scope')}
            hint={chosen === '' ? t('invite.scope_org_hint') : undefined}
          >
            <Select
              data-testid="invite-scope"
              value={chosen}
              onChange={(e) => setScope(e.target.value)}
              className="h-9"
            >
              {orgWide && <option value="">{t('invite.scope_org_all')}</option>}
              {projects.map((p) => (
                <option key={String(p['slug'])} value={String(p['slug'])}>
                  {t('invite.scope_project', { name: String(p['name']) })}
                </option>
              ))}
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
          {/* **보냈다와 전달하세요는 다른 말이다.** 둘을 같은 문구로 덮으면 한쪽은 반드시
              거짓이고, 그때 사람은 오지 않는 메일을 기다린다(2026-09-22). */}
          {summary !== null && (
            <p data-testid="invite-summary" className="text-sm font-medium text-text">
              {summary}
            </p>
          )}
          <p className="text-xs text-status-action">
            {mailed ? t('invite.mailed') : t('invite.link_once')}
          </p>
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
        // **머리 있는 표다**(REQ-WEB-191) — 머리 없는 줄에서는 흐린 slug 가 무엇의 값인지 알 수 없었다
        <Table
          head={
            <>
              <Th>{t('settings.members.email')}</Th>
              <Th className="w-24">{t('settings.members.role')}</Th>
              <Th className="w-40">{t('invite.scope')}</Th>
              <Th className="w-20">{t('invite.col.state')}</Th>
              <Th className="w-28">{t('invite.col.sent')}</Th>
              <Th className="w-16" />
            </>
          }
        >
          {rows(invitations.data).map((row) => (
            <Tr key={String(row['id'])}>
              <Td className="truncate">{String(row['email'])}</Td>
              <Td>
                <Mono>{String(row['role'])}</Mono>
              </Td>
              <Td className="text-text-mute">
                <span data-testid="invite-row-scope">
                  <ScopeText
                    slug={(row['project_slug'] as string | null) ?? null}
                    name={(row['project_name'] as string | null) ?? null}
                  />
                </span>
              </Td>
              <Td className="text-xs text-text-mute">
                {t(`invite.${String(row['state'])}` as never)}
              </Td>
              {/* 안 보낸 것과 보냈는데 안 온 것은 다른 문제다 — 화면이 가르지 못하면
                  admin 이 같은 초대를 세 번 만든다 */}
              <Td className="text-xs text-text-faint">
                {row['last_sent_at'] === null || row['last_sent_at'] === undefined
                  ? t('invite.unsent')
                  : t('invite.sent_at', { when: relativeTime(t, String(row['last_sent_at'])) })}
              </Td>
              <Td>
                {row['state'] === 'pending' && (
                  <ConfirmAction
                    label={t('invite.revoke')}
                    testId="invite-revoke"
                    message={t('invite.revoke_confirm', { email: String(row['email']) })}
                    confirmLabel={t('invite.revoke')}
                    pending={revoke.isPending}
                    onConfirm={() => revoke.mutate(String(row['id']))}
                  />
                )}
              </Td>
            </Tr>
          ))}
        </Table>
      )}
    </section>
  );
}

/**
 * 적용 범위 한 칸 — "조직 전체" 또는 프로젝트 **이름**(slug 는 흐린 보조). 멤버 표와 초대 표가
 * 같은 모양을 쓴다(REQ-WEB-191).
 */
function ScopeText({
  slug,
  name,
}: {
  slug: string | null;
  name: string | null;
}): React.JSX.Element {
  const t = useT();
  if (slug === null) return <span>{t('settings.members.org_wide')}</span>;
  return (
    <span>
      {name ?? slug}
      {name !== null && name !== slug && (
        <span className="ml-1 font-mono text-2xs text-text-faint">{slug}</span>
      )}
    </span>
  );
}
