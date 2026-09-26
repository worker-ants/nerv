// 시작하기 — 새 조직의 세 걸음 (screens.md §2.1 · §2.2 · REQ-WEB-205)
//
// 조직을 막 만든 사람은 프로젝트 0개인 홈에 섰고, 거기에는 "밀린 결정이 없어요" 와 빈 최근 활동뿐
// 이었다. 프로젝트를 만들고 사람을 부르고 에이전트를 붙이는 길은 설정의 탭 셋에 흩어져 있었고
// 어느 화면도 그 순서를 말하지 않았다(2026-09-24 UI/UX 검토 — SET-01 · NAV-03 · HUB-13).
//
// **조직 admin 에게만** 보인다 — 셋 중 둘(프로젝트·초대)은 조직 admin 의 일이다. 끝난 걸음은 ✓ 로
// 남기고, 셋이 끝나거나 닫으면 사라진다. 닫은 것은 이 브라우저가 기억한다(편의일 뿐이다 — 잊어도
// 다시 보일 뿐 잃는 것은 없다). **데이터가 오기 전에는 아무 말도 하지 않는다**(REQ-WEB-198) —
// 받아 오기 전의 0 을 "아직 안 했다" 로 읽으면 이미 끝낸 사람에게 할 일을 내민다.

import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useT } from '../lib/i18n.js';
import {
  rows,
  useMe,
  useMembers,
  useOrgInvitations,
  useProjects,
  useTokens,
} from '../lib/queries.js';
import { canManageScope } from '../lib/session.js';
import { cn } from '../lib/utils.js';
import { Card } from './ui/primitives.js';

const DISMISS_KEY = (org: string): string => `nerv.start-dismissed.${org}`;

function readDismissed(org: string): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY(org)) === '1';
  } catch {
    return false;
  }
}

export interface StartChecklistProps {
  orgSlug: string | null;
  /** 온보딩의 ③ 처럼 그 자리의 본문일 때는 닫기를 두지 않는다 */
  dismissible?: boolean | undefined;
}

export function StartChecklist({
  orgSlug,
  dismissible = true,
}: StartChecklistProps): React.JSX.Element | null {
  const t = useT();
  const me = useMe();
  const isOrgAdmin = canManageScope(me.data, orgSlug, null);
  const projects = useProjects(isOrgAdmin ? orgSlug : null);
  const members = useMembers(isOrgAdmin ? orgSlug : null);
  const invitations = useOrgInvitations(isOrgAdmin ? orgSlug : null);
  const tokens = useTokens();
  const [dismissed, setDismissed] = useState(() => orgSlug !== null && readDismissed(orgSlug));

  if (!isOrgAdmin || orgSlug === null || (dismissible && dismissed)) return null;
  if (
    projects.data === undefined ||
    members.data === undefined ||
    invitations.data === undefined ||
    tokens.data === undefined
  ) {
    return null;
  }

  const steps = [
    {
      id: 'project',
      done: rows(projects.data).length > 0,
      label: t('start.project'),
      to: '/settings/projects' as const,
      // 폼이 열린 채로 도착한다 — 도착해서 [+ 새 프로젝트]를 한 번 더 찾게 하지 않는다
      search: { new: 1 as const },
    },
    {
      id: 'invite',
      // 부른 것도 한 걸음이다 — 상대가 아직 수락하지 않았어도 이 사람이 할 일은 끝났다
      // 명부는 멤버십 한 줄씩이다 — 겸직한 한 사람이 두 줄이므로 **사람**을 센다
      done:
        new Set(rows(members.data).map((m) => m['user_id'])).size > 1 ||
        rows(invitations.data).some((i) => i['state'] === 'pending'),
      label: t('start.invite'),
      // 초대 탭으로 연다 — 멤버 탭이 기본이라 그냥 보내면 초대 폼을 한 번 더 찾아야 한다(REQ-WEB-242)
      to: '/settings/members' as const,
      search: { tab: 'invites' as const },
    },
    {
      id: 'agent',
      // 살아 있는 토큰이 하나라도 있는가 — 폐기·만료된 것은 에이전트를 붙이지 못한다
      done: rows(tokens.data).some(
        (k) =>
          (k['revoked_at'] === null || k['revoked_at'] === undefined) &&
          !(typeof k['expires_at'] === 'string' && Date.parse(k['expires_at']) <= Date.now()),
      ),
      label: t('start.agent'),
      to: '/settings/tokens' as const,
      search: {},
    },
  ];
  if (steps.every((s) => s.done)) return null;

  return (
    <Card data-testid="start-checklist">
      <div className="flex items-baseline gap-2">
        <h2 className="font-medium">{t('start.title')}</h2>
        {dismissible && (
          <button
            type="button"
            data-testid="start-dismiss"
            className="ml-auto text-xs text-text-faint hover:text-text"
            onClick={() => {
              try {
                localStorage.setItem(DISMISS_KEY(orgSlug), '1');
              } catch {
                // 기억하지 못해도 이번에는 닫힌다
              }
              setDismissed(true);
            }}
          >
            {t('start.dismiss')}
          </button>
        )}
      </div>
      <p className="mt-0.5 text-sm text-text-mute">{t('start.lead')}</p>
      <ol className="mt-3 flex flex-col gap-1.5">
        {steps.map((step, index) => (
          <li
            key={step.id}
            data-testid={`start-step-${step.id}`}
            data-done={step.done ? 'true' : undefined}
            className="flex items-center gap-2.5 text-sm"
          >
            <span
              aria-hidden="true"
              className={cn(
                'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-2xs',
                step.done ? 'bg-status-ok/15 text-status-ok' : 'bg-bg-sunken text-text-mute',
              )}
            >
              {step.done ? '✓' : index + 1}
            </span>
            {step.done ? (
              <span className="text-text-faint">
                {step.label} · {t('start.done')}
              </span>
            ) : (
              <Link to={step.to} search={step.search} className="text-link hover:underline">
                {step.label} ▸
              </Link>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}
