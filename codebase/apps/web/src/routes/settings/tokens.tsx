// /settings/tokens — S8 에이전트 토큰 (FR-14 · D-08)
//
// **원문은 발급 응답에서 한 번만 보인다.** 다시 볼 수 없다는 사실을 화면이 분명히 말해야
// 하고(그러지 않으면 사람은 창을 닫고 다시 찾는다), 목록에는 prefix 만 남는다.
//
// 권한은 **사람 권한의 부분집합**을 넘지 못한다(D-08). 두 종류가 잠긴다.
//   ① 사람 전용(`approval:decide`) — 누구도 토큰에 실을 수 없다. `spec:approve` 는 2026-10-11 사람 결정으로
//      옵트인 권한이 됐다 — 세션에서 사람이 대답으로 승인하는 `nerv_spec_approve`(A3)만 본다. 권장 묶음에는 없고,
//      admin · planner 가 아니면 ②로 잠긴다
//   ② **내 역할 밖** — 예를 들어 developer 의 `review:resolve`(2026-09-02 사람 결정)
//
// ②가 오래 열려 있었다. 발급은 되는데 검증 시점 교집합에서 잘려 **켜 놓고 쓸 수 없는**
// 토큰이 나왔고, 사람은 그 이유를 화면 어디에서도 볼 수 없었다. 발급 시점에 잘라 저장하지
// 않는 것은 그대로 둔다 — 나중에 역할이 넓어지면 이미 발급된 토큰이 그 순간 따라가야 한다.
// 화면이 말해 주는 것과 저장을 좁히는 것은 다른 일이다.
//
// **토큰은 프로젝트 하나에 묶이는데 화면이 그 말을 하지 않았다**(2026-09-21 — 사람 보고 ·
// REQ-WEB-167). 발급 대상은 헤더가 고른 프로젝트였고(설정 라우트에서 그 값은 "마지막으로
// 본 프로젝트" 다 · `scope.ts`) 폼에는 이름 칸과 권한 체크박스뿐이었으며, 발급된 목록에도
// 프로젝트 열이 없었다 — 서버는 `project_slug`·`project_name` 을 처음부터 싣고 있었고
// 와이어프레임(docs/03-proposal/ui-wireframes.md §2.8)도 그 열을
// 그리고 있었는데 화면만 빠져 있었다. 세 자리에서 말한다: **고를 때**(폼의 선택기) ·
// **받을 때**(원문 카드) · **나중에**(목록의 열).
//
// **발급한 토큰의 이름과 권한을 고친다**(2026-10-11 사람 결정 · REQ-WEB-306). 권한 하나를 더하려고 새로
// 발급하면 그 토큰을 쓰던 기계마다 설정을 다시 해야 했다. 주인만 고치므로 이 표에만 [편집]이 있고(조직 전체
// 표는 폐기만), 프로젝트와 만료는 고치지 않는다 — 바꾸려면 새로 발급한다.

