// 첨부 패널 — 디자인 시안 (screens.md §2.4 · REQ-WEB-125)
//
// **시안이 문서 밖에 있으면 문서가 아니다.** 지금까지 시안은 슬랙이나 외부 링크로 떠돌았고,
// 그 링크는 스펙의 버전과 무관하게 바뀌었다 — "이 버전이 말하는 화면" 을 나중에 되짚을 수 없다.
//
// 본문에 넣는 일은 여기 없다 — 웹은 본문을 고치지 않고 에이전트가 쓴다(REQ-WEB-173).
// 패널은 올리고, 미리 보고, 받고, 지운다. **지난 버전 본문이 가리키는 첨부는 지우지 않고
// 내린다**(REQ-WEB-265) — 파일을 남겨 그 버전의 그림이 깨지지 않게 한다. 내린 첨부는 접어
// 두고 복원하거나, 가리키는 버전이 없으면 지운다.

import { useRef, useState } from 'react';
import { useApiError } from '../../lib/api-errors.js';
import { apiBase, apiHref } from '../../lib/config.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api.js';
import { rows, useSpecAttachments, useSpecHiddenAttachments } from '../../lib/queries.js';
import { useT } from '../../lib/i18n.js';
import { useRealtime } from '../../lib/realtime.js';
import { cn } from '../../lib/utils.js';
import { ConfirmAction } from '../../components/ui/confirm-action.js';
import { Button } from '../../components/ui/primitives.js';

/** 서버와 같은 화이트리스트 — 고르개가 아닌 것을 보여 주면 올린 뒤에야 거부당한다 */
const ACCEPT =
  'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,application/pdf,text/html,text/plain,application/zip';

