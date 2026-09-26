// 승인 카드 — 스펙 승인·플랜·질문 3유형 (ui-wireframes §2.7 · spec-workflow §6.4)
//
// 카드가 반드시 실어야 하는 것: **무엇을 승인하는가**(대상 + 델타) · **누가 요청했나** ·
// **얼마나 기다렸나**. 마지막 항목이 빠지면 오래된 요청이 새 요청 밑에 묻힌다.
//
// 질문 카드는 세션 신원 3요소(사용자·hostname·에이전트 종류)를 함께 싣는다(REQ-WEB-008) —
// "어느 머신의 누구를 멈춰 세우고 있나"가 답변 우선순위를 정하기 때문이다.

import { useT } from '../../lib/i18n.js';
import { useApiError } from '../../lib/api-errors.js';
import { relativeTime } from '../../lib/format.js';
import { Link } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MessageKey, Translator } from '@nerv/schema';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { usePressKey } from '../../lib/press-key.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useSpecVersion } from '../../lib/queries.js';
import { useRealtime } from '../../lib/realtime.js';
import { inOrgHref, useScope } from '../../lib/scope.js';
import { cn } from '../../lib/utils.js';
import { StatusBadge } from '../../components/status-badge.js';
import { Button, Kbd, Mono, Textarea } from '../../components/ui/primitives.js';
import { ScopeBadge } from '../../components/scope-badge.js';
import { DECISION_GRACE_MS, useGrace } from './decision-grace.js';

export type Decision = 'approve' | 'reject' | 'comment';

/** 카드가 5초 들고 있는 것 — 누른 순간의 코멘트까지 함께 든다(그 사이 고친 글이 실리지 않게) */
type Held =
  | { kind: 'decision'; decision: Decision; comment: string }
  | { kind: 'answer'; choice: string; comment: string };

/**
 * 제목 재료가 없는 대상의 이름(REQ-WEB-133 — "제목이 없으면 그 종류의 이름").
 *
 * 목록 질의는 `spec_version` 에만 제목을 JOIN 하므로(`approval.service.ts`) **플랜·발견·
 * 게이트 우회 카드는 제목 없이 온다.** 2026-09-06 까지 폴백이 `gate_bypass` 하나뿐이라
 * 나머지가 **"(제목 없음)"** 으로 떴다 — 매뉴얼이 "큰 작업 앞에 선다" 고 설명하는 플랜
 * 승인 카드가 그것이었고, `inbox.subject.plan` 은 카탈로그에 있으면서 참조가 0건이었다.
 *
 * `approval_subject_type` 전 값을 여기서 갖는다. 값이 늘면 **타입이 먼저 막는다** —
 * 조용히 "(제목 없음)" 으로 떨어지지 않게 하는 것이 이 표의 목적이다.
 */
const SUBJECT_FALLBACK = {
  spec_version: 'inbox.subject.spec_version',
  change_request: 'inbox.subject.change_request',
  plan: 'inbox.subject.plan',
  question: 'inbox.subject.question',
  gate_bypass: 'inbox.subject.gate_bypass',
  finding: 'inbox.subject.finding',
} as const satisfies Record<string, MessageKey>;

export function subjectFallback(t: Translator, subjectType: unknown): string {
  const key = SUBJECT_FALLBACK[subjectType as keyof typeof SUBJECT_FALLBACK];
  return key === undefined ? t('inbox.card.untitled') : t(key);
}

/**
 * 토스트가 부르는 카드의 이름 — 키와 제목. 카드는 결정하는 순간 목록에서 사라지므로
 * 무엇을 처리했는지는 이 한 줄에만 남는다(REQ-WEB-197).
 */
export function subjectLabel(t: Translator, card: Record<string, unknown>): string {
  const key = String(card['spec_key'] ?? card['task_key'] ?? '');
  const title = String(
    card['title'] ?? card['spec_title'] ?? subjectFallback(t, card['subject_type']),
  );
  return key === '' ? title : `${key} ${title}`;
}

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
  path: string;
}[] {
  const proj = String(card['project_slug'] ?? '');
  const out: { key: string; to: string; params: Record<string, string>; path: string }[] = [];
  const specKey = card['spec_key'];
  const taskKey = card['task_key'];
  if (typeof specKey === 'string' && specKey !== '') {
    out.push({
      key: specKey,
      to: '/p/$proj/specs/$spec',
      params: { proj, spec: specKey },
      path: `/p/${proj}/specs/${specKey}`,
    });
  }
  if (typeof taskKey === 'string' && taskKey !== '') {
    out.push({
      key: taskKey,
      to: '/p/$proj/tasks/$task',
      params: { proj, task: taskKey },
      path: `/p/${proj}/tasks/${taskKey}`,
    });
  }
  return out;
}

