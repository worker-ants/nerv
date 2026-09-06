// /settings/workspace — 조직·프로젝트 관리 (S8 · EP-ORG-03~05 · EP-PRJ-02·04·05)
//
// **두 축을 한 화면에서 다룬다.** 헤더의 select 두 개(조직 ▾ → 프로젝트 ▾)가 고르는
// 것을 여기서 만들고 고치고 치운다 — 고르는 곳과 관리하는 곳이 갈라지면 사람은 매번
// "이건 어디서 바꾸지"를 묻는다.
//
// **지우는 것과 치우는 것을 가른다.** 프로젝트는 **보관**한다(`archived_at`) — 그 아래
// 스펙·Task·리뷰가 달려 있고 그것을 지우는 것은 감사 기록을 지우는 일이다(FR-16).
// 조직은 **비어 있을 때만** 지운다: 되돌릴 수 없는 일 앞에 되돌릴 수 있는 단계(프로젝트
// 보관)를 하나 세운다.

import { useT } from '../../lib/i18n.js';
import { useApiError } from '../../lib/api-errors.js';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { rows, useMe, useProjects } from '../../lib/queries.js';
import { primaryMembership, rolesInOrg } from '../../lib/session.js';
import { useRealtime } from '../../lib/realtime.js';
import { cn } from '../../lib/utils.js';
import {
  Button,
  Card,
  EmptyState,
  Field,
  FieldRow,
  FieldRowAction,
  Input,
  Mono,
  SectionTitle,
} from '../../components/ui/primitives.js';

export const Route = createFileRoute('/settings/workspace')({ component: WorkspaceTab });

function WorkspaceTab(): React.JSX.Element {
  const t = useT();
  const me = useMe();
  const membership = me.data === undefined ? null : primaryMembership(me.data);
  const orgSlug = membership?.org_slug ?? null;
  // 조직 권한은 **그 조직의 모든 멤버십을 합쳐** 본다 — 한 행만 보면 조직
  // admin 인데 프로젝트에서 planner 인 사람이 잠긴다(겸직은 합집합이다)
  const isAdmin = rolesInOrg(me.data, orgSlug).includes('admin');
  // **보관한 프로젝트를 볼 길이 화면에 없었다**(사람 보고 2026-08-27). 복구 버튼은
  // 코드에 있었지만 목록이 보관을 빼고 오니 그 줄이 영영 그려지지 않았고, 그래서
  // 보관은 사실상 되돌릴 수 없는 일이었다.
  const [showArchived, setShowArchived] = useState(false);
  const projects = useProjects(orgSlug, showArchived);
  const projectRows = rows(projects.data);

  return (
    <section className="flex flex-col gap-8">
      {!isAdmin && (
        <p className="rounded-nerv border border-border bg-bg-sunken px-3 py-2 text-sm text-text-mute">
          {t('settings.workspace.admin_only')}
        </p>
      )}
      {/* **데이터가 온 뒤에 그린다.** `useState(name)` 은 첫 렌더의 값을 붙잡으므로
          me 가 늦게 오면 입력칸이 빈 채로 굳는다 — key 로 다시 만든다 */}
      <OrgSection
        key={membership?.org_name ?? ''}
        orgSlug={orgSlug}
        name={membership?.org_name ?? ''}
        canEdit={isAdmin}
      />
      <ProjectSection
        orgSlug={orgSlug}
        projects={projectRows}
        canEdit={isAdmin}
        showArchived={showArchived}
        onShowArchived={setShowArchived}
      />
    </section>
  );
}

