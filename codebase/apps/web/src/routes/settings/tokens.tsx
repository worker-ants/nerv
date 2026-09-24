// /settings/tokens — S8 에이전트 토큰 (FR-14 · D-08)
//
// **원문은 발급 응답에서 한 번만 보인다.** 다시 볼 수 없다는 사실을 화면이 분명히 말해야
// 하고(그러지 않으면 사람은 창을 닫고 다시 찾는다), 목록에는 prefix 만 남는다.
//
// 권한은 **사람 권한의 부분집합**을 넘지 못한다(D-08). 두 종류가 잠긴다.
//   ① 사람 전용(`spec:approve`·`approval:decide`) — 누구도 토큰에 실을 수 없다
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

import { useT } from '../../lib/i18n.js';
import { useApiError } from '../../lib/api-errors.js';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { AGENT_SCOPES, HUMAN_ONLY_SCOPES, scopesForRoles } from '@nerv/schema';
import { apiFetch } from '../../lib/api.js';
import { deployedServerOrigin } from '../../lib/manual-vars.js';
import { rows, useMe, useOrgTokens, useTokens } from '../../lib/queries.js';
import { canManageScope, rolesInProject } from '../../lib/session.js';
import { useScope } from '../../lib/scope.js';
import { useRealtime } from '../../lib/realtime.js';
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
import { ScopeBadge } from '../../components/scope-badge.js';

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

/** 만료가 이미 지났는가 — 서버의 검증(`verifyPat`)과 같은 판정이다. */
function isExpired(value: unknown): boolean {
  return typeof value === 'string' && new Date(value).getTime() <= Date.now();
}

/** 표의 날짜 칸 — 시각까지 적으면 열이 읽히지 않는다. 없으면 "없음" 이라고 말한다. */
function day(value: unknown, absent: string): string {
  return typeof value === 'string' && value !== '' ? value.slice(0, 10) : absent;
}

interface Issued {
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
  const { pushToast } = useRealtime();
  const onApiError = useApiError();
  // **발급 대상은 이 폼이 고른다**(REQ-WEB-167). 예전에는 헤더가 고른 프로젝트였는데,
  // 설정 라우트에는 프로젝트 축이 없어 그 값은 "마지막으로 본 프로젝트" 였다 — 사람은
  // 자기가 무엇을 향해 발급하는지 모른 채 눌렀다. `projects` 는 헤더의 select 가 그리는
  // 그 목록과 같은 값이고(`scope.ts`), 기본값은 지금 보고 있는 프로젝트다.
  const { orgSlug, projectSlug, projects } = useScope();
  const me = useMe();
  // 조직 전체 토큰 표는 **조직 admin 만**(2026-09-24 · REQ-API-172) — 조직의 모든 토큰을 보이는
  // 표라, 한 프로젝트의 admin 이 남의 프로젝트 토큰을 보면 안 된다. 서버와 같은 규칙이다
  const isAdmin = canManageScope(me.data, orgSlug, null);
  const orgTokens = useOrgTokens(orgSlug, isAdmin);

  const [target, setTarget] = useState<string | null>(null);
  const project = target ?? projectSlug;
  // 역할은 겸직의 합집합이다 — 서버의 `assertMembership` 과 같은 규칙(session.ts).
  // **고른 프로젝트의 역할을 본다**: 프로젝트마다 역할이 다를 수 있고, 잠기는 칸도 달라진다.
  const myScopes = scopesForRoles(rolesInProject(me.data, orgSlug, project));

