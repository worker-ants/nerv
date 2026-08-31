// 승인 카드 — 스펙 승인·플랜·질문 3유형 (ui-wireframes §2.7 · spec-workflow §6.4)
//
// 카드가 반드시 실어야 하는 것: **무엇을 승인하는가**(대상 + 델타) · **누가 요청했나** ·
// **얼마나 기다렸나**. 마지막 항목이 빠지면 오래된 요청이 새 요청 밑에 묻힌다.
//
// 질문 카드는 세션 신원 3요소(사용자·hostname·에이전트 종류)를 함께 싣는다(REQ-WEB-008) —
// "어느 머신의 누구를 멈춰 세우고 있나"가 답변 우선순위를 정하기 때문이다.

import { useT } from '../../lib/i18n.js';
import { Link } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Translator } from '@nerv/schema';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import { cn } from '../../lib/utils.js';
import { StatusBadge } from '../../components/status-badge.js';
import { Button, Mono, Textarea } from '../../components/ui/primitives.js';

export type Decision = 'approve' | 'reject' | 'comment';

export function waitedLabel(t: Translator, seconds: number): string {
  if (seconds < 60) return t('inbox.waited.just_now');
  if (seconds < 3600) return t('inbox.waited.minutes', { n: Math.floor(seconds / 60) });
  if (seconds < 86400) return t('inbox.waited.hours', { n: Math.floor(seconds / 3600) });
  return t('inbox.waited.days', { n: Math.floor(seconds / 86400) });
}

/**
 * 질문의 출처 — 스펙·Task 를 **누를 수 있는 것**으로 만든다.
 *
 * 이것이 카드에 없으면 사람은 에이전트가 요약한 문장만 보고 판단하게 된다. 스킬이
 * `context` 를 요구하는 이유가 그것이고(skills/question §절차 2), 요구해 놓고 화면에
 * 내보내지 않으면 그 인자는 쓰이지 않는 인자가 된다.
 */
function questionContext(card: Record<string, unknown>): {
  key: string;
  to: string;
  params: Record<string, string>;
}[] {
  const proj = String(card['project_slug'] ?? '');
  const out: { key: string; to: string; params: Record<string, string> }[] = [];
  const specKey = card['spec_key'];
  const taskKey = card['task_key'];
  if (typeof specKey === 'string' && specKey !== '') {
    out.push({ key: specKey, to: '/p/$proj/specs/$spec', params: { proj, spec: specKey } });
  }
  if (typeof taskKey === 'string' && taskKey !== '') {
    out.push({ key: taskKey, to: '/p/$proj/tasks/$task', params: { proj, task: taskKey } });
  }
  return out;
}

export interface ApprovalCardProps {
  card: Record<string, unknown>;
  compact?: boolean;
  /** 받은 요청이 포커스한 카드 — j/k 로 옮겨온 카드에 a/r/c 가 꽂힌다(REQ-WEB-025) */
  active?: boolean;
}

