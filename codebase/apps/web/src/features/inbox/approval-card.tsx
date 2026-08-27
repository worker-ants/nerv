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
  const id = String(card['id']);
  const projectSlug = String(card['project_slug'] ?? '');

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
      if (e.key === 'a' && !isQuestion && card['self_requested'] !== true) decide.mutate('approve');
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
        <Mono>{String(card['spec_key'] ?? card['task_key'] ?? '')}</Mono>
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
        </p>
      )}

      {!(compact ?? false) && (
        <>
          <p className="mt-2 max-h-40 overflow-y-auto rounded-nerv-sm bg-bg-sunken px-2.5 py-2 text-sm whitespace-pre-wrap text-text-mute">
            {String(card['body_md'] ?? '')}
          </p>
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

      {card['self_requested'] === true && !isQuestion && (
        // 지시자≠승인자 — 서버가 최종 판정하지만, 누를 수 없는 버튼의 이유는 미리 보여준다
        <p className="mt-2 rounded-nerv-sm bg-status-waiting-soft px-2 py-1 text-xs text-status-waiting">
          {t('inbox.card.self_requested')}
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
                disabled={decide.isPending || card['self_requested'] === true}
                onClick={() => decide.mutate('approve')}
                title={
                  card['self_requested'] === true ? t('inbox.card.self_requested_title') : undefined
                }
              >
                {t('inbox.key.approve')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={decide.isPending || card['self_requested'] === true}
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
