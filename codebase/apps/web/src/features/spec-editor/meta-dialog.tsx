// 스펙 메타 다이얼로그 — 제목·부모 이동·정렬·아카이브 (REQ-WEB-038·039 · EP-SPEC-15~17)
//
// **명세의 칸 넷을 모두 둔다**(2026-09-28 · REQ-WEB-267): 제목 · 부모(트리에서 고른다) · 정렬 키 ·
// 주인 역할. 예전에는 제목과 "상위 문서 키" 입력 둘뿐이라 부모를 옮기려면 키를 외워 쳐야 했고,
// 지금 부모가 무엇인지도 보이지 않았으며, 정렬 키와 주인 역할은 API 가 받는데 화면에 칸이 없었다.
//
// **이동은 이력을 끊지 않는다**(FR-01). 그 사실을 화면이 말해야 사람이 옮길 용기를 낸다 —
// 문서를 옮기면 링크가 깨진다고 믿으면 트리는 처음 만든 모양 그대로 굳는다.
//
// 두 개의 409 를 각각 다르게 다룬다:
//   `tree_cycle`     — 어느 하위로의 이동이 막혔는지 지목한다(막연한 거부는 벽이다)
//   `archive_blocked` — 무엇을 먼저 정리해야 하는지 목록으로 준다

import { useT } from '../../lib/i18n.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { NERV_ERROR, ROLE_SCOPES } from '@nerv/schema';
import { apiFetch, NervApiError } from '../../lib/api.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useApiError } from '../../lib/api-errors.js';
import { rows, useSpecTree } from '../../lib/queries.js';
import { useRealtime } from '../../lib/realtime.js';
import { cn } from '../../lib/utils.js';
import { Button, Field, Input } from '../../components/ui/primitives.js';
import { ConfirmAction } from '../../components/ui/confirm-action.js';
import type { ProjectId } from '../../lib/query-keys.js';
import { Modal } from '../../components/ui/modal.js';

export interface MetaDialogProps {
  projectSlug: string;
  projectId: ProjectId | undefined;
  specKey: string;
  title: string;
  /** 지금의 메타 — 상세 응답이 준다(EP-SPEC-03). 없으면 맨 위 · 정하지 않음 */
  parentKey?: string | null;
  sortKey?: string | null;
  ownerRole?: string | null;
  /** planner·admin 만 편집한다 — 그 외 역할에는 비활성 + 사유(REQ-WEB-003·038) */
  canEdit: boolean;
  onClose: () => void;
}

interface Blocker {
  kind: string;
  key: string;
}

