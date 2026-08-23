// 승인 카드 — 스펙 승인·플랜·질문 3유형 (ui-wireframes §2.7 · spec-workflow §6.4)
//
// 카드가 반드시 실어야 하는 것: **무엇을 승인하는가**(대상 + 델타) · **누가 요청했나** ·
// **얼마나 기다렸나**. 마지막 항목이 빠지면 오래된 요청이 새 요청 밑에 묻힌다.
//
// 질문 카드는 세션 신원 3요소(사용자·hostname·에이전트 종류)를 함께 싣는다(REQ-WEB-008) —
// "어느 머신의 누구를 멈춰 세우고 있나"가 답변 우선순위를 정하기 때문이다.

import { Link } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import { cn } from '../../lib/utils.js';
import { StatusBadge } from '../../components/status-badge.js';
import { Button, Mono, Textarea } from '../../components/ui/primitives.js';

export type Decision = 'approve' | 'reject' | 'comment';

export function waitedLabel(seconds: number): string {
  if (seconds < 60) return '방금';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 대기`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 대기`;
  return `${Math.floor(seconds / 86400)}일 대기`;
}

export interface ApprovalCardProps {
  card: Record<string, unknown>;
  compact?: boolean;
  /** 승인함이 포커스한 카드 — j/k 로 옮겨온 카드에 a/r/c 가 꽂힌다(REQ-WEB-025) */
  active?: boolean;
}

export function ApprovalCard({ card, compact, active }: ApprovalCardProps): React.JSX.Element {
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
        throw new Error('거절 사유를 적어주세요.');
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
          ? `요청 세션 ${String(card['hostname'] ?? '?')}/${String(card['agent_type'] ?? '?')} 에 전달됨`
          : `${decisionLabel(decision)} 처리됐습니다.`,
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
          label={isQuestion ? '질문' : '승인'}
        />
        <Mono>{String(card['spec_key'] ?? card['task_key'] ?? '')}</Mono>
        <span className="min-w-0 flex-1 truncate font-medium">
          {String(card['title'] ?? card['spec_title'] ?? '(제목 없음)')}
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
          {waitedLabel(Number(card['waiting_seconds'] ?? 0))}
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
            placeholder={isQuestion ? '답변' : '코멘트 — 거절에는 필수'}
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
              거절에는 사유가 필요합니다 — 요청자 알림과 감사 로그에 남습니다.
            </p>
          )}
        </>
      )}

      {card['self_requested'] === true && !isQuestion && (
        // 지시자≠승인자 — 서버가 최종 판정하지만, 누를 수 없는 버튼의 이유는 미리 보여준다
        <p className="mt-2 rounded-nerv-sm bg-status-waiting-soft px-2 py-1 text-xs text-status-waiting">
          내가 요청한 항목입니다 — 다른 승인자가 처리해야 합니다.
        </p>
      )}

      {/* 요약 카드도 **다음 걸음을 준다** — 여기서는 결정할 수 없으니(본문도 코멘트 칸도
          없다) 결정할 수 있는 곳으로 보낸다. 막다른 길을 만들지 않는다(§1.5) */}
      {(compact ?? false) && (
        <Link to="/inbox" className="mt-1.5 inline-block text-xs text-link hover:underline">
          승인함에서 처리 ▸
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
              답변 보내기
            </Button>
          ) : (
            <>
              <Button
                variant="primary"
                size="sm"
                disabled={decide.isPending || card['self_requested'] === true}
                onClick={() => decide.mutate('approve')}
                title={
                  card['self_requested'] === true
                    ? '지시자는 자기 산출물을 승인할 수 없습니다'
                    : undefined
                }
              >
                승인
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={decide.isPending || card['self_requested'] === true}
                onClick={() => decide.mutate('reject')}
              >
                거절
              </Button>
              <Button
                size="sm"
                disabled={decide.isPending}
                onClick={() => decide.mutate('comment')}
              >
                코멘트
              </Button>
              {active === true && (
                <span className="ml-auto text-2xs text-text-faint">
                  <kbd>a</kbd> 승인 · <kbd>r</kbd> 거절 · <kbd>c</kbd> 코멘트
                </span>
              )}
            </>
          )}
        </footer>
      )}
    </article>
  );
}

function decisionLabel(decision: Decision): string {
  return decision === 'approve' ? '승인' : decision === 'reject' ? '거절' : '코멘트';
}
