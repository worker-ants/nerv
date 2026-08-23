// 스펙 메타 다이얼로그 — 제목·부모 이동·정렬·아카이브 (REQ-WEB-038·039 · EP-SPEC-15~17)
//
// **이동은 이력을 끊지 않는다**(FR-01). 그 사실을 화면이 말해야 사람이 옮길 용기를 낸다 —
// 문서를 옮기면 링크가 깨진다고 믿으면 트리는 처음 만든 모양 그대로 굳는다.
//
// 두 개의 409 를 각각 다르게 다룬다:
//   `tree_cycle`     — 어느 하위로의 이동이 막혔는지 지목한다(막연한 거부는 벽이다)
//   `archive_blocked` — 무엇을 먼저 정리해야 하는지 목록으로 준다

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { NERV_ERROR } from '@nerv/schema';
import { apiFetch, NervApiError } from '../../lib/api.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import { Button, Field, Input } from '../../components/ui/primitives.js';

export interface MetaDialogProps {
  projectSlug: string;
  projectId: string | undefined;
  specKey: string;
  title: string;
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
  canEdit,
  onClose,
}: MetaDialogProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const [newTitle, setNewTitle] = useState(title);
  const [parentKey, setParentKey] = useState('');
  const [cycleError, setCycleError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<Blocker[] | null>(null);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.spec(specKey) });
    if (projectId !== undefined) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectSpecTree(projectId) });
    }
  };

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${projectSlug}/specs/${specKey}`, {
        method: 'PATCH',
        body: {
          title: newTitle,
          ...(parentKey.trim() === '' ? {} : { parent_key: parentKey.trim() }),
        },
      }),
    onSuccess: () => {
      setCycleError(null);
      invalidate();
      pushToast({ tone: 'ok', message: '메타를 저장했습니다 — 버전·관계·코멘트는 그대로입니다.' });
      onClose();
    },
    onError: (error: Error) => {
      if (error instanceof NervApiError && error.body.details['kind'] === 'tree_cycle') {
        setCycleError(
          `${String(error.body.details['parent'])} 은(는) ${specKey} 의 하위입니다 — 자기 아래로는 옮길 수 없습니다.`,
        );
        return;
      }
      pushToast({ tone: 'warn', message: error.message });
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
        message: '아카이브했습니다 — 삭제가 아니라 기본 조회에서만 빠집니다.',
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
      pushToast({ tone: 'warn', message: error.message });
    },
  });

  return (
    <div
      role="dialog"
      aria-label="스펙 메타"
      data-testid="meta-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-text/20 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-nerv-lg border border-border bg-bg-elev p-5 shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-lg font-semibold tracking-tight">스펙 메타 — {specKey}</h2>
        <p className="mb-3 text-xs text-text-mute">
          이동·개명해도 버전·관계·코멘트는 그대로 유지됩니다(FR-01).
        </p>

        {!canEdit && (
          <p className="mb-3 rounded-nerv-sm bg-status-waiting-soft px-2 py-1.5 text-sm text-status-waiting">
            메타 편집은 <code className="font-mono">planner</code>·
            <code className="font-mono">admin</code> 만 가능합니다 — 아래는 읽기 전용입니다.
          </p>
        )}

        <div className="mb-3 flex flex-col gap-3">
          <Field label="제목">
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              disabled={!canEdit}
            />
          </Field>
          <Field label="부모 스펙 키" hint="비우면 현재 위치를 유지합니다">
            <Input
              value={parentKey}
              onChange={(e) => setParentKey(e.target.value)}
              disabled={!canEdit}
              placeholder="SPC-…"
              className="font-mono"
            />
          </Field>
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
            <p className="font-medium text-status-danger">
              아카이브할 수 없습니다 — 먼저 정리하세요
            </p>
            <ul className="mt-1 text-xs text-text-mute">
              {blockers.map((b) => (
                <li key={`${b.kind}-${b.key}`}>
                  {b.kind === 'child_spec' ? '하위 스펙' : '활성 클레임 Task'} · {b.key}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button
            variant="primary"
            data-testid="meta-save"
            disabled={!canEdit || save.isPending}
            onClick={() => save.mutate()}
          >
            저장
          </Button>
          <Button
            variant="danger"
            data-testid="meta-archive"
            disabled={!canEdit || archive.isPending}
            onClick={() => archive.mutate()}
            title="삭제가 아닙니다 — 기본 조회에서만 빠지고 링크·이력은 남습니다"
          >
            아카이브
          </Button>
          <Button variant="ghost" className="ml-auto" onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>
    </div>
  );
}
