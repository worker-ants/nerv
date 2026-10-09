// 리뷰 면제 — 정본: docs/04-mvp/screens.md REQ-WEB-299 · api.md REQ-API-274
//
// **코드를 내지 않은 작업은 code 리뷰를 받을 길이 없다**(2026-10-09 · clemvion CLE-T-2NVZA4 · CLE-T-SJAYNM). 프로젝트가
// 완료 조건으로 `code` · `consistency` 리뷰를 요구하면 그런 작업은 done 에서 막혔고, 면제는 API 에만 있어 화면에서 닫을
// 길이 없었다 — 남은 길은 하지 않은 리뷰를 꾸며 내는 것뿐이었다. 사람이 **종류를 골라** 사유와 함께 면제하고, 그 기록을
// 작업 화면에 남긴다. 누가 어느 종류를 면제할 수 있는지와 코드를 낸 작업의 코드 리뷰를 면제하지 못한다는 판정은
// 서버가 한다 — 화면은 같은 표(`REVIEW_WAIVER_ROLES`)로 미리 잠근다.

import {
  canWaiveReviewKind,
  CODE_EVIDENCE_KINDS,
  CODE_REVIEW_KINDS,
  GatePolicySchema,
} from '@nerv/schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { useApiError } from '../../lib/api-errors.js';
import { relativeTime, reviewKindText } from '../../lib/format.js';
import { useT } from '../../lib/i18n.js';
import { usePressKey } from '../../lib/press-key.js';
import type { Row } from '../../lib/queries.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import { Button, Textarea } from '../../components/ui/primitives.js';

const isCodeKind = (kind: string): boolean =>
  (CODE_REVIEW_KINDS as readonly string[]).includes(kind);

/** 프로젝트가 완료 조건으로 요구하는 리뷰 종류 — 종류 목록으로 켠 프로젝트만 면제할 종류가 있다 */
export function requiredReviewKinds(gatePolicy: unknown): string[] {
  const parsed = GatePolicySchema.safeParse(gatePolicy ?? {});
  const coverage = parsed.success ? parsed.data.done_gate.review_coverage : false;
  return Array.isArray(coverage) ? [...new Set(coverage)] : [];
}

