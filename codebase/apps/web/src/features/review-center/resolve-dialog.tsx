// 처분 다이얼로그 — S6(REQ-WEB-064 · EP-REV-02)
//
// **근거 없는 처분은 없다.** `resolution.rationale_md` 가 NOT NULL 인 것은 스키마의 취향이
// 아니라 규율이다(database.md §2.7) — 유예가 사유 없이 쌓이면 유예 목록은 곧 잊힌 목록이
// 된다. `fixed` 에 커밋을 요구하는 이유도 같다: 검증 가능한 사실만 A2 로 통과한다.
//
// **처분은 넷이다**(2026-08-30 — 사람 요청). 구현이 맞고 스펙이 틀린 지적은 코드가 아니라
// 문서를 고쳐 닫힌다 — 그때 커밋이 없다고 `dismissed`·`wont_fix` 로 닫으면 둘 다 거짓이
// 된다(오탐도 아니었고 미룬 것도 아니다). `spec_change` 의 증거는 **그 스펙의 지금 버전**
// 이라, 사람에게 버전 id 를 묻지 않고 문서만 고르게 한다(REQ-WEB-117).

import { useEffect, useState } from 'react';
import { useApiError } from '../../lib/api-errors.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api.js';
import { useT } from '../../lib/i18n.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import { useSpec } from '../../lib/queries.js';
import type { Row } from '../../lib/queries.js';
import { SpecLinkPicker } from '../spec-editor/spec-link-picker.js';
import { Button, Field, Input, Textarea } from '../../components/ui/primitives.js';
import type { ProjectId } from '../../lib/query-keys.js';

export type ResolveAction = 'fixed' | 'spec_change' | 'dismissed' | 'wont_fix';

export function ResolveDialog({
  projectSlug,
  projectId,
  finding,
  action,
  onDone,
}: {
  projectSlug: string;
  projectId: ProjectId | undefined;
  finding: Row;
  action: ResolveAction;
  onDone: () => void;
}): React.JSX.Element {
  const t = useT();
  const [rationale, setRationale] = useState('');
  const [commit, setCommit] = useState('');
  // **고치는 문서는 대개 그 지적이 나온 문서다.** 미리 고르고, 아니면 바꾸게 한다
  const [specKey, setSpecKey] = useState(
    typeof finding['spec_key'] === 'string' ? finding['spec_key'] : '',
  );
  const [picking, setPicking] = useState(false);
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();

  // 증거는 그 스펙의 **지금 버전**이다 — 발견이 달고 있는 버전은 고치기 **전**의 버전이다
  const picked = useSpec(projectSlug, action === 'spec_change' ? specKey : '');
  const specVersionId =
    typeof picked.data?.['version_id'] === 'string' ? picked.data['version_id'] : '';
  useEffect(() => {
    if (action !== 'spec_change') setPicking(false);
  }, [action]);

  const resolve = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${projectSlug}/findings/${String(finding['id'])}/resolve`, {
        method: 'POST',
        body: {
          resolution: action,
          rationale,
          ...(action === 'fixed' ? { commit_sha: commit } : {}),
          ...(action === 'spec_change' ? { spec_version_id: specVersionId } : {}),
        },
      }),
    onSuccess: () => {
      // 큐와 게이트 현황은 같은 사실의 두 얼굴이다 — 함께 다시 읽는다
      // 프로젝트 축뿐이다 — slug 로 잡으면 아무 캐시도 맞지 않는다(queries.ts 규약)
      // 축이 없으면 무효화하지 않는다 — 빈 축으로 부르면 아무 캐시에도 닿지 않고,
      // 그 침묵이 정확히 이 표시가 없애려는 결함이다(query-keys.ts `ProjectId`).
      if (projectId !== undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.projectFindings(projectId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.projectGateCoverage(projectId) });
      }
      pushToast({ tone: 'ok', message: t('reviews.resolve.done') });
      onDone();
    },
    onError: onApiError,
  });

  // 서버도 같은 것을 막지만(EP-REV-02) 버튼이 먼저 막아야 사람이 왕복하지 않는다
  const ready =
    rationale.trim() !== '' &&
    (action !== 'fixed' || commit.trim() !== '') &&
    (action !== 'spec_change' || specVersionId !== '');

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
      {action === 'spec_change' && (
        <Field label={t('reviews.resolve.spec')} hint={t('reviews.resolve.spec_hint')}>
          <div className="relative flex flex-wrap items-center gap-2">
            {specKey === '' ? (
              <span className="text-2xs text-text-faint">{t('reviews.resolve.spec_none')}</span>
            ) : (
              <span data-testid="resolve-spec-key" className="font-mono text-xs text-text">
                {specKey}
              </span>
            )}
            <button
              type="button"
              data-testid="resolve-spec-pick"
              onClick={() => setPicking(!picking)}
              className="rounded-nerv-sm border border-border px-2 py-0.5 text-2xs text-text-mute hover:border-border-strong hover:text-text"
            >
              {t('reviews.resolve.spec_pick')}
            </button>
            {/* 고르는 길은 본문 링크와 **같은 고르개**다 — 두 벌을 두면 하나는 언젠가 낡는다 */}
            {picking && (
              <SpecLinkPicker
                projectSlug={projectSlug}
                projectId={projectId}
                onPick={(spec) => {
                  setSpecKey(spec.key);
                  setPicking(false);
                }}
                onClose={() => setPicking(false)}
              />
            )}
          </div>
        </Field>
      )}
      <div className="mt-2 flex gap-2">
        <Button
          type="submit"
          data-testid="resolve-submit"
          variant="primary"
          disabled={!ready || resolve.isPending}
        >
          {t('reviews.resolve.submit')}
        </Button>
        <Button type="button" onClick={onDone}>
          {t('reviews.resolve.cancel')}
        </Button>
      </div>
    </form>
  );
}