  const [name, setName] = useState<string | null>(null);
  const [days, setDays] = useState<number>(0);
  const [scopes, setScopes] = useState<string[]>(['spec:read', 'task:claim']);
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
  const granted = scopes.filter((scope) => myScopes.has(scope as never));

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

  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`/me/tokens/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me', 'tokens'] });
      void queryClient.invalidateQueries({ queryKey: ['org', orgSlug, 'tokens'] });
      pushToast({ tone: 'ok', message: t('settings.tokens.revoke_done') });
    },
  });

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
              disabled={issue.isPending || project === null}
              onClick={() => issue.mutate()}
            >
              {t('settings.tokens.issue')}
            </Button>
          </FieldRowAction>
        </FieldRow>
        {/* **막다른 길을 만들지 않는다**(§1.5 · REQ-WEB-003). 비활성인 단추는 왜 그런지를
            같은 자리에서 말해야 한다 — 예전에는 아무 말 없이 잠겨 있었다. */}
        {project === null && (
          <p data-testid="token-no-project" className="mt-2 text-xs text-status-waiting">
            {t('settings.tokens.no_project')}
          </p>
        )}
        <fieldset className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">
          <legend className="sr-only">{t('settings.tokens.scopes')}</legend>
          {AGENT_SCOPES.map((scope) => {
            // 내 역할에 없는 권한은 **보이되 잠긴다**. 사람 전용 권한과 같은 규율이다 —
            // 목록에서 빼면 "왜 이건 못 주지"가 화면 밖에 남는다.
            const mineScope = myScopes.has(scope);
            return (
              <label
                key={scope}
                className={
                  mineScope
                    ? 'flex cursor-pointer items-center gap-1.5'
                    : 'flex items-center gap-1.5 opacity-45'
                }
                title={mineScope ? undefined : t('settings.tokens.out_of_role')}
              >
                <input
                  type="checkbox"
                  checked={granted.includes(scope)}
                  disabled={!mineScope}
                  onChange={(e) =>
                    setScopes((prev) =>
                      e.target.checked ? [...prev, scope] : prev.filter((s) => s !== scope),
                    )
                  }
                />
                <code className="font-mono">{scope}</code>
              </label>
            );
          })}
          {/* 사람 전용 권한은 **숨기지 않고 비활성으로 보인다**(REQ-WEB-027 · D-08).
              목록에서 빼버리면 "왜 승인 권한을 토큰에 못 주지?"라는 질문이 화면 밖에 남고,
              그 답이 어디에도 없다. 보이되 고를 수 없는 것이 규칙을 가르친다. */}
          {HUMAN_ONLY_SCOPES.map((scope) => (
            <label
              key={scope}
              data-testid="human-only-scope"
              title={t('settings.tokens.human_only_title')}
              className="flex cursor-not-allowed items-center gap-1.5 opacity-50"
            >
              <input type="checkbox" disabled checked={false} readOnly />
              <code className="font-mono">{scope}</code>
              <span className="text-text-faint">{t('settings.tokens.human_only')}</span>
            </label>
          ))}
        </fieldset>
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
            icon="🔑"
            title={t('settings.tokens.empty')}
            hint={t('settings.tokens.empty_hint')}
          />
        ) : (
          <Table
            head={
              <>
                {/* **프로젝트가 맨 앞이다** — 토큰을 찾는 첫 물음이 "어느 프로젝트의
                    것인가" 이고, 와이어프레임(§2.8)도 그 열을 그리고 있었다 */}
                <Th>{t('settings.tokens.project')}</Th>
                <Th>{t('settings.members.name')}</Th>
                <Th>prefix</Th>
                <Th>{t('settings.tokens.scopes')}</Th>
                <Th>{t('settings.tokens.expires')}</Th>
                <Th>{t('settings.tokens.last_used')}</Th>
                <Th>{t('settings.tokens.last_host')}</Th>
                <Th />
              </>
            }
          >
            {mine.map((token) => (
              <Tr key={String(token['id'])}>
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
                  {token['last_used_hostname'] === null || token['last_used_hostname'] === undefined
                    ? '—'
                    : String(token['last_used_hostname'])}
                </Td>
                <Td className="text-right">
                  {token['revoked_at'] === null ? (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => revoke.mutate(String(token['id']))}
                    >
                      {t('settings.tokens.revoke')}
                    </Button>
                  ) : (
                    <span className="text-xs text-text-faint">{t('settings.tokens.revoked')}</span>
                  )}
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </div>

      {isAdmin && <OrgTokens tokens={rows(orgTokens.data)} />}
    </div>
  );
}

/**
 * 프로젝트 칸 — 이름으로 읽고 slug 로 대조한다(설정 파일에 적는 것은 slug 다).
 *
 * **내 토큰은 모든 조직의 것이다**(REQ-WEB-192) — 조직이 둘 이상이면 조직이 앞에 선다.
 * 조직 전체 표(`OrgTokens`)는 한 조직의 것이라 조직을 넘기지 않는다.
 */
function ProjectCell({ token }: { token: Record<string, unknown> }): React.JSX.Element {
  return (
    <ScopeBadge
      className="text-sm text-text"
      orgSlug={token['org_slug']}
      orgName={token['org_name']}
      projectSlug={token['project_slug'] ?? ''}
      projectName={token['project_name']}
      withSlug
    />
  );
}

/**
 * 원문 1회 표시 — REQ-WEB-026.
 *
 * **이 카드가 자기를 설명하지 않으면 다시 볼 기회가 없다.** 값만 보여 주던 동안, 받은
 * 사람이 들고 나가는 것은 문자열 하나였고 그것이 어느 프로젝트·어떤 권한의 토큰인지는
 * 창을 닫는 순간 사라졌다(목록에는 원문이 없어 대조할 것도 접두뿐이다). 프로젝트·권한·
 * 만료를 같은 상자에서 말하고, **그대로 붙여넣을 한 줄**을 함께 준다 — 이 값이 갈 곳은
 * 결국 저장소의 설정 세 자리이고(`nerv-init` · docs/04-mvp/plugin.md §3.7), 서버 주소는 화면이
 * 이미 안다(`/config.json` 의 `api_url` · REQ-WEB-165 가 매뉴얼에서 쓰는 그 값이다).
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
  const command = `nerv-init --server ${server} --project ${issued.project.slug} --token ${issued.token}`;
  return (
    <div
      data-testid="issued-token"
      className="mt-3 rounded-nerv border border-status-ok bg-status-ok-soft p-3"
    >
      <p className="text-sm font-medium text-status-ok">{t('settings.tokens.copy_now')}</p>
      <code className="mt-2 block rounded-nerv-sm bg-code-bg p-2 font-mono text-xs break-all text-code-text">
        {issued.token}
      </code>
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
      <p className="mt-2.5 text-xs text-text-mute">{t('settings.tokens.paste')}</p>
      <code
        data-testid="issued-command"
        className="mt-1 block rounded-nerv-sm bg-code-bg p-2 font-mono text-xs break-all text-code-text"
      >
        {command}
      </code>
      <Button size="sm" variant="ghost" className="mt-1" onClick={onClose}>
        {t('common.close')}
      </Button>
    </div>
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
function OrgTokens({ tokens }: { tokens: Record<string, unknown>[] }): React.JSX.Element {
  const t = useT();
  const [project, setProject] = useState('');
  const [owner, setOwner] = useState('');

  const projects = useMemo(
    () => [...new Set(tokens.map((token) => String(token['project_slug'] ?? '')))].sort(),
    [tokens],
  );
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
      <SectionTitle>{t('settings.tokens.org_title')}</SectionTitle>
      <p className="mb-2 text-xs text-text-mute">{t('settings.tokens.org_hint')}</p>
      {tokens.length === 0 ? (
        <EmptyState icon="🔑" title={t('settings.tokens.org_empty')} />
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
              {projects.map((slug) => (
                <option key={slug} value={slug}>
                  {slug}
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
                <Th>prefix</Th>
                <Th>{t('settings.tokens.scopes')}</Th>
                <Th>{t('settings.tokens.expires')}</Th>
                <Th>{t('settings.tokens.last_used')}</Th>
                <Th>{t('settings.tokens.status')}</Th>
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
              </Tr>
            ))}
          </Table>
        </>
      )}
    </div>
  );
}