/**
 * 카드가 **화면에 보이는가**(2026-09-24 — UI/UX 검토 · REQ-WEB-204).
 *
 * 키보드 커서와 사람이 보고 있는 카드가 갈려, 트랙패드로 다섯째 카드까지 내려가 읽은 사람이 `a` 를
 * 누르면 **화면 위로 밀려난 첫째 카드**가 승인됐다. 결정 키는 보이는 카드에만 꽂힌다 — 보이지 않으면
 * 첫 키는 그 카드를 데려와 보여 줄 뿐 아무것도 결정하지 않는다.
 *
 * 레이아웃이 없는 환경(크기 0)은 판정하지 않는다 — 그런 자리에서 막으면 키가 영영 안 먹는다.
 */
export function inView(el: Element | null): boolean {
  if (el === null) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return true;
  const visible = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
  // 카드의 절반 또는 화면 높이의 삼분의 일 이상 보여야 "보고 있다" 로 친다
  return visible >= Math.min(r.height / 2, window.innerHeight / 3);
}

/**
 * 승인 카드가 가리키는 것 — 스펙 · 플랜(그 작업) · 발견(리뷰 센터의 그 발견).
 * 예전에는 스펙 하나뿐이라(주석은 "작업 결재는 없다" 였다 — 사실이 아니었다) 플랜·발견 카드가
 * 대상을 가리키지 않았다(REQ-WEB-204).
 */
function subjectLinkOf(card: Record<string, unknown>): {
  key: string;
  to: string;
  params: Record<string, string>;
  path: string;
  search?: Record<string, string | number>;
} | null {
  const proj = String(card['project_slug'] ?? '');
  if (proj === '') return null;
  const specKey = card['spec_key'];
  if (typeof specKey === 'string' && specKey !== '') {
    // **결재할 그 버전을 연다**(2026-09-24 · SPEC-01 · REQ-WEB-214). 링크가 버전을 싣지 않아 리뷰어는
    // 판단해야 할 v4 가 아니라 승인본 v3 를 읽었다 — 카드 안 미리보기는 v4 를 보이면서
    const versionNo = Number(card['version_no']);
    const pinned = Number.isInteger(versionNo) && versionNo > 0;
    return {
      key: specKey,
      to: '/p/$proj/specs/$spec',
      params: { proj, spec: specKey },
      path: `/p/${proj}/specs/${specKey}${pinned ? `?v=${String(versionNo)}` : ''}`,
      ...(pinned ? { search: { v: versionNo } } : {}),
    };
  }
  const taskKey = card['task_key'];
  if (card['subject_type'] === 'plan' && typeof taskKey === 'string' && taskKey !== '') {
    return {
      key: taskKey,
      to: '/p/$proj/tasks/$task',
      params: { proj, task: taskKey },
      path: `/p/${proj}/tasks/${taskKey}`,
    };
  }
  const findingId = card['finding_id'];
  if (card['subject_type'] === 'finding' && typeof findingId === 'string' && findingId !== '') {
    return {
      key: findingId.slice(0, 8),
      to: '/p/$proj/reviews',
      params: { proj },
      path: `/p/${proj}/reviews?finding=${findingId}`,
      search: { finding: findingId },
    };
  }
  return null;
}

/** 스펙 카드의 변경분 — 직전 버전과의 diff 주소(알림과 같은 규칙 · REQ-WEB-163). v1 이면 없다 */
function diffSearchOf(card: Record<string, unknown>): Record<string, string> | undefined {
  const version = Number(card['version_no']);
  if (!Number.isInteger(version) || version < 2) return undefined;
  return { diff: `v${String(version - 1)}..v${String(version)}` };
}

/**
 * 카드 안의 링크 — **다른 조직의 카드면 조직을 먼저 바꾸고** 그 자리로 간다(REQ-WEB-199).
 *
 * 받은 요청은 모든 조직을 싣는데 조직은 주소가 아니라 기억에 있다. 다른 조직 카드의 문서
 * 링크를 그대로 따라가면 서버는 지금 조직 안에서 프로젝트를 찾고 "없다" 고 답했다.
 */
