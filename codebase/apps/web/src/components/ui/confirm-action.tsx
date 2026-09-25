// 되돌리기 어려운 조작의 확인 — **한 모양**이다 (screens.md §1.5 · REQ-WEB-200)
//
// 2026-09-24 까지 확인은 네 모양이었다: 같은 자리에서 문장 + 단추로 바뀌는 것(조직 삭제),
// `role="dialog"` 를 단 인라인 카드(세션 중단), 떠 있는 모달, 그리고 **확인 없음**(토큰 폐기 ·
// 초대 회수 · 스펙 보관 · 첨부 삭제 · 클레임 포기 · 프로젝트 보관). 사람은 어느 단추가 다시
// 묻는지 예측할 수 없었고, 한 번 "묻지 않는 단추" 를 겪으면 모든 단추를 망설이며 누른다.
//
// 모양은 조직 삭제가 이미 쓰던 **같은 자리 두 단계**다 — 누른 자리에서 무엇이 일어나는지를
// 말하고 [실행]·[취소] 가 선다. 눈이 단추에서 떠나지 않고, 떠 있는 모달처럼 화면을 가리지 않는다.
//
//   - 포커스는 [취소] 에 간다(사유 칸이 있으면 그 칸) — Enter 를 연달아 눌러 실행되지 않게
//   - Esc 는 취소이고, 모달 안에서도 확인만 닫는다(모달까지 닫지 않는다)
//   - 취소하면 포커스가 누른 단추로 돌아온다
//   - 사유가 필요한 조작(세션 중단)은 같은 자리에 칸을 연다 — 사유는 지시 칸과 따로다
//   - 확인을 켜 둔 채 다른 곳으로 가면(포커스가 떠나면) 8초 뒤 원래대로 돌아간다

import { useEffect, useRef, useState } from 'react';
import { useT } from '../../lib/i18n.js';
import { cn } from '../../lib/utils.js';
import { Button, Input } from './primitives.js';
import type { ButtonSize, ButtonVariant } from './primitives.js';

export interface ConfirmReason {
  /** 칸의 접근성 이름 */
  label: string;
  placeholder?: string;
}

interface BarProps {
  /** 무엇이 일어나는가 — 되돌릴 수 없으면 그렇다고 */
  message: React.ReactNode;
  /** 덧붙이는 한 줄(누구에게 미치는가 · 되돌리는 길) */
  detail?: React.ReactNode | undefined;
  confirmLabel: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  /** 사유를 받는다 — 비어 있으면 실행하지 않는다 */
  reason?: ConfirmReason | undefined;
  /** 한 줄에 들지 않는 확인(설명·사유가 붙는 것) — 칸 전체를 쓰는 상자로 선다 */
  block?: boolean | undefined;
  pending?: boolean | undefined;
  /** `-confirming`(상자) · `-confirm` · `-cancel` · `-reason` 이 붙는다 */
  testIdBase?: string | undefined;
  className?: string | undefined;
}

/**
 * 확인 막대 — 단추 없이도 쓴다. 고르는 것(선택기)이 확인을 부르는 자리는 단추가 없으므로
 * 이것만 세운다(게이트 정책의 "저장하지 않은 변경을 버리고 옮길까요").
 */
export function ConfirmBar({
  message,
  detail,
  confirmLabel,
  onConfirm,
  onCancel,
  reason,
  block,
  pending,
  testIdBase,
  className,
}: BarProps): React.JSX.Element {
  const t = useT();
  const [text, setText] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);
  const id = (suffix: string): string | undefined =>
    testIdBase === undefined ? undefined : `${testIdBase}-${suffix}`;

  useEffect(() => {
    (reason === undefined ? cancelRef.current : reasonRef.current)?.focus();
  }, [reason]);

  const blocked = pending === true || (reason !== undefined && text.trim() === '');

  return (
    <div
      role="group"
      aria-label={typeof message === 'string' ? message : undefined}
      data-testid={id('confirming')}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        // 모달 안의 확인이면 확인만 닫는다 — 모달의 Esc 까지 가면 쓰던 것이 함께 사라진다
        e.stopPropagation();
        onCancel();
      }}
      className={cn(
        block === true
          ? 'flex w-full flex-col gap-2 rounded-nerv border border-status-danger bg-status-danger-soft p-3 text-sm'
          : 'inline-flex flex-wrap items-center gap-2',
        className,
      )}
    >
      <span className={cn('text-sm text-status-danger', block === true && 'font-medium')}>
        {message}
      </span>
      {detail !== undefined && (
        <span className={cn('text-xs text-text-mute', block !== true && 'basis-full')}>
          {detail}
        </span>
      )}
      {reason !== undefined && (
        <Input
          ref={reasonRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={reason.placeholder}
          aria-label={reason.label}
          data-testid={id('reason')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !blocked) onConfirm(text.trim());
          }}
        />
      )}
      <span className="flex gap-2">
        <Button
          size="sm"
          variant="danger-solid"
          data-testid={id('confirm')}
          disabled={blocked}
          onClick={() => onConfirm(text.trim())}
        >
          {confirmLabel}
        </Button>
        <Button ref={cancelRef} size="sm" data-testid={id('cancel')} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </span>
    </div>
  );
}

