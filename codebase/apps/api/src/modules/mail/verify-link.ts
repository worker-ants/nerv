// 확인·재설정 링크 — 가입 확인 메일과 비밀번호 재설정 메일에 박히는 주소 (정본: docs/04-mvp/api.md §1.3)
//
// **순수 함수만 둔다.** `better-auth.ts` 가 이 파일을 import 한다 — 그 파일은 Nest 밖이라
// (`VerificationMail` 머리 주석) 아웃박스 서비스를 끌어오면 DI 그래프가 따라 들어온다.

/**
 * 확인 링크 — API 가 토큰을 확인하고 **화면으로** 돌려보낸다(api.md §1.3).
 *
 * **돌아갈 자리는 요청이 정한다**(2026-09-24 — 사람 보고). 전에는 언제나 화면의 첫 주소(`/`)
 * 였다. 그래서 초대 링크로 가입한 사람은 초대 화면이 아니라 홈에 떨어졌고(REQ-WEB-089 가
 * "그 초대 화면으로 되돌린다" 고 적은 자리), 소속이 없는 사람은 아무것도 할 수 없는 빈 홈에
 * 섰다(REQ-WEB-188). better-auth 는 요청의 `callbackURL` 을 자기 `url` 에 실어 넘기는데 우리가
 * 그 링크를 새로 만들면서 그 값을 버리고 있었다.
 *
 * **화면 오리진 밖으로는 보내지 않는다.** 돌아갈 자리는 메일에 박혀 남의 손에 들릴 수 있는
 * 값이라, 다른 호스트를 허락하면 우리 도메인의 링크가 열린 리다이렉트가 된다. better-auth 도
 * 신뢰 오리진으로 거르지만 그 목록은 API 자신까지 담는다 — 사람이 돌아갈 곳은 화면뿐이다.
 * 맞지 않으면 조용히 첫 주소로 떨어진다(링크를 못 쓰게 만드는 것보다 낫다).
 */
export function verifyEmailLink(input: {
  api: string;
  web: string;
  token: string;
  returnTo: string | null;
}): string {
  const web = input.web.replace(/\/+$/, '');
  const back = safeReturnTo(web, input.returnTo) ?? `${web}/`;
  return (
    `${input.api.replace(/\/+$/, '')}/api/auth/verify-email` +
    `?token=${encodeURIComponent(input.token)}&callbackURL=${encodeURIComponent(back)}`
  );
}

/**
 * 비밀번호 재설정 링크 — API 가 토큰을 보고 **화면의 `/reset-password`** 로 돌려보낸다(2026-09-25 · REQ-API-187).
 *
 * 확인 링크와 같은 모양이다: 사람이 여는 것은 인증 스택의 `GET /api/auth/reset-password/<토큰>` 이고, 그 자리가
 * 토큰이 살아 있는지 **보기만 하고**(쓰지 않는다) 화면으로 보낸다 — 살아 있으면 `?token=`, 아니면
 * `?error=INVALID_TOKEN`. 그래서 만료된 링크를 연 사람은 새 비밀번호를 두 번 치기 **전에** 그 사실을 안다.
 * 메일 보안 검사기가 링크를 미리 열어도 토큰은 닳지 않는다(쓰는 것은 화면의 POST 다).
 *
 * **돌아갈 자리는 요청에서 받지 않는다.** 가입 확인과 달리 여기는 갈 곳이 하나뿐이다 — 요청이 준 값을 실으면
 * 그만큼 열린 리다이렉트의 여지가 생긴다.
 */
export function resetPasswordLink(input: { api: string; web: string; token: string }): string {
  const back = `${input.web.replace(/\/+$/, '')}/reset-password`;
  return (
    `${input.api.replace(/\/+$/, '')}/api/auth/reset-password/${encodeURIComponent(input.token)}` +
    `?callbackURL=${encodeURIComponent(back)}`
  );
}

/** 화면 오리진 안의 절대 주소로 — 아니면 null. 상대 경로(`/invite/…`)는 화면 기준으로 편다 */
function safeReturnTo(web: string, returnTo: string | null): string | null {
  if (returnTo === null || returnTo.trim() === '') return null;
  try {
    const base = new URL(`${web}/`);
    const target = new URL(returnTo, base);
    return target.origin === base.origin ? target.href : null;
  } catch {
    return null;
  }
}

/** better-auth 가 넘긴 확인 링크에서 요청의 `callbackURL` 을 꺼낸다. 없거나 못 읽으면 null */
export function returnToOf(url: string): string | null {
  try {
    return new URL(url).searchParams.get('callbackURL');
  } catch {
    return null;
  }
}
