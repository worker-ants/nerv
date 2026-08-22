// /settings/members — S8 멤버·역할 (ui-wireframes §2.8 · FR-14)
//
// 역할 6종이 여기서 결정되고, 그 값이 플랫폼 전체 권한의 정본이다(membership.role).
// **권한 없는 버튼은 숨기지 않고 비활성 + 사유를 붙인다**(REQ-WEB-003) — 숨기면 사용자는
// 기능이 없다고 생각하고, 그 오해는 관리자에게 문의로 돌아온다.

import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api.js';
import { rows, useMe, useMembers } from '../../lib/queries.js';
import { primaryMembership } from '../../lib/session.js';
import { useRealtime } from '../../lib/realtime.js';

export const Route = createFileRoute('/settings/members')({ component: MembersTab });

const ROLES = ['admin', 'planner', 'designer', 'developer', 'qa', 'viewer'] as const;

function MembersTab(): React.JSX.Element {
  const me = useMe();
  const membership = me.data === undefined ? null : primaryMembership(me.data);
  const orgSlug = membership?.org_slug ?? null;
  const projectSlug = membership?.project_slug ?? null;
  const members = useMembers(orgSlug);
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const isAdmin = membership?.role === 'admin';

  const changeRole = useMutation({
    mutationFn: (input: { id: string; role: string }) =>
      apiFetch(`/projects/${projectSlug ?? ''}/memberships/${input.id}`, {
        method: 'PATCH',
        body: { role: input.role },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org', orgSlug, 'members'] });
      pushToast({ tone: 'ok', message: '역할을 바꿨습니다.' });
    },
    onError: (error: Error) => pushToast({ tone: 'warn', message: error.message }),
  });

  return (
    <section>
      <h1 className="mb-3 text-lg font-semibold">멤버·역할</h1>
      {!isAdmin && (
        <p className="mb-2 text-sm text-text-mute">
          역할 변경은 <code>admin</code> 만 할 수 있습니다 — 아래 목록은 읽기 전용입니다.
        </p>
      )}
      <table className="w-full text-sm">
        <thead className="text-left text-text-mute">
          <tr>
            <th className="py-1">이름</th>
            <th>이메일</th>
            <th>스코프</th>
            <th>역할</th>
          </tr>
        </thead>
        <tbody>
          {rows(members.data).map((m) => (
            <tr key={String(m['id'])} className="border-t border-border">
              <td className="py-1">{String(m['display_name'])}</td>
              <td className="text-text-mute">{String(m['email'])}</td>
              <td className="text-text-mute">{String(m['project_slug'] ?? '조직 전체')}</td>
              <td>
                <select
                  value={String(m['role'])}
                  disabled={!isAdmin || changeRole.isPending}
                  title={isAdmin ? undefined : '이 변경은 admin 역할만 가능합니다'}
                  onChange={(e) => changeRole.mutate({ id: String(m['id']), role: e.target.value })}
                  className="rounded border border-border bg-bg px-1 py-0.5 disabled:opacity-60"
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows(members.data).length === 0 && (
        <p className="mt-2 text-sm text-text-mute">멤버가 없습니다.</p>
      )}
    </section>
  );
}