/** 조직 — 이름 변경과 삭제. **slug 는 바꾸지 않는다**(링크의 축이다 · D-09) */
function OrgSection({
  orgSlug,
  name,
  canEdit,
}: {
  orgSlug: string | null;
  name: string;
  canEdit: boolean;
}): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();
  const [draft, setDraft] = useState(name);
  const [confirming, setConfirming] = useState(false);

  const rename = useMutation({
    mutationFn: () =>
      apiFetch(`/orgs/${orgSlug ?? ''}`, { method: 'PATCH', body: { name: draft } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      pushToast({ tone: 'ok', message: t('settings.workspace.org_renamed') });
    },
    onError: onApiError,
  });

  const remove = useMutation({
    mutationFn: () => apiFetch(`/orgs/${orgSlug ?? ''}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      void navigate({ to: '/' });
    },
    onError: (error: Error) => {
      setConfirming(false);
      pushToast({ tone: 'warn', message: error.message });
    },
  });

  return (
    <div>
      <SectionTitle>{t('settings.workspace.org')}</SectionTitle>
      <Card className="flex flex-col gap-3">
        <div className="flex items-end gap-2">
          <Field label={t('settings.workspace.org_name')}>
            <Input
              data-testid="org-name"
              value={draft}
              disabled={!canEdit}
              onChange={(e) => setDraft(e.target.value)}
            />
          </Field>
          <Button
            variant="primary"
            data-testid="org-rename"
            disabled={!canEdit || draft.trim() === '' || draft === name || rename.isPending}
            onClick={() => rename.mutate()}
          >
            {t('common.save')}
          </Button>
        </div>
        {/* slug 는 주소이고 API 경로다 — 바꾸면 밖에서 걸어 둔 링크가 전부 깨진다 */}
        <p className="text-2xs text-text-faint">
          {t('settings.workspace.slug_fixed')} <Mono>{orgSlug ?? '—'}</Mono>
        </p>

        <div className="border-t border-border pt-3">
          {!confirming ? (
            <Button
              variant="danger"
              size="sm"
              data-testid="org-delete"
              disabled={!canEdit}
              onClick={() => setConfirming(true)}
            >
              {t('settings.workspace.org_delete')}
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {/* 되돌릴 수 없는 일이라 한 번 더 묻는다 — 그리고 **왜 막힐 수 있는지**를
                  미리 말한다. 눌러 보고 나서 거절당하는 것보다 낫다 */}
              <span className="text-sm text-status-danger">
                {t('settings.workspace.org_delete_confirm')}
              </span>
              <Button
                variant="danger"
                size="sm"
                data-testid="org-delete-confirm"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                {t('common.delete')}
              </Button>
              <Button size="sm" onClick={() => setConfirming(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          )}
          <p className="mt-1.5 text-2xs text-text-faint">
            {t('settings.workspace.org_delete_rule')}
          </p>
        </div>
      </Card>
    </div>
  );
}

/** 프로젝트 — 만들기 · 이름 고치기 · 보관/복구 */
function ProjectSection({
  orgSlug,
  projects,
  showArchived,
  onShowArchived,
  canEdit,
}: {
  orgSlug: string | null;
  projects: Record<string, unknown>[];
  showArchived: boolean;
  onShowArchived: (next: boolean) => void;
  canEdit: boolean;
}): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const [creating, setCreating] = useState(false);

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['org', orgSlug, 'projects'] });
  };

  return (
    <div>
      <SectionTitle
        action={
          canEdit ? (
            <span className="flex items-center gap-3">
              {/* 보관을 **볼 수 있어야** 복구할 수 있다 — 켜면 목록이 보관까지 담는다 */}
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
              <Button size="sm" data-testid="project-new" onClick={() => setCreating(!creating)}>
                {creating ? t('common.cancel') : t('settings.workspace.project_new')}
              </Button>
            </span>
          ) : undefined
        }
      >
        {t('settings.workspace.projects')}
      </SectionTitle>

      {creating && (
        <ProjectForm
          orgSlug={orgSlug}
          onDone={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}

      {projects.length === 0 && !creating && (
        <EmptyState icon="◇" title={t('settings.workspace.no_projects')} />
      )}

      <ul className="flex flex-col">
        {projects.map((project) => (
          <ProjectRow
            key={String(project['id'])}
            project={project}
            canEdit={canEdit}
            onChanged={refresh}
            onError={(m) => pushToast({ tone: 'warn', message: m })}
          />
        ))}
      </ul>
    </div>
  );
}

/** 새 프로젝트 — slug·key·이름 셋이 필수다(서버가 같은 것을 요구한다 · EP-PRJ-02) */
function ProjectForm({
  orgSlug,
  onDone,
}: {
  orgSlug: string | null;
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
      pushToast({ tone: 'ok', message: t('settings.workspace.project_created') });
      onDone();
    },
    onError: onApiError,
  });

  // **이름에서 slug·key 를 만들어 준다.** 셋을 손으로 채우게 하면 사람은 매번 같은
  // 변환을 머릿속에서 한다 — 고칠 수 있게 두되 기본값은 준다.
  const onName = (value: string): void => {
    setName(value);
    const auto = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    setSlug(auto);
    setKey(auto.replace(/-/g, '').slice(0, 3).toUpperCase());
  };

  const ready = name.trim() !== '' && slug.trim() !== '' && key.trim() !== '';

  return (
    <FieldRow className="mb-3 rounded-nerv border border-border bg-bg-elev px-4 py-3">
      <Field label={t('settings.workspace.project_name')}>
        <Input data-testid="project-name" value={name} onChange={(e) => onName(e.target.value)} />
      </Field>
      <Field label={t('settings.workspace.project_slug')} hint={t('settings.workspace.slug_hint')}>
        <Input
          data-testid="project-slug"
          value={slug}
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
      {/* 버튼은 **입력 줄**에 선다 — 라벨 줄도 힌트 줄도 아니다 */}
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

function ProjectRow({
  project,
  canEdit,
  onChanged,
  onError,
}: {
  project: Record<string, unknown>;
  canEdit: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
}): React.JSX.Element {
  const t = useT();
  const slug = String(project['slug']);
  const archived = project['archived_at'] !== null && project['archived_at'] !== undefined;
  const [name, setName] = useState(String(project['name']));
  const [editing, setEditing] = useState(false);

  const save = useMutation({
    mutationFn: () => apiFetch(`/projects/${slug}`, { method: 'PATCH', body: { name } }),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
    onError: (error: Error) => onError(error.message),
  });

  const archive = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${slug}/${archived ? 'restore' : 'archive'}`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: onChanged,
    onError: (error: Error) => onError(error.message),
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
        <>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="max-w-64" />
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
        </>
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
            title={canEdit ? undefined : t('settings.workspace.admin_only')}
            onClick={() => setEditing(true)}
          >
            {t('common.edit')}
          </Button>
          <Button
            size="sm"
            variant={archived ? 'default' : 'danger'}
            data-testid="project-archive"
            disabled={!canEdit || archive.isPending}
            title={canEdit ? undefined : t('settings.workspace.admin_only')}
            onClick={() => archive.mutate()}
          >
            {archived ? t('settings.workspace.restore') : t('settings.workspace.archive')}
          </Button>
        </>
      )}
    </li>
  );
}