export function ApprovalCard({ card, compact, active }: ApprovalCardProps): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const [comment, setComment] = useState('');
  const [reasonRequired, setReasonRequired] = useState(false);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const isQuestion = card['subject_type'] === 'question';
  // 서버가 판정한 값이다 — 예전 판정(`self_requested !== true`)은 완화를 몰랐다.
  // 낡은 응답에는 이 필드가 없을 수 있으니 그때만 예전 규칙으로 떨어진다.
  const canApprove =
    typeof card['can_approve'] === 'boolean'
      ? card['can_approve']
      : card['self_requested'] !== true;
  const id = String(card['id']);
  const context = questionContext(card);
  // 선택지는 서버가 jsonb 로 준다 — 배열이 아니면 없는 것으로 본다(카드 하나가 목록을 죽이지 않게)
  const options = Array.isArray(card['options'])
    ? (card['options'] as unknown[]).filter((o): o is string => typeof o === 'string')
    : [];
  const projectSlug = String(card['project_slug'] ?? '');

  /**
   * 선택지로 답한다 — **원클릭이 이 필드의 존재 이유다**(data-model §2.7).
   *
   * 에이전트는 그대로 실행 가능한 선택지를 2~4개 만들어 보낸다(skills/question §절차 1).
   * 그것을 화면이 자유 서술 상자 하나로 받으면, 구조화해서 보낸 쪽의 노력이 사라지고
   * **재해석 드리프트**가 되돌아온다 — 사람이 고른 것과 에이전트가 읽은 것이 갈린다.
   */
  const answerWith = useMutation({
    mutationFn: (choice: string) =>
      apiFetch(`/projects/${projectSlug}/questions/${id}/answer`, {
        method: 'POST',
        body: { answer_key: choice, answer_md: comment },
        idempotencyKey: `answer-${id}`,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox() });
      pushToast({
        tone: 'ok',
        message: t('inbox.card.delivered', {
          host: String(card['hostname'] ?? '?'),
          agent: String(card['agent_type'] ?? '?'),
        }),
      });
    },
    onError: (error: Error) => pushToast({ tone: 'warn', message: error.message }),
  });

  const decide = useMutation({
    mutationFn: async (decision: Decision) => {
      // **거절에는 사유가 필수다**(REQ-WEB-022). 사유 없는 거절은 요청자에게 "다시 해보라"는
      // 말만 남기고, 그 왕복이 승인 병목(P4)을 만든다. 사유는 알림과 감사 로그 양쪽에 남는다.
      if (decision === 'reject' && comment.trim() === '') {
        setReasonRequired(true);
        throw new Error(t('inbox.card.reason_missing'));
      }
      setReasonRequired(false);
      if (isQuestion) {
        return apiFetch(`/projects/${projectSlug}/questions/${id}/answer`, {
          method: 'POST',
          body: { answer_md: comment },
          idempotencyKey: `answer-${id}`,
        });
      }

      return apiFetch(`/approvals/${id}/decision`, {
        method: 'POST',
        body: {
          decision,
          comment,
          // 카드를 연 시점의 해시를 함께 보낸다 — 그 사이 본문이 바뀌었으면 서버가 막는다.
          seen_content_hash: card['content_hash'],
        },
        idempotencyKey: `decision-${id}-${decision}`,
      });
    },
    onSuccess: (_result, decision) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox() });
      // 처리됨 트레일 — 3분 유지(ui-wireframes §4.1)
      pushToast({
        tone: 'ok',
        message: isQuestion
          ? t('inbox.card.delivered', {
              host: String(card['hostname'] ?? '?'),
              agent: String(card['agent_type'] ?? '?'),
            })
          : t('inbox.card.decided', { decision: decisionLabel(t, decision) }),
      });
    },
    onError: (error: Error) => pushToast({ tone: 'warn', message: error.message }),
  });

  useEffect(() => {
    if (active !== true) return;
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target !== null && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      if (e.key === 'a' && !isQuestion && canApprove) decide.mutate('approve');
      if (e.key === 'r' && !isQuestion) decide.mutate('reject');
      if (e.key === 'c') {
        e.preventDefault();
        commentRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, card, decide, isQuestion]);

  return (
    <article
      data-testid="approval-card"
      data-kind={isQuestion ? 'question' : 'approval'}
      className={cn(
        'rounded-nerv border bg-bg-elev px-3 py-2.5 transition-colors',
        // 포커스된 카드는 **왼쪽 띠**로 표시한다 — 링을 두르면 카드가 떠 보이고,
        // 목록을 j/k 로 훑을 때 카드가 하나씩 튀어오르는 것처럼 읽힌다
        active === true ? 'border-border-strong' : 'border-border',
      )}
    >
      <header className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge
          token={isQuestion ? 'waiting' : 'action'}
          label={isQuestion ? t('inbox.card.question') : t('inbox.key.approve')}
        />
        {!isQuestion && <Mono>{String(card['spec_key'] ?? card['task_key'] ?? '')}</Mono>}
        <span className="min-w-0 flex-1 truncate font-medium">
          {String(card['title'] ?? card['spec_title'] ?? t('inbox.card.untitled'))}
        </span>
        <span className="shrink-0 text-xs text-text-mute">
          {String(card['project_slug'] ?? '')}
        </span>
        {/* 기다린 시간은 **오래될수록 눈에 띄어야 한다** — 한 시간 넘게 묵은 요청이
            방금 온 요청과 같은 회색이면 목록의 순서만으로는 묻힌다 */}
        <span
          data-testid="waited"
          className={cn(
            'shrink-0 text-xs',
            Number(card['waiting_seconds'] ?? 0) >= 3600
              ? 'font-medium text-status-waiting'
              : 'text-text-faint',
          )}
        >
          {waitedLabel(t, Number(card['waiting_seconds'] ?? 0))}
        </span>
      </header>

      {isQuestion && (
        // 세션 신원 3요소 — 누구의 어느 머신이 멈춰 있는지(REQ-WEB-008 · D-13)
        <p data-testid="question-identity" className="mt-1.5 text-xs text-text-mute">
          {String(card['requested_by'] ?? '')} ·{' '}
          <span className="font-mono">{String(card['hostname'] ?? '')}</span> ·{' '}
          {String(card['agent_type'] ?? '')}
          {/* **왜 부르는가**를 같은 줄에 둔다 — 다섯 사유는 읽는 사람의 첫 분류다
              (제품 결정인가, 스펙 공백인가, 인프라인가). 없으면 적지 않는다 */}
          {typeof card['escalate'] === 'string' && card['escalate'] !== '' && (
            <>
              {' · '}
              <span data-testid="question-escalate">
                {t(`question.escalate.${card['escalate']}` as 'question.escalate.spec')}
              </span>
            </>
          )}
        </p>
      )}

      {/* 출처 — 사람은 요약이 아니라 원문을 보고 판단한다. 머리의 키는 한 칸뿐이라
          둘 이상이면 여기서 나머지를 잇는다 */}
      {isQuestion && (context.length > 0 || typeof card['finding_id'] === 'string') && (
        <p data-testid="question-context" className="mt-1 flex flex-wrap gap-2 text-xs">
          {context.map((item) => (
            <Link
              key={item.key}
              to={item.to}
              params={item.params as never}
              className="text-link hover:underline"
            >
              <Mono>{item.key}</Mono>
            </Link>
          ))}
          {typeof card['finding_id'] === 'string' && card['finding_id'] !== '' && (
            <span className="text-text-faint">
              <Mono>{String(card['finding_id']).slice(0, 8)}</Mono>
            </span>
          )}
        </p>
      )}

      {!(compact ?? false) && (
        <>
          {/* 본문이 없는 질문도 있다 — 빈 회색 띠를 그리면 "무언가 못 불러왔다"로 읽힌다 */}
          {String(card['body_md'] ?? '') !== '' && (
            <p className="mt-2 max-h-40 overflow-y-auto rounded-nerv-sm bg-bg-sunken px-2.5 py-2 text-sm whitespace-pre-wrap text-text-mute">
              {String(card['body_md'])}
            </p>
          )}
          {/* **선택지는 누를 수 있어야 한다.** 에이전트가 그대로 실행 가능한 답 2~4개를
              만들어 보내는데(skills/question §절차 1) 화면이 자유 서술 상자 하나로만
              받으면, 구조화한 쪽의 노력이 사라지고 재해석 드리프트가 되돌아온다.
              아래 답변 칸은 남긴다 — 고르는 것과 함께 덧붙일 말이 있을 수 있다 */}
          {isQuestion && options.length > 0 && (
            <div data-testid="question-options" className="mt-2 flex flex-wrap gap-2">
              {options.map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant="ghost"
                  disabled={answerWith.isPending}
                  onClick={() => answerWith.mutate(option)}
                  className="border border-border"
                >
                  {option}
                </Button>
              ))}
            </div>
          )}
          <Textarea
            ref={commentRef}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={
              isQuestion ? t('inbox.card.answer_placeholder') : t('inbox.card.comment_placeholder')
            }
            data-testid="decision-comment"
            className="mt-2"
            rows={2}
          />
          {reasonRequired && (
            <p
              role="alert"
              data-testid="reason-required"
              className="mt-1 text-xs text-status-danger"
            >
              {t('inbox.card.reason_required')}
            </p>
          )}
        </>
      )}

      {/* **판정은 서버가 한다**(`can_approve`) — 완화가 둘로 늘면서(소규모·admin) 화면이
          규칙을 다시 구현하면 두 벌이 되고, 두 벌이 되면 언젠가 한쪽만 고친다.
          내가 요청한 것인데 승인도 가능하면 그 사실만 조용히 적는다(admin 이 그 자리다). */}
      {card['self_requested'] === true && !isQuestion && (
        <p
          data-testid="self-requested-note"
          className={cn(
            'mt-2 rounded-nerv-sm px-2 py-1 text-xs',
            canApprove
              ? 'bg-bg-sunken text-text-mute'
              : 'bg-status-waiting-soft text-status-waiting',
          )}
        >
          {canApprove ? t('inbox.card.self_requested_admin') : t('inbox.card.self_requested')}
        </p>
      )}

      {/* 요약 카드도 **다음 걸음을 준다** — 여기서는 결정할 수 없으니(본문도 코멘트 칸도
          없다) 결정할 수 있는 곳으로 보낸다. 막다른 길을 만들지 않는다(§1.5) */}
      {(compact ?? false) && (
        <Link to="/inbox" className="mt-1.5 inline-block text-xs text-link hover:underline">
          {t('inbox.card.handle_in_inbox')}
        </Link>
      )}

      {!(compact ?? false) && (
        <footer className="mt-2.5 flex items-center gap-2">
          {isQuestion ? (
            <Button
              variant="primary"
              size="sm"
              disabled={decide.isPending || comment.trim() === ''}
              onClick={() => decide.mutate('approve')}
            >
              {t('inbox.card.send_answer')}
            </Button>
          ) : (
            <>
              <Button
                variant="primary"
                size="sm"
                data-testid="approve"
                disabled={decide.isPending || !canApprove}
                onClick={() => decide.mutate('approve')}
                title={canApprove ? undefined : t('inbox.card.self_requested_title')}
              >
                {t('inbox.key.approve')}
              </Button>
              {/* **거절은 요청자도 할 수 있다** — 서버가 막는 것은 승인뿐인데(EP-APR-03)
                  화면이 둘 다 껐다. 자기 요청을 스스로 접는 길이 없으면 그 카드는
                  다른 사람이 볼 때까지 받은편지함에 남는다 */}
              <Button
                variant="danger"
                size="sm"
                data-testid="reject"
                disabled={decide.isPending}
                onClick={() => decide.mutate('reject')}
              >
                {t('inbox.key.reject')}
              </Button>
              <Button
                size="sm"
                disabled={decide.isPending}
                onClick={() => decide.mutate('comment')}
              >
                {t('inbox.key.comment')}
              </Button>
              {active === true && (
                <span className="ml-auto text-2xs text-text-faint">{t('inbox.card.keys')}</span>
              )}
            </>
          )}
        </footer>
      )}
    </article>
  );
}

function decisionLabel(t: Translator, decision: Decision): string {
  if (decision === 'approve') return t('inbox.decision.approve');
  if (decision === 'reject') return t('inbox.decision.reject');
  return t('inbox.decision.comment');
}
