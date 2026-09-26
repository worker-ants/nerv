// /settings/projects — 프로젝트 목록 (S8 · EP-PRJ-02·04·05)
//
// **조직과 프로젝트를 나눈다**(2026-09-26 — 사람 지시 · REQ-WEB-242). 프로젝트를 만들고, 이름·저장소를 고치고,
// 보관·복구하는 곳이다. 조직 이름·삭제·새 조직은 조직 무리의 `/settings/org` 에 있다.
//
// 프로젝트는 지우지 않고 **보관**한다(`archived_at`). 그 아래 스펙·Task·리뷰가 있고, 그것을 지우면 감사 기록도
// 함께 지워진다(FR-16).

import { REPO_HOSTS } from '@nerv/schema';
import { useT } from '../../lib/i18n.js';
import { useApiError } from '../../lib/api-errors.js';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { projectKeyFromSlug, slugFromName } from '../../lib/slug.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { rows, useMe, useMembers, useProjects } from '../../lib/queries.js';
import { useScope } from '../../lib/scope.js';
import { canManageScope, rolesInProject } from '../../lib/session.js';
import { useRealtime } from '../../lib/realtime.js';
import { cn } from '../../lib/utils.js';
import {
  Button,
  EmptyState,
  Field,
  FieldRow,
  FieldRowAction,
  Input,
  Mono,
  PageHeader,
  SectionTitle,
  Select,
} from '../../components/ui/primitives.js';
import { ConfirmAction } from '../../components/ui/confirm-action.js';
import { ReadOnlyNotice, scopeAdmins } from '../../components/read-only-notice.js';

export const Route = createFileRoute('/settings/projects')({
  // `?new=1` — **폼이 열린 채로 도착한다**(2026-09-24 · REQ-WEB-205). "새 프로젝트" 를 누르고 온 사람이
  // [+ 새 프로젝트]를 한 번 더 찾아 누르지 않게 한다
  validateSearch: (search: Record<string, unknown>): { new?: 1 } =>
    search['new'] === 1 || search['new'] === '1' ? { new: 1 } : {},
  component: ProjectsTab,
});

function ProjectsTab(): React.JSX.Element {
  const t = useT();
  const me = useMe();
  const { orgSlug, orgName } = useScope();
  const search = Route.useSearch();
  const navigate = useNavigate();
  // 새 프로젝트는 조직 수준이라 **조직 admin 만** 만든다(2026-09-24 사람 결정 · REQ-API-169 확장)
  const isOrgAdmin = canManageScope(me.data, orgSlug, null);
  // 프로젝트 줄(이름·저장소·보관)은 **그 프로젝트의** admin 도 고친다 — 서버의 EP-PRJ-04·05 와 같은 규칙
  const canEditProject = (slug: string): boolean =>
    rolesInProject(me.data, orgSlug, slug).includes('admin');
  const anyProjectAdmin = (me.data?.memberships ?? []).some(
    (m) => m.org_slug === orgSlug && m.roles.includes('admin'),
  );
  // **보관한 프로젝트를 볼 방법이 화면에 없었다**(사람 보고 2026-08-27). 목록이 보관을 빼고 와서 복구 버튼이
  // 있는 줄이 그려지지 않았고, 보관은 사실상 되돌릴 수 없는 일이었다
  const [showArchived, setShowArchived] = useState(false);
  const projects = useProjects(orgSlug, showArchived);
  // 누구에게 부탁할지 — 새 프로젝트는 조직 admin 이 만든다(REQ-WEB-201)
  const members = useMembers(orgSlug);

  return (
    <section className="flex flex-col gap-8">
      <PageHeader
        title={t('settings.workspace.title_projects', { org: orgName ?? orgSlug ?? '' })}
      />
      {!isOrgAdmin && (
        <ReadOnlyNotice
          admins={members.data === undefined ? undefined : scopeAdmins(rows(members.data), null)}
        >
          {t('settings.workspace.projects_admin_only')}
        </ReadOnlyNotice>
      )}
      <ProjectSection
        orgSlug={orgSlug}
        projects={rows(projects.data)}
        canCreate={isOrgAdmin}
        canSeeArchived={isOrgAdmin || anyProjectAdmin}
        canEditProject={canEditProject}
        showArchived={showArchived}
        onShowArchived={setShowArchived}
        // 잠긴 사람에게는 열지 않는다 — 단추가 잠긴 이유는 위의 안내에 있다
        openNew={search.new === 1 && isOrgAdmin}
        onFormClosed={() => {
          if (search.new === 1)
            void navigate({ to: '/settings/projects', search: {}, replace: true });
        }}
      />
    </section>
  );
}

