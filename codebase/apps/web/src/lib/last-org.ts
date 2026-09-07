// 마지막으로 고른 조직 — 키 하나를 두 곳이 쓴다
//
// scope.ts 가 이 값을 쓰고(`/o/:org` 가 적는다), api.ts 가 이 값을 `X-Nerv-Org` 로 실어
// 보낸다(REQ-API-152 — 같은 slug 가 두 조직에 있을 때 서버가 어느 쪽인지 알아야 한다).
// api.ts 가 scope.ts 를 부르면 queries → api 로 순환이라 **키를 아는 곳을 따로 둔다** —
// 두 곳에 문자열을 적어 두면 언젠가 한쪽만 바뀐다.
//
// localStorage 가 막힌 환경(사파리 프라이빗 등)에서도 화면은 그대로 돈다 — 읽기·쓰기 모두
// 실패를 삼키고 `null` 로 떨어진다.

const LAST_ORG_KEY = 'nerv.last-org';

export function readLastOrg(): string | null {
  try {
    return localStorage.getItem(LAST_ORG_KEY);
  } catch {
    return null;
  }
}

export function writeLastOrg(slug: string): void {
  try {
    localStorage.setItem(LAST_ORG_KEY, slug);
  } catch {
    // 기억하지 못해도 화면은 돈다 — 첫 조직으로 떨어질 뿐이다
  }
}
