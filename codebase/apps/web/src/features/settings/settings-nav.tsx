// 설정의 항목 — 범위로 묶는다: 조직 · 프로젝트 · 나 (2026-09-25 — 사람 결정 D1 · UI/UX 검토 SET-06 · NAV-10 · REQ-WEB-227)
//
// 설정은 "설정" 한 낱말과 탭 넷이었고, 탭마다 범위가 달랐다 — 토큰은 **나**(모든 조직), 조직·프로젝트와 멤버는
// **조직**, 게이트 정책은 **프로젝트**. 탭 줄은 그 차이를 말하지 않았고 토큰 탭은 내 것과 조직 전체의 것을 한 화면에
// 섞었다. 여기서 항목을 범위로 묶고 무리마다 이름을 단다.
//
// **자리는 둘이고 목록은 하나다.** 사이드바가 서는 폭에서는 셸 사이드바의 [설정] 아래에 펼쳐지고(도움말의 차례와
// 같은 규칙 · REQ-WEB-225), 서랍으로 접히는 좁은 폭에서는 설정 화면 머리의 가로 줄이다(REQ-WEB-151 — 줄 안에서
// 민다). 두 자리가 같은 목록을 읽으므로 한쪽에만 항목이 더해지는 일이 없다.

import { Link } from '@tanstack/react-router';
import { useT } from '../../lib/i18n.js';
import { useMe } from '../../lib/queries.js';
import { canManageScope } from '../../lib/session.js';
import { useScope } from '../../lib/scope.js';
import { cn } from '../../lib/utils.js';
import type { MessageKey } from '@nerv/schema';

type SettingsPath =
  | '/settings/workspace'
  | '/settings/members'
  | '/settings/org-tokens'
  | '/settings/gates'
  | '/settings/account'
  | '/settings/tokens';

/**
 * 이름 키는 접두사로 좁힌다 — `MessageKey` 전체로 두면 번역기가 카탈로그 전체의 자리표시자를 합쳐 "인자를 하나 더
 * 달라" 가 된다(manual.ts 의 `ManualTitleKey` 와 같은 이유). 이 키들은 전부 자리표시자가 없다
 */
type ItemKey = Extract<MessageKey, `settings.tab.${string}`>;
type GroupKey = Extract<MessageKey, `settings.group.${string}`>;

interface SettingsItem {
  to: SettingsPath | null;
  label: ItemKey;
  /** 이 항목을 볼 수 있는가 — 권한이 없으면 **그리지 않는다**(REQ-WEB-168) */
  orgAdminOnly?: boolean;
}

interface SettingsGroup {
  key: 'org' | 'project' | 'me';
  label: GroupKey;
  items: SettingsItem[];
}

/**
 * 무리의 순서가 곧 설정의 순서다 — **조직이 먼저다**: 멤버·토큰·게이트는 그 안에서 정하는 것들이고, `/settings` 는
 * 첫 무리의 첫 항목에 착지한다(예전에는 탭 줄 첫 칸이 조직·프로젝트인데 착지는 둘째 칸 멤버였다).
 */
export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    key: 'org',
    label: 'settings.group.org',
    items: [
      { to: '/settings/workspace', label: 'settings.tab.workspace' },
      { to: '/settings/members', label: 'settings.tab.members' },
      { to: '/settings/org-tokens', label: 'settings.tab.org_tokens', orgAdminOnly: true },
    ],
  },
  {
    key: 'project',
    label: 'settings.group.project',
    items: [
      { to: '/settings/gates', label: 'settings.tab.gates' },
      // 명세의 연동 탭은 Phase 2 다 — **자리만 비활성으로 둔다**(§2.8). 없는 척하면 찾는 사람이 헤맨다
      { to: null, label: 'settings.tab.integrations' },
    ],
  },
  {
    key: 'me',
    label: 'settings.group.me',
    // **내 계정이 먼저다**(2026-09-25 — 사람 결정 D10 · REQ-WEB-229) — 이름·비밀번호는 누구에게나 있고 토큰은 쓰는
    // 사람에게만 있다
    items: [
      { to: '/settings/account', label: 'settings.tab.account' },
      { to: '/settings/tokens', label: 'settings.tab.tokens' },
    ],
  },
];

