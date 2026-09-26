// UI 프리미티브 — 화면들이 공유하는 최소 어휘 (screens.md §4)
//
// 이 파일이 있는 이유는 일관성이 규율로 지켜지지 않기 때문이다. 화면마다 `rounded-md border
// border-border bg-bg-elev p-3` 를 손으로 적으면 세 번째 화면쯤에서 값이 갈라지고, 갈라진
// 값은 아무도 되돌리지 않는다. 여기 없는 조합이 필요하면 **여기에 추가한다**.
//
// 디자인 방향은 평평함이다: 층은 그림자가 아니라 선과 여백으로 만든다. 그림자는 떠 있는 것
// (드롭다운·모달)에만 쓴다.

import { createContext, useContext, useId, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useWriteLock } from '../../lib/realtime.js';
import { TOKEN_CLASS } from '../status-badge.js';
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
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* **화면 제목은 한 단 크다**(시안 27px · 정정 2026-08-23). 20px/600 은 본문
              14px 와 너무 가까워, 제목이 "조금 굵은 문장"으로 읽히고 화면에 시작점이
              생기지 않는다 — 그것이 "텍스트 나열"의 첫 번째 원인이었다.
              프리미티브 한 곳에서 정하므로 열세 화면이 함께 바뀐다. */}
          <h1 className="truncate text-2xl font-bold tracking-[-0.022em]">{title}</h1>
          {meta}
        </div>
        {description !== undefined && (
          <p className="mt-2 text-base leading-[1.55] text-text-mute">{description}</p>
        )}
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
      {/* 구역 제목은 **굵기로** 가른다(2026-09-25 — D4 · SYS-11). 대문자·자간으로 가르던 동안 한글에는 대문자가
          없어 그냥 작은 회색 글자였고, 구역 제목이 그 아래 본문보다 작았다 */}
      <h2 className="text-sm font-semibold text-text-mute">{children}</h2>
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
  /**
   * 다음 행동 — **필수다**(2026-09-24 · REQ-WEB-208 · §1.5 "빈 문구 + 다음 행동 링크 1개 이상").
   * 선택 prop 이던 동안 18곳 중 3곳만 지켰고, 빠뜨려도 아무도 몰랐다. 정말 갈 곳이 없는 자리는
   * `null` 을 **명시한다** — 빠뜨린 것과 고른 것을 타입이 가른다.
   */
  action: React.ReactNode | null;
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
      {action !== null && <div className="mt-2">{action}</div>}
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

/** 단축키 표기 — 본문 글자와 구분되게, 그러나 조용하게. 키 이름은 번역하지 않는다(키보드에 새겨진 글자다) */
export function Kbd({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <kbd className="rounded-nerv-sm border border-border bg-bg-sunken px-1 font-mono text-text-mute">
      {children}
    </kbd>
  );
}

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'subtle' | 'danger' | 'danger-solid';
export type ButtonSize = 'xs' | 'sm' | 'md';

const VARIANT: Record<ButtonVariant, string> = {
  // 화면당 하나면 충분하다 — 여러 개면 무엇이 주 행동인지 사라진다
  primary: 'bg-status-action text-on-status hover:opacity-90 border border-transparent',
  default: 'border border-border bg-bg-elev text-text hover:bg-bg-hover',
  ghost: 'border border-transparent text-text-mute hover:bg-bg-hover hover:text-text',
  // 줄 안의 작은 조작(발견의 [해소…] · 첨부의 [삭제] · 다이어그램의 [확대]) — 테두리만 있고 바탕은 곁의 면을 따른다.
  // 스무 자리가 이 글자열을 손으로 베껴 쓰던 동안 그 단추들에는 잠긴 까닭도 오프라인 잠금도 없었다(REQ-WEB-235)
  subtle: 'border border-border text-text-mute hover:border-border-strong hover:text-text',
  danger: 'border border-border text-status-danger hover:bg-status-danger-soft',
  // **확인의 실행 단추다** — 되돌리기 어려운 일을 한 번 더 물은 뒤에만 선다(confirm-action.tsx).
  // 이 칠이 없던 동안 세션 중단은 클래스를 덮어써 빨갛게 칠했다
  'danger-solid': 'border border-transparent bg-status-danger text-on-status hover:opacity-90',
};

