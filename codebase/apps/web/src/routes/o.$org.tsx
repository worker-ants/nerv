// /o/:org — 조직 전환. 화면 없이 컨텍스트만 바꾸고 홈으로 보낸다(screens.md §1.6 · :151).
//
// **바꾸는 일이 실제로 있어야 한다.** 2026-09-06 까지 이 라우트는 `<Navigate to="/" />`
// 하나였고 `useScope` 는 `orgs[0]` 고정이었다 — 조직이 둘인 사용자가 헤더에서 두 번째를
// 고르면 홈으로 갔다가 **원래 조직을 다시 보게 됐다.** 아무 일도 없던 것처럼 보이는 전환은
// 고장난 전환보다 나쁘다: 사람은 자기가 잘못 눌렀다고 생각한다.
//
// **바뀐 것이 모든 자리에 닿아야 한다**(2026-09-24 — 사람 보고 · REQ-WEB-190). 기록만 하던
// 동안 한 번만 마운트되는 헤더는 옛 조직의 프로젝트를 계속 가리켰다. 지금은 셋을 한다 —
// 기록(듣는 쪽이 바로 따라온다) · 캐시 무효화(같은 slug 가 두 조직에 있으면 옛 조직의 응답이
// 남는다) · 확인 토스트(전환은 화면이 없어서, 말하지 않으면 됐는지 알 수 없다).
//
// `?next=` 는 착지할 자리다 — 초대를 수락한 사람을 그 프로젝트로 보낸다. 앱 안의 경로만 받는다.
import { createFileRoute } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useT } from '../lib/i18n.js';
import { useMe } from '../lib/queries.js';
import { useRealtime } from '../lib/realtime.js';
import { rememberOrg, safeNext } from '../lib/scope.js';

export const Route = createFileRoute('/o/$org')({
  validateSearch: (search: Record<string, unknown>): { next?: string } => {
    const next = safeNext(search['next']);
    return next === undefined ? {} : { next };
  },
  component: OrgSwitch,
});

function OrgSwitch(): null {
  const { org } = Route.useParams();
  const { next } = Route.useSearch();
  const t = useT();
  const me = useMe();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  // 개발 모드의 이중 effect 가 토스트를 두 번 띄우지 않게
  const done = useRef(false);

  useEffect(() => {
    // 내가 속한 조직인지 알아야 "전환했다" 고 말할 수 있다 — me 가 오기 전에는 기다린다
    if (done.current || me.data === undefined) return;
    done.current = true;
    const membership = me.data.memberships.find((m) => m.org_slug === org);
    if (membership !== undefined) {
      rememberOrg(org);
      void queryClient.invalidateQueries();
      pushToast({ tone: 'ok', message: t('shell.org_switched', { org: membership.org_name }) });
    }
    // 속하지 않은 조직이면 바꾸지 않는다 — 기록만 하면 헤더는 첫 조직으로 떨어지면서
    // "바꿨다" 고 말하게 된다
    // **`next` 는 경로만이 아니다** — 알림이 짚은 뷰 상태(`?rail=comments` · `?diff=`)까지 싣는다
    // (REQ-WEB-199). 라우터의 `to` 는 경로 자리라 쿼리를 함께 주면 경로의 일부로 읽히므로,
    // 주소 전체를 히스토리에 그대로 넘긴다.
    if (membership !== undefined && next !== undefined) {
      router.history.replace(next);
      return;
    }
    void navigate({ to: '/', replace: true });
  }, [me.data, org, next, navigate, router, queryClient, pushToast, t]);

  return null;
}
