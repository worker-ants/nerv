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
  FULL_COMMIT_SHA_PATTERN,
  GatePolicySchema,
  reviewKind,
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
import { Button, Input, Textarea } from '../../components/ui/primitives.js';

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

/** 40자 커밋 SHA 인가 — 서버(`GateBypassInput`)와 같은 정규식이다 */
const FULL_SHA = new RegExp(FULL_COMMIT_SHA_PATTERN, 'i');

/**
 * 이 작업과 함께 알려진 브랜치 — 리뷰가 들어온 브랜치와 클레임한 세션이 일한 브랜치. 순서는 처음 나온 순서다(리뷰가 앞)
 */
export function taskBranches(task: Row): string[] {
  const from = (list: unknown): string[] =>
    Array.isArray(list)
      ? (list as Row[])
          .map((r) => (typeof r['branch'] === 'string' ? r['branch'].trim() : ''))
          .filter((b) => b !== '')
      : [];
  return [...new Set([...from(task['reviews']), ...from(task['claims'])])];
}

/** 이 역할로 브랜치 면제를 낼 수 있는가 — 면제할 수 있는 리뷰 종류가 하나라도 있으면(`REVIEW_WAIVER_ROLES` · 서버와 같은 표) */
export function canWaiveBranch(roles: readonly string[]): boolean {
  return reviewKind.enumValues.some((kind) => canWaiveReviewKind(roles, kind));
}

/**
 * **리뷰가 없는 브랜치의 면제**(2026-10-16 · 사람 결정 D4 · REQ-WEB-327 · api.md REQ-API-339). 문서만 바꾼 브랜치처럼 리뷰를 받지
 * 않을 브랜치는 게이트 판정(EP-REV-08 — push 훅 · CI)이 「리뷰 없음」으로 막는다. 사람이 그 브랜치와 종류를 골라 사유와 함께
 * 면제하면 그 (브랜치 · 종류)가 `waived` 로 통과하고 게이트 현황의 그 브랜치 줄에 보인다.
 *
 * 작업 면제(위 `ReviewWaiverForm` — 완료 조건)와 다른 일이라 따로 둔다. 자리는 둘이다 — 작업 상세의 리뷰 카드(그 작업의 리뷰 ·
 * 클레임 세션의 브랜치를 후보로 보인다 · 작업이 끝난 뒤에도 그 카드는 남는다)와 **리뷰 센터의 게이트 현황**(2026-10-16 사람 결정
 * · REQ-WEB-332 — 그 줄의 브랜치를 미리 채우고, 작업과 무관한 브랜치는 이름을 직접 넣는다). 면제할 종류는 역할이 정한다
 * (`REVIEW_WAIVER_ROLES`) — 코드 증적 검사는 없다(브랜치에는 작업이 없다).
 */
