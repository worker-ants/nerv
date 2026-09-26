// /settings/org — 조직 정보 (S8 · EP-ORG-03~05)
//
// **조직과 프로젝트를 나눈다**(2026-09-26 — 사람 지시 · REQ-WEB-242). 예전에는 한 화면 "조직·프로젝트" 가 조직
// 이름·삭제·새 조직과 프로젝트 목록을 함께 다뤘고, 설정 메뉴에서는 조직 무리에만 있었다. 프로젝트 목록은 이제
// 프로젝트 무리의 `/settings/projects` 에 있다.
//
// 조직은 **비어 있을 때만** 지운다. 되돌릴 수 없는 일 앞에 되돌릴 수 있는 단계(프로젝트 보관)를 하나 둔다.

import { useT } from '../../lib/i18n.js';
import { useApiError } from '../../lib/api-errors.js';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { CreateOrgForm } from '../../features/org/create-org-form.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { rows, useMe, useMembers, useProjects } from '../../lib/queries.js';
import { useScope } from '../../lib/scope.js';
import { canManageScope } from '../../lib/session.js';
import { useRealtime } from '../../lib/realtime.js';
import {
  Button,
  Card,
  Field,
  Input,
  Mono,
  PageHeader,
  SectionTitle,
} from '../../components/ui/primitives.js';
import { ConfirmAction } from '../../components/ui/confirm-action.js';
import { ReadOnlyNotice, scopeAdmins } from '../../components/read-only-notice.js';

export const Route = createFileRoute('/settings/org')({ component: OrgTab });

function OrgTab(): React.JSX.Element {
  const t = useT();
  const me = useMe();
  // **지금 조직은 `useScope()` 한 곳에서 온다**(§1.8 · REQ-WEB-076). 따로 고르면 헤더에서 두 번째 조직을 골라도
  // 이 화면은 첫 조직을 고친다
  const { orgSlug, orgName } = useScope();
  // **조직 수준 조작은 조직 admin 만**(2026-09-24 사람 결정 · REQ-API-169 확장)
  const isOrgAdmin = canManageScope(me.data, orgSlug, null);
  // 누구에게 부탁할지 — 조직 수준은 조직 admin 이다(REQ-WEB-201)
  const members = useMembers(orgSlug);

  return (
    <section className="flex flex-col gap-8">
      {/* 제목에 조직 이름이 있다(SET-06 · REQ-WEB-227) — 입력칸의 값만으로는 어느 조직인지 알기 어렵다 */}
      <PageHeader title={t('settings.workspace.title_org', { org: orgName ?? orgSlug ?? '' })} />
      {!isOrgAdmin && (
        <ReadOnlyNotice
          admins={members.data === undefined ? undefined : scopeAdmins(rows(members.data), null)}
        >
          {t('settings.workspace.org_admin_only')}
        </ReadOnlyNotice>
      )}
      {/* **데이터가 온 뒤에 그린다.** `useState(name)` 은 첫 렌더의 값을 붙잡으므로
          me 가 늦게 오면 입력칸이 빈 채로 굳는다 — key 로 다시 만든다 */}
      <OrgSection key={orgName ?? ''} orgSlug={orgSlug} name={orgName ?? ''} canEdit={isOrgAdmin} />
      <NewOrgSection />
    </section>
  );
}

/** 조직 — 이름 변경과 삭제. **slug 는 바꾸지 않는다**(링크의 기준이다 · D-09) */
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
  // **지울 수 있는지는 누르기 전에 알린다**(2026-09-24 — UI/UX 검토 · REQ-WEB-201). 서버는 보관한 프로젝트까지
  // 세서 거절한다(`deleteOrg`). 예전 안내는 "먼저 프로젝트를 보관하세요" 였고, 따라 한 admin 은 모든 사람의 결재
  // 카드와 알림을 숨기고도 조직을 지우지 못했다
  const everything = useProjects(canEdit ? orgSlug : null, true);
  const all = rows(everything.data);
  const archivedCount = all.filter(
    (p) => p['archived_at'] !== null && p['archived_at'] !== undefined,
  ).length;
  // 세기 전에는 지울 수 있다고 하지 않는다 — 목록이 오기 전의 0 은 "없다" 가 아니다(REQ-WEB-198)
  const counted = everything.data !== undefined;
  const blockedByProjects = !counted || all.length > 0;

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
    onError: onApiError,
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
            disabledReason={canEdit ? undefined : t('settings.workspace.admin_only')}
            onClick={() => rename.mutate()}
          >
            {t('common.save')}
          </Button>
        </div>
        {/* slug 는 주소이고 API 경로다 — 바꾸면 밖에 공유한 링크가 모두 깨진다 */}
        <p className="text-2xs text-text-faint">
          {t('settings.workspace.slug_fixed')} <Mono>{orgSlug ?? '—'}</Mono>
        </p>

        <div className="border-t border-border pt-3">
          {/* 되돌릴 수 없는 일이라 한 번 더 묻는다(REQ-WEB-200 · confirm-action.tsx) */}
          <ConfirmAction
            label={t('settings.workspace.org_delete')}
            testId="org-delete"
            disabled={!canEdit || blockedByProjects}
            title={
              !canEdit
                ? t('settings.workspace.admin_only')
                : counted
                  ? t('settings.workspace.org_delete_blocked', {
                      n: all.length,
                      archived: archivedCount,
                    })
                  : undefined
            }
            message={t('settings.workspace.org_delete_confirm', { org: name })}
            confirmLabel={t('common.delete')}
            pending={remove.isPending}
            onConfirm={() => remove.mutate()}
          />
          <p data-testid="org-delete-rule" className="mt-1.5 text-2xs text-text-faint">
            {canEdit && counted && all.length > 0
              ? t('settings.workspace.org_delete_blocked', {
                  n: all.length,
                  archived: archivedCount,
                })
              : t('settings.workspace.org_delete_rule')}
          </p>
        </div>
      </Card>
    </div>
  );
}

/**
 * 새 조직 — **누구나** 만든다(EP-ORG-03 · 만든 사람이 admin 이 된다). 2026-09-24 사람 결정(SET-08).
 *
 * 헤더 조직 메뉴의 "조직 관리 · 새 조직" 이 이 화면으로 온다. 접어 둔다: 조직이 나뉘면 스펙도 나뉘므로 자주 누를
 * 단추가 아니고, 그 안내를 폼 옆에 함께 둔다. 만들면 **그 조직으로 옮겨 간다** — 첫 프로젝트를 같이 만들었으면
 * 그 프로젝트로, 아니면 프로젝트 목록의 만들기 폼으로(REQ-WEB-205).
 */
function NewOrgSection(): React.JSX.Element {
  const t = useT();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="new-org">
      <SectionTitle
        action={
          <Button size="sm" data-testid="new-org-toggle" onClick={() => setOpen(!open)}>
            {open ? t('common.cancel') : t('settings.workspace.new_org_open')}
          </Button>
        }
      >
        {t('settings.workspace.new_org')}
      </SectionTitle>
      <p className="text-sm text-text-mute">{t('settings.workspace.new_org_lead')}</p>
      {open && (
        <div className="mt-2 rounded-nerv border border-border bg-bg-elev px-4 py-3">
          <CreateOrgForm
            onCreated={(org, project) => {
              void navigate({
                to: '/o/$org',
                params: { org },
                search: { next: project === null ? '/settings/projects?new=1' : `/p/${project}` },
              });
            }}
          />
          <p className="mt-3 text-xs text-text-faint">{t('onboarding.step1_wait')}</p>
        </div>
      )}
    </div>
  );
}
