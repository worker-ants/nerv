// /settings/org-tokens — S8 조직 전체 토큰 (EP-TOK-04 · REQ-WEB-168 · REQ-WEB-227)
//
// **조직 묶음의 자기 화면이다**(2026-09-25 — 사람 결정 D1 · UI/UX 검토 SET-06). 이 표는 토큰 탭 아래에 있었다 —
// 그 탭은 **내** 토큰(모든 조직)인데 조직 하나의 것을 한 화면에 섞어, 개인·조직 두 범위가 탭 경계와 어긋났다.
// 조직 admin 만 본다: 아니면 목록을 **부르지도 않고**(REQ-WEB-168) 누가 볼 수 있는지 말한다.

import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useT } from '../../lib/i18n.js';
import { rows, useMe, useMembers, useOrgTokens } from '../../lib/queries.js';
import { canManageScope } from '../../lib/session.js';
import { useScope } from '../../lib/scope.js';
import {
  EmptyState,
  PageHeader,
  Select,
  Skeleton,
  Table,
  Td,
  Th,
  Tr,
} from '../../components/ui/primitives.js';
import { ErrorState, failedWithoutData } from '../../components/query-state.js';
import { ReadOnlyNotice, scopeAdmins } from '../../components/read-only-notice.js';
import {
  day,
  isExpired,
  ProjectCell,
  RevokeButton,
  useRevoke,
} from '../../features/settings/token-parts.js';

export const Route = createFileRoute('/settings/org-tokens')({ component: OrgTokensTab });

function OrgTokensTab(): React.JSX.Element {
  const t = useT();
  const me = useMe();
  const { orgSlug, orgName } = useScope();
  const isAdmin = canManageScope(me.data, orgSlug, null);
  const orgTokens = useOrgTokens(orgSlug, isAdmin);
  const members = useMembers(orgSlug);
  const revoke = useRevoke(orgSlug);
  return (
    <section className="flex flex-col gap-4">
      <PageHeader title={t('settings.org_tokens.title', { org: orgName ?? orgSlug ?? '' })} />
      {!isAdmin ? (
        <ReadOnlyNotice
          admins={me.data === undefined ? undefined : scopeAdmins(rows(members.data), null)}
        >
          {t('settings.org_tokens.admin_only')}
        </ReadOnlyNotice>
      ) : failedWithoutData(orgTokens) ? (
        <ErrorState error={orgTokens.error} onRetry={() => void orgTokens.refetch()} />
      ) : orgTokens.data === undefined ? (
        <Skeleton rows={4} />
      ) : (
        <OrgTokens tokens={rows(orgTokens.data)} revoke={revoke} />
      )}
    </section>
  );
}

/**
 * 조직 전체 토큰 — EP-TOK-04 (admin).
 *
 * **서버는 2026-08 부터 이것을 줄 수 있었고 부르는 화면이 없었다.** 내 목록으로는
 * "누가 어느 프로젝트에 무슨 토큰을 갖고 있나" 에 답할 수 없는데, 그것이 관리의 본체다.
 *
 * **거르기는 화면에서 한다.** 전표가 이 엔드포인트의 질의 인자를 **없음**으로 못 박았고
 * (2026-09-06 정정 — 컨트롤러가 읽지 않는다), 조직 하나의 토큰은 한 응답에 들어오는
 * 크기다. 없는 인자를 화면이 보내면 조용히 무시되고, 그때 목록은 거른 것처럼 보인다.
 */