export function BranchWaiverForm({
  proj,
  roles,
  branches = [],
  initialBranch = '',
  startOpen = false,
  onDone,
  onCancel,
}: {
  proj: string;
  roles: readonly string[];
  /** 눌러서 고르는 후보 — 작업 상세는 그 작업의 브랜치(`taskBranches`)를 준다 */
  branches?: readonly string[];
  /** 미리 채울 브랜치 — 게이트 현황의 줄에서 열면 그 줄의 브랜치 */
  initialBranch?: string;
  /** 펼친 채로 시작한다 — 게이트 현황처럼 단추를 누른 자리에서 열 때 */
  startOpen?: boolean;
  /** 기록한 뒤 — 부른 쪽이 목록을 다시 읽고 폼을 닫는다 */
  onDone?: () => void;
  /** [취소] — 부른 쪽이 폼을 닫는다(없으면 접기만 한다) */
  onCancel?: () => void;
}): React.JSX.Element | null {
  const t = useT();
  const onError = useApiError();
  const { pushToast } = useRealtime();
  const press = usePressKey('branch-waiver');
  const [open, setOpen] = useState(startOpen);
  const [branch, setBranch] = useState(initialBranch);
  const [headSha, setHeadSha] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [reason, setReason] = useState('');

  const waivable = reviewKind.enumValues.filter((kind) => canWaiveReviewKind(roles, kind));
  const known = [...branches];
  const head = headSha.trim();
  const headInvalid = head !== '' && !FULL_SHA.test(head);
  const kindsText = chosen.map((k) => reviewKindText(t, k)).join(' · ');

  const waive = useMutation({
    mutationFn: () =>
      apiFetch<Record<string, unknown>>(`/projects/${proj}/gates/bypass`, {
        method: 'POST',
        body: {
          branch: branch.trim(),
          ...(head === '' ? {} : { head_sha: head.toLowerCase() }),
          kinds: chosen,
          reason: reason.trim(),
        },
        idempotencyKey: press.take(),
      }),
    onSettled: press.release,
    onSuccess: () => {
      pushToast({
        tone: 'ok',
        message: t('task.branch_waiver.done', { branch: branch.trim(), kinds: kindsText }),
      });
      setOpen(false);
      setBranch(initialBranch);
      setHeadSha('');
      setChosen([]);
      setReason('');
      onDone?.();
    },
    onError,
  });

  // 면제할 수 있는 종류가 없는 역할(qa · designer · viewer)에게는 단추를 내밀지 않는다 — 작업 면제가 그 안내를 이미 한다
  if (waivable.length === 0) return null;

  return (
    <div
      data-testid="branch-waiver-form"
      className="mt-2 flex flex-col gap-2 border-t border-border pt-2"
    >
      {!open ? (
        <div>
          <Button size="sm" data-testid="branch-waiver-open" onClick={() => setOpen(true)}>
            {t('task.branch_waiver.open')}
          </Button>
        </div>
      ) : (
        <>
          <p className="text-xs font-medium text-text">{t('task.branch_waiver.title')}</p>
          <p className="text-xs text-text-mute">{t('task.branch_waiver.hint')}</p>
          <Input
            data-testid="branch-waiver-branch"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder={t('task.branch_waiver.branch_placeholder')}
            aria-label={t('task.branch_waiver.branch')}
            className="font-mono"
          />
          {/* 이 작업에서 아는 브랜치는 눌러서 고른다 — 이름을 옮겨 적다 틀리면 다른 브랜치가 면제된다 */}
          {known.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-2xs text-text-faint">
              <span>{t('task.branch_waiver.known')}</span>
              {known.map((b) => (
                <button
                  key={b}
                  type="button"
                  data-testid="branch-waiver-known"
                  aria-pressed={branch.trim() === b}
                  onClick={() => setBranch(b)}
                  className="rounded-nerv-sm border border-border px-1.5 py-0.5 font-mono text-text-mute hover:text-text aria-pressed:border-status-action aria-pressed:text-status-action"
                >
                  {b}
                </button>
              ))}
            </div>
          )}
          <Input
            data-testid="branch-waiver-head"
            value={headSha}
            onChange={(e) => setHeadSha(e.target.value)}
            placeholder={t('task.branch_waiver.head_placeholder')}
            aria-label={t('task.branch_waiver.head')}
            aria-invalid={headInvalid}
            className="font-mono"
          />
          {headInvalid && (
            <p data-testid="branch-waiver-head-invalid" className="text-xs text-status-danger">
              {t('task.branch_waiver.head_invalid')}
            </p>
          )}
          <fieldset className="flex flex-wrap gap-3 text-sm">
            <legend className="sr-only">{t('task.waiver.kinds')}</legend>
            {waivable.map((kind) => (
              <label key={kind} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  data-testid={`branch-waiver-kind-${kind}`}
                  checked={chosen.includes(kind)}
                  onChange={(e) =>
                    setChosen((prev) =>
                      e.target.checked ? [...prev, kind] : prev.filter((k) => k !== kind),
                    )
                  }
                />
                {reviewKindText(t, kind)}
              </label>
            ))}
          </fieldset>
          <Textarea
            data-testid="branch-waiver-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('task.branch_waiver.reason_placeholder')}
            rows={2}
          />
          {chosen.length > 0 && branch.trim() !== '' && (
            <p className="text-xs text-status-waiting">
              {t('task.branch_waiver.confirm', { branch: branch.trim(), kinds: kindsText })}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              data-testid="branch-waiver-submit"
              disabled={
                branch.trim() === '' ||
                chosen.length === 0 ||
                reason.trim() === '' ||
                headInvalid ||
                waive.isPending
              }
              onClick={() => waive.mutate()}
            >
              {t('task.waiver.submit')}
            </Button>
            <Button
              size="sm"
              data-testid="branch-waiver-cancel"
              onClick={() => {
                setOpen(false);
                onCancel?.();
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