export function MetaDialog({
  projectSlug,
  projectId,
  specKey,
  title,
  parentKey = null,
  sortKey = null,
  ownerRole = null,
  canEdit,
  onClose,
}: MetaDialogProps): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();
  const [newTitle, setNewTitle] = useState(title);
  /** 고른 부모 — `undefined` 는 그대로, `null` 은 맨 위로 */
  const [parentChoice, setParentChoice] = useState<string | null | undefined>(undefined);
  const [newSortKey, setNewSortKey] = useState(sortKey ?? '');
  const [newOwnerRole, setNewOwnerRole] = useState(ownerRole ?? '');
  const [cycleError, setCycleError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<Blocker[] | null>(null);

  // Esc 로 닫힌다 — 다이얼로그의 기본 기대다(FreezeDialog 와 같은 규율). 안의 확인이 열려 있으면
  // Esc 는 확인만 닫는다(confirm-action.tsx 가 전파를 멈춘다)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.spec(specKey) });
    if (projectId !== undefined) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectSpecTree(projectId) });
    }
  };

  // **바뀐 칸만 보낸다** — 그대로인 값을 다시 보내면 서버가 바뀐 것으로 적는다(이벤트의 변경 목록)
  const changes: Record<string, unknown> = {
    ...(newTitle.trim() !== '' && newTitle.trim() !== title ? { title: newTitle.trim() } : {}),
    ...(parentChoice !== undefined && parentChoice !== parentKey
      ? { parent_key: parentChoice }
      : {}),
    ...(newSortKey.trim() !== '' && newSortKey.trim() !== (sortKey ?? '')
      ? { sort_key: newSortKey.trim() }
      : {}),
    ...(newOwnerRole !== '' && newOwnerRole !== (ownerRole ?? '')
      ? { owner_role: newOwnerRole }
      : {}),
  };
  const dirty = Object.keys(changes).length > 0;

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${projectSlug}/specs/${specKey}`, {
        method: 'PATCH',
        body: changes,
      }),
    onSuccess: () => {
      setCycleError(null);
      invalidate();
      pushToast({ tone: 'ok', message: t('spec.meta.saved') });
      onClose();
    },
    onError: (error: Error) => {
      if (error instanceof NervApiError && error.body.details['kind'] === 'tree_cycle') {
        setCycleError(
          t('spec.meta.cycle', {
            parent: String(error.body.details['parent']),
            key: specKey,
          }),
        );
        return;
      }
      onApiError(error);
    },
  });

  const archive = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${projectSlug}/specs/${specKey}/archive`, { method: 'POST', body: {} }),
    onSuccess: () => {
      setBlockers(null);
      invalidate();
      pushToast({
        tone: 'ok',
        message: t('spec.meta.archived'),
      });
      onClose();
    },
    onError: (error: Error) => {
      if (
        error instanceof NervApiError &&
        error.code === NERV_ERROR.PRECONDITION &&
        error.body.details['kind'] === 'archive_blocked'
      ) {
        setBlockers(error.body.details['blockers'] as Blocker[]);
        return;
      }
      onApiError(error);
    },
  });

  return (
    // **공용 모달이다**(REQ-WEB-224) — Esc 로 닫히지 않았고 aria-modal·첫 포커스가 없어 Tab 이 뒤로 샜다
    <Modal label={t('spec.meta.dialog')} onClose={onClose} testId="meta-dialog">
      <h2 className="mb-1 text-lg font-semibold tracking-tight">
        {t('spec.meta.title', { key: specKey })}
      </h2>
      <p className="mb-3 text-xs text-text-mute">{t('spec.meta.lead')}</p>

      {!canEdit && (
        <p className="mb-3 rounded-nerv-sm bg-status-waiting-soft px-2 py-1.5 text-sm text-status-waiting">
          {t('spec.meta.role_note_pre')} <code className="font-mono">planner</code>·
          <code className="font-mono">admin</code> {t('spec.meta.role_note_post')}{' '}
          {t('common.read_only_suffix')}
        </p>
      )}

      <div className="mb-3 flex flex-col gap-3">
        <Field label={t('spec.meta.title_field')}>
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            disabled={!canEdit}
          />
        </Field>
        {/* `Field` 는 칸 하나를 `<label>` 로 감싼다 — 찾기 칸과 고르는 목록이 함께 든 이 자리는
            라벨 하나에 담지 않고 같은 모양의 묶음으로 둔다 */}
        <div role="group" aria-labelledby="meta-parent-label" className="flex flex-col gap-1">
          <span id="meta-parent-label" className="text-xs font-medium text-text-mute">
            {t('spec.meta.parent_field')}
          </span>
          <ParentPicker
            projectSlug={projectSlug}
            projectId={projectId}
            specKey={specKey}
            current={parentKey}
            value={parentChoice === undefined ? parentKey : parentChoice}
            onChange={setParentChoice}
            disabled={!canEdit}
          />
          <span className="text-xs text-text-faint">{t('spec.meta.parent_hint')}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('spec.meta.sort_field')} hint={t('spec.meta.sort_hint')}>
            <Input
              data-testid="meta-sort-key"
              value={newSortKey}
              onChange={(e) => setNewSortKey(e.target.value)}
              disabled={!canEdit}
              className="font-mono"
            />
          </Field>
          <Field label={t('spec.meta.owner_field')} hint={t('spec.meta.owner_hint')}>
            <select
              data-testid="meta-owner-role"
              value={newOwnerRole}
              onChange={(e) => setNewOwnerRole(e.target.value)}
              disabled={!canEdit}
              className="h-9 w-full rounded-nerv-sm border border-border bg-bg-elev px-2 text-sm"
            >
              {/* 정하지 않은 채로만 고를 수 있다 — 한 번 정한 역할을 비우는 길은 API 에 없다 */}
              {ownerRole === null && <option value="">{t('spec.meta.owner_none')}</option>}
              {Object.keys(ROLE_SCOPES).map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      {cycleError !== null && (
        <p role="alert" data-testid="cycle-error" className="mb-2 text-sm text-status-danger">
          {cycleError}
        </p>
      )}

      {blockers !== null && (
        <div
          data-testid="archive-blocked"
          className="mb-3 rounded-nerv border border-status-danger bg-status-danger-soft p-2.5 text-sm"
        >
          <p className="font-medium text-status-danger">{t('spec.meta.archive_blocked')}</p>
          <ul className="mt-1 text-xs text-text-mute">
            {/* **정리할 것으로 가는 길**이다 — 누를 수 없는 키 글자만 두면 사람은 그 키를 외워
                  다른 화면에서 다시 찾아야 했다 */}
            {blockers.map((b) => (
              <li key={`${b.kind}-${b.key}`}>
                {b.kind === 'child_spec'
                  ? t('spec.meta.blocker.child')
                  : t('spec.meta.blocker.claim')}{' '}
                ·{' '}
                {b.kind === 'child_spec' ? (
                  <Link
                    to="/p/$proj/specs/$spec"
                    params={{ proj: projectSlug, spec: b.key }}
                    className="font-mono text-link hover:underline"
                    onClick={onClose}
                  >
                    {b.key}
                  </Link>
                ) : (
                  <Link
                    to="/p/$proj/tasks/$task"
                    params={{ proj: projectSlug, task: b.key }}
                    className="font-mono text-link hover:underline"
                    onClick={onClose}
                  >
                    {b.key}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button
          variant="primary"
          data-testid="meta-save"
          disabled={!canEdit || !dirty || save.isPending}
          disabledReason={canEdit ? undefined : t('spec.meta.edit_role')}
          onClick={() => save.mutate()}
        >
          {t('common.save')}
        </Button>
        {/* **보관도 한 번 묻는다**(§2.4 "[아카이브…] 확인" · REQ-WEB-200). 예전에는 누르는 즉시
              보관됐다 — 되살릴 수는 있지만(이 문서 주소의 [복구]) 그 길을 모르는 사람에게는
              문서가 목록에서 사라진 것이다 */}
        <ConfirmAction
          label={t('spec.meta.archive')}
          variant="danger"
          size="md"
          testId="meta-archive"
          disabled={!canEdit}
          // `title` 은 **잠긴 단추의 사유**다(confirm-action.tsx) — 설명("삭제가 아닙니다")을 여기 두면 잠긴 까닭으로 읽힌다
          title={t('spec.meta.edit_role')}
          tooltip={t('spec.meta.archive_title')}
          message={t('spec.meta.archive_confirm')}
          detail={t('spec.meta.archive_confirm_detail')}
          confirmLabel={t('spec.meta.archive')}
          pending={archive.isPending}
          onConfirm={() => archive.mutate()}
        />
        <Button variant="ghost" className="ml-auto" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
    </Modal>
  );
}

/**
 * **부모는 트리에서 고른다**(REQ-WEB-267). 자기 자신과 자기 아래 문서는 고를 수 없다 — 서버도
 * `tree_cycle` 로 막지만, 누른 뒤에 거절당하는 것보다 처음부터 잠겨 있는 편이 낫다.
 */
function ParentPicker({
  projectSlug,
  projectId,
  specKey,
  current,
  value,
  onChange,
  disabled,
}: {
  projectSlug: string;
  projectId: ProjectId | undefined;
  specKey: string;
  current: string | null;
  value: string | null;
  onChange: (next: string | null) => void;
  disabled: boolean;
}): React.JSX.Element {
  const t = useT();
  const tree = useSpecTree(projectSlug, projectId);
  const [query, setQuery] = useState('');
  const nodes = rows(tree.data).map((n) => ({
    id: String(n['id']),
    key: String(n['key']),
    title: String(n['title'] ?? ''),
    parent: n['parent_id'] == null ? null : String(n['parent_id']),
  }));
  // 트리 순서 그대로 펼친다 — 서버가 정렬 키 순으로 준다
  const children = new Map<string | null, typeof nodes>();
  for (const n of nodes) children.set(n.parent, [...(children.get(n.parent) ?? []), n]);
  const ordered: { node: (typeof nodes)[number]; depth: number }[] = [];
  const walk = (parent: string | null, depth: number): void => {
    for (const node of children.get(parent) ?? []) {
      ordered.push({ node, depth });
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  // 자기와 자기 아래 — 고를 수 없다
  const self = nodes.find((n) => n.key === specKey);
  const blocked = new Set<string>();
  const block = (id: string): void => {
    blocked.add(id);
    for (const c of children.get(id) ?? []) block(c.id);
  };
  if (self !== undefined) block(self.id);

  const q = query.trim().toLowerCase();
  const shown = ordered.filter(
    ({ node }) =>
      q === '' || node.key.toLowerCase().includes(q) || node.title.toLowerCase().includes(q),
  );
  const option = (
    key: string | null,
    label: React.ReactNode,
    depth: number,
    locked: boolean,
  ): React.JSX.Element => (
    <button
      key={key ?? '(root)'}
      type="button"
      role="radio"
      aria-checked={value === key}
      data-testid={key === null ? 'meta-parent-root' : `meta-parent-${key}`}
      disabled={disabled || locked}
      title={locked ? t('spec.meta.parent_locked') : undefined}
      onClick={() => onChange(key)}
      style={{ paddingLeft: 8 + depth * 12 }}
      className={cn(
        'flex w-full items-center gap-2 py-1 pr-2 text-left text-sm hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-50',
        value === key && 'bg-bg-active font-medium',
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-1.5">
      <p data-testid="meta-parent-current" className="text-xs text-text-mute">
        {t('spec.meta.parent_current')}{' '}
        <span className="font-mono">{current ?? t('spec.meta.parent_root')}</span>
      </p>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={disabled}
        placeholder={t('spec.meta.parent_search')}
        aria-label={t('spec.meta.parent_search')}
      />
      <div
        role="radiogroup"
        aria-label={t('spec.meta.parent_field')}
        data-testid="meta-parent-picker"
        className="max-h-48 overflow-y-auto rounded-nerv-sm border border-border py-1"
      >
        {q === '' && option(null, t('spec.meta.parent_root'), 0, false)}
        {shown.map(({ node, depth }) =>
          option(
            node.key,
            <>
              <span className="shrink-0 font-mono text-xs text-text-faint">{node.key}</span>
              <span className="min-w-0 truncate">{node.title}</span>
            </>,
            q === '' ? depth : 0,
            blocked.has(node.id),
          ),
        )}
      </div>
    </div>
  );
}