/** 프로젝트 — 만들기 · 이름 고치기 · 보관/복구 */
function ProjectSection({
  orgSlug,
  projects,
  showArchived,
  onShowArchived,
  canCreate,
  canSeeArchived,
  canEditProject,
  openNew,
  onFormClosed,
}: {
  orgSlug: string | null;
  projects: Record<string, unknown>[];
  showArchived: boolean;
  onShowArchived: (next: boolean) => void;
  /** 새 프로젝트 — 조직 수준이라 조직 admin 만 */
  canCreate: boolean;
  /** 보관 보기 — 복구할 수 있는 사람(조직 admin · 어느 프로젝트의 admin)에게 */
  canSeeArchived: boolean;
  /** 프로젝트 줄 — 조직 admin 또는 그 프로젝트의 admin */
  canEditProject: (slug: string) => boolean;
  /** `?new=1` 로 왔다 — 폼을 연 채로 시작한다 */
  openNew: boolean;
  /** 폼이 닫혔다(만들었거나 취소했다) — 주소에서 `?new=1` 을 뺀다 */
  onFormClosed: () => void;
}): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const [creating, setCreatingState] = useState(openNew);
  const setCreating = (next: boolean): void => {
    setCreatingState(next);
    if (!next) onFormClosed();
  };

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['org', orgSlug, 'projects'] });
  };

  return (
    <div>
      <SectionTitle
        action={
          <span className="flex items-center gap-3">
            {/* 보관을 **볼 수 있어야** 복구할 수 있다 — 켜면 목록이 보관까지 담는다 */}
            {canSeeArchived && (
              <label
                className="flex cursor-pointer items-center gap-1.5 text-xs text-text-mute"
                title={t('settings.workspace.show_archived_hint')}
              >
                <input
                  type="checkbox"
                  data-testid="show-archived"
                  checked={showArchived}
                  onChange={(e) => onShowArchived(e.target.checked)}
                />
                {t('settings.workspace.show_archived')}
              </label>
            )}
            {/* **숨기지 않는다**(REQ-WEB-003) — 예전에는 조직 admin 이 아니면 단추가 그려지지
                않아, 프로젝트를 만들 수 있는지조차 알 수 없었다 */}
            <Button
              size="sm"
              data-testid="project-new"
              disabled={!canCreate}
              disabledReason={canCreate ? undefined : t('settings.workspace.project_new_locked')}
              onClick={() => setCreating(!creating)}
            >
              {creating ? t('common.cancel') : t('settings.workspace.project_new')}
            </Button>
          </span>
        }
      >
        {t('settings.workspace.projects')}
      </SectionTitle>

      {creating && (
        <ProjectForm
          orgSlug={orgSlug}
          autoFocus={openNew}
          onDone={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}

      {projects.length === 0 && !creating && (
        <EmptyState
          icon="◇"
          title={t('settings.workspace.no_projects')}
          action={
            canCreate ? (
              <Button size="sm" data-testid="project-new-empty" onClick={() => setCreating(true)}>
                {t('settings.workspace.project_new')}
              </Button>
            ) : null
          }
        />
      )}

      <ul className="flex flex-col">
        {projects.map((project) => (
          <ProjectRow
            key={String(project['id'])}
            project={project}
            canEdit={canEditProject(String(project['slug']))}
            onChanged={refresh}
          />
        ))}
      </ul>
    </div>
  );
}

/** 새 프로젝트 — slug·key·이름 셋이 필수다(서버가 같은 것을 요구한다 · EP-PRJ-02) */
function ProjectForm({
  orgSlug,
  autoFocus,
  onDone,
}: {
  orgSlug: string | null;
  /** 이 폼을 열려고 온 사람이다 — 이름 칸에서 시작한다 */
  autoFocus: boolean;
  onDone: () => void;
}): React.JSX.Element {
  const t = useT();
  const onApiError = useApiError();
  const { pushToast } = useRealtime();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [key, setKey] = useState('');

  const create = useMutation({
    mutationFn: () =>
      apiFetch(`/orgs/${orgSlug ?? ''}/projects`, {
        method: 'POST',
        body: { name, slug, key: key.toUpperCase() },
      }),
    onSuccess: () => {
      // **만든 프로젝트로 바로 갈 수 있게 한다**(REQ-WEB-205). 예전에는 토스트와 폼 닫기뿐이라, 방금 만든
      // 프로젝트를 따로 찾아 들어가야 했다
      pushToast({
        tone: 'ok',
        message: t('settings.workspace.project_created'),
        href: `/p/${slug}`,
        hrefLabel: t('shell.toast.open'),
      });
      onDone();
    },
    onError: onApiError,
  });

  // **이름에서 slug·key 를 만들어 준다.** 셋을 손으로 채우게 하면 사람은 매번 같은
  // 변환을 머릿속에서 한다 — 고칠 수 있게 두되 기본값은 준다.
  const onName = (value: string): void => {
    setName(value);
    const auto = slugFromName(value);
    setSlug(auto);
    setKey(projectKeyFromSlug(auto));
  };

  const ready = name.trim() !== '' && slug.trim() !== '' && key.trim() !== '';
  // **이름을 적었는데 주소가 비었으면 그 이유를 칸 아래에 적는다**(2026-09-25 · UI/UX 검토 SET-14). 주소는 이름의 영문·숫자로
  // 만든다 — 한글만 적으면 빈 값이 되고, 예전에는 [만들기]가 사유 없이 잠겼다(REQ-WEB-003). 이 제품의 주 언어가
  // 한국어라 흔히 만나는 자리다
  const slugNeeded = name.trim() !== '' && slug.trim() === '';

  return (
    <FieldRow className="mb-3 rounded-nerv border border-border bg-bg-elev px-4 py-3">
      <Field label={t('settings.workspace.project_name')}>
        <Input
          data-testid="project-name"
          autoFocus={autoFocus}
          value={name}
          onChange={(e) => onName(e.target.value)}
        />
      </Field>
      <Field
        label={t('settings.workspace.project_slug')}
        hint={t('settings.workspace.slug_hint')}
        error={slugNeeded ? t('settings.workspace.slug_needed') : undefined}
      >
        <Input
          data-testid="project-slug"
          value={slug}
          aria-invalid={slugNeeded}
          onChange={(e) => setSlug(e.target.value)}
          className="font-mono"
        />
      </Field>
      <Field label={t('settings.workspace.project_key')} hint={t('settings.workspace.key_hint')}>
        <Input
          data-testid="project-key"
          value={key}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
          className="w-24 font-mono"
        />
      </Field>
      {/* 버튼은 **입력 줄**에 둔다 — 라벨 줄도 힌트 줄도 아니다 */}
      <FieldRowAction>
        <Button
          variant="primary"
          data-testid="project-create"
          disabled={!ready || create.isPending}
          onClick={() => create.mutate()}
        >
          {t('common.create')}
        </Button>
      </FieldRowAction>
    </FieldRow>
  );
}

/** 널 가능한 열을 입력칸의 값으로 — `String(null)` 은 칸에 `"null"` 을 적는다 */
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function ProjectRow({
  project,
  canEdit,
  onChanged,
}: {
  project: Record<string, unknown>;
  canEdit: boolean;
  onChanged: () => void;
}): React.JSX.Element {
  const t = useT();
  // 실패는 표(§1.5)를 거쳐 알린다(REQ-WEB-196) — 예전에는 `error.message` 만 부모에게 넘겨
  // 토스트에 그대로 찍었고, 부류·재시도 시각·갈 곳이 그 사이에서 사라졌다.
  const onApiError = useApiError();
  const slug = String(project['slug']);
  const archived = project['archived_at'] !== null && project['archived_at'] !== undefined;
  const [name, setName] = useState(String(project['name']));
  // **저장소 주소를 넣을 자리가 화면에 없었다**(2026-09-10 — 사람 보고 · REQ-WEB-160).
  // 두 열은 처음부터 있었고 `PATCH /projects/{slug}` 도 처음부터 받았는데(EP-PRJ-04) 채울
  // 방법이 API 뿐이라, 작업 상세의 증적 링크(REQ-WEB-159)가 "저장소 주소가 없습니다" 라고
  // 알려 놓고 **고칠 곳은 알려 주지 못했다** — 더 갈 곳이 없는 화면이다(§1.5).
  //
  // 이것은 로드맵이 Phase 2 로 미룬 **git 연동 탭이 아니다**([4.1](scope.md) §3.4): 웹훅도
  // OAuth 도 clone 도 없고, 이미 있는 두 칸을 사람이 채울 수 있게 할 뿐이다.
  const [repoUrl, setRepoUrl] = useState(text(project['repo_url']));
  const [defaultBranch, setDefaultBranch] = useState(text(project['default_branch']));
  // **주소의 모양은 고르는 것이지 추정하는 것이 아니다**(2026-09-10 · REQ-WEB-162).
  // 도메인으로 짐작하면 자체 호스팅에서 반드시 틀린다 — `git.example.com` 은 GitHub 인지
  // GitLab 인지 알 수 없다. 열이 `NOT NULL DEFAULT 'github'` 이라 빈 값은 없다.
  const [repoHost, setRepoHost] = useState(text(project['repo_host']) || 'github');
  const [editing, setEditing] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${slug}`, {
        method: 'PATCH',
        // **빈 칸은 "지운다" 가 아니라 "비운다" 다.** 서버는 `coalesce(…, repo_url)` 로
        // null 을 "안 건드림" 으로 읽으므로(EP-PRJ-04), 사람이 지운 값을 그대로 보내려면
        // 빈 문자열이어야 한다 — null 을 보내면 지운 티가 안 나고 옛 주소가 살아남는다.
        body: {
          name,
          repo_url: repoUrl.trim(),
          default_branch: defaultBranch.trim(),
          repo_host: repoHost,
        },
      }),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
    onError: onApiError,
  });

  const archive = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${slug}/${archived ? 'restore' : 'archive'}`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: onChanged,
    onError: onApiError,
  });

  return (
    <li
      data-testid="project-row"
      data-archived={archived}
      className={cn(
        'flex flex-wrap items-center gap-3 border-b border-border py-3 last:border-b-0',
        archived && 'opacity-60',
      )}
    >
      {editing ? (
        <FieldRow className="w-full">
          <Field label={t('settings.workspace.project_name')}>
            <Input
              data-testid="project-name-edit"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="max-w-64"
            />
          </Field>
          {/* 증적의 커밋·코드 경로가 이 주소 위에서 열린다 — 왜 채우는지를 칸 옆에 적는다 */}
          <Field
            label={t('settings.workspace.repo_url')}
            hint={t('settings.workspace.repo_url_hint')}
          >
            <Input
              data-testid="project-repo-url"
              value={repoUrl}
              placeholder="https://github.com/org/repo"
              onChange={(e) => setRepoUrl(e.target.value)}
              className="min-w-64 font-mono"
            />
          </Field>
          {/* 값이 정하는 것은 **주소의 모양**이지 접속이 아니다 — 서버는 이 저장소에
              접속하지 않는다. 어휘의 정본은 `@nerv/schema` 의 `REPO_HOSTS` 다(REQ-CB-006) */}
          <Field
            label={t('settings.workspace.repo_host')}
            hint={t('settings.workspace.repo_host_hint')}
          >
            <Select
              data-testid="project-repo-host"
              value={repoHost}
              onChange={(e) => setRepoHost(e.target.value)}
              className="w-32"
            >
              {REPO_HOSTS.map((host) => (
                <option key={host} value={host}>
                  {host}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('settings.workspace.default_branch')}
            hint={t('settings.workspace.default_branch_hint')}
          >
            <Input
              data-testid="project-default-branch"
              value={defaultBranch}
              placeholder="main"
              onChange={(e) => setDefaultBranch(e.target.value)}
              className="w-32 font-mono"
            />
          </Field>
          <FieldRowAction className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              data-testid="project-save"
              disabled={name.trim() === '' || save.isPending}
              onClick={() => save.mutate()}
            >
              {t('common.save')}
            </Button>
            <Button size="sm" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
          </FieldRowAction>
        </FieldRow>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate font-medium">{String(project['name'])}</span>
          <Mono>{slug}</Mono>
          <Mono>{String(project['key'])}</Mono>
          {archived && (
            <span className="rounded-nerv-sm bg-status-idle px-1.5 py-0.5 text-2xs text-status-idle-text">
              {t('settings.workspace.archived')}
            </span>
          )}
          {/* 권한이 없으면 **숨기지 않고 비활성 + 사유**를 붙인다(REQ-WEB-003) */}
          <Button
            size="sm"
            data-testid="project-edit"
            disabled={!canEdit}
            disabledReason={canEdit ? undefined : t('settings.workspace.admin_only')}
            onClick={() => setEditing(true)}
          >
            {t('common.edit')}
          </Button>
          {archived ? (
            // 복구는 되돌리는 일이라 묻지 않는다
            <Button
              size="sm"
              data-testid="project-archive"
              disabled={!canEdit || archive.isPending}
              disabledReason={canEdit ? undefined : t('settings.workspace.admin_only')}
              onClick={() => archive.mutate()}
            >
              {t('settings.workspace.restore')}
            </Button>
          ) : (
            // **보관은 남에게 미친다**(REQ-WEB-200) — 복구할 수 있지만, 그 사이 이 프로젝트의
            // 결재 카드와 알림이 모든 사람의 화면에서 사라진다. 확인 창에 그 수를 적는다
            <ConfirmAction
              label={t('settings.workspace.archive')}
              testId="project-archive"
              disabled={!canEdit}
              title={t('settings.workspace.admin_only')}
              message={t('settings.workspace.archive_confirm', { name: String(project['name']) })}
              detail={t('settings.workspace.archive_detail', {
                n: Number(project['pending_approvals'] ?? 0),
              })}
              confirmLabel={t('settings.workspace.archive')}
              pending={archive.isPending}
              onConfirm={() => archive.mutate()}
            />
          )}
        </>
      )}
    </li>
  );
}
