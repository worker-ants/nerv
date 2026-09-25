// 언어 전환 — 사용자 메뉴와 로그인 전 화면이 같이 쓴다 (screens.md §1.7 · 2026-09-25 REQ-WEB-230)
//
// 바꾸는 자리는 사용자 메뉴다(§1.7). 그런데 로그인·가입·초대 화면은 셸 밖이라 그 메뉴가 없고, 브라우저 언어가
// 다르게 잡힌 사람은 **로그인하기 전까지 바꿀 수 없었다** — 읽을 수 없는 말로 적힌 로그인 화면이 첫 화면이었다
// (UI/UX 검토 SET-13 ③). 같은 단추 줄을 두 자리가 쓴다 — 모양이 둘이면 한 번 찾은 사람이 다시 찾지 못한다.

import { LOCALES } from '@nerv/schema';
import { LOCALE_LABEL, useLocale, useT } from '../lib/i18n.js';
import { cn } from '../lib/utils.js';

export function LocaleSwitch({
  className,
  labelled = true,
}: {
  className?: string;
  /** 머리의 "언어" 글자 — 사용자 메뉴는 두고, 로그인 전 화면은 단추만 둔다(단추 글자가 이미 언어 이름이다) */
  labelled?: boolean;
}): React.JSX.Element {
  const t = useT();
  const { locale, setLocale } = useLocale();
  return (
    <div data-testid="locale-switch" className={className}>
      {labelled && <p className="mb-1 text-2xs text-text-faint">{t('shell.language')}</p>}
      <div role="group" aria-label={t('shell.language')} className="flex gap-1">
        {LOCALES.map((code) => (
          <button
            key={code}
            type="button"
            data-testid={`locale-${code}`}
            aria-pressed={locale === code}
            onClick={() => setLocale(code)}
            className={cn(
              'rounded-nerv-sm px-2 py-0.5 text-xs',
              locale === code ? 'bg-bg-active font-medium' : 'text-text-mute hover:bg-bg-hover',
            )}
          >
            {/* 언어 이름은 그 언어로 적는다 — 읽을 수 없는 말로 적힌 선택지는 고를 수 없다 */}
            {LOCALE_LABEL[code]}
          </button>
        ))}
      </div>
    </div>
  );
}