/** 면제 기록 한 줄씩 — 리뷰 목록 카드 아래에 늘 보인다(작업이 끝난 뒤에도) */
export function ReviewWaiverList({ waivers }: { waivers: Row[] }): React.JSX.Element | null {
  const t = useT();
  if (waivers.length === 0) return null;
  return (
    <ul
      data-testid="review-waivers"
      className="mt-2 flex flex-col gap-1 border-t border-border pt-2"
    >
      {waivers.map((w) => {
        const kinds = Array.isArray(w['kinds']) ? (w['kinds'] as string[]) : null;
        const voidKinds = Array.isArray(w['void_kinds']) ? (w['void_kinds'] as string[]) : [];
        return (
          <li key={String(w['id'])} data-testid="review-waiver" className="text-xs text-text-mute">
            <span className="text-text">
              {t('task.waiver.line', {
                kinds:
                  kinds === null
                    ? t('task.waiver.all')
                    : kinds.map((k) => reviewKindText(t, k)).join(' · '),
                by: String(w['by_name'] ?? ''),
                at: relativeTime(t, typeof w['at'] === 'string' ? w['at'] : null),
              })}
            </span>
            {' — '}
            {String(w['reason'] ?? '')}
            {voidKinds.length > 0 && (
              <span data-testid="review-waiver-void" className="ml-1 text-status-danger">
                ({voidKinds.map((k) => reviewKindText(t, k)).join(' · ')}: {t('task.waiver.void')})
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 면제 입력 — 완료 조건 카드 안. 면제할 수 있는 종류가 하나라도 있을 때만 [리뷰 면제]를 둔다. 접어 둔 채로 시작한다:
 * 면제는 예외이고, 펼친 폼이 먼저 보이면 리뷰를 받는 대신 면제를 고르게 된다.
 */
export function ReviewWaiverForm({
  proj,
  taskParam,
  task,
  requiredKinds,
  roles,
}: {
  proj: string;
  /** 페이지가 작업을 읽은 경로 인자 — 같은 쿼리 키를 무효화한다 */
  taskParam: string;
  task: Row;
  requiredKinds: string[];
  roles: readonly string[];
}): React.JSX.Element | null {
  const t = useT();
  const onError = useApiError();
  const { pushToast } = useRealtime();
  const queryClient = useQueryClient();
  const press = usePressKey('waiver');
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [reason, setReason] = useState('');

  const waivers = Array.isArray(task['review_waivers']) ? (task['review_waivers'] as Row[]) : [];
  // 범위 없는 면제가 이미 있으면 리뷰 커버리지 전부가 면제됐다 — 더 고를 것이 없다
  const waivedAll = waivers.some((w) => !Array.isArray(w['kinds']));
  // 이미 기록된 면제 — 코드 증적 때문에 세지 않는 종류는 다시 고를 수 있게 남긴다(서버가 거절하고 이유를 준다)
  const waived = new Set(
    waivers.flatMap((w) => {
      const kinds = Array.isArray(w['kinds']) ? (w['kinds'] as string[]) : [];
      const voidKinds = Array.isArray(w['void_kinds']) ? (w['void_kinds'] as string[]) : [];
      return kinds.filter((k) => !voidKinds.includes(k));
    }),
  );
  const evidence = Array.isArray(task['evidence']) ? (task['evidence'] as Row[]) : [];
  const hasCode = evidence.some((e) =>
    (CODE_EVIDENCE_KINDS as readonly string[]).includes(String(e['kind'])),
  );
  const candidates = waivedAll ? [] : requiredKinds.filter((kind) => !waived.has(kind));

  const waive = useMutation({
    mutationFn: () =>
      apiFetch<Record<string, unknown>>(`/projects/${proj}/gates/bypass`, {
        method: 'POST',
        body: { subject_id: String(task['id']), kinds: chosen, reason: reason.trim() },
        idempotencyKey: press.take(),
      }),
    onSettled: press.release,
    onSuccess: () => {
      pushToast({
        tone: 'ok',
        message: t('task.waiver.done', {
          kinds: chosen.map((k) => reviewKindText(t, k)).join(' · '),
        }),
      });
      setOpen(false);
      setChosen([]);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskParam) });
    },
    onError,
  });

  if (candidates.length === 0) return null;
  const waivable = candidates.filter((kind) => canWaiveReviewKind(roles, kind));
  if (waivable.length === 0) {
    return (
      <p data-testid="review-waiver-no-role" className="text-xs text-text-faint">
        {t('task.waiver.no_role')}
      </p>
    );
  }

  return (
    <div
      data-testid="review-waiver-form"
      className="flex flex-col gap-2 border-t border-border pt-3"
    >
      {!open ? (
        <div>
          <Button size="sm" data-testid="review-waiver-open" onClick={() => setOpen(true)}>
            {t('task.waiver.open')}
          </Button>
        </div>
      ) : (
        <>
          <p className="text-xs font-medium text-text">{t('task.waiver.title')}</p>
          <p className="text-xs text-text-mute">{t('task.waiver.hint')}</p>
          <fieldset className="flex flex-wrap gap-3 text-sm">
            <legend className="sr-only">{t('task.waiver.kinds')}</legend>
            {waivable.map((kind) => {
              const blocked = hasCode && isCodeKind(kind);
              return (
                <label
                  key={kind}
                  className="flex items-center gap-1.5"
                  title={blocked ? t('task.waiver.code_evidence') : undefined}
                >
                  <input
                    type="checkbox"
                    data-testid={`review-waiver-kind-${kind}`}
                    disabled={blocked}
                    checked={chosen.includes(kind)}
                    onChange={(e) =>
                      setChosen((prev) =>
                        e.target.checked ? [...prev, kind] : prev.filter((k) => k !== kind),
                      )
                    }
                  />
                  {reviewKindText(t, kind)}
                </label>
              );
            })}
          </fieldset>
          {hasCode && waivable.some(isCodeKind) && (
            <p data-testid="review-waiver-code" className="text-xs text-status-waiting">
              {t('task.waiver.code_evidence')}
            </p>
          )}
          <Textarea
            data-testid="review-waiver-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('task.waiver.reason_placeholder')}
            rows={2}
          />
          {chosen.length > 0 && (
            <p className="text-xs text-status-waiting">
              {t('task.waiver.confirm', {
                kinds: chosen.map((k) => reviewKindText(t, k)).join(' · '),
              })}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              data-testid="review-waiver-submit"
              disabled={chosen.length === 0 || reason.trim() === '' || waive.isPending}
              onClick={() => waive.mutate()}
            >
              {t('task.waiver.submit')}
            </Button>
            <Button size="sm" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