const SIZE: Record<ButtonSize, string> = {
  // 시안의 두 단이다: 보조 27px · 주 행동 30px(`--spacing-control-sm` · `--spacing-control`)
  sm: 'h-control-sm px-3 text-sm gap-1',
  md: 'h-control px-3.5 text-sm gap-1.5',
  // 줄 안의 작은 조작 — 높이를 글자가 정하고, 모서리·굵기는 곁의 배지와 같다
  xs: 'h-auto px-2 py-0.5 text-2xs gap-1 rounded-nerv-sm font-normal',
};

/**
 * 단추 — **못 누르는 까닭을 말한다**(2026-09-25 · UI/UX 검토 SYS-08·SYS-09 · REQ-WEB-003 · REQ-WEB-235).
 *
 * 비활성 단추는 사유를 `title` 로 달거나 잊었다. `title` 은 마우스를 올려야만 뜨고 `disabled` 단추는 포커스를 받지
 * 않아, 키보드·터치로는 사유에 닿을 길이 없었다. 사유가 있으면 `disabled` 대신 **`aria-disabled`** 로 잠근다 —
 * 포커스는 남고 누름은 무시하며, 사유는 `aria-describedby` 로 읽히고 hover·포커스에서 말풍선으로 보인다.
 * 사유 없는 비활성(보내는 중 등 잠깐의 것)은 전처럼 `disabled` 다.
 *
 * **오프라인이면 쓰기 단추는 스스로 잠긴다** — 주 단추(`primary`)와 파괴 확정(`danger-solid`)이 기본이고,
 * 다른 단추는 `requiresOnline` 으로 켠다. 배너가 "읽기 전용" 이라 말하는 동안 [승인]·[저장]이 살아 있었다.
 */
/** 말풍선의 가장 넓은 폭(`max-w-64`)과 화면 끝에서 띄울 여백 */
const BUBBLE_MAX_PX = 256;
const EDGE_PX = 8;

