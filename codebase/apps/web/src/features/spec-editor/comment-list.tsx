// 스펙 코멘트 — 레일의 `코멘트` 탭 (screens.md §2.4 · §3.3 · REQ-WEB-216)
//
// 리뷰어가 코멘트를 달려면 "앵커 (헤딩 slug 또는 REQ-…)" 칸에 slug 를 **손으로** 적어야 했다 — slug 는
// 서버가 정규화해 발급하는 값이라 사람이 알 수 없다. 달린 코멘트에는 누가·언제·어느 버전인지가
// 없었고, 탭의 수는 해결된 것까지 세어 "코멘트 5" 를 눌렀는데 "열린 코멘트가 없습니다" 가 떴다.
// 달기·해소가 실패해도(해소 권한 없음 등) 화면은 아무 말이 없었고, 해결된 것을 다시 볼 길도,
// §3.3 이 적은 "앵커 유실" 모음도 없었다(2026-09-24 UI/UX 검토 SPEC-04).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { useApiError } from '../../lib/api-errors.js';
import { relativeTime } from '../../lib/format.js';
import { useT } from '../../lib/i18n.js';
import { queryKeys } from '../../lib/query-keys.js';
import { cn } from '../../lib/utils.js';
import { Avatar, Button, Input, Select, Textarea } from '../../components/ui/primitives.js';

/** 코멘트를 달 수 있는 자리 — 본문의 헤딩과 요구사항 */
export interface AnchorChoice {
  value: string;
  label: string;
  kind: 'heading' | 'requirement';
}

