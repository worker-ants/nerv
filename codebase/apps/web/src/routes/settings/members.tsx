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
import {
  EmptyState,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
  Tr,
} from '../../components/ui/primitives.js';

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
      <PageHeader title="멤버·역할" description="역할 6종이 플랫폼 전체 권한의 정본입니다." />
      {!isAdmin && (
        <p className="mb-3 rounded-nerv border border-border bg-bg-sunken px-3 py-2 text-sm text-text-mute">
          역할 변경은 <code className="font-mono">admin</code> 만 할 수 있습니다 — 아래 목록은 읽기
          전용입니다.
        </p>
      )}
      {rows(members.data).length === 0 ? (
        <EmptyState icon="👥" title="멤버가 없습니다." />
      ) : (
        <Table
          head={
            <>
              <Th>이름</Th>
              <Th>이메일</Th>
              <Th>스코프</Th>
              <Th className="w-32">역할</Th>
            </>
          }
        >
          {rows(members.data).map((m) => (
            <Tr key={String(m['id'])}>
              <Td className="font-medium">{String(m['display_name'])}</Td>
              <Td className="text-text-mute">{String(m['email'])}</Td>
              <Td className="text-text-mute">{String(m['project_slug'] ?? '조직 전체')}</Td>
              <Td>
                <Select
                  value={String(m['role'])}
                  disabled={!isAdmin || changeRole.isPending}
                  title={isAdmin ? undefined : '이 변경은 admin 역할만 가능합니다'}
                  onChange={(e) => changeRole.mutate({ id: String(m['id']), role: e.target.value })}
                  className="w-full"
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </Select>
              </Td>
            </Tr>
          ))}
        </Table>
      )}
    </section>
  );
}
