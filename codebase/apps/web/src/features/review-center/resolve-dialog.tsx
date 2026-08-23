// 처분 다이얼로그 — S6(REQ-WEB-064 · EP-REV-02)
//
// **근거 없는 처분은 없다.** `resolution.rationale_md` 가 NOT NULL 인 것은 스키마의 취향이
// 아니라 규율이다(database.md §2.7) — 유예가 사유 없이 쌓이면 유예 목록은 곧 잊힌 목록이
// 된다. `fixed` 에 커밋을 요구하는 이유도 같다: 검증 가능한 사실만 A2 로 통과한다.

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api.js';
import { useT } from '../../lib/i18n.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import type { Row } from '../../lib/queries.js';
import { Button, Field, Input, Textarea } from '../../components/ui/primitives.js';

export type ResolveAction = 'fixed' | 'dismissed' | 'wont_fix';

export function ResolveDialog({
  projectSlug,
  projectId,
  finding,
  action,
  onDone,
}: {
  projectSlug: string;
  projectId: string | undefined;
  finding: Row;
  action: ResolveAction;
  onDone: () => void;
}): React.JSX.Element {
  const t = useT();
  const [rationale, setRationale] = useState('');
  const [commit, setCommit] = useState('');
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();

  const resolve = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${projectSlug}/findings/${String(finding['id'])}/resolve`, {
        method: 'POST',
        body: {
          resolution: action,
          rationale,
          ...(action === 'fixed' ? { commit_sha: commit } : {}),
        },
      }),
    onSuccess: () => {
      // 큐와 게이트 현황은 같은 사실의 두 얼굴이다 — 함께 다시 읽는다
      const key = projectId ?? projectSlug;
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectFindings(key) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectGateCoverage(key) });
      pushToast({ tone: 'ok', message: t('reviews.resolve.done') });
      onDone();
    },
    onError: (error: Error) => pushToast({ tone: 'warn', message: error.message }),
  });

  // 서버도 같은 것을 막지만(EP-REV-02) 버튼이 먼저 막아야 사람이 왕복하지 않는다
  const ready = rationale.trim() !== '' && (action !== 'fixed' || commit.trim() !== '');

  return (
    <form
      data-testid="resolve-dialog"
      className="mt-2 rounded-nerv border border-border bg-bg-elev p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) resolve.mutate();
      }}
    >
      <p className="mb-2 text-2xs font-semibold text-text">
        {t('reviews.resolve.title')} — {t(`reviews.action.${action}` as 'reviews.action.fixed')}
      </p>
      <Field label={t('reviews.resolve.rationale')} hint={t('reviews.resolve.rationale_hint')}>
        <Textarea
          data-testid="resolve-rationale"
          rows={2}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
        />
      </Field>
      {action === 'fixed' && (
        <Field label={t('reviews.resolve.commit')} hint={t('reviews.resolve.commit_hint')}>
          <Input
            data-testid="resolve-commit"
            value={commit}
            onChange={(e) => setCommit(e.target.value)}
          />
        </Field>
      )}
      <div className="mt-2 flex gap-2">
        <Button type="submit" variant="primary" disabled={!ready || resolve.isPending}>
          {t('reviews.resolve.submit')}
        </Button>
        <Button type="button" onClick={onDone}>
          {t('reviews.resolve.cancel')}
        </Button>
      </div>
    </form>
  );
}
