// 첨부 패널 — 디자인 시안 (screens.md §2.4 · REQ-WEB-125)
//
// **시안이 문서 밖에 있으면 문서가 아니다.** 지금까지 시안은 슬랙이나 외부 링크로 떠돌았고,
// 그 링크는 스펙의 버전과 무관하게 바뀌었다 — "이 버전이 말하는 화면" 을 나중에 되짚을 수 없다.
//
// 올린 뒤에 **본문에 넣는 길을 같은 자리에 둔다**: 파일만 매달고 끝나면 문서를 읽는 사람은
// 그 그림을 못 본다. 붙여넣을 마크다운을 한 번에 넣어 준다.

import { useRef, useState } from 'react';
import { useApiError } from '../../lib/api-errors.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api.js';
import { rows, useSpecAttachments } from '../../lib/queries.js';
import { useT } from '../../lib/i18n.js';
import { useRealtime } from '../../lib/realtime.js';
import { cn } from '../../lib/utils.js';

/** 서버와 같은 화이트리스트 — 고르개가 아닌 것을 보여 주면 올린 뒤에야 거부당한다 */
const ACCEPT =
  'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,application/pdf,text/html,text/plain,application/zip';

export function AttachmentPanel({
  projectSlug,
  specKey,
  canEdit,
  onInsert,
}: {
  projectSlug: string;
  specKey: string;
  canEdit: boolean;
  /** 본문에 넣기 — 편집 중일 때만 온다 */
  onInsert?: ((markdown: string) => void) | undefined;
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
      const res = await fetch(`/api/v1/projects/${projectSlug}/specs/${specKey}/attachments`, {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      if (!res.ok) throw new Error(String((await res.json())?.error?.message ?? res.statusText));
      return (await res.json()) as Record<string, unknown>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['spec', specKey, 'attachments'] });
      pushToast({ tone: 'ok', message: t('spec.attach.done') });
    },
    onError: onApiError,
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/projects/${projectSlug}/attachments/${id}`, { method: 'DELETE' }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['spec', specKey, 'attachments'] }),
  });

  const items = rows(attachments.data);

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
          const url = `/api/v1/projects/${projectSlug}/attachments/${id}`;
          const isImage = String(item['content_type']).startsWith('image/');
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
              <div className="mt-1 flex flex-wrap gap-1.5">
                {onInsert !== undefined && (
                  <button
                    type="button"
                    data-testid="attach-insert"
                    onClick={() => onInsert(`![${String(item['filename'])}](${url})`)}
                    className="rounded-nerv-sm border border-border px-1.5 py-0.5 text-2xs text-text-mute hover:border-border-strong hover:text-text"
                  >
                    {t('spec.attach.insert')}
                  </button>
                )}
                {canEdit && (
                  <button
                    type="button"
                    data-testid="attach-remove"
                    onClick={() => remove.mutate(id)}
                    className="rounded-nerv-sm border border-border px-1.5 py-0.5 text-2xs text-text-faint hover:text-status-danger"
                  >
                    {t('common.delete')}
                  </button>
                )}
              </div>
            </li>
          );
        })}
        {items.length === 0 && (
          <li className="text-2xs text-text-faint">{t('spec.attach.empty')}</li>
        )}
      </ul>
    </div>
  );
}
