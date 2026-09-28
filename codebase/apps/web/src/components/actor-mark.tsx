// 누가 했는가 — 사람과 에이전트를 한 모양으로 가른다 (2026-09-28 · 사람 결정 · screens.md §4.3 · REQ-WEB-010 · REQ-WEB-277)
//
// 같은 구분이 다섯 모양이었다 — 피드는 머리글자 원과 "AI" 칸, 작업 카드는 작은 "AI" 배지, 리뷰 코멘트와 첨부는
// 🤖/👤 이모지, 알림은 이름 뒤 " 🤖", 스펙 코멘트는 글자만. 이모지는 OS 마다 그림이 다르고 색과 크기를 토큰으로
// 다룰 수 없으며, 읽는 도구는 뜻("에이전트")이 아니라 그림 이름("로봇 얼굴")을 읽는다. 피드가 이미 쓰던 두 모양을
// 한 부품으로 모았다: 사람은 머리글자 원(사람마다 색이 달라 **누구인지**도 보인다), 에이전트는 같은 크기의 "AI" 칸.

import { useT } from '../lib/i18n.js';
import { cn } from '../lib/utils.js';
import { Avatar, GlyphChip } from './ui/primitives.js';

export function ActorMark({
  name,
  agent,
  machine,
  delegator,
  size = 'md',
  label,
  testId,
  className,
}: {
  /** 행위자 이름 — 없으면(시스템) 자리만 둔다 */
  name: string | null;
  agent: boolean;
  /** 에이전트가 어느 기계의 무엇인가 — `mac-02 · claude-code` */
  machine?: string | undefined;
  /** 에이전트에게 맡긴 사람 — 알 때만 */
  delegator?: string | undefined;
  size?: 'sm' | 'md';
  /** 사람의 이름이 곁에 적혀 있지 않은 자리의 말(`Avatar` 의 `label`) */
  label?: string | undefined;
  /** 에이전트 칸의 testid — 자리마다 이름이 있다(피드는 `event-actor-agent`) */
  testId?: string | undefined;
  className?: string;
}): React.JSX.Element {
  const t = useT();
  // 작은 칸은 머리글자 칸 한 부품(`GlyphChip` — 18px · 10px 글자)을 쓴다. 손으로 짜지 않는다(REQ-WEB-238)
  const face = (text: string, tone: string, round: boolean): React.JSX.Element =>
    size === 'sm' ? (
      <GlyphChip shape={round ? 'round' : 'square'} className={tone}>
        {text}
      </GlyphChip>
    ) : (
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex size-6 shrink-0 items-center justify-center text-2xs font-semibold',
          round ? 'rounded-full' : 'rounded-nerv-sm',
          tone,
        )}
      >
        {text}
      </span>
    );
  if (agent) {
    const describe = [
      t('actor.agent'),
      name ?? '',
      machine ?? '',
      delegator === undefined ? '' : t('actor.delegated_by', { name: delegator }),
    ]
      .filter((v) => v !== '')
      .join(' · ');
    return (
      <span
        data-testid={testId ?? 'actor-agent'}
        title={describe}
        className={cn('inline-flex shrink-0', className)}
      >
        {face('AI', 'bg-status-agent-soft text-status-agent', false)}
        <span className="sr-only">{describe}</span>
      </span>
    );
  }
  if (name === null || name.trim() === '') {
    return (
      <span className={cn('inline-flex shrink-0', className)}>
        {face('·', 'bg-bg-sunken font-normal text-text-mute', true)}
      </span>
    );
  }
  return (
    <Avatar
      name={name}
      size={size}
      label={label}
      {...(className === undefined ? {} : { className })}
    />
  );
}
