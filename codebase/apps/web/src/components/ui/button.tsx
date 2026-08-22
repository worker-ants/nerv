// shadcn/ui 프리미티브 — 시맨틱 토큰(primary·destructive·muted)은 screens.md §4.1 표에서 파생한다.
// 임의 hex 를 쓰지 않는다(REQ-WEB-032).

import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-status-action',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:opacity-90',
        outline: 'border border-border bg-bg-elev text-text hover:bg-bg-sunken',
        ghost: 'text-text hover:bg-bg-sunken',
        destructive: 'bg-destructive text-primary-foreground hover:opacity-90',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3',
        lg: 'h-10 px-6',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * 권한이 없어 비활성일 때의 사유. 버튼을 숨기지 않고 비활성 + 툴팁으로 알린다(REQ-WEB-003).
   */
  disabledReason?: string;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  disabledReason,
  ...props
}: ButtonProps): React.JSX.Element {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      {...(disabledReason === undefined ? {} : { title: disabledReason, disabled: true })}
      {...props}
    />
  );
}

export { buttonVariants };