function CardLink({
  orgSlug,
  currentOrg,
  path,
  to,
  params,
  search,
  testId,
  children,
}: {
  orgSlug: unknown;
  currentOrg: string | null;
  /** 같은 곳의 주소 — 조직을 바꾼 뒤 착지할 자리 */
  path: string;
  to: string;
  params: Record<string, string>;
  search?: Record<string, string | number>;
  testId?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const routed = inOrgHref(orgSlug, path, currentOrg);
  if (routed !== path && typeof orgSlug === 'string') {
    return (
      <Link
        to="/o/$org"
        params={{ org: orgSlug }}
        search={{ next: path }}
        data-testid={testId}
        className="text-link hover:underline"
      >
        {children}
      </Link>
    );
  }
  return (
    <Link
      to={to}
      params={params as never}
      search={search as never}
      data-testid={testId}
      className="text-link hover:underline"
    >
      {children}
    </Link>
  );
}

/** 일괄 결정에서 이 카드가 못 지나간 이유(REQ-WEB-183) — 서버가 준 것을 그대로 싣는다 */
export interface CardFailure {
  kind: string | null;
  message: string;
}

export interface ApprovalCardProps {
  card: Record<string, unknown>;
  compact?: boolean;
  /** 받은 요청이 포커스한 카드 — j/k 로 옮겨온 카드에 a/r/c 가 꽂힌다(REQ-WEB-025) */
  active?: boolean;
  /**
   * 단축키만 끈다 — 일괄 확인 패널이 열려 있는 동안이다(REQ-WEB-182).
   *
   * `active` 를 내리는 것으로 대신하지 않는 이유: 그러면 포커스 표시까지 함께 사라져,
   * 확인을 취소한 사람이 자기가 어디 있었는지 잃는다.
   */
  keysOff?: boolean;
  /** 일괄 선택 대상인가 — 대기 탭의 승인 카드에만 선다(질문·처리됨에는 없다) */
  selectable?: boolean;
  selected?: boolean;
  onToggle?: (id: string) => void;
  /** 방금 일괄에서 실패한 카드 — 왜 안 됐는지 카드가 말한다 */
  failure?: CardFailure;
}

export function ApprovalCard({
  card,
  compact,
  active,
  keysOff,
  selectable,
  selected,
  onToggle,
  failure,
}: ApprovalCardProps): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();
  const [comment, setComment] = useState('');
  const [reasonRequired, setReasonRequired] = useState(false);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  /** 보이지 않는 카드에 결정 키가 왔다 — 데려와 잠깐 강조한다 */
  const [nudged, setNudged] = useState(false);
  const isQuestion = card['subject_type'] === 'question';
  // 결정된 카드인가 — 처리됨 탭의 카드는 조작 대상이 아니라 기록이다(2026-09-03)
  const decided = (card['decision'] ?? null) as string | null;
  const [showBody, setShowBody] = useState(false);
  // 카드의 주어 — 승인은 스펙 한 편이고, 질문은 아래 `context` 가 여럿을 잇는다
  const subjectLink = subjectLinkOf(card);
  const { orgSlug: currentOrg } = useScope();
  const subject = useSpecVersion(
    String(card['project_slug'] ?? ''),
    subjectLink?.params['spec'] ?? '',
    typeof card['version_no'] === 'number' ? card['version_no'] : null,
    showBody && subjectLink?.to === '/p/$proj/specs/$spec',
  );
  // 서버가 판정한 값이다 — 예전 판정(`self_requested !== true`)은 완화를 몰랐다.
  // 낡은 응답에는 이 필드가 없을 수 있으니 그때만 예전 규칙으로 떨어진다.
  const canApprove =
    typeof card['can_approve'] === 'boolean'
      ? card['can_approve']
      : card['self_requested'] !== true;
  /**
   * **왜 못 누르는가**(2026-09-07 · REQ-WEB-145). 서버가 이유를 함께 준다 —
   * 화면은 그것을 문장으로 바꾸기만 한다. 이유 없는 잠긴 단추는 고장 난 화면으로 읽힌다.
   */
  const lockReason = ((): string | null => {
    if (canApprove || isQuestion) return null;
    const reason = card['can_approve_reason'];
    switch (reason) {
      case 'author':
        return t('inbox.card.cannot_approve.author');
      case 'session_owner':
        return t('inbox.card.cannot_approve.session_owner');
      case 'missing_role':
      case 'not_in_role_queue':
        return t('inbox.card.cannot_approve.missing_role');
      case 'already_approved':
        return t('inbox.card.cannot_approve.already_approved');
      case 'not_assignee':
        return t('inbox.card.cannot_approve.not_assignee');
      case 'self_requested':
        return t('inbox.card.self_requested');
      default:
        // 서버가 이유를 주지 않는 옛 응답 — 예전 문구로 물러선다
        return card['self_requested'] === true ? t('inbox.card.self_requested') : null;
    }
  })();
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
  // 멱등 키는 **누름마다** 새로 만든다(REQ-WEB-195) — 카드 id 로 만들면 같은 카드의 두 번째
  // 코멘트가 첫 코멘트의 재생이 되거나(같은 글) `idempotency_mismatch` 로 막힌다(다른 글).
  const answerPress = usePressKey('answer');
  const decidePress = usePressKey('decision');

  const answerWith = useMutation({
    mutationFn: ({ choice, comment }: { choice: string; comment: string }) =>
      apiFetch(`/projects/${projectSlug}/questions/${id}/answer`, {
        method: 'POST',
        body: { answer_key: choice, answer_md: comment },
        idempotencyKey: answerPress.take(),
      }),
    onSettled: answerPress.release,
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
    onError: onApiError,
  });

  const decide = useMutation({
    mutationFn: async ({ decision, comment }: { decision: Decision; comment: string }) => {
      if (isQuestion) {
        return apiFetch(`/projects/${projectSlug}/questions/${id}/answer`, {
          method: 'POST',
          body: { answer_md: comment },
          idempotencyKey: decidePress.take(),
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
        idempotencyKey: decidePress.take(),
      });
    },
    onSettled: decidePress.release,
    onSuccess: (result, { decision }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox() });
      // **아직 확정이 아니면 그렇게 말한다**(2026-09-07 · REQ-WEB-146). T3 는 서로 다른
      // 두 사람이 승인해야 문서가 움직이는데, "승인했습니다" 만 뜨면 승인자는 자기가
      // 마지막 결재라고 믿는다 — 그것이 게이트가 조용히 약해지는 자리다.
      const quorum = (
        result as { quorum?: { given: number; required: number; satisfied: boolean } }
      )?.quorum;
      if (!isQuestion && decision === 'approve' && quorum?.satisfied === false) {
        pushToast({
          tone: 'warn',
          message: t('inbox.card.quorum_pending', {
            n: quorum.required - quorum.given,
            role: String(card['assignee_role'] ?? t('inbox.card.role_queue_any')),
          }),
        });
        return;
      }
      // 처리됨 트레일 — 3분 유지(ui-wireframes §4.1). **무엇을** 처리했는지 말한다(REQ-WEB-197):
      // a 를 다섯 번 누른 사람의 화면에 "승인 처리됐습니다." 다섯 장이 쌓이면 어느 문서였는지
      // 한 줄도 남지 않는다 — 카드는 목록에서 이미 사라졌다.
      pushToast({
        tone: 'ok',
        kind: 'trail',
        message: isQuestion
          ? t('inbox.card.delivered', {
              host: String(card['hostname'] ?? '?'),
              agent: String(card['agent_type'] ?? '?'),
            })
          : t('inbox.card.decided', {
              subject: subjectLabel(t, card),
              decision: decisionLabel(t, decision),
            }),
        ...(subjectLink === null
          ? {}
          : {
              href: inOrgHref(card['org_slug'], subjectLink.path, currentOrg),
              hrefLabel: t('shell.toast.open'),
            }),
      });
    },
    onError: onApiError,
  });

  /**
   * **보내기 전 5초**(2026-09-25 · 사람 결정 D7 · REQ-WEB-237). 누른 결정은 카드가 들고 있다가
   * 보낸다 — 그 사이 [취소]·`z` 로 무른다. 서버에 철회 경로가 없어 트레일의 "되돌리기" 는 문구만
   * 있는 약속이었고, 철회 API 는 감사·게이트의 뜻이 무거워 따로 정한다.
   */
  const grace = useGrace<Held>((held) => {
    if (held.kind === 'answer') answerWith.mutate(held);
    else decide.mutate(held);
  });
  const sending = decide.isPending || answerWith.isPending;
  const busy = grace.pending !== null || sending;
  const cancelRef = useRef<HTMLButtonElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const hold = (held: Held): void => {
    // 단추를 눌러 들었으면 [취소]로 포커스를 옮긴다 — 누른 단추가 사라져 포커스가 body 로 떨어지지
    // 않게. 키(a·r)로 들었으면 카드에 둔다 — j/k 로 다음 카드로 가는 흐름을 끊지 않는다
    const fromButton =
      footerRef.current?.contains(document.activeElement) === true ||
      (document.activeElement instanceof HTMLElement &&
        document.activeElement.closest('[data-testid="question-options"]') !== null);
    grace.hold(held);
    if (fromButton) window.setTimeout(() => cancelRef.current?.focus(), 0);
  };
  const cancelHeld = (): void => {
    grace.cancel();
    articleRef.current?.focus();
  };
  const heldLabel = ((): string | null => {
    const held = grace.pending;
    if (held === null) return null;
    if (held.kind === 'answer') return t('inbox.grace.answer_option', { option: held.choice });
    return isQuestion ? t('inbox.grace.answer') : decisionLabel(t, held.decision);
  })();

  /**
   * **거절에는 사유가 필수다**(REQ-WEB-022). 사유 없는 거절은 요청자에게 "다시 해보라" 는 말만
   * 남기고, 그 왕복이 승인 병목(P4)을 만든다.
   *
   * 이 검사는 **요청 앞에서** 한다(REQ-WEB-196). 예전에는 `mutationFn` 안에서 던져서, 카드 아래의
   * 빨간 문장과 같은 뜻의 경고 토스트가 한 번 더 떴고 사유 칸으로 가는 길은 없었다 — 보낼 수
   * 없는 것을 보내 보고 실패를 알리는 대신, 보내지 않고 쓸 자리로 데려간다.
   */
  const requestDecision = (decision: Decision): void => {
    if (!isQuestion && decision === 'reject' && comment.trim() === '') {
      setReasonRequired(true);
      commentRef.current?.focus();
      return;
    }
    setReasonRequired(false);
    hold({ kind: 'decision', decision, comment });
  };

  useEffect(() => {
    if (active !== true || keysOff === true) return;
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target !== null && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      // **단추와 같은 조건이다.** 결정된 카드에서는 단추가 사라지는데 키는 살아 있어,
      // `a` 를 누르면 요청이 나가고 `already_decided` 오류 토스트가 떴다 — 이 파일이
      // 아래에서 "누를 수 있는 것은 할 수 있다는 뜻이어야 한다" 고 적어 두고 키에는
      // 적용하지 않은 자리다(2026-09-05 감사).
      if (decided !== null) return;
      // 들고 있는 결정을 무른다 — 들고 있거나 보내는 동안에는 다른 결정 키를 받지 않는다
      if (e.key === 'z' && grace.pending !== null) {
        e.preventDefault();
        cancelHeld();
        return;
      }
      if (busy) return;
      if ((e.key === 'a' || e.key === 'r') && !isQuestion && !inView(articleRef.current)) {
        // **보이지 않는 카드는 결정하지 않는다**(REQ-WEB-204) — 데려와 보여 줄 뿐이다
        articleRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        setNudged(true);
        window.setTimeout(() => setNudged(false), 1500);
        return;
      }
      if (e.key === 'a' && !isQuestion && canApprove) requestDecision('approve');
      if (e.key === 'r' && !isQuestion) requestDecision('reject');
      if (e.key === 'c') {
        e.preventDefault();
        commentRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, keysOff, card, isQuestion, decided, requestDecision, busy, grace.pending]);

  return (
    <article
      ref={articleRef}
      // 코멘트 칸에서 Esc 로 나오면 포커스가 여기로 온다 — 카드 단축키가 다시 먹는다
      tabIndex={-1}
      data-testid="approval-card"
      data-kind={isQuestion ? 'question' : 'approval'}
      data-nudged={nudged || undefined}
      className={cn(
        'rounded-nerv border bg-bg-elev px-3 py-2.5 transition-colors outline-none',
        nudged && 'bg-status-action-soft',
        // 포커스된 카드는 **왼쪽 띠**로 표시한다 — 링을 두르면 카드가 떠 보이고,
        // 목록을 j/k 로 훑을 때 카드가 하나씩 튀어오르는 것처럼 읽힌다
        active === true ? 'border-border-strong' : 'border-border',
      )}
    >
      <header className="flex flex-wrap items-center gap-2 text-sm">
        {/* **선택은 결정이 아니다.** 체크박스는 일괄에 넣는 표시일 뿐이라 여기서 아무것도
            움직이지 않는다 — 움직이는 것은 아래 확인 패널을 지난 뒤다(REQ-WEB-181) */}
        {selectable === true && (
          <input
            type="checkbox"
            data-testid="bulk-select"
            aria-label={t('inbox.bulk.select_card')}
            checked={selected === true}
            onChange={() => onToggle?.(id)}
            className="size-3.5 shrink-0 accent-status-action"
          />
        )}
        <StatusBadge
          token={isQuestion ? 'waiting' : 'action'}
          label={isQuestion ? t('inbox.card.question') : t('inbox.key.approve')}
        />
        {/* **키는 손잡이가 아니라 문이다**(2026-08-31 — 사람 요청). 예전에는 글자였을 뿐이라
            그 문서를 보려면 스펙 목록에서 손으로 찾아야 했다 */}
        {!isQuestion && subjectLink !== null && (
          <CardLink
            orgSlug={card['org_slug']}
            currentOrg={currentOrg}
            path={subjectLink.path}
            to={subjectLink.to}
            params={subjectLink.params}
            {...(subjectLink.search === undefined ? {} : { search: subjectLink.search })}
            testId="subject-link"
          >
            <Mono>{subjectLink.key}</Mono>
          </CardLink>
        )}
        {!isQuestion && subjectLink === null && (
          <Mono>{String(card['spec_key'] ?? card['task_key'] ?? '')}</Mono>
        )}
        <span className="min-w-0 flex-1 truncate font-medium">
          {String(
            card['title'] ??
              card['spec_title'] ??
              card['task_title'] ??
              card['finding_title'] ??
              // "(제목 없음)" 은 사람에게 아무것도 말하지 않는다(실측 2026-09-03: 처리됨
              // 카드가 그랬다) — 종류의 이름이라도 말한다.
              subjectFallback(t, card['subject_type']),
          )}
        </span>
        {/* **세션을 멈춰 세운 질문**은 행동하는 카드에서도 그렇다고 말한다 — 홈의 줄에만 있었다 */}
        {isQuestion && card['urgency'] === 'blocking' && (
          <StatusBadge
            data-testid="card-blocking"
            token="waiting"
            mark={null}
            label={t('home.todo.blocking')}
          />
        )}
        {/* **어느 조직·프로젝트의 일인가**(REQ-WEB-192) — 받은 요청은 조직을 가로지른다 */}
        <ScopeBadge
          className="shrink-0"
          orgSlug={card['org_slug']}
          orgName={card['org_name']}
          projectSlug={card['project_slug']}
          projectName={card['project_name']}
        />
        {/* **몇 명 중 몇 명인지 보인다**(2026-09-07 · REQ-WEB-146). T3 는 서로 다른 두 사람이
            승인해야 확정되는데, 카드가 그 사실을 말하지 않으면 첫 승인자는 자기가 마지막
            결재라고 믿는다 — 조용히 약해진 게이트는 없는 게이트보다 나쁘다. */}
        {Number(card['approvals_required'] ?? 1) > 1 && (
          <StatusBadge
            data-testid="quorum"
            token="waiting"
            mark={null}
            label={t('inbox.card.quorum', {
              given: Number(card['approvals_given'] ?? 0),
              required: Number(card['approvals_required'] ?? 1),
            })}
          />
        )}
        {typeof card['assignee_role'] === 'string' && (
          <span data-testid="role-queue" className="shrink-0 text-xs text-text-faint">
            {t('inbox.card.role_queue', { role: card['assignee_role'] })}
          </span>
        )}
        {/* 기다린 시간은 **오래될수록 눈에 띄어야 한다** — 한 시간 넘게 묵은 요청이
            방금 온 요청과 같은 회색이면 목록의 순서만으로는 묻힌다 */}
        {/* **결정된 카드는 기다리는 중이 아니다**(2026-09-03). 처리됨 탭에서도 대기 시간이
            계속 흘러 "9일 대기" 라고 적혀 있었다 — 그 값은 requested_at 기준이라 결정한
            뒤에도 자란다. 결정된 것은 무엇을 언제 정했는지를 말한다. */}
        {decided === null ? (
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
        ) : (
          <span data-testid="decided-at" className="shrink-0 text-xs text-text-faint">
            {t('inbox.card.decided_at', {
              decision: decisionLabel(t, decided as Decision),
              when: relativeTime(t, String(card['decided_at'] ?? '')),
            })}
          </span>
        )}
      </header>

      {!isQuestion && (
        // **누가 · 어느 세션이 · 무엇을**(2026-09-24 — UI/UX 검토 · REQ-WEB-204). 요청자·세션 줄은
        // 질문 카드에만 있었고, 플랜·발견 카드는 대상조차 가리키지 않았다 — critical 하향 승인이
        // 무엇을 내리는지 모른 채 켜져 있었다
        <div className="mt-1.5 flex flex-col gap-1 text-xs text-text-mute">
          <p data-testid="request-line" className="flex flex-wrap items-center gap-x-1.5">
            <span>
              {t('inbox.card.requested_by', { who: String(card['requested_by'] ?? '—') })}
            </span>
            {typeof card['requested_hostname'] === 'string' && (
              <span className="font-mono text-text-faint">
                · {card['requested_hostname']} · {String(card['requested_agent_type'] ?? '')}
              </span>
            )}
            {card['session_waiting'] === true && (
              <StatusBadge
                data-testid="session-waiting"
                token="waiting"
                mark={null}
                label={t('inbox.card.session_waiting')}
              />
            )}
          </p>
          <TargetLine card={card} currentOrg={currentOrg} />
        </div>
      )}

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
            <CardLink
              key={item.key}
              orgSlug={card['org_slug']}
              currentOrg={currentOrg}
              path={item.path}
              to={item.to}
              params={item.params}
            >
              <Mono>{item.key}</Mono>
            </CardLink>
          ))}
          {/* 발견도 갈 곳이 있다 — 예전에는 짧은 id 만 적혀 있어서 그 지적을 보려면
              리뷰 큐에서 손으로 찾아야 했다(2026-08-31 — 사람 요청). 주소가 가리키는
              발견이 이미 처분됐으면 리뷰 센터가 필터를 풀어 보여준다 */}
          {typeof card['finding_id'] === 'string' && card['finding_id'] !== '' && (
            <CardLink
              orgSlug={card['org_slug']}
              currentOrg={currentOrg}
              path={`/p/${String(card['project_slug'] ?? '')}/reviews?finding=${String(card['finding_id'])}`}
              to="/p/$proj/reviews"
              params={{ proj: String(card['project_slug'] ?? '') }}
              search={{ finding: String(card['finding_id']) }}
              testId="finding-link"
            >
              <Mono>{String(card['finding_id']).slice(0, 8)}</Mono>
            </CardLink>
          )}
        </p>
      )}

      {/* **문서를 여기서 연다**(2026-08-31 — 사람 요청). 결재하려면 본문을 봐야 하는데
          카드에는 제목과 키뿐이었다 — 다른 탭에서 열고 돌아오는 왕복이 승인 병목(P4)이다.
          **목록을 무겁게 하지 않으려고 펼칠 때 받아 온다**: 결재 목록에 본문을 싣는 것과
          펼친 하나를 받는 것은 다른 비용이다. 그리고 **검토 중인 그 버전**을 받는다 —
          카드가 보여준 것과 승인되는 것이 같아야 한다(§2.3). */}
      {!(compact ?? false) && !isQuestion && subjectLink?.to === '/p/$proj/specs/$spec' && (
        <div className="mt-2">
          <Button
            size="xs"
            variant="subtle"
            data-testid="toggle-body"
            aria-expanded={showBody}
            onClick={() => setShowBody(!showBody)}
          >
            {showBody ? t('inbox.card.hide_body') : t('inbox.card.show_body')}
          </Button>
          {showBody && (
            <div
              data-testid="subject-body"
              className="mt-1.5 max-h-80 overflow-y-auto rounded-nerv-sm bg-bg-sunken px-2.5 py-2 text-sm whitespace-pre-wrap text-text-mute"
            >
              {subject.isPending
                ? t('common.loading')
                : subject.isError
                  ? t('inbox.card.body_failed')
                  : String(subject.data?.['body_md'] ?? '') === ''
                    ? t('inbox.card.body_empty')
                    : String(subject.data?.['body_md'])}
            </div>
          )}
        </div>
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
                  disabled={busy}
                  onClick={() => hold({ kind: 'answer', choice: option, comment })}
                  className="border border-border"
                >
                  {option}
                </Button>
              ))}
            </div>
          )}
          {/* **결정에 남긴 말은 남는다**(2026-09-24 · REQ-WEB-133). 거절에는 사유가
              필수인데(REQ-WEB-022) 그 문장을 읽을 곳이 처리됨 탭에 없었다 — 무엇을 언제
              정했는지는 적히면서 **왜** 가 빠져 있었고, 나중에 그 카드를 여는 사람이
              찾는 것이 바로 그 한 줄이다. 코멘트 결정(`comment`)의 말도 여기 든다. */}
          {decided !== null && String(card['comment_md'] ?? '') !== '' && (
            <div
              data-testid="decision-note"
              className="mt-2 rounded-nerv-sm bg-bg-sunken px-2.5 py-2 text-sm"
            >
              <span className="block text-2xs text-text-faint">
                {t('inbox.card.decision_note')}
              </span>
              <span className="mt-0.5 block whitespace-pre-wrap text-text-mute">
                {String(card['comment_md'])}
              </span>
            </div>
          )}
          {/* 결정된 카드에는 입력 칸을 두지 않는다(2026-09-03) — 처리됨 탭에서 코멘트를
              적고 [승인] 을 눌러도 서버는 already_decided 로 거절한다. 누를 수 있는 것은
              할 수 있다는 뜻이어야 한다. */}
          {decided === null && (
            <Textarea
              ref={commentRef}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              // 들고 있는 동안 고친 글은 실리지 않는다 — 그러니 고치지 못하게 한다
              readOnly={busy}
              placeholder={
                isQuestion
                  ? t('inbox.card.answer_placeholder')
                  : t('inbox.card.comment_placeholder')
              }
              // **칸 안에서도 키보드로 끝낸다**(REQ-WEB-204). 범례는 "키보드로 완결" 을 약속하는데,
              // c 로 들어온 칸에는 보낼 키도 나올 키도 없었다(입력 칸에서는 카드 단축키가 꺼진다)
              onKeyDown={(e) => {
                const mod = e.metaKey || e.ctrlKey;
                if (e.key === 'Enter' && mod) {
                  e.preventDefault();
                  if (busy) return;
                  if (isQuestion) {
                    if (comment.trim() !== '') requestDecision('approve');
                  } else requestDecision(e.shiftKey ? 'reject' : 'comment');
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  articleRef.current?.focus();
                }
              }}
              data-testid="decision-comment"
              className="mt-2"
              rows={2}
            />
          )}
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

      {/* **일괄에서 빠진 카드는 그 사실을 말한다**(REQ-WEB-183). 20건을 눌렀는데 18건만
          사라지고 둘이 조용히 남으면, 사람은 그 둘을 처리했다고 믿거나 화면이 고장 났다고
          읽는다 — 어느 쪽이든 목록을 못 믿게 되는 자리다. */}
      {failure !== undefined && (
        <p
          role="status"
          data-testid="bulk-failure"
          className="mt-2 rounded-nerv-sm bg-status-danger-soft px-2 py-1 text-xs text-status-danger"
        >
          {t('inbox.bulk.item_failed', { reason: failure.message })}
        </p>
      )}

      {/* **판정은 서버가 한다**(`can_approve`) — 완화가 둘로 늘면서(소규모·admin) 화면이
          규칙을 다시 구현하면 두 벌이 되고, 두 벌이 되면 언젠가 한쪽만 고친다.
          내가 요청한 것인데 승인도 가능하면 그 사실만 조용히 적는다(admin 이 그 자리다). */}
      {!isQuestion && (card['self_requested'] === true || lockReason !== null) && (
        <p
          data-testid="self-requested-note"
          className={cn(
            'mt-2 rounded-nerv-sm px-2 py-1 text-xs',
            canApprove
              ? 'bg-bg-sunken text-text-mute'
              : 'bg-status-waiting-soft text-status-waiting',
          )}
        >
          {canApprove ? t('inbox.card.self_requested_admin') : lockReason}
        </p>
      )}

      {/* 요약 카드도 **다음 걸음을 준다** — 여기서는 결정할 수 없으니(본문도 코멘트 칸도
          없다) 결정할 수 있는 곳으로 보낸다. 막다른 길을 만들지 않는다(§1.5) */}
      {(compact ?? false) && (
        <Link to="/inbox" className="mt-1.5 inline-block text-xs text-link hover:underline">
          {t('inbox.card.handle_in_inbox')}
        </Link>
      )}

      {!(compact ?? false) && decided === null && (
        <footer ref={footerRef} className="mt-2.5 flex items-center gap-2">
          {heldLabel !== null || sending ? (
            <GraceStrip
              label={heldLabel}
              active={active === true}
              cancelRef={cancelRef}
              onCancel={cancelHeld}
            />
          ) : isQuestion ? (
            <Button
              variant="primary"
              size="sm"
              disabled={comment.trim() === ''}
              onClick={() => requestDecision('approve')}
            >
              {t('inbox.card.send_answer')}
            </Button>
          ) : (
            <>
              <Button
                variant="primary"
                size="sm"
                data-testid="approve"
                disabled={!canApprove}
                onClick={() => requestDecision('approve')}
                disabledReason={canApprove ? undefined : (lockReason ?? undefined)}
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
                onClick={() => requestDecision('reject')}
                requiresOnline
              >
                {t('inbox.key.reject')}
              </Button>
              <Button size="sm" onClick={() => requestDecision('comment')} requiresOnline>
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

/**
 * 들고 있는 결정의 줄 — 무엇을 보내려는지 · [취소] · 줄어드는 막대(REQ-WEB-237).
 * 남은 초를 세지 않는다: 매초 바뀌는 글자는 보조기기가 매초 읽는다. 문장은 한 번, 시간은 막대가 말한다.
 * `label` 이 null 이면 이미 보내는 중이다 — 무를 수 없으니 [취소]도 없다.
 */
function GraceStrip({
  label,
  active,
  cancelRef,
  onCancel,
}: {
  label: string | null;
  active: boolean;
  cancelRef: React.RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
}): React.JSX.Element {
  const t = useT();
  return (
    <div
      role="status"
      data-testid="decision-grace"
      data-state={label === null ? 'sending' : 'held'}
      className="relative flex min-h-8 flex-1 items-center gap-2 overflow-hidden rounded-nerv-sm bg-bg-sunken px-2.5 py-1 text-sm text-text-mute"
    >
      <span className="min-w-0 flex-1">
        {label === null
          ? t('inbox.grace.sending')
          : t('inbox.grace.held', { what: label, s: DECISION_GRACE_MS / 1000 })}
      </span>
      {label !== null && (
        <>
          {active && (
            <span className="text-2xs text-text-faint">
              <Kbd>z</Kbd>
            </span>
          )}
          <Button ref={cancelRef} size="sm" data-testid="decision-cancel" onClick={onCancel}>
            {t('inbox.grace.cancel')}
          </Button>
          <span
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-0.5 origin-left animate-grace bg-status-action motion-reduce:hidden"
          />
        </>
      )}
    </div>
  );
}

function decisionLabel(t: Translator, decision: Decision): string {
  if (decision === 'approve') return t('inbox.decision.approve');
  if (decision === 'reject') return t('inbox.decision.reject');
  return t('inbox.decision.comment');
}

/**
 * 대상 줄 — 유형마다 **무엇을** 결정하는지(REQ-WEB-204).
 *   스펙: `v{n}` · 게이트 티어 · 변경 요약 · [변경분 보기 ▸](직전 버전과의 diff)
 *   플랜: 그 작업의 키·제목 · 발견: 발견의 심각도·제목(머리의 링크가 리뷰 센터의 그 발견으로 간다)
 */
function TargetLine({
  card,
  currentOrg,
}: {
  card: Record<string, unknown>;
  currentOrg: string | null;
}): React.JSX.Element | null {
  const t = useT();
  const proj = String(card['project_slug'] ?? '');
  const specKey = card['spec_key'];
  if (typeof specKey === 'string' && specKey !== '') {
    const diff = diffSearchOf(card);
    const version = card['version_no'];
    return (
      <div data-testid="target-line" className="flex flex-col gap-0.5">
        <p className="flex flex-wrap items-center gap-x-1.5">
          {typeof version === 'number' && <span className="font-mono text-text">v{version}</span>}
          {typeof card['gate_tier'] === 'string' && (
            <span
              data-testid="gate-tier"
              className="rounded-nerv-sm border border-border px-1 font-mono text-2xs"
            >
              {card['gate_tier']}
            </span>
          )}
          {diff !== undefined && (
            <CardLink
              orgSlug={card['org_slug']}
              currentOrg={currentOrg}
              path={`/p/${proj}/specs/${specKey}?diff=${diff['diff'] ?? ''}`}
              to="/p/$proj/specs/$spec"
              params={{ proj, spec: specKey }}
              search={diff}
              testId="diff-link"
            >
              {t('inbox.card.view_diff')}
            </CardLink>
          )}
        </p>
        {typeof card['change_summary_md'] === 'string' && card['change_summary_md'] !== '' && (
          <p data-testid="change-summary" className="line-clamp-2 text-text-mute">
            {card['change_summary_md']}
          </p>
        )}
      </div>
    );
  }
  if (card['subject_type'] === 'plan' && typeof card['task_key'] === 'string') {
    return (
      <p data-testid="target-line">
        {t('inbox.card.plan_for', {
          key: card['task_key'],
          title: String(card['task_title'] ?? ''),
        })}
      </p>
    );
  }
  if (card['subject_type'] === 'finding' && typeof card['finding_title'] === 'string') {
    return (
      <p data-testid="target-line">
        {t('inbox.card.finding_of', {
          severity: String(card['finding_severity'] ?? ''),
          title: card['finding_title'],
        })}
      </p>
    );
  }
  return null;
}