export function Button({
  variant = 'default',
  size = 'md',
  className,
  type = 'button',
  disabled,
  disabledReason,
  requiresOnline,
  onClick,
  onMouseEnter,
  onFocus,
  children,
  ...rest
}: React.ComponentProps<'button'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 비활성의 사유 — `disabled` 일 때만 쓰인다. 주면 포커스가 남는 잠금(`aria-disabled`)이 된다 */
  disabledReason?: string | undefined;
  /** 오프라인이면 잠근다 — 기본은 `primary`·`danger-solid` 만 */
  requiresOnline?: boolean;
}): React.JSX.Element {
  const writeLock = useWriteLock();
  const reasonId = useId();
  // 말풍선을 어디에 맞출까 — 가운데가 기본이고, 화면 끝 가까이면 단추의 그쪽 끝에 맞춘다(오른쪽 끝의 [+ 새 작업]
  // 말풍선이 화면 밖으로 잘렸다 — 2026-09-25 캡처). CSS 만으로는 화면 끝을 알 수 없어 올리는 순간 잰다
  const [align, setAlign] = useState<'center' | 'start' | 'end'>('center');
  const measure = (el: HTMLElement): void => {
    const rect = el.getBoundingClientRect();
    const half = BUBBLE_MAX_PX / 2;
    const middle = rect.left + rect.width / 2;
    setAlign(
      middle - half >= EDGE_PX && middle + half <= window.innerWidth - EDGE_PX
        ? 'center'
        : rect.left + BUBBLE_MAX_PX > window.innerWidth - EDGE_PX
          ? 'end'
          : 'start',
    );
  };
  const online = requiresOnline ?? (variant === 'primary' || variant === 'danger-solid');
  const reason = (disabled === true ? disabledReason : undefined) ?? (online ? writeLock : null);
  const classes = cn(
    'inline-flex items-center justify-center rounded-nerv font-medium transition-colors',
    // 비활성은 **숨기지 않는다**(REQ-WEB-003) — 흐리게 두고 사유를 말한다
    'disabled:cursor-not-allowed disabled:opacity-45',
    // 잠금(`aria-disabled`)은 `opacity` 로 흐리지 않는다 — 가상 요소인 말풍선까지 함께 흐려진다. 바탕색 막(`::before`)을
    // 덮어 같은 만큼 흐리게 하고 말풍선(`::after`)은 그 위에 온전히 선다
    'aria-disabled:cursor-not-allowed',
    VARIANT[variant],
    SIZE[size],
    className,
  );
  const locked = typeof reason === 'string' && reason !== '';
  // **잠김과 풀림이 같은 모양이다** — 한쪽만 조각(Fragment)이면 React 가 단추를 새로 만들어, 풀리는 순간 키보드
  // 포커스가 사라진다. 단추는 늘 첫 자식이고 설명만 붙었다 떨어진다
  return (
    <>
      <button
        type={type}
        disabled={locked ? undefined : disabled}
        aria-disabled={locked ? 'true' : undefined}
        aria-describedby={locked ? reasonId : undefined}
        data-reason={locked ? reason : undefined}
        // 잠겼으면 누름은 무시한다 — 폼의 제출 단추면 제출도 막는다(Enter 의 암묵 제출도 이 클릭으로 온다)
        onClick={locked ? (e) => e.preventDefault() : onClick}
        onMouseEnter={(e) => {
          if (locked) measure(e.currentTarget);
          onMouseEnter?.(e);
        }}
        onFocus={(e) => {
          if (locked) measure(e.currentTarget);
          onFocus?.(e);
        }}
        className={cn(
          classes,
          // 말풍선은 **가상 요소**다 — 단추 안에 글자를 넣으면 단추의 이름·글자(`textContent`)가 사유로 오염된다
          locked &&
            'relative before:pointer-events-none before:absolute before:-inset-px before:rounded-[inherit] before:bg-bg/55 after:pointer-events-none after:absolute after:bottom-full after:z-40 after:mb-1.5 after:hidden after:w-max after:max-w-64 after:rounded-nerv-sm after:bg-text after:px-2 after:py-1 after:text-left after:text-xs after:font-normal after:whitespace-normal after:text-bg after:content-[attr(data-reason)] hover:after:block focus-visible:after:block',
          locked &&
            (align === 'center'
              ? 'after:left-1/2 after:-translate-x-1/2'
              : align === 'end'
                ? 'after:right-0'
                : 'after:left-0'),
        )}
        {...rest}
      >
        {children}
      </button>
      {/* 설명으로만 읽힌다(aria-describedby) — 화면에는 서지 않는다 */}
      {locked && (
        <span id={reasonId} hidden>
          {reason}
        </span>
      )}
    </>
  );
}

/**
 * **숫자 배지** — 사이드바의 받은 요청·알림·세션·리뷰 수(2026-09-25 · SYS-07 — 셸 안에 따로 있던 것을 공용으로).
 * 색은 상태 배지와 같은 표(`TOKEN_CLASS`)에서 온다 — 숫자 배지와 상태 배지가 다른 색표를 들면 같은 "대기" 가
 * 두 색이 된다. **차오른 색이 아니라 물든 색이다**(시안) — 진한 배경 + 흰 글자는 화면에서 가장 시끄러운 물건이
 * 되는데 배지는 어디에나 있다. 0 이면 서지 않는다.
 */