/** 사이드바 항목과 같은 모양 — 셸의 NAV_ITEM 과 맞춘다(여기서 셸을 import 하지 않는다) */
const RAIL_ITEM =
  'group flex h-[29px] items-center gap-2 rounded-[5px] px-2 text-base text-text-mute transition-colors hover:bg-bg-hover hover:text-text';
const RAIL_ACTIVE = 'bg-bg-active font-medium text-text';

// 가로 줄의 활성 표시는 `data-status` 로 준다 — `activeProps` 의 border 두 벌은 생성된 CSS 순서가 이긴다(REQ-WEB-151)
const TAB =
  'shrink-0 border-b-2 border-transparent px-1 pb-2 text-sm whitespace-nowrap text-text-mute ' +
  'transition-colors hover:text-text ' +
  'data-[status=active]:border-status-action data-[status=active]:font-medium data-[status=active]:text-text';

export function SettingsNav({
  variant,
  className,
}: {
  /** `rail` — 셸 사이드바의 [설정] 아래 · `tabs` — 좁은 폭의 설정 화면 머리 */
  variant: 'rail' | 'tabs';
  className?: string;
}): React.JSX.Element {
  const t = useT();
  const me = useMe();
  const { orgSlug } = useScope();
  const orgAdmin = canManageScope(me.data, orgSlug, null);
  const groups = SETTINGS_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.orgAdminOnly !== true || orgAdmin),
  }));

  if (variant === 'tabs')
    return (
      // 넘치면 **줄 안에서** 민다 — 페이지를 옆으로 밀면 제목·본문까지 함께 간다(REQ-WEB-151)
      <nav
        data-testid="settings-tabs"
        aria-label={t('settings.nav_label')}
        className={cn('mb-5 flex gap-4 overflow-x-auto border-b border-border', className)}
      >
        {groups.map((group) => (
          <div key={group.key} className="flex shrink-0 items-end gap-3">
            <span
              data-testid={`settings-group-${group.key}`}
              className="shrink-0 pb-2 text-2xs font-semibold tracking-wide text-text-faint uppercase"
            >
              {t(group.label)}
            </span>
            {group.items.map((item) =>
              item.to === null ? (
                <span
                  key={item.label}
                  aria-disabled="true"
                  className="shrink-0 px-1 pb-2 text-sm whitespace-nowrap text-text-ghost"
                >
                  {t(item.label)} · {t('shell.nav.phase2')}
                </span>
              ) : (
                <Link key={item.to} to={item.to} className={TAB}>
                  {t(item.label)}
                </Link>
              ),
            )}
          </div>
        ))}
      </nav>
    );

  return (
    <nav
      data-testid="settings-nav"
      aria-label={t('settings.nav_label')}
      className={cn('mt-0.5 ml-2 flex flex-col gap-0.5 border-l border-border pl-1.5', className)}
    >
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-0.5">
          <p
            data-testid={`settings-group-${group.key}`}
            className="px-2 pt-1.5 text-2xs font-semibold tracking-[0.07em] text-text-ghost uppercase"
          >
            {t(group.label)}
          </p>
          {group.items.map((item) =>
            item.to === null ? (
              <span
                key={item.label}
                aria-disabled="true"
                className={cn(
                  RAIL_ITEM,
                  'cursor-default text-text-ghost hover:bg-transparent hover:text-text-ghost',
                )}
              >
                <span className="flex-1 truncate">{t(item.label)}</span>
                <span className="shrink-0 text-2xs">{t('shell.nav.phase2')}</span>
              </span>
            ) : (
              <Link
                key={item.to}
                to={item.to}
                data-testid={`settings-nav-${item.to.slice('/settings/'.length)}`}
                className={RAIL_ITEM}
                activeProps={{ className: RAIL_ACTIVE }}
              >
                <span className="flex-1 truncate">{t(item.label)}</span>
              </Link>
            ),
          )}
        </div>
      ))}
    </nav>
  );
}
