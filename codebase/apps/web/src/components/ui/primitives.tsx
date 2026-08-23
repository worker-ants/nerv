// UI 프리미티브 — 화면들이 공유하는 최소 어휘 (screens.md §4)
//
// 이 파일이 있는 이유는 일관성이 규율로 지켜지지 않기 때문이다. 화면마다 `rounded-md border
// border-border bg-bg-elev p-3` 를 손으로 적으면 세 번째 화면쯤에서 값이 갈라지고, 갈라진
// 값은 아무도 되돌리지 않는다. 여기 없는 조합이 필요하면 **여기에 추가한다**.
//
// 디자인 방향은 평평함이다: 층은 그림자가 아니라 선과 여백으로 만든다. 그림자는 떠 있는 것
// (드롭다운·모달)에만 쓴다.

import { cn } from '../../lib/utils.js';

// ── 페이지 골격 ────────────────────────────────────────────────────────────

/**
 * 읽는 화면의 폭을 묶는다. 전폭으로 흘리면 한 줄이 너무 길어져 눈이 줄을 잃는다.
 * 보드처럼 가로로 넓어야 하는 화면은 `wide` 로 푼다.
 */
export function PageBody({
  children,
  wide,
  className,
}: {
  children: React.ReactNode;
  wide?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn('mx-auto w-full px-6 py-6', wide ? 'max-w-none' : 'max-w-content', className)}
    >
      {children}
    </div>
  );
}

/** 제목·설명·액션을 한 줄로 — 화면마다 제목 위치가 달라지지 않게 한다. */
export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** 제목 옆에 붙는 배지·키 등 */
  meta?: React.ReactNode;
}): React.JSX.Element {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
          {meta}
        </div>
        {description !== undefined && <p className="mt-1 text-sm text-text-mute">{description}</p>}
      </div>
      {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/** 구역 제목 — 크기 대신 굵기와 색으로 구분한다(크기를 키우면 화면이 소란스러워진다). */
export function SectionTitle({
  children,
  action,
  className,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={cn('mb-2 flex items-center justify-between gap-2', className)}>
      <h2 className="text-xs font-semibold tracking-wide text-text-mute uppercase">{children}</h2>
      {action}
    </div>
  );
}

// ── 면 ─────────────────────────────────────────────────────────────────────

/** 얹힌 면. 그림자 없이 선으로만 구분한다. */
export function Card({
  children,
  className,
  padded = true,
  interactive,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
  padded?: boolean;
  interactive?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'rounded-nerv border border-border bg-bg-elev',
        padded && 'p-4',
        interactive &&
          'cursor-pointer transition-colors hover:border-border-strong hover:bg-bg-hover',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * 빈 상태 — **막다른 길을 만들지 않는다**(§1.5). 문구만 있고 다음 행동이 없으면
 * 사람은 그 화면에서 되돌아 나가는 것 말고 할 수 있는 게 없다.
 */
export function EmptyState({
  icon = '·',
  title,
  hint,
  action,
  className,
}: {
  icon?: string;
  title: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-1 rounded-nerv border border-dashed border-border px-6 py-10 text-center',
        className,
      )}
    >
      <span aria-hidden="true" className="text-lg text-text-faint">
        {icon}
      </span>
      <p className="text-sm text-text-mute">{title}</p>
      {hint !== undefined && <p className="text-xs text-text-faint">{hint}</p>}
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** 로딩 골격 — 스피너 단독 금지(§1.5). 들어올 모양을 미리 보여준다. */
export function Skeleton({
  rows = 3,
  className,
}: {
  rows?: number;
  className?: string;
}): React.JSX.Element {
  return (
    <div data-testid="skeleton" className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-nerv bg-bg-sunken" />
      ))}
    </div>
  );
}

// ── 조작 ───────────────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const VARIANT: Record<ButtonVariant, string> = {
  // 화면당 하나면 충분하다 — 여러 개면 무엇이 주 행동인지 사라진다
  primary: 'bg-status-action text-white hover:opacity-90 border border-transparent',
  default: 'border border-border bg-bg-elev text-text hover:bg-bg-hover',
  ghost: 'border border-transparent text-text-mute hover:bg-bg-hover hover:text-text',
  danger: 'border border-border text-status-danger hover:bg-status-danger-soft',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-7 px-2 text-xs gap-1',
  md: 'h-8 px-3 text-sm gap-1.5',
};

export function Button({
  variant = 'default',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: React.ComponentProps<'button'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}): React.JSX.Element {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-nerv-sm font-medium transition-colors',
        // 비활성은 **숨기지 않는다**(REQ-WEB-003) — 흐리게 두고 사유는 title 로 준다
        'disabled:cursor-not-allowed disabled:opacity-45',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    />
  );
}

/** 입력 — 테두리는 평소에 거의 안 보이고 포커스에서 드러난다. */
export function Input({ className, ...rest }: React.ComponentProps<'input'>): React.JSX.Element {
  return (
    <input
      className={cn(
        'h-8 w-full rounded-nerv-sm border border-border bg-bg-elev px-2 text-sm',
        'placeholder:text-text-faint focus:border-border-strong',
        className,
      )}
      {...rest}
    />
  );
}

export function Textarea({
  className,
  ...rest
}: React.ComponentProps<'textarea'>): React.JSX.Element {
  return (
    <textarea
      className={cn(
        'w-full rounded-nerv-sm border border-border bg-bg-elev px-2 py-1.5 text-sm',
        'placeholder:text-text-faint focus:border-border-strong',
        className,
      )}
      {...rest}
    />
  );
}

export function Select({ className, ...rest }: React.ComponentProps<'select'>): React.JSX.Element {
  return (
    <select
      className={cn(
        'h-8 rounded-nerv-sm border border-border bg-bg-elev px-2 text-sm',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...rest}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-text-mute">{label}</span>
      {children}
      {hint !== undefined && error === undefined && (
        <span className="text-2xs text-text-faint">{hint}</span>
      )}
      {error !== undefined && (
        <span role="alert" className="text-2xs text-status-danger">
          {error}
        </span>
      )}
    </label>
  );
}

// ── 표시 ───────────────────────────────────────────────────────────────────

/** 안정 ID·해시처럼 **사람이 눈으로 대조하는** 값. 고정폭이라야 자릿수가 맞는다. */
export function Mono({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return <span className={cn('font-mono text-xs text-text-faint', className)}>{children}</span>;
}

/** 표 — 머리행은 조용하고 행 사이는 실선 하나. 얼룩말 줄무늬는 쓰지 않는다. */
export function Table({
  head,
  children,
  className,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-medium text-text-mute">
            {head}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return <th className={cn('py-2 pr-3 font-medium', className)}>{children}</th>;
}

export function Tr({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <tr className={cn('border-b border-border last:border-0 hover:bg-bg-hover', className)}>
      {children}
    </tr>
  );
}

export function Td({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return <td className={cn('py-2 pr-3 align-middle', className)}>{children}</td>;
}

/** 떠 있는 면 — 여기서만 그림자를 쓴다. */
export function Popover({
  children,
  className,
  align = 'left',
}: {
  children: React.ReactNode;
  className?: string;
  align?: 'left' | 'right';
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'absolute z-40 mt-1 min-w-44 rounded-nerv border border-border bg-bg-elev py-1 shadow-popover',
        align === 'right' ? 'right-0' : 'left-0',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function MenuItem({
  className,
  ...rest
}: React.ComponentProps<'button'>): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'block w-full px-3 py-1.5 text-left text-sm text-text hover:bg-bg-hover',
        className,
      )}
      {...rest}
    />
  );
}