export function CountBadge({
  count,
  tone,
  testId,
  className,
}: {
  count: number;
  tone: 'action' | 'waiting' | 'agent' | 'danger';
  testId?: string;
  className?: string;
}): React.JSX.Element | null {
  if (count === 0) return null;
  return (
    <span
      {...(testId === undefined ? {} : { 'data-testid': testId })}
      className={cn(
        'ml-1 inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 text-2xs font-semibold',
        TOKEN_CLASS[tone],
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

/** 입력 — 테두리는 평소에 거의 안 보이고 포커스에서 드러난다. */
/**
 * **같은 화면 안에서 보기를 바꾸는** 세그먼트(2026-09-24 · UI/UX 검토 SYS-12 · REQ-WEB-211).
 *
 * "둘·셋 중 하나 고르기" 가 화면마다 다르게 짜여 있었다 — 스펙 목록의 [트리|표|그래프]는 지금
 * 어느 보기인지를 배경색과 굵기로만 말해서 보조기기에는 상태가 없었다(REQ-WEB-033). 여기서는
 * `aria-pressed` 가 그 상태를 싣는다. **주소가 바뀌는 탭**(받은 요청의 대기·처리됨, 설정)은 이것이
 * 아니라 링크다 — 그쪽은 `aria-current` 로 말한다.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  testIdPrefix,
}: {
  /** 무엇을 고르는 묶음인가 — 보조기기가 읽는 이름 */
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  testIdPrefix?: string;
}): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-nerv-sm border border-border p-0.5 text-xs"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          data-testid={testIdPrefix === undefined ? undefined : `${testIdPrefix}-${option.value}`}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-nerv-sm px-3 py-1',
            option.value === value ? 'bg-bg-active font-medium' : 'text-text-mute hover:text-text',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

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

/**
 * **한 줄에 놓이는 필드들** — 라벨은 라벨끼리, 입력은 입력끼리, 힌트는 힌트끼리 선다.
 *
 * 예전에는 `flex items-end` 였다. 그러면 **아래 끝**만 맞는데, 힌트가 있는 필드와 없는 필드는
 * 키가 다르므로 힌트 없는 쪽의 라벨과 입력이 통째로 내려앉는다(실측 2026-08-29: 프로젝트 추가
 * 줄에서 "이름"이 slug·키보다 한 단 아래로 밀렸다). 눈이 따라가는 것은 상자의 밑변이 아니라
 * **입력의 줄**이다.
 *
 * 세 줄짜리 격자를 만들고 각 필드가 `subgrid` 로 그 줄을 나눠 쓴다. 힌트가 없는 칸은 비어
 * 있을 뿐 자리는 그대로라, 무엇을 더하고 빼도 줄은 흔들리지 않는다.
 *
 * 필드가 아닌 것(버튼 등)은 `FieldRowAction` 으로 감싸 **입력 줄**에 놓는다.
 */
const FieldRowContext = createContext(false);

export function FieldRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <FieldRowContext.Provider value={true}>
      <div
        className={cn(
          // `justify-start`: 자동 트랙은 남는 가로를 나눠 갖는다 — 그대로 두면 버튼이 카드 끝까지
          // 늘어난다(실측). 좁은 화면에서는 줄로 흐르게 해서 칸이 밖으로 밀리지 않게 한다.
          'grid grid-flow-col justify-start items-start gap-x-3 gap-y-1 max-md:grid-flow-row',
          '[grid-template-rows:auto_auto_auto]',
          className,
        )}
      >
        {children}
      </div>
    </FieldRowContext.Provider>
  );
}

/**
 * 줄 안의 버튼 자리 — 라벨 줄도 힌트 줄도 아닌 **입력 줄**에 선다.
 *
 * 좁은 화면에서 줄이 세로로 흐를 때는(위 `max-md:grid-flow-row`) 자리를 지정하지 않는다 —
 * 그때 2행은 첫 필드의 입력 칸이라, 못 박아 두면 버튼이 폼 맨 위로 올라간다(실측).
 */