export function AttachmentPanel({
  projectSlug,
  specKey,
  canEdit,
}: {
  projectSlug: string;
  specKey: string;
  canEdit: boolean;
}): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();
  const attachments = useSpecAttachments(projectSlug, specKey);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file, file.name);
      // multipart 는 `apiFetch` 의 JSON 경로를 타지 않는다 — content-type 을 브라우저가 정한다
      const res = await fetch(
        `${apiBase()}/api/v1/projects/${projectSlug}/specs/${specKey}/attachments`,
        { method: 'POST', body: form, credentials: 'include' },
      );
      if (!res.ok) throw new Error(String((await res.json())?.error?.message ?? res.statusText));
      return (await res.json()) as Record<string, unknown>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['spec', specKey, 'attachments'] });
      pushToast({ tone: 'ok', message: t('spec.attach.done') });
    },
    onError: onApiError,
  });

  // **첨부 삭제는 되돌릴 수 없다** — 가리키는 버전이 없으면 서버가 저장소 객체와 행을 함께
  // 지운다. 가리키는 버전이 있으면 내리기만 하고, 무엇을 했는지 응답이 알린다(REQ-API-231).
  // 예전에는 실패해도 말이 없었다(지금은 기본 처리기가 말한다 · REQ-WEB-196)
  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch<Record<string, unknown>>(`/projects/${projectSlug}/attachments/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['spec', specKey, 'attachments'] });
      pushToast({
        tone: 'ok',
        message: t(result['deleted'] === true ? 'spec.attach.deleted_ok' : 'spec.attach.hidden_ok'),
      });
    },
    onError: onApiError,
  });

  // 내리기는 되돌릴 수 있다 — 복원에 확인을 두지 않는 이유다
  const restore = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/projects/${projectSlug}/attachments/${id}/restore`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['spec', specKey, 'attachments'] });
      pushToast({ tone: 'ok', message: t('spec.attach.restored_ok') });
    },
    onError: onApiError,
  });

  const items = rows(attachments.data);
  const hiddenQuery = useSpecHiddenAttachments(projectSlug, specKey, canEdit);
  const hiddenItems = rows(hiddenQuery.data);
  const [showHidden, setShowHidden] = useState(false);

  /** 이 첨부를 본문에 가진 버전 — `v4, v5` 로 적는다 */
  const versionsOf = (item: Record<string, unknown>): number[] =>
    Array.isArray(item['referenced_by_versions'])
      ? (item['referenced_by_versions'] as unknown[]).map(Number)
      : [];
  const versionLabel = (versions: number[]): string => versions.map((v) => `v${v}`).join(', ');

  /** [삭제] — 가리키는 버전이 없을 때만 파일까지 지운다 */
  const deleteAction = (id: string, name: string): React.JSX.Element => (
    <ConfirmAction
      testIdBase="attach-remove"
      message={t('spec.attach.remove_confirm', { name })}
      detail={t('spec.attach.remove_detail')}
      confirmLabel={t('common.delete')}
      pending={remove.isPending}
      onConfirm={() => remove.mutate(id)}
      trigger={({ open, ref, disabled }) => (
        <Button
          size="xs"
          variant="subtle"
          ref={ref}
          data-testid="attach-remove"
          disabled={disabled}
          onClick={open}
          className="text-text-faint hover:text-status-danger"
        >
          {t('common.delete')}
        </Button>
      )}
    />
  );

  return (
    <div className="flex flex-col gap-2 px-2">
      {canEdit && (
        <div
          data-testid="attach-drop"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file !== undefined) upload.mutate(file);
          }}
          className={cn(
            'rounded-nerv border border-dashed px-3 py-3 text-center text-2xs transition-colors',
            dragging ? 'border-status-action text-status-action' : 'border-border text-text-faint',
          )}
        >
          {t('spec.attach.hint')}
          <button
            type="button"
            data-testid="attach-pick"
            onClick={() => inputRef.current?.click()}
            className="ml-1.5 text-link hover:underline"
          >
            {t('spec.attach.pick')}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file !== undefined) upload.mutate(file);
              e.target.value = '';
            }}
          />
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {items.map((item) => {
          const id = String(item['id']);
          // **본문에 남는 주소와 브라우저가 부르는 주소가 다르다.** 서버가 주는 주소는
          // 상대 경로이고(REQ-API-089) 에이전트가 본문(md)에 그대로 넣는다 — 절대 주소를 박으면
          // 그 문서가 이 배치에 묶인다. 대신 화면이 **자기가 부를 때만** 오리진을 붙인다:
          // `<img src>`·`<a href>` 는 `apiFetch` 를 타지 않아, 상대 경로면 브라우저가
          // 화면이 뜬 오리진으로 해소한다 — 호스트를 가른 배치에는 그쪽에 API 가 없다
          // (REQ-WEB-166 · 2026-09-21 사람 보고: 첨부 링크가 `app.` 호스트로 갔다).
          const path = `/api/v1/projects/${projectSlug}/attachments/${id}`;
          const url = apiHref(path);
          const isImage = String(item['content_type']).startsWith('image/');
          const versions = versionsOf(item);
          return (
            <li key={id} data-testid="attachment" className="rounded-nerv border border-border p-2">
              {/* **보이는 것이 먼저다** — 시안은 파일 이름이 아니라 그림으로 알아본다.
                  SVG 도 `<img>` 로 부른다: 그 경로에서는 스크립트가 실행되지 않는다 */}
              {isImage && (
                <img
                  src={url}
                  alt={String(item['filename'])}
                  className="mb-1.5 max-h-40 w-full rounded-nerv-sm bg-bg-sunken object-contain"
                />
              )}
              <div className="flex items-center gap-2 text-2xs">
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate text-link hover:underline"
                >
                  {String(item['filename'])}
                </a>
                <span className="shrink-0 text-text-faint">
                  {item['is_agent'] === true ? '🤖' : '👤'} {String(item['uploaded_by'] ?? '')}
                </span>
              </div>
              {/* 지우기만 남았다 — 편집할 수 없으면 줄 자체를 두지 않는다. 지난 버전 본문이
                  가리키면 단추부터 [내리기]다: [삭제]를 눌렀는데 파일이 남으면 그것이 혼동이다 */}
              {canEdit && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {versions.length > 0 ? (
                    <ConfirmAction
                      testIdBase="attach-hide"
                      message={t('spec.attach.hide_confirm', { name: String(item['filename']) })}
                      detail={t('spec.attach.hide_detail', { versions: versionLabel(versions) })}
                      confirmLabel={t('spec.attach.hide')}
                      pending={remove.isPending}
                      onConfirm={() => remove.mutate(id)}
                      trigger={({ open, ref, disabled }) => (
                        <Button
                          size="xs"
                          variant="subtle"
                          ref={ref}
                          data-testid="attach-hide"
                          disabled={disabled}
                          onClick={open}
                          className="text-text-faint hover:text-text"
                        >
                          {t('spec.attach.hide')}
                        </Button>
                      )}
                    />
                  ) : (
                    deleteAction(id, String(item['filename']))
                  )}
                </div>
              )}
            </li>
          );
        })}
        {items.length === 0 && (
          <li className="text-2xs text-text-faint">{t('spec.attach.empty')}</li>
        )}
      </ul>

      {/* 내린 첨부 — 접어 둔다. 지금 문서의 첨부와 섞이면 내린 뜻이 없다 */}
      {canEdit && hiddenItems.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            data-testid="attach-hidden-toggle"
            aria-expanded={showHidden}
            onClick={() => setShowHidden(!showHidden)}
            className="text-left text-2xs text-text-mute hover:text-text"
          >
            {showHidden ? '▾' : '▸'} {t('spec.attach.hidden_toggle', { n: hiddenItems.length })}
          </button>
          {showHidden && (
            <ul className="flex flex-col gap-1.5">
              {hiddenItems.map((item) => {
                const id = String(item['id']);
                const versions = versionsOf(item);
                return (
                  <li
                    key={id}
                    data-testid="attachment-hidden"
                    className="rounded-nerv border border-dashed border-border p-2 text-2xs"
                  >
                    <a
                      href={apiHref(`/api/v1/projects/${projectSlug}/attachments/${id}`)}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-text-mute hover:underline"
                    >
                      {String(item['filename'])}
                    </a>
                    {versions.length > 0 && (
                      <p data-testid="attach-kept-for" className="mt-0.5 text-text-faint">
                        {t('spec.attach.kept_for', { versions: versionLabel(versions) })}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Button
                        size="xs"
                        variant="subtle"
                        data-testid="attach-restore"
                        disabled={restore.isPending}
                        onClick={() => restore.mutate(id)}
                      >
                        {t('spec.attach.restore')}
                      </Button>
                      {versions.length === 0 && deleteAction(id, String(item['filename']))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
