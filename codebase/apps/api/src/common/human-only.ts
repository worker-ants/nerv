// 사람 전용 게이트 — **판정은 도메인 서비스에 있다** (D-05 · api.md §1.3b)
//
// 예전에는 이 판정이 **표면에만** 있었다: `HUMAN_ONLY` 를 던지는 곳이 컨트롤러 다섯이고
// 도메인 서비스는 0건이었다. 대응 메서드(`updateProject`·`archive`·`restore`·
// `BaselineService.create`·`steer`·승인 결정)는 주체의 종류를 **인자로 받지도 않았다** —
// 다른 표면이 같은 메서드를 부르면 게이트가 없다는 뜻이다.
//
// D-05 는 "표면은 번역만 하고 판정은 도메인 서비스 한 곳" 이라 적는다. 게이트도 판정이다.
// 표면이 늘 때마다 사람이 기억해서 붙이는 것은 규약이 아니라 습관이고, 습관은 빠진다.
//
// **주체의 종류는 표면이 안다.** 그것이 D-05 가 말하는 "번역" 이다: 컨트롤러는 요청에서
// 주체를 읽어 넘기고, 무엇을 막을지는 서비스가 정한다.

import { msg, NERV_ERROR } from '@nerv/schema';
import { NervError } from './nerv-exception.filter.js';

/**
 * 도메인 메서드가 받는 주체.
 *
 * `isAgent` 가 축이다 — 세션 유무가 아니다. PAT 는 에이전트 세션 없이도 온다
 * (`ResolveInput.isAgent` 주석과 같은 이유).
 */
export interface Actor {
  userId: string;
  isAgent: boolean;
}

/**
 * 사람 전용 동작의 종류 — 메시지와 딥링크가 여기서 갈린다.
 *
 * 값을 늘릴 때는 i18n 키(`error.human_only.*`)도 함께 늘어난다. 그것이 의도다:
 * "사람만 할 수 있다" 는 말은 **무엇을 대신 하라는 안내**가 붙어야 쓸모가 있다.
 */
export type HumanOnlyAction =
  | 'project_admin'
  | 'inbox'
  | 'inbox_decide'
  | 'approve'
  | 'bypass'
  | 'steer'
  | 'baseline'
  | 'token_issue';

const MESSAGE = {
  project_admin: 'error.human_only.project_admin',
  inbox: 'error.human_only.inbox',
  inbox_decide: 'error.human_only.inbox_decide',
  approve: 'error.human_only.approve',
  bypass: 'error.human_only.bypass',
  steer: 'error.human_only.steer',
  baseline: 'error.human_only.baseline',
  token_issue: 'error.human_only.token_issue',
} as const;

/**
 * **토큰 발급은 여기 없다.** "PAT 가 PAT 를 발급하지 못한다" 는 도메인 판단이 아니라
 * **인증 사슬의 규칙**이다(D-08 — 권한 상속의 사슬은 사람에서 시작한다). 무엇을 발급할
 * 수 있는지는 도메인이 보고(`isAgentScope` — 사람 전용 권한은 토큰에 담기지 않는다),
 * 누가 요청했는지는 표면이 본다. 그 둘은 다른 물음이라 자리를 나눈다.
 */

/**
 * 에이전트면 막는다. **사람이면 아무 일도 하지 않는다** — 역할 판정은 이 함수의 몫이 아니다
 * (`@RequireRole` 과 서비스의 역할 검사가 그것을 본다). 여기서 가르는 축은 하나뿐이다.
 *
 * `webUrl` 은 **대신 갈 곳**이다. 막기만 하고 길을 안 주면 에이전트는 같은 호출을 재시도한다.
 */
export function assertHuman(actor: Actor, action: HumanOnlyAction, webUrl?: string): void {
  if (!actor.isAgent) return;
  throw new NervError(NERV_ERROR.HUMAN_ONLY, msg(MESSAGE[action]), {
    kind: 'human_only',
    action,
    ...(webUrl === undefined ? {} : { web_url: webUrl }),
  });
}