export function FieldRowAction({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return <div className={cn('md:row-start-2', className)}>{children}</div>;
}

export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | undefined;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  // 줄 안에서는 세 칸을 부모 격자에서 빌려 쓰고, 혼자 있을 때는 그냥 세로로 쌓는다
  const inRow = useContext(FieldRowContext);
  return (
    <label
      className={cn(inRow ? 'row-span-3 grid grid-rows-subgrid' : 'flex flex-col gap-1', className)}
    >
      <span className="text-xs font-medium text-text-mute">{label}</span>
      {children}
      {hint !== undefined && error === undefined && (
        <span className="text-xs text-text-faint">{hint}</span>
      )}
      {error !== undefined && (
        <span role="alert" className="text-xs text-status-danger">
          {error}
        </span>
      )}
    </label>
  );
}

// ── 표시 ───────────────────────────────────────────────────────────────────

/** 고정 ID·해시처럼 **사람이 눈으로 대조하는** 값. 고정폭이라야 자릿수가 맞는다. */
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
/**
 * **hover 에서만 드러나는 것의 규칙 한 벌**(2026-09-25 — UI/UX 검토 SYS-X3 · REQ-WEB-224). `opacity-0
 * group-hover:opacity-100` 만 두면 키보드로 포커스해도 투명하고(전역 포커스 고리도 함께 묻힌다) 터치 기기에는
 * 드러날 길이 없다 — 알림 [읽음] 이 그랬다. 무리 안에 포커스가 있을 때와 hover 가 없는 기기에서는 늘 보인다.
 */
export const REVEAL_ON_HOVER =
  'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100';