export function CommentList({
  projectSlug,
  specKey,
  versionId,
  comments,
  anchors,
  onAnchor,
}: {
  projectSlug: string;
  specKey: string;
  /** 새 코멘트가 붙는 버전 — 보는 버전이다(REQ-WEB-214) */
  versionId: string;
  comments: Record<string, unknown>[];
  /** 고를 수 있는 앵커 — 비어 있으면 적어 넣는 칸으로 떨어진다 */
  anchors: readonly AnchorChoice[];
  /** 앵커가 가리키는 본문 자리로 간다(REQ-WEB-215) */
  onAnchor: (anchor: string) => void;
}): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const onApiError = useApiError();
  const [anchor, setAnchor] = useState('');
  const [body, setBody] = useState('');
  const [showResolved, setShowResolved] = useState(false);

  const refresh = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: queryKeys.specComments(specKey) });
  // **실패는 말한다** — 두 쓰기 모두 기본 처리기로 사유를 보인다(예전에는 조용히 아무 일도 없었다)
  const add = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${projectSlug}/spec-versions/${versionId}/comments`, {
        method: 'POST',
        body: { anchor, body_md: body },
      }),
    onSuccess: () => {
      setBody('');
      void refresh();
    },
    onError: onApiError,
  });
  const resolve = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/projects/${projectSlug}/comments/${id}/resolve`, { method: 'POST', body: {} }),
    onSuccess: () => void refresh(),
    onError: onApiError,
  });

  const known = new Set(anchors.map((a) => a.value));
  const open = comments.filter((c) => c['status'] === 'open');
  const resolved = comments.filter((c) => c['status'] !== 'open');
  // **앵커 유실은 머리에 모은다**(§3.3). 헤딩이 바뀌어 가리키던 자리가 사라진 코멘트는 누르면 아무 데도
  // 가지 않는다 — 그 사실을 먼저 말한다. 고를 앵커를 모를 때(본문을 아직 못 받았을 때)는 가르지 않는다
  const lost = anchors.length === 0 ? [] : open.filter((c) => !known.has(String(c['anchor'])));
  const placed = open.filter((c) => !lost.includes(c));

  const row = (c: Record<string, unknown>, muted = false): React.JSX.Element => {
    const author =
      typeof c['author_name'] === 'string'
        ? c['author_name']
        : typeof c['author_hostname'] === 'string'
          ? c['author_hostname']
          : null;
    const agent = typeof c['author_hostname'] === 'string';
    return (
      <li
        key={String(c['id'])}
        data-testid="comment-row"
        className={cn('rounded-nerv border border-border p-2', muted && 'opacity-70')}
      >
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs text-text-faint">
          {/* 앵커가 코멘트의 전부다 — 위치 없는 지적은 고칠 수 없다(D-09) */}
          <button
            type="button"
            data-testid="comment-anchor"
            onClick={() => onAnchor(String(c['anchor']))}
            className="font-mono text-link hover:underline"
          >
            {String(c['anchor'])}
          </button>
          {/* **누가 · 언제 · 어느 버전에**(SPEC-04) */}
          {author !== null && (
            <span data-testid="comment-author" className="flex items-center gap-1">
              {!agent && <Avatar name={author} size="sm" />}
              {agent ? `${author} · ${String(c['author_agent_type'] ?? '')}` : author}
            </span>
          )}
          <span>
            {relativeTime(t, typeof c['created_at'] === 'string' ? c['created_at'] : null)}
          </span>
          {c['version_no'] != null && <span>v{String(c['version_no'])}</span>}
        </div>
        <div className="mt-0.5 text-sm">{String(c['body_md'])}</div>
        {muted ? (
          typeof c['resolved_by_name'] === 'string' && (
            <p className="mt-1 text-2xs text-text-faint">
              {t('spec.comment.resolved_by', { name: c['resolved_by_name'] })}
            </p>
          )
        ) : (
          <button
            type="button"
            data-testid="comment-resolve"
            className="mt-1 text-xs text-link hover:underline disabled:opacity-50"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate(String(c['id']))}
          >
            {t('spec.comment_resolve')}
          </button>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {lost.length > 0 && (
        <section data-testid="comments-lost" className="flex flex-col gap-1">
          <p className="text-2xs font-medium text-status-waiting">
            {t('spec.comment.lost', { count: lost.length })}
          </p>
          <ul className="flex flex-col gap-1">{lost.map((c) => row(c))}</ul>
        </section>
      )}
      <ul className="flex flex-col gap-1">
        {placed.map((c) => row(c))}
        {open.length === 0 && (
          <li className="text-xs text-text-faint">{t('spec.no_open_comments')}</li>
        )}
      </ul>
      {/* **해결된 것도 다시 볼 수 있다** — 무엇이 지적됐고 어떻게 닫혔는지는 다음 리뷰의 재료다 */}
      {resolved.length > 0 && (
        <button
          type="button"
          data-testid="comments-resolved-toggle"
          aria-expanded={showResolved}
          onClick={() => setShowResolved((v) => !v)}
          className="self-start text-2xs text-text-mute hover:text-text"
        >
          {t(showResolved ? 'spec.comment.resolved_hide' : 'spec.comment.resolved_show', {
            count: resolved.length,
          })}
        </button>
      )}
      {showResolved && <ul className="flex flex-col gap-1">{resolved.map((c) => row(c, true))}</ul>}
      <div className="mt-1 flex flex-col gap-1.5 border-t border-border pt-2">
        {/* **앵커는 고른다**(SPEC-04). slug 는 서버가 정규화하는 값이라 사람이 알 수 없었다 — 본문의
            헤딩과 요구사항에서 고르고, 고를 것을 모를 때만 적어 넣는다 */}
        {anchors.length > 0 ? (
          <Select
            data-testid="comment-anchor-select"
            value={anchor}
            onChange={(e) => setAnchor(e.target.value)}
            aria-label={t('spec.comment_anchor_label')}
            className="h-7 text-xs"
          >
            <option value="">{t('spec.comment.anchor_pick')}</option>
            <optgroup label={t('spec.comment.anchor_headings')}>
              {anchors
                .filter((a) => a.kind === 'heading')
                .map((a) => (
                  <option key={`h-${a.value}`} value={a.value}>
                    {a.label}
                  </option>
                ))}
            </optgroup>
            {anchors.some((a) => a.kind === 'requirement') && (
              <optgroup label={t('spec.comment.anchor_requirements')}>
                {anchors
                  .filter((a) => a.kind === 'requirement')
                  .map((a) => (
                    <option key={`r-${a.value}`} value={a.value}>
                      {a.label}
                    </option>
                  ))}
              </optgroup>
            )}
          </Select>
        ) : (
          <Input
            value={anchor}
            onChange={(e) => setAnchor(e.target.value)}
            placeholder={t('spec.comment_anchor')}
            aria-label={t('spec.comment_anchor_label')}
            className="h-7 text-xs"
          />
        )}
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('spec.comments')}
          aria-label={t('spec.comments')}
          rows={2}
          className="text-xs"
        />
        <Button
          size="sm"
          data-testid="comment-add"
          disabled={versionId === '' || anchor.trim() === '' || body.trim() === '' || add.isPending}
          onClick={() => add.mutate()}
          className="self-start"
        >
          {t('spec.comment_add')}
        </Button>
      </div>
    </div>
  );
}