import { useT } from '../../lib/i18n.js';
import { useApiError } from '../../lib/api-errors.js';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useState } from 'react';
import {
  AGENT_RECOMMENDED_SCOPES,
  checkPluginInstallUrl,
  scopesForRoles,
  TOKEN_NAME_MAX,
} from '@nerv/schema';
import { apiFetch } from '../../lib/api.js';
import { deployedServerOrigin } from '../../lib/manual-vars.js';
import { rows, useMe, useTokens } from '../../lib/queries.js';
import { canManageScope, rolesInProject } from '../../lib/session.js';
import { useScope } from '../../lib/scope.js';
import {
  Button,
  Card,
  EmptyState,
  Field,
  FieldRow,
  FieldRowAction,
  Input,
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
import { CopyButton } from '../../components/copy-button.js';
import {
  day,
  isExpired,
  ProjectCell,
  RevokeButton,
  ScopeChecklist,
  useRevoke,
  useUpdateToken,
} from '../../features/settings/token-parts.js';
import { helpLink } from '../../lib/manual-chapters.js';

export const Route = createFileRoute('/settings/tokens')({ component: TokensTab });

/**
 * 만료 선택지 — **날짜 칸이 아니라 기간이다.**
 *
 * 날짜를 직접 받으면 시간대가 끼어들고(브라우저의 자정은 서버의 자정이 아니다) 사람은
 * "오늘부터 얼마" 로 생각하지 특정 날짜로 생각하지 않는다. 0 은 만료 없음이다 —
 * 지금까지의 동작이고, 그것이 기본값인 이유는 여기서 기본을 바꾸면 **오늘 되던 토큰이
 * 어느 날 조용히 죽기** 때문이다(만료는 사람이 고르는 것이지 화면이 정할 일이 아니다).
 */
const EXPIRY_DAYS = [0, 30, 90, 365] as const;

/** 만료까지의 날짜 수 → 서버가 받는 ISO. 0 은 "만료 없음" 이라 값이 없다. */
function expiryIso(days: number): string | null {
  if (days === 0) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

interface Issued {
  /** 목록의 `id` — 연결됐는지(첫 사용)를 그 줄에서 읽는다 */
  tokenId: string;
  token: string;
  name: string;
  expires_at: string | null;
  scopes: string[];
  project: { slug: string; name: string };
}

function TokensTab(): React.JSX.Element {
  const t = useT();
  const tokens = useTokens();
  const queryClient = useQueryClient();
  const onApiError = useApiError();
  // **발급 대상은 이 폼이 고른다**(REQ-WEB-167). 예전에는 헤더가 고른 프로젝트였는데,
  // 설정 라우트에는 프로젝트 축이 없어 그 값은 "마지막으로 본 프로젝트" 였다 — 사람은
  // 자기가 무엇을 향해 발급하는지 모른 채 눌렀다. `projects` 는 헤더의 select 가 그리는
  // 그 목록과 같은 값이고(`scope.ts`), 기본값은 지금 보고 있는 프로젝트다.
  const { orgSlug, projectSlug, projects, projectsLoaded } = useScope();
  const me = useMe();
  // 조직 전체 토큰 표는 **조직 admin 만**(2026-09-24 · REQ-API-172) — 조직의 모든 토큰을 보이는
  // 표라, 한 프로젝트의 admin 이 남의 프로젝트 토큰을 보면 안 된다. 서버와 같은 규칙이다
  const isAdmin = canManageScope(me.data, orgSlug, null);

  const [target, setTarget] = useState<string | null>(null);
  const project = target ?? projectSlug;
  // 역할은 겸직의 합집합이다 — 서버의 `assertMembership` 과 같은 규칙(session.ts).
  // **고른 프로젝트의 역할을 본다**: 프로젝트마다 역할이 다를 수 있고, 잠기는 칸도 달라진다.
  const myScopes = scopesForRoles(rolesInProject(me.data, orgSlug, project));

  const [name, setName] = useState<string | null>(null);
  const [days, setDays] = useState<number>(0);
  // **기본은 권장 묶음이다**(2026-09-24 · REQ-WEB-207). 기본값이 `spec:read`·`task:claim` 둘이던 동안
  // 그대로 발급한 토큰은 `nerv_bootstrap` 이 요구하는 `agent-session:launch` 가 없어 설치가 처음부터
  // 막혔다. [직접 고르기]로 바꾸면 그때의 권장 묶음에서 출발해 칸을 고친다
  const [customScopes, setCustomScopes] = useState(false);
  const [scopes, setScopes] = useState<string[]>([...AGENT_RECOMMENDED_SCOPES]);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);

  // 기본 이름에 프로젝트를 넣는다 — 상수 하나였을 때는 프로젝트를 옮겨 가며 발급한 토큰이
  // 목록에서 **전부 같은 이름**이었다. 사람이 직접 적었으면(`name !== null`) 그것이 이긴다.
  const autoName = `${project ?? ''}/${t('settings.tokens.default_name')}`;
  const tokenName = name ?? autoName;

  // **화면이 보여준 것과 발급되는 것이 같아야 한다**(2026-09-04 · 실측).
  // 초기값이 상수라, 역할에 `task:claim` 이 없는 사람에게는 그 칸이 잠긴 채 **체크 해제로**
  // 보이는데 본문에는 실려 갔다. 사용 시점에 역할과 교집합을 내므로 권한이 새지는 않았지만,
  // 발급된 토큰의 권한 표는 그 사람이 고른 적 없는 값을 보여줬다.
  const chosen: readonly string[] = customScopes ? scopes : AGENT_RECOMMENDED_SCOPES;
  const granted = chosen.filter((scope) => myScopes.has(scope as never));

  const issue = useMutation({
    mutationFn: () =>
      apiFetch<Issued>('/me/tokens', {
        method: 'POST',
        // 조직도 함께 보낸다 — 같은 slug 가 두 조직에 있으면 slug 만으로는 어느
        // 프로젝트에 바인딩할지 정해지지 않는다(REQ-API-152).
        body: {
          project: project ?? '',
          org: orgSlug ?? undefined,
          name: tokenName,
          scopes: granted,
          expires_at: expiryIso(days),
        },
      }),
    onSuccess: (result) => {
      setIssued(result);
      void queryClient.invalidateQueries({ queryKey: ['me', 'tokens'] });
      void queryClient.invalidateQueries({ queryKey: ['org', orgSlug, 'tokens'] });
    },
    onError: onApiError,
  });

  const revoke = useRevoke(orgSlug);
  // 한 번에 한 줄만 고친다 — 둘을 열어 두면 어느 [저장]이 어느 토큰인지 눈으로 맞춰야 한다
  const [editing, setEditing] = useState<string | null>(null);

  // 죽은 토큰은 기본으로 접는다 — 폐기·만료는 목록에서 **자라기만 하는** 줄이고, 관리가
  // 힘들어지는 자리가 정확히 여기다. 지우지는 않는다: 감사가 묻는 것은 지금 살아 있는
  // 토큰이 아니라 "그때 무엇이 있었나" 이기도 하다.
  const mine = rows(tokens.data).filter(
    (token) => showRevoked || (token['revoked_at'] === null && !isExpired(token['expires_at'])),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('settings.tab.tokens')} />
      <Card>
        <SectionTitle>{t('settings.tokens.new')}</SectionTitle>
        {/* 한 번만 보인다는 사실은 **누르기 전에** 읽혀야 한다 — 화면 머리에 있으면
            발급 버튼까지 눈이 내려간 뒤라 이미 늦다 */}
        <p className="mb-2.5 text-xs text-text-mute">{t('settings.tokens.lead')}</p>
        <FieldRow>
          {/* **프로젝트가 첫 칸이다.** 토큰의 뜻을 정하는 값이라 이름보다 앞에 온다 */}
          <Field
            label={t('settings.tokens.project')}
            hint={t('settings.tokens.project_hint')}
            className="w-60"
          >
            <Select
              data-testid="token-project"
              value={project ?? ''}
              disabled={projects.length === 0}
              // 이름을 직접 적지 않았으면(`name === null`) 자동 이름이 **프로젝트를
              // 따라간다** — 앞 프로젝트의 이름이 남으면 그 토큰은 태어나면서부터 거짓말을
              // 한다. 적은 이름은 건드리지 않는다: 사람이 고른 것이 화면보다 세다.
              onChange={(e) => setTarget(e.target.value)}
            >
              {projects.map((p) => (
                <option key={String(p['slug'])} value={String(p['slug'])}>
                  {String(p['name'])} ({String(p['slug'])})
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('settings.tokens.name')} className="w-56">
            <Input
              value={tokenName}
              onChange={(e) => setName(e.target.value)}
              aria-label={t('settings.tokens.name')}
            />
          </Field>
          <Field
            label={t('settings.tokens.expires')}
            hint={t('settings.tokens.expires_hint')}
            className="w-52"
          >
            <Select
              data-testid="token-expiry"
              value={String(days)}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {EXPIRY_DAYS.map((n) => (
                <option key={n} value={n}>
                  {n === 0
                    ? t('settings.tokens.expires_never')
                    : t('settings.tokens.expires_days', { n })}
                </option>
              ))}
            </Select>
          </Field>
          <FieldRowAction>
            <Button
              variant="primary"
              data-testid="token-issue"
              disabled={issue.isPending || project === null}
              onClick={() => issue.mutate()}
            >
              {t('settings.tokens.issue')}
            </Button>
          </FieldRowAction>
        </FieldRow>
        {/* **막다른 길을 만들지 않는다**(§1.5 · REQ-WEB-003). 비활성인 단추는 왜 그런지를
            같은 자리에서 말해야 한다 — 예전에는 아무 말 없이 잠겨 있었다. */}
        {/* 목록을 받기 전에는 "프로젝트가 없다" 가 아니다(REQ-WEB-293) */}
        {project === null && projectsLoaded && (
          <p data-testid="token-no-project" className="mt-2 text-xs text-status-waiting">
            {/* **조직 admin 에게는 할 일을 말한다**(2026-09-24 · REQ-WEB-205). 조직을 막 만든 admin 이
                "admin 에게 소속을 요청하세요" 를 읽었다 — 자기 자신에게 요청하라는 말이었다 */}
            {isAdmin && projects.length === 0 ? (
              <>
                {t('settings.tokens.no_project_admin')}{' '}
                <Link
                  to="/settings/projects"
                  search={{ new: 1 }}
                  data-testid="token-create-project"
                  className="text-link hover:underline"
                >
                  {t('home.create_project')} ▸
                </Link>
              </>
            ) : (
              t('settings.tokens.no_project')
            )}
          </p>
        )}
        <div
          role="radiogroup"
          aria-label={t('settings.tokens.scopes')}
          className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"
        >
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              name="scope-preset"
              data-testid="scope-recommended"
              checked={!customScopes}
              onChange={() => setCustomScopes(false)}
            />
            {t('settings.tokens.preset_recommended')}
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              name="scope-preset"
              data-testid="scope-custom"
              checked={customScopes}
              onChange={() => {
                setScopes([...granted]);
                setCustomScopes(true);
              }}
            />
            {t('settings.tokens.preset_custom')}
          </label>
          <span className="text-text-faint">{t('settings.tokens.preset_hint')}</span>
        </div>
        {/* 권한 칸은 고치기 줄과 같은 부품이다 — 잠그는 규칙(역할 밖 · 사람 전용)과 권한마다의 설명이 한 벌이다 */}
        <ScopeChecklist
          myScopes={myScopes}
          checked={granted}
          // 권장일 때는 묶음을 **보여 주기만** 한다 — 고치려면 [직접 고르기]
          editable={customScopes}
          onToggle={(scope, on) =>
            setScopes((prev) => (on ? [...prev, scope] : prev.filter((s) => s !== scope)))
          }
        />
        {issued !== null && <RevealOnce issued={issued} onClose={() => setIssued(null)} />}
      </Card>

      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>{t('settings.tokens.issued')}</SectionTitle>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-mute">
            <input
              type="checkbox"
              data-testid="token-show-revoked"
              checked={showRevoked}
              onChange={(e) => setShowRevoked(e.target.checked)}
            />
            {t('settings.tokens.show_revoked')}
          </label>
        </div>
        {/* 받아 오기 전에는 "토큰이 없습니다" 가 아니다(REQ-WEB-198) */}
        {tokens.data === undefined ? (
          failedWithoutData(tokens) ? (
            <ErrorState error={tokens.error} onRetry={() => void tokens.refetch()} />
          ) : (
            <Skeleton rows={2} />
          )
        ) : mine.length === 0 ? (
          <EmptyState
            icon="◇"
            title={t('settings.tokens.empty')}
            hint={t('settings.tokens.empty_hint')}
            action={
              <Link
                to="/help/$chapter"
                params={{ chapter: 'install' }}
                className="text-sm text-link hover:underline"
              >
                {t('settings.tokens.install_chapter')} ▸
              </Link>
            }
          />
        ) : (
          <Table
            head={
              <>
                {/* **프로젝트가 맨 앞이다** — 토큰을 찾는 첫 물음이 "어느 프로젝트의
                    것인가" 이고, 와이어프레임(§2.8)도 그 열을 그리고 있었다 */}
                <Th>{t('settings.tokens.project')}</Th>
                <Th>{t('settings.members.name')}</Th>
                <Th>{t('settings.tokens.prefix')}</Th>
                <Th>{t('settings.tokens.scopes')}</Th>
                <Th>{t('settings.tokens.expires')}</Th>
                <Th>{t('settings.tokens.last_used')}</Th>
                <Th>{t('settings.tokens.last_host')}</Th>
                <Th />
              </>
            }
          >
            {mine.map((token) => (
              <Fragment key={String(token['id'])}>
                <Tr>
                  <Td>
                    <ProjectCell token={token} />
                  </Td>
                  <Td className="font-medium">{String(token['name'])}</Td>
                  <Td className="font-mono text-xs">{String(token['prefix'])}…</Td>
                  <Td className="text-xs text-text-mute">
                    {(token['scopes'] as string[] | undefined)?.join(' · ')}
                  </Td>
                  <Td
                    className={
                      isExpired(token['expires_at'])
                        ? 'text-xs text-status-danger'
                        : 'text-xs text-text-mute'
                    }
                  >
                    {day(token['expires_at'], t('settings.tokens.no_expiry'))}
                  </Td>
                  <Td className="text-xs text-text-mute">
                    {token['last_used_at'] === null
                      ? t('settings.tokens.unused')
                      : day(token['last_used_at'], '—')}
                  </Td>
                  {/* 어느 머신이 이 토큰을 쓰는가 — 유출 판단의 첫 단서다(NFR-03) */}
                  <Td className="font-mono text-xs text-text-mute">
                    {token['last_used_hostname'] === null ||
                    token['last_used_hostname'] === undefined
                      ? '—'
                      : String(token['last_used_hostname'])}
                  </Td>
                  <Td className="text-right">
                    {token['revoked_at'] === null ? (
                      <span className="inline-flex items-center gap-1.5">
                        {/* 만료된 토큰은 고치지 않는다 — 되살리는 길이 아니다(서버도 거절한다 · REQ-API-292) */}
                        {!isExpired(token['expires_at']) && (
                          <Button
                            size="sm"
                            variant="subtle"
                            data-testid="token-edit"
                            aria-expanded={editing === token['id']}
                            onClick={() =>
                              setEditing((prev) =>
                                prev === token['id'] ? null : String(token['id']),
                              )
                            }
                          >
                            {t('settings.tokens.edit')}
                          </Button>
                        )}
                        <RevokeButton token={token} revoke={revoke} />
                      </span>
                    ) : (
                      <span className="text-xs text-text-faint">
                        {t('settings.tokens.revoked')}
                      </span>
                    )}
                  </Td>
                </Tr>
                {editing === token['id'] && (
                  <Tr>
                    <Td colSpan={8}>
                      <TokenEditor
                        token={token}
                        orgSlug={orgSlug}
                        onDone={() => setEditing(null)}
                      />
                    </Td>
                  </Tr>
                )}
              </Fragment>
            ))}
          </Table>
        )}
      </div>

      {/* **조직 전체 토큰은 조직 묶음의 자기 화면이다**(2026-09-25 — 사람 결정 D1 · SET-06 · REQ-WEB-227). 이 탭은 **내**
          토큰(모든 조직)이고, 조직의 것까지 한 화면에 섞어 두었더니 두 범위가 탭 경계와 어긋났다 — 조직 admin 에게만
          그 자리로 가는 길을 남긴다 */}
      {isAdmin && (
        <p data-testid="org-tokens-pointer" className="text-sm text-text-mute">
          {t('settings.tokens.org_moved')}{' '}
          <Link to="/settings/org-tokens" className="text-link hover:underline">
            {t('settings.tokens.org_title')} ▸
          </Link>
        </p>
      )}
    </div>
  );
}

/**
 * **토큰 고치기 줄**(2026-10-11 · REQ-WEB-306) — 이름과 권한만이다.
 *
 * 권한 칸은 발급 폼과 같은 부품이고, 기준은 **그 토큰의 프로젝트에서 내 역할**이다(발급 폼이 고른 프로젝트가
 * 아니다). 이미 담긴 권한은 역할 밖이어도 뺄 수 있다 — 역할이 좁아진 뒤 남은 권한을 치울 길이다. 바뀐 권한은 그
 * 토큰의 다음 호출부터 적용된다는 사실을 [저장] 앞에서 말한다.
 */
function TokenEditor({
  token,
  orgSlug,
  onDone,
}: {
  token: Record<string, unknown>;
  orgSlug: string | null;
  onDone: () => void;
}): React.JSX.Element {
  const t = useT();
  const me = useMe();
  const onApiError = useApiError();
  const update = useUpdateToken(orgSlug);
  const current = (token['scopes'] as string[] | undefined) ?? [];
  const [name, setName] = useState(String(token['name'] ?? ''));
  const [scopes, setScopes] = useState<string[]>([...current]);
  // 내 토큰은 모든 조직의 것이다 — 그 토큰의 조직과 프로젝트로 역할을 본다(목록이 조직을 싣는다 · REQ-API-170)
  const tokenOrg = typeof token['org_slug'] === 'string' ? token['org_slug'] : orgSlug;
  const myScopes = scopesForRoles(
    rolesInProject(me.data, tokenOrg, String(token['project_slug'] ?? '')),
  );
  const trimmed = name.trim();

  return (
    <div data-testid="token-editor" className="flex flex-col gap-2 py-1">
      <FieldRow>
        <Field label={t('settings.tokens.name')} className="w-72">
          <Input
            data-testid="token-edit-name"
            value={name}
            maxLength={TOKEN_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            aria-label={t('settings.tokens.name')}
          />
        </Field>
      </FieldRow>
      <ScopeChecklist
        myScopes={myScopes}
        checked={scopes}
        editable
        keep={current}
        onToggle={(scope, on) =>
          setScopes((prev) => (on ? [...prev, scope] : prev.filter((s) => s !== scope)))
        }
        testId="token-edit-scope"
        humanOnlyTestId="token-edit-human-only"
      />
      <p className="text-xs text-text-mute">{t('settings.tokens.edit_hint')}</p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          data-testid="token-edit-save"
          disabled={update.isPending || trimmed === ''}
          onClick={() =>
            update.mutate(
              { id: String(token['id']), name: trimmed, scopes },
              { onSuccess: onDone, onError: onApiError },
            )
          }
        >
          {t('common.save')}
        </Button>
        <Button size="sm" variant="subtle" data-testid="token-edit-cancel" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}

/**
 * 발급한 뒤 — **연결 3단계**(2026-09-24 · REQ-WEB-207 · plugin.md §4).
 *
 * 예전 카드는 원문과 "그대로 붙여넣을 한 줄"(`nerv-init --server … --token …`)을 줬는데 그대로
 * 따라 하면 붙지 않았다: 그 시점에는 `nerv-init` 을 배달하는 플러그인이 아직 없고, 맨 이름
 * `nerv-init` 은 셸 PATH 에 없다(설치 캐시에 있다 — §3.7). 원문에는 복사 단추도 없었고, 설치 장으로
 * 가는 말은 링크가 아니라 글자였다. 순서를 명세대로 세운다 — ① 토큰 ② 플러그인 설치 ③ 설정.
 *
 * `--token` 은 한 줄에 둔다(2026-09-24 사람 결정 — 붙여넣기 한 번이 낫다). 셸 기록에 남는다는 사실과
 * 빼고 실행하면 가려서 묻는다는 길을 곁에 적는다. **연결을 기다린다** — 이 카드가 열려 있는 동안 목록을
 * 짧게 다시 읽어, 그 토큰이 처음 쓰이면 "연결됨 — 기계" 로 바뀐다.
 */
function RevealOnce({
  issued,
  onClose,
}: {
  issued: Issued;
  onClose: () => void;
}): React.JSX.Element {
  const t = useT();
  const server = deployedServerOrigin() ?? '';
  // 이 서버 주소로 설치할 수 없으면(https·비루프백·신뢰된 CA) GitHub 으로 받는다 — 설치 장과 같은 판정
  const direct = server !== '' && checkPluginInstallUrl(server).ok;
  const marketplace = direct
    ? `/plugin marketplace add ${server}/plugin/marketplace.json`
    : '/plugin marketplace add worker-ants/nerv';
  const install = '/plugin install nerv@nerv';
  const init = `"$(ls -d "$HOME"/.claude/plugins/cache/*/nerv/*/bin/nerv-init | sort -V | tail -1)" --server ${server} --project ${issued.project.slug} --token ${issued.token}`;
  const [connected, setConnected] = useState<string | null>(null);
  const tokens = useTokens(connected === null ? 5000 : false);
  const row = rows(tokens.data).find((r) => r['id'] === issued.tokenId);
  const usedAt = row?.['last_used_at'];
  const host = typeof usedAt === 'string' ? String(row?.['last_used_hostname'] ?? '') : null;
  // 한 번 연결되면 그대로 둔다 — 폴링도 멈춘다
  useEffect(() => {
    if (host !== null && connected === null) setConnected(host);
  }, [host, connected]);

  return (
    <div
      data-testid="issued-token"
      className="mt-3 rounded-nerv border border-status-ok bg-status-ok-soft p-3"
    >
      <p className="text-sm font-medium text-status-ok">{t('settings.tokens.copy_now')}</p>

      <p className="mt-2.5 text-xs font-medium">{t('settings.tokens.step1')}</p>
      <div className="mt-1 flex items-start gap-2">
        <code className="min-w-0 flex-1 rounded-nerv-sm bg-code-bg p-2 font-mono text-xs break-all text-code-text">
          {issued.token}
        </code>
        <CopyButton value={issued.token} testId="issued-token-copy" />
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-text-mute">{t('settings.tokens.issued_for')}</dt>
        <dd data-testid="issued-project">
          {issued.project.name}{' '}
          <span className="font-mono text-text-faint">({issued.project.slug})</span>
        </dd>
        <dt className="text-text-mute">{t('settings.tokens.scopes')}</dt>
        <dd className="font-mono text-2xs">{issued.scopes.join(' · ')}</dd>
        <dt className="text-text-mute">{t('settings.tokens.expires')}</dt>
        <dd>
          {issued.expires_at === null
            ? t('settings.tokens.expires_never')
            : issued.expires_at.slice(0, 10)}
        </dd>
      </dl>

      <p className="mt-3 text-xs font-medium">{t('settings.tokens.step2')}</p>
      {[marketplace, install].map((line) => (
        <div key={line} className="mt-1 flex items-start gap-2">
          <code
            data-testid="issued-plugin"
            className="min-w-0 flex-1 rounded-nerv-sm bg-code-bg p-2 font-mono text-xs break-all text-code-text"
          >
            {line}
          </code>
          <CopyButton value={line} />
        </div>
      ))}
      {!direct && (
        <p className="mt-1 text-2xs text-text-faint">
          {t('settings.tokens.step2_github')}{' '}
          {/* 이유는 설치 장의 Claude Code 절에 있다 — 글자로만 "설치 장에 있다" 고 하던 자리(REQ-WEB-268) */}
          <Link
            {...helpLink('install', 'claude-code')}
            data-testid="issued-github-why"
            className="text-link hover:underline"
          >
            {t('settings.tokens.step2_github_why')} ▸
          </Link>
        </p>
      )}

      <p className="mt-3 text-xs font-medium">{t('settings.tokens.step3')}</p>
      <div className="mt-1 flex items-start gap-2">
        <code
          data-testid="issued-command"
          className="min-w-0 flex-1 rounded-nerv-sm bg-code-bg p-2 font-mono text-xs break-all text-code-text"
        >
          {init}
        </code>
        <CopyButton value={init} testId="issued-command-copy" />
      </div>
      <p className="mt-1 text-2xs text-text-faint">{t('settings.tokens.step3_note')}</p>

      <p
        data-testid="issued-connection"
        data-connected={connected !== null ? 'true' : undefined}
        className="mt-3 text-xs"
      >
        {connected !== null ? (
          <span className="font-medium text-status-ok">
            ✓ {t('settings.tokens.connected', { host: connected === '' ? '—' : connected })}
          </span>
        ) : (
          <span className="text-text-mute">{t('settings.tokens.waiting')}</span>
        )}
      </p>
      <div className="mt-2 flex items-center gap-3">
        <Link
          to="/help/$chapter"
          params={{ chapter: 'install' }}
          data-testid="issued-install-chapter"
          className="text-xs text-link hover:underline"
        >
          {t('settings.tokens.install_chapter')} ▸
        </Link>
        <Button size="sm" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
    </div>
  );
}
