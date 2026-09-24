// 토스트 스택 — 셸 오른쪽 아래(screens.md §1.3 · REQ-WEB-197)
//
// 2026-09-24 까지 이 자리는 네 가지를 못 했다.
//   ① 모양이 하나였다 — "권한이 없습니다" 와 "승인했습니다" 가 같은 흰 상자에 글자만 달랐다.
//   ② 보조기기에 알리지 않았다 — 모든 실패가 여기로 오는데 스크린리더 사용자는 듣지 못했다.
//   ③ 상한이 없었다 — 에이전트가 초안을 저장할 때마다 3분짜리 한 장이 쌓였다.
//   ④ 링크가 `<a href>` 라 누르면 앱 전체를 새로 적재했다 — 캐시와 실시간 연결이 끊긴다.

import { useRouter } from '@tanstack/react-router';
import { useT } from '../lib/i18n.js';
import { useRealtime } from '../lib/realtime.js';
import type { Toast } from '../lib/realtime.js';
import { cn } from '../lib/utils.js';

/** 한 번에 보이는 수 — 넘치면 오래된 것부터 접고 "외 N건" 으로 말한다 */
export const TOAST_VISIBLE_MAX = 3;

/**
 * 톤마다 기호 · 색 줄. **색만으로 말하지 않는다**(ui-wireframes §4.6 — 색 + 글자 + 기호).
 * 기호는 장식이 아니라 톤의 이름이라 보조기기에는 `role` 이 대신 말한다.
 */
const TONE = {
  warn: { glyph: '⚠', rule: 'border-l-status-danger', glyphClass: 'text-status-danger' },
  ok: { glyph: '✓', rule: 'border-l-status-ok', glyphClass: 'text-status-ok' },
  info: { glyph: 'ℹ', rule: 'border-l-status-progress', glyphClass: 'text-status-progress' },
} as const satisfies Record<Toast['tone'], { glyph: string; rule: string; glyphClass: string }>;

/** 앱 안 경로인가 — 그러면 라우터로 옮겨 가고 새로 적재하지 않는다 */
export function isInAppHref(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

export function ToastStack(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const { toasts, dismissToast, dismissAllToasts } = useRealtime();
  const visible = toasts.slice(-TOAST_VISIBLE_MAX);
  const hidden = toasts.length - visible.length;

  return (
    <section
      aria-label={t('shell.toast.region')}
      data-testid="toast-outlet"
      className="fixed right-4 bottom-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {hidden > 0 && (
        <div
          data-testid="toast-overflow"
          className="flex items-center justify-end gap-2 text-xs text-text-mute"
        >
          <span>{t('shell.toast.more', { n: hidden })}</span>
          <button type="button" className="text-link hover:underline" onClick={dismissAllToasts}>
            {t('shell.toast.dismiss_all')}
          </button>
        </div>
      )}
      {visible.map((toast) => {
        const tone = TONE[toast.tone];
        return (
          <div
            key={toast.id}
            data-testid="toast"
            data-tone={toast.tone}
            // 경고는 끼어들어 알리고(alert), 나머지는 하던 말이 끝난 뒤에 알린다(status)
            role={toast.tone === 'warn' ? 'alert' : 'status'}
            className={cn(
              'flex items-start gap-2.5 rounded-nerv border border-l-2 border-border bg-bg-elev px-3 py-2 text-sm shadow-popover',
              tone.rule,
            )}
          >
            <span aria-hidden="true" className={cn('mt-px shrink-0', tone.glyphClass)}>
              {tone.glyph}
            </span>
            <span className="min-w-0 flex-1 break-words">
              {toast.message}
              {toast.href !== undefined && (
                <>
                  {' '}
                  <a
                    href={toast.href}
                    className="whitespace-nowrap text-link underline"
                    onClick={(e) => {
                      if (toast.href === undefined || !isInAppHref(toast.href)) return;
                      e.preventDefault();
                      router.history.push(toast.href);
                      dismissToast(toast.id);
                    }}
                  >
                    {toast.hrefLabel ?? t('shell.toast.open')}
                  </a>
                </>
              )}
            </span>
            <button
              type="button"
              aria-label={t('shell.dismiss')}
              className="shrink-0 text-text-faint hover:text-text"
              onClick={() => dismissToast(toast.id)}
            >
              ✕
            </button>
          </div>
        );
      })}
    </section>
  );
}