function OrgTokens({
  tokens,
  revoke,
}: {
  tokens: Record<string, unknown>[];
  revoke: ReturnType<typeof useRevoke>;
}): React.JSX.Element {
  const t = useT();
  const [project, setProject] = useState('');
  const [owner, setOwner] = useState('');

  // 거르개는 **이름**으로 읽는다(SET-06) — slug 는 설정 파일에 적는 글자지 사람이 고르는 이름이 아니다. 값은 slug 다
  const projects = useMemo(() => {
    const byslug = new Map<string, string>();
    for (const token of tokens) {
      const slug = String(token['project_slug'] ?? '');
      if (!byslug.has(slug)) byslug.set(slug, String(token['project_name'] ?? slug));
    }
    return [...byslug].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tokens]);
  const owners = useMemo(
    () => [...new Set(tokens.map((token) => String(token['owner'] ?? '')))].sort(),
    [tokens],
  );
  const shown = tokens.filter(
    (token) =>
      (project === '' || String(token['project_slug'] ?? '') === project) &&
      (owner === '' || String(token['owner'] ?? '') === owner),
  );

  return (
    <div>
      <p className="mb-3 text-sm text-text-mute">{t('settings.tokens.org_hint')}</p>
      {tokens.length === 0 ? (
        <EmptyState icon="◇" title={t('settings.tokens.org_empty')} action={null} />
      ) : (
        <>
          <div className="mb-2 flex flex-wrap gap-2">
            <Select
              data-testid="org-token-project"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className="w-48"
            >
              <option value="">{t('settings.tokens.all_projects')}</option>
              {projects.map(([slug, name]) => (
                <option key={slug} value={slug}>
                  {name}
                </option>
              ))}
            </Select>
            <Select
              data-testid="org-token-owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="w-48"
            >
              <option value="">{t('settings.tokens.all_owners')}</option>
              {owners.map((who) => (
                <option key={who} value={who}>
                  {who}
                </option>
              ))}
            </Select>
          </div>
          <Table
            head={
              <>
                <Th>{t('settings.tokens.project')}</Th>
                <Th>{t('settings.tokens.owner')}</Th>
                <Th>{t('settings.members.name')}</Th>
                <Th>{t('settings.tokens.prefix')}</Th>
                <Th>{t('settings.tokens.scopes')}</Th>
                <Th>{t('settings.tokens.expires')}</Th>
                <Th>{t('settings.tokens.last_used')}</Th>
                <Th>{t('settings.tokens.status')}</Th>
                {/* **남의 토큰을 끊는 문**(REQ-WEB-201). 이 표는 보이기만 했다 — 서버는 조직
                    admin 의 폐기를 허용하고(REQ-API-173) 매뉴얼도 그렇다고 적었는데, 떠난 사람의
                    토큰은 API 를 직접 부를 줄 아는 사람만 끊을 수 있었다 */}
                <Th />
              </>
            }
          >
            {shown.map((token) => (
              <Tr key={String(token['id'])}>
                <Td>
                  <ProjectCell token={token} />
                </Td>
                <Td>{String(token['owner'] ?? '')}</Td>
                <Td className="font-medium">{String(token['name'])}</Td>
                <Td className="font-mono text-xs">{String(token['prefix'])}…</Td>
                <Td className="text-xs text-text-mute">
                  {(token['scopes'] as string[] | undefined)?.join(' · ')}
                </Td>
                <Td className="text-xs text-text-mute">
                  {day(token['expires_at'], t('settings.tokens.no_expiry'))}
                </Td>
                <Td className="text-xs text-text-mute">
                  {token['last_used_at'] === null
                    ? t('settings.tokens.unused')
                    : day(token['last_used_at'], '—')}
                </Td>
                {/* 상태는 셋이고 **무엇이 이 토큰을 죽였는지**까지 말한다 — "활성 아님" 만
                    보이면 admin 은 폐기해야 하는지 기다려도 되는지 알 수 없다 */}
                <Td className="text-xs">
                  {token['revoked_at'] !== null ? (
                    <span className="text-text-faint">{t('settings.tokens.revoked')}</span>
                  ) : isExpired(token['expires_at']) ? (
                    <span className="text-status-danger">{t('settings.tokens.expired')}</span>
                  ) : (
                    <span className="text-status-ok">{t('settings.tokens.active')}</span>
                  )}
                </Td>
                <Td className="text-right">
                  {token['revoked_at'] === null && !isExpired(token['expires_at']) && (
                    <RevokeButton token={token} revoke={revoke} />
                  )}
                </Td>
              </Tr>
            ))}
          </Table>
        </>
      )}
    </div>
  );
}