export function Popover({
  children,
  className,
  align = 'left',
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  align?: 'left' | 'right';
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'className' | 'children'>): React.JSX.Element {
  return (
    <div
      {...rest}
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

/**
 * 대문자 소제목 — 화면 안의 구역을 **크기가 아니라 성질로** 나눈다.
 *
 * 제목을 키워서 구역을 나누면 화면이 소란스러워진다(§4 "제목은 크기보다 굵기와 여백으로").
 * 작고 흐린 대문자 라벨은 눈에 먼저 들어오지 않으면서 자리를 정확히 알려 준다.
 */
export function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'text-2xs font-semibold tracking-[0.07em] text-text-faint uppercase',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** 아바타 색 — **새 색을 만들지 않는다.** 상태 토큰의 soft 배경을 사람에게 재사용한다. */
const AVATAR_TONE = [
  'bg-status-progress-soft text-status-progress',
  'bg-status-agent-soft text-status-agent',
  'bg-status-done-soft text-status-done',
  'bg-status-waiting-soft text-status-waiting',
  'bg-status-action-soft text-status-action',
] as const;

/**
 * **머리글자 칸** — 18px 칸 안의 한 글자(2026-09-26 — 임의 px 장부 PR 2 · REQ-WEB-238).
 *
 * 관계 행의 방향(↑ 나가는 · ↓ 들어오는)과 활동 타임라인의 종류 글리프가 같은 칸을 세 자리에서 각자 짰다
 * (18px 칸 · 5px 모서리 · 10px 글자를 손으로 적었다 — 그래프 패널 · 스펙 관계 레일 · 세션 타임라인). 모양은 여기 한 곳이 정하고,
 * 부르는 쪽은 색(`className`)과 모양(`shape`)만 고른다. 글리프는 곁의 글자가 이미 말하는 것을 되풀이하는 표지라
 * 보조기기에는 숨긴다.
 */
export function GlyphChip({
  children,
  shape = 'square',
  className,
}: {
  children: React.ReactNode;
  /** `square` — 관계 행의 방향 · `round` — 타임라인의 종류 */
  shape?: 'square' | 'round';
  className?: string;
}): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-4.5 shrink-0 items-center justify-center text-3xs font-semibold',
        shape === 'round' ? 'rounded-full' : 'rounded-nerv-sm',
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * 사람 표식 — 이름 첫 글자.
 *
 * 목록에서 "누구 것인가"를 **읽지 않고 알아보게** 하는 장치다. 이름을 글자로만 늘어놓으면
 * 줄마다 같은 굵기의 텍스트가 하나 더 늘 뿐이고, 그것이 이 화면들이 텍스트 나열로 읽히던
 * 이유 중 하나였다(2026-08-23 재검토).
 *
 * 색은 이름에서 **결정적으로** 고른다 — 같은 사람은 어느 화면에서나 같은 색이다.
 */
export function Avatar({
  name,
  size = 'md',
  className,
  label,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /**
   * 이름이 **곁에 적혀 있지 않은** 자리의 말(2026-09-24 · REQ-WEB-209) — 툴팁과 스크린리더 이름이 된다.
   * 보드 카드처럼 이니셜만 서는 곳에서는 같은 이니셜의 두 사람을 가를 수 없었고, 읽는 도구에는
   * 아무것도 읽히지 않았다. 이름이 곁에 있으면 주지 않는다 — 같은 이름을 두 번 읽힌다
   */
  label?: string | undefined;
}): React.JSX.Element {
  const initial = name.trim().slice(0, 1) || '?';
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  const box = {
    sm: 'size-4.5 text-2xs',
    md: 'h-6 w-6 text-2xs',
    lg: 'h-7.5 w-7.5 text-xs',
  };
  const face = (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
        box[size],
        AVATAR_TONE[hash % AVATAR_TONE.length],
        className,
      )}
    >
      {initial}
    </span>
  );
  if (label === undefined) return face;
  return (
    <span className="inline-flex shrink-0" title={label}>
      {face}
      <span className="sr-only">{label}</span>
    </span>
  );
}

export interface SummaryMetric {
  label: string;
  value: number | string;
  /** 강조가 필요한 값만 색을 준다 — 전부 색이면 아무것도 강조되지 않는다 */
  tone?: 'default' | 'progress' | 'waiting' | 'danger' | 'done';
  /** 숫자를 보고 **갈 데가 있어야 한다**(§1.5) — 없으면 그냥 표시다 */
  href?: string;
  /** 그 자리의 뷰 상태 — 보드의 "내 담당" 은 `?assignee=<나>` 로 간다(REQ-WEB-221) */
  search?: Record<string, unknown>;
  /**
   * 상태의 색을 나르는 점(`statusDot`) — 있으면 숫자는 중립을 지킨다. 숫자까지 물들이면 줄이 신호등이 된다
   * (세션 줄 · 2026-08-23 시안)
   */
  dot?: string;
  /**
   * 누르면 거르는 칸 — 켠 칸은 `aria-pressed`. 셀 것이 없어 고를 수 없는 칸은 `disabled` 로 선다
   * (누를 수 있어 보이는데 안 눌리는 것이 가장 나쁘다)
   */
  toggle?: { pressed: boolean; onToggle: () => void; disabled?: boolean };
  /** 물러선 칸 — 0 이거나 다른 칸을 골랐을 때. 고른 것이 색이 아니라 **대비**로 읽힌다 */
  dimmed?: boolean;
  testId?: string;
}

/**
 * 요약 스트립 — **이 줄만 보고 "지금 몇 개가 도나"에 답한다.**
 *
 * 화면 맨 위에 큰 숫자 몇 개를 두는 이유는 스캔 순서다. 목록부터 그리면 사람은 항목을
 * 세면서 전체를 짐작해야 하고, 그 짐작이 화면을 볼 때마다 반복된다.
 *
 * **한 벌이다**(2026-09-26 — UI/UX 검토 SYS-13). 세션 모니터는 같은 줄을 따로 짜서(점 + 큰 숫자 + 라벨 · 누르면
 * 거름) 좁은 폭의 넘침을 자기만 가로 스크롤로 풀고, 칸 여백·숫자 크기가 작업 보드·리뷰 센터와 1px 씩 달랐다.
 * 줄의 모양(`layout`)과 칸의 성격(링크 · 거름 · 표시)만 고르고 나머지는 여기 한 곳이 정한다.
 */
export function SummaryStrip({
  metrics,
  actions,
  layout = 'stacked',
  className,
  ...rest
}: {
  metrics: readonly SummaryMetric[];
  actions?: React.ReactNode;
  /** `stacked` — 라벨 위 숫자(작업 보드 · 리뷰 센터) · `inline` — 점 · 숫자 · 라벨을 한 줄에(세션) */
  layout?: 'stacked' | 'inline';
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  const tone = {
    default: 'text-text',
    progress: 'text-status-progress',
    waiting: 'text-status-waiting',
    danger: 'text-status-danger',
    done: 'text-status-done',
  };
  return (
    <div
      // **좁으면 접힌다**(2026-09-25 — UI/UX 검토 SYS-13). 줄바꿈 없는 한 줄이던 동안 폰 폭의 작업 보드에서 지표 넷과
      // 필터 셋이 문서를 가로로 17px 밀었고 필터가 잘렸다. 칸 사이 여백도 좁은 폭에서 줄인다
      className={cn('flex flex-wrap items-center gap-y-3 border-y border-border py-3', className)}
      {...rest}
    >
      {metrics.map((m, i) => {
        const number = (
          <span
            className={cn(
              'text-metric font-[650] tracking-[-0.02em] tabular-nums',
              // 점이 색을 나르면 숫자는 중립이다
              m.dot === undefined ? tone[m.tone ?? 'default'] : 'text-text',
            )}
          >
            {m.value}
          </span>
        );
        const body =
          layout === 'inline' ? (
            <>
              {m.dot !== undefined && (
                <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', m.dot)} />
              )}
              {number}
              <span
                className={cn(
                  'text-sm',
                  m.toggle?.pressed === true ? 'text-text' : 'text-text-mute',
                )}
              >
                {m.label}
              </span>
            </>
          ) : (
            <>
              <span className="text-2xs font-semibold tracking-[0.06em] text-text-faint uppercase">
                {m.label}
              </span>
              {number}
            </>
          );
        const shell = cn(
          layout === 'inline' ? 'flex shrink-0 items-center gap-2' : 'flex flex-col gap-1',
          'pr-8 max-md:pr-4',
          i < metrics.length - 1 && 'mr-8 border-r border-border max-md:mr-4',
          m.dimmed === true && 'opacity-45',
        );
        const testId = m.testId === undefined ? {} : { 'data-testid': m.testId };
        if (m.toggle !== undefined) {
          const { pressed, onToggle, disabled } = m.toggle;
          return (
            <button
              key={m.label}
              type="button"
              {...testId}
              data-selected={pressed}
              aria-pressed={pressed}
              disabled={disabled}
              onClick={onToggle}
              className={cn(
                shell,
                'text-left transition-opacity',
                disabled !== true && 'cursor-pointer hover:opacity-100',
              )}
            >
              {body}
            </button>
          );
        }
        return m.href === undefined ? (
          <div key={m.label} {...testId} className={shell}>
            {body}
          </div>
        ) : (
          <Link
            key={m.label}
            to={m.href}
            {...testId}
            {...(m.search === undefined ? {} : { search: m.search })}
            className={cn(shell, 'group')}
          >
            <span className="contents group-hover:[&>span:last-child]:text-link">{body}</span>
          </Link>
        );
      })}
      {actions !== undefined && (
        <>
          <div className="flex-1" />
          <div className="flex flex-wrap items-center gap-2 max-md:basis-full">{actions}</div>
        </>
      )}
    </div>
  );
}
