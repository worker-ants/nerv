// 작업 보관 — 정본: docs/04-mvp/screens.md REQ-WEB-301 · 302 · api.md REQ-API-284~286
//
// **진행하지 않기로 한 작업을 정리할 길이 없었다**(2026-10-10 · clemvion CLE-T-V54M21 · 2K6CDJ · CYS6YF). 작업에는
// 보관도 취소도 없어, 다른 작업으로 대체된 중복이 백로그에 그대로 남았다. 보관은 상태와 따로 간다 — 보관한 작업은
// 보드 · 작업 큐 · 클레임에서 빠지고 키로는 그대로 열린다. 사유마다 필요한 칸(대신할 작업 · 메모)과 누가 할 수 있는지는
// 서버가 판정한다. 화면은 같은 규칙으로 미리 잠근다.

import { TASK_ARCHIVE_REASONS, TASK_ARCHIVE_REPLACED_REASONS } from '@nerv/schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { useApiError } from '../../lib/api-errors.js';
import { relativeTime, taskArchiveReasonText } from '../../lib/format.js';
import { useT } from '../../lib/i18n.js';
import { usePressKey } from '../../lib/press-key.js';
import type { Row } from '../../lib/queries.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import { EntityLink } from '../../components/entity-link.js';
import { Button, Input, Textarea } from '../../components/ui/primitives.js';

const needsReplacement = (reason: string): boolean =>
  (TASK_ARCHIVE_REPLACED_REASONS as readonly string[]).includes(reason);

/** 보관한 작업의 알림줄 — 사유 · 대신할 작업 · 누가 언제 · [복원] */
export function ArchivedNotice({
  proj,
  taskParam,
  task,
  canRestore,
  restoreLockedReason,
}: {
  proj: string;
  /** 페이지가 작업을 읽은 경로 인자 — 같은 쿼리 키를 무효화한다 */
  taskParam: string;
  task: Row;
  canRestore: boolean;
  restoreLockedReason?: string | undefined;
}): React.JSX.Element {
  const t = useT();
  const onError = useApiError();
  const { pushToast } = useRealtime();
  const queryClient = useQueryClient();
  const press = usePressKey('restore');
  const restore = useMutation({
    mutationFn: () =>
      apiFetch<Record<string, unknown>>(`/projects/${proj}/tasks/${taskParam}/restore`, {
        method: 'POST',
        idempotencyKey: press.take(),
      }),
    onSettled: press.release,
    onSuccess: () => {
      pushToast({ tone: 'ok', message: t('task.archive.restored') });
      // 대신할 작업 · 기다리던 작업의 상세도 바뀌었다(의존을 옮기거나 풀었다) — 작업 상세 전부를 다시 읽는다
      void queryClient.invalidateQueries({ queryKey: [queryKeys.task(taskParam)[0]] });
    },
    onError,
  });
  const replacement = typeof task['superseded_by'] === 'string' ? task['superseded_by'] : null;
  const note = typeof task['archive_note'] === 'string' ? task['archive_note'] : null;
  return (
    <div
      role="status"
      data-testid="task-archived"
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-nerv-sm bg-bg-sunken px-3 py-2 text-sm"
    >
      <span className="font-medium text-text">
        {t('task.archive.notice', {
          reason: taskArchiveReasonText(t, task['archive_reason']),
          by: String(task['archived_by_name'] ?? ''),
          at: relativeTime(t, typeof task['archived_at'] === 'string' ? task['archived_at'] : null),
        })}
      </span>
      {replacement !== null && (
        <span className="text-text-mute">
          {t('task.archive.replaced_by')}{' '}
          <EntityLink
            projectSlug={proj}
            entity={{ kind: 'task', key: replacement }}
            testId="task-archived-replacement"
            className="font-mono text-link hover:underline"
          >
            {replacement}
          </EntityLink>
        </span>
      )}
      {note !== null && <span className="text-text-mute">— {note}</span>}
      <Button
        size="sm"
        className="ml-auto"
        data-testid="task-restore"
        disabled={!canRestore || restore.isPending}
        disabledReason={canRestore ? undefined : restoreLockedReason}
        requiresOnline
        onClick={() => restore.mutate()}
      >
        {t('task.archive.restore')}
      </Button>
    </div>
  );
}

/**
 * 보관 폼 — 머리의 [보관]이 연다. 사유 넷 가운데 하나를 고르고, 중복 · 대체면 대신할 작업의 키를, 필요 없어짐 · 하지
 * 않음이면 이유 한 줄을 받는다. 보관하면 보드에서 빠지므로 무엇이 일어나는지 폼 안에 적는다
 */
export function ArchiveTaskForm({
  proj,
  taskParam,
  onClose,
}: {
  proj: string;
  taskParam: string;
  onClose: () => void;
}): React.JSX.Element {
  const t = useT();
  const onError = useApiError();
  const { pushToast } = useRealtime();
  const queryClient = useQueryClient();
  const press = usePressKey('archive');
  const [reason, setReason] = useState<string>('duplicate');
  const [replacement, setReplacement] = useState('');
  const [note, setNote] = useState('');
  const replaced = needsReplacement(reason);
  const ready = replaced ? replacement.trim() !== '' : note.trim() !== '';

  const archive = useMutation({
    mutationFn: () =>
      apiFetch<Record<string, unknown>>(`/projects/${proj}/tasks/${taskParam}/archive`, {
        method: 'POST',
        body: {
          reason,
          ...(replaced ? { superseded_by: replacement.trim() } : {}),
          ...(note.trim() === '' ? {} : { note: note.trim() }),
        },
        idempotencyKey: press.take(),
      }),
    onSettled: press.release,
    onSuccess: () => {
      pushToast({ tone: 'ok', message: t('task.archive.done') });
      // 대신할 작업 · 기다리던 작업의 상세도 바뀌었다(의존을 옮기거나 풀었다) — 작업 상세 전부를 다시 읽는다
      void queryClient.invalidateQueries({ queryKey: [queryKeys.task(taskParam)[0]] });
      onClose();
    },
    onError,
  });

  return (
    <div
      data-testid="task-archive-form"
      className="mb-4 flex flex-col gap-2 rounded-nerv-sm border border-border p-3"
    >
      <p className="text-xs font-medium text-text">{t('task.archive.title')}</p>
      <p className="text-xs text-text-mute">{t('task.archive.hint')}</p>
      <fieldset className="flex flex-wrap gap-3 text-sm">
        <legend className="sr-only">{t('task.archive.reason')}</legend>
        {TASK_ARCHIVE_REASONS.map((value) => (
          <label key={value} className="flex items-center gap-1.5">
            <input
              type="radio"
              name="archive-reason"
              data-testid={`task-archive-reason-${value}`}
              checked={reason === value}
              onChange={() => setReason(value)}
            />
            {taskArchiveReasonText(t, value)}
          </label>
        ))}
      </fieldset>
      {replaced && (
        <label className="flex flex-col gap-1 text-xs text-text-mute">
          {t('task.archive.replacement')}
          <Input
            data-testid="task-archive-replacement"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder={t('task.archive.replacement_placeholder')}
            className="font-mono"
          />
        </label>
      )}
      <Textarea
        data-testid="task-archive-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t(replaced ? 'task.archive.note_optional' : 'task.archive.note_required')}
        rows={2}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="primary"
          data-testid="task-archive-submit"
          disabled={!ready || archive.isPending}
          requiresOnline
          onClick={() => archive.mutate()}
        >
          {t('task.archive.submit')}
        </Button>
        <Button size="sm" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}