/** 누르는 단추 — 기본은 `Button`. 칩처럼 모양이 다른 단추는 `trigger` 로 그린다 */
export interface TriggerProps {
  open: () => void;
  ref: React.RefObject<HTMLButtonElement | null>;
  disabled: boolean;
}

export function ConfirmAction({
  label,
  trigger,
  variant = 'danger',
  size = 'sm',
  disabled,
  title,
  tooltip,
  testId,
  testIdBase,
  timeoutMs = 8000,
  onConfirm,
  pending,
  className,
  ...bar
}: Omit<BarProps, 'onCancel' | 'testIdBase'> & {
  /** 단추 글자 — `trigger` 를 주면 쓰지 않는다 */
  label?: React.ReactNode;
  trigger?: (props: TriggerProps) => React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean | undefined;
  /** 비활성일 때의 사유(REQ-WEB-003) — **잠긴 단추에만** 단다 */
  title?: string | undefined;
  /** 켜져 있을 때의 설명 — 단추의 뜻(세션 중단의 "전달과 무관하게 즉시") */
  tooltip?: string | undefined;
  /** 확인이 서 있을 때의 자리(칸 전체를 쓰는 상자 등) — 단추에는 붙지 않는다 */
  className?: string;
  /** 단추의 testid. 확인 막대는 `testIdBase`(없으면 이 값)에 접미를 붙인다 */
  testId?: string;
  testIdBase?: string;
  timeoutMs?: number;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (open || !returnFocus.current) return;
    returnFocus.current = false;
    triggerRef.current?.focus();
  }, [open]);

  // 켜 둔 채 떠난 확인은 거둔다 — 나중에 다른 일을 하다 그 자리를 누르면 실행된다.
  // 포커스가 안에 있는 동안(읽는 중·사유를 쓰는 중)은 두고, 떠난 뒤의 8초만 센다.
  useEffect(() => {
    if (!open || timeoutMs <= 0) return;
    const timer = window.setInterval(() => {
      if (barRef.current?.contains(document.activeElement) === true) return;
      setOpen(false);
    }, timeoutMs);
    return () => window.clearInterval(timer);
  }, [open, timeoutMs]);

  const cancel = (): void => {
    returnFocus.current = true;
    setOpen(false);
  };

  if (open) {
    return (
      <span
        ref={barRef}
        className={cn(bar.block === true ? 'block w-full' : 'inline-flex', className)}
      >
        <ConfirmBar
          {...bar}
          pending={pending}
          testIdBase={testIdBase ?? testId}
          onCancel={cancel}
          onConfirm={(reason) => {
            setOpen(false);
            onConfirm(reason);
          }}
        />
      </span>
    );
  }

  const isDisabled = disabled === true || pending === true;
  if (trigger !== undefined) {
    return <>{trigger({ open: () => setOpen(true), ref: triggerRef, disabled: isDisabled })}</>;
  }
  return (
    <Button
      ref={triggerRef}
      size={size}
      variant={variant}
      data-testid={testId}
      disabled={isDisabled}
      disabledReason={disabled === true ? title : undefined}
      title={disabled === true ? undefined : tooltip}
      onClick={() => setOpen(true)}
    >
      {label}
    </Button>
  );
}
