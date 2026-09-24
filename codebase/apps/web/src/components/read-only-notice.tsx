// 바꿀 수 없는 설정의 안내 — **누구에게 부탁할지까지** 말한다 (screens.md §2.8 · REQ-WEB-201)
//
// 2026-09-24 까지 안내는 자리마다 달랐다: 조직 이름칸은 회색 문장, 게이트는 주황 문장, 역할 칩은
// 툴팁뿐, 초대 구역은 **아예 사라졌다**(REQ-WEB-003 은 숨기지 말라고 한다). 어느 것도 admin 이
// **누구인지** 말하지 않아서, 동료를 부르고 싶은 사람은 멤버 표의 칩을 눈으로 훑어 admin 을
// 찾아야 했다. 톤은 중립 하나다 — 권한이 없는 것은 경고할 일이 아니다.

import { useT } from '../lib/i18n.js';
import { cn } from '../lib/utils.js';

/** 이름을 셋까지 적고 나머지는 수로 — 명부가 긴 조직에서 안내가 문단이 되지 않게 */
const SHOWN = 3;

/**
 * 이 범위를 바꿀 수 있는 사람 — 조직 전체 범위는 조직 admin, 프로젝트 범위는 조직 admin 과 그
 * 프로젝트의 admin 이다(서버의 `assertCanManageScope` 와 같은 규칙 · REQ-API-169).
 * 명부(EP-MBR-01)는 조직 멤버 누구나 읽는다.
 */
export function scopeAdmins(
  members: readonly Record<string, unknown>[],
  projectSlug: string | null,
): string[] {
  const names = members
    .filter(
      (m) =>
        m['role'] === 'admin' &&
        (m['project_slug'] === null ||
          m['project_slug'] === undefined ||
          (projectSlug !== null && m['project_slug'] === projectSlug)),
    )
    .map((m) => String(m['display_name'] ?? m['email'] ?? ''))
    .filter((name) => name !== '');
  return [...new Set(names)];
}

export function ReadOnlyNotice({
  children,
  admins,
  className,
}: {
  /** 규칙 — 무엇을 누가 바꾸는가 */
  children: React.ReactNode;
  /** 부탁할 사람 — 모르면(명부를 아직 못 받았으면) 규칙만 말한다 */
  admins: readonly string[] | undefined;
  className?: string;
}): React.JSX.Element {
  const t = useT();
  const list = admins ?? [];
  const names =
    list.length > SHOWN
      ? t('settings.readonly.more', {
          names: list.slice(0, SHOWN).join(' · '),
          n: list.length - SHOWN,
        })
      : list.join(' · ');
  return (
    <p
      data-testid="read-only-notice"
      className={cn(
        'rounded-nerv border border-border bg-bg-sunken px-3 py-2 text-sm text-text-mute',
        className,
      )}
    >
      {children}
      {list.length > 0 && (
        <>
          {' '}
          <span data-testid="read-only-ask">{t('settings.readonly.ask', { names })}</span>
        </>
      )}
    </p>
  );
}
