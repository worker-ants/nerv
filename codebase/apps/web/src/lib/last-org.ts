// 마지막으로 고른 조직과, 조직마다 마지막으로 본 프로젝트 — 키를 아는 곳은 여기 하나다
//
// scope.ts 가 이 값을 쓰고(`/o/:org` 가 적는다), api.ts 가 이 값을 `X-Nerv-Org` 로 실어
// 보낸다(REQ-API-152 — 같은 slug 가 두 조직에 있을 때 서버가 어느 쪽인지 알아야 한다).
// api.ts 가 scope.ts 를 부르면 queries → api 로 순환이라 **키를 아는 곳을 따로 둔다** —
// 두 곳에 문자열을 적어 두면 언젠가 한쪽만 바뀐다.
//
// **읽는 쪽이 바뀜을 들을 수 있어야 한다**(2026-09-24 — 사람 보고 · REQ-WEB-190). 헤더는 앱에서
// 한 번만 마운트되는데, 예전에는 이 값을 마운트할 때 `useState` 로 한 번 읽고 끝이었다. 조직을
// 바꾸면 새로 그려진 본문은 새 조직을, **헤더는 옛 조직과 옛 프로젝트를** 가리켰다. 쓰기가
// 구독자에게 알리고 `useSyncExternalStore` 가 듣는다 — 다른 탭의 쓰기는 `storage` 이벤트로 온다.
//
// localStorage 가 막힌 환경(사파리 프라이빗 등)에서도 화면은 그대로 돈다 — 읽기·쓰기 모두
// 실패를 삼키고 `null` 로 떨어진다. 그때도 이 탭 안의 구독은 메모리 값으로 돈다.

const LAST_ORG_KEY = 'nerv.last-org';
/**
 * 마지막 프로젝트는 **조직마다** 기억한다(2026-09-24). 키가 하나이던 동안 조직을 바꿔도 옛
 * 조직의 프로젝트가 남았고, 두 조직에 같은 slug 가 있으면 옛 것이 그대로 골라졌다.
 *
 * **조직을 모르는 옛 키(`nerv.last-project`)는 읽지 않는다.** 그 값이 어느 조직의 것인지 알 수
 * 없어서, 폴백으로 쓰면 같은 slug 를 가진 다른 조직에서 바로 이 결함이 되살아난다. 대가는
 * 올린 직후 한 번 첫 프로젝트로 떨어지는 것뿐이다.
 */
const PROJECT_KEY_PREFIX = 'nerv.last-project.';
const projectKey = (org: string): string => `${PROJECT_KEY_PREFIX}${org}`;

/** 저장이 막혔을 때도 이 탭 안에서는 기억한다 */
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

// 메모리는 **저장이 막혔을 때만** 쓴다 — 늘 함께 쓰면 localStorage 를 비워도 옛 값이 살아난다
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string): void {
  if (read(key) === value) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // 기억하지 못해도 화면은 돈다 — 이 탭 안에서는 메모리가 대신한다
    memory.set(key, value);
  }
  for (const listener of listeners) listener();
}

/** `useSyncExternalStore` 의 구독 — 다른 탭의 쓰기도 듣는다 */
export function subscribeScope(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent): void => {
    if (e.key === null || e.key.startsWith(LAST_ORG_KEY) || e.key.startsWith(PROJECT_KEY_PREFIX))
      listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function readLastOrg(): string | null {
  return read(LAST_ORG_KEY);
}

export function writeLastOrg(slug: string): void {
  write(LAST_ORG_KEY, slug);
}

/** 그 조직에서 마지막으로 본 프로젝트 */
export function readLastProject(org: string | null): string | null {
  return org === null ? null : read(projectKey(org));
}

export function writeLastProject(org: string | null, slug: string): void {
  if (org === null) return;
  write(projectKey(org), slug);
}
