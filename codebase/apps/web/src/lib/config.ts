// 런타임 설정 — 화면이 자기 오리진에서 읽어 오는 배포 설정 (docs/04-mvp/scope.md §2.3 3단계)
//
// **빌드 타임(`VITE_*`)에 굽지 않는다.** 구우면 환경마다 다른 번들이 되어 "같은 산출물을
// 승격한다" 가 깨진다 — dev 에서 통과한 그 파일이 운영에 올라가는 것이 아니라, 운영용으로
// 다시 빌드한 다른 파일이 올라간다. 그래서 산출물은 하나이고, **배포가 파일 하나를 놓는다.**
//
// 읽는 것은 `/config.json` 하나이고 지금 들어 있는 값도 하나다 — API 주소(`api_url`).
//   - compose·k8s: 앞문(nginx)이 `NERV_API_URL` 을 그 자리에서 내어 준다(§5.4 템플릿)
//   - CDN 배치(4단계): 정적 파일 하나를 그 경로에 놓는다
//   - 개발 루프(Vite): **그 파일이 없다** — 아래 폴백이 그 자리를 받는다
//
// **없으면 같은 오리진이다.** 폴백이 빈 문자열인 이유는 그것이 지금까지의 동작이기
// 때문이다(상대 경로 → 화면이 뜬 오리진). 3단계는 "가를 수 있게 한다" 이지 "가른다" 가
// 아니므로, 파일이 없거나 값이 비면 **한 줄도 바뀌지 않아야 한다.**
//
// **개발 루프에서 이 파일은 404 가 아니다.** Vite 는 모르는 경로에 SPA 의 `index.html` 을
// 200 으로 돌려준다 — 그래서 상태 코드만 보고 성공이라 믿으면 HTML 을 JSON 으로 파싱하다
// 죽는다(플러그인 마켓플레이스가 같은 함정을 겪었다 · 4.6 §3.5). 아래는 **파싱까지 해 보고**
// 실패하면 폴백으로 간다.

/** 배포가 놓는 설정의 모양 — 지금은 주소 하나다. 늘어나면 여기부터 늘어난다. */
export interface RuntimeConfig {
  /** API 의 공개 오리진(`NERV_API_URL`). 빈 문자열이면 **화면과 같은 오리진**이다. */
  apiBase: string;
}

/** 파일이 없거나 못 읽을 때의 값 — 지금까지의 동작(상대 경로)이다. */
const SAME_ORIGIN: RuntimeConfig = { apiBase: '' };

/** 배포가 놓는 파일의 경로. 화면과 **같은 오리진**에서 읽는다 — 설정을 읽으러 다른 곳에 묻지 않는다. */
export const CONFIG_PATH = '/config.json';

let current: RuntimeConfig = SAME_ORIGIN;

/**
 * 지금 쓰는 API 주소. 비어 있으면 상대 경로가 된다(`''` + `/api/v1`).
 *
 * **동기 함수인 것이 계약이다** — 요청을 보내는 자리(`api.ts`·`session.ts`·`ws.ts`)가
 * 매번 설정을 기다리면 화면마다 await 가 하나씩 늘고, 그 사이에 나간 요청은 다른 주소로
 * 간다. 설정은 부팅 때 **한 번** 읽고(`loadRuntimeConfig`), 그 뒤로는 이 값을 읽는다.
 */
export function apiBase(): string {
  return current.apiBase;
}

/**
 * 서버가 준 **API 상대 주소**를 이 배치의 API 오리진에 붙인다 — 첨부처럼 `fetch` 가 아니라
 * `<img src>`·`<a href>` 로 브라우저가 직접 부르는 주소가 여기를 탄다.
 *
 * **저장되는 것은 상대 주소이고 붙이는 것은 볼 때다.** 서버는 첨부 주소를
 * `/api/v1/projects/{slug}/attachments/{id}` 로 준다(docs/04-mvp/api.md REQ-API-089)
 * — 그 모양이 정본인 이유는 소비자마다 앞에 붙일 것이 다르기 때문이다:
 * 에이전트는 `$NERV_SERVER`, 화면은 이 함수다. 본문(md)에 절대 주소를 박으면 그 문서가
 * 이 배치에 묶여, 도메인을 바꾼 날 옛 스펙의 그림이 전부 깨진다.
 *
 * **`fetch` 는 이 함수를 타지 않는다** — 그쪽은 `apiFetch`(`api.ts`)가 이미 같은 일을 한다.
 * 여기가 필요한 자리는 브라우저가 주소를 **스스로 해소하는** 자리뿐이고, 그 자리에서
 * 상대 주소는 화면이 뜬 오리진으로 간다 — 호스트를 가른 배치에서는 그쪽에 API 가 없다
 * (docs/04-mvp/scope.md §2.3 4단계).
 */
export function apiHref(path: string): string {
  return `${current.apiBase}${path}`;
}

/** 테스트가 모듈 상태를 되돌린다 — 남으면 다음 테스트가 앞 테스트의 배포 설정을 물려받는다. */
export function resetRuntimeConfigForTesting(config: RuntimeConfig = SAME_ORIGIN): void {
  current = config;
}

/**
 * 값을 오리진으로 정규화한다 — 경로·질의·끝 슬래시는 주소의 일부가 아니다.
 *
 * 서버가 같은 규칙으로 읽는다(`common/origins.ts` 의 `originOf`) — **양쪽이 같은 값을
 * 봐야** 브라우저가 싣는 `Origin` 과 서버의 허용 목록이 맞는다(REQ-CB-041).
 * 스킴이 없는 값(`api.example.com:8080`)은 불투명 오리진(`"null"`)이 되므로 버린다.
 */
function originOf(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const origin = new URL(value.trim()).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

/**
 * 부팅 때 한 번 읽는다 — 실패는 **폴백이지 오류가 아니다.**
 *
 * 화면이 뜨지 못하게 만들 이유가 없다: 파일이 없는 배치(개발 루프)가 정상 경로이고,
 * 잘못 놓인 파일은 같은 오리진으로 도는 편이 흰 화면보다 낫다. 대신 **왜 폴백했는지는
 * 콘솔에 남긴다** — 주소를 바꿔 놓고 안 바뀐다고 보는 사람이 볼 곳이 있어야 한다.
 */
export async function loadRuntimeConfig(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<RuntimeConfig> {
  try {
    const res = await fetchImpl(CONFIG_PATH, { cache: 'no-store' });
    if (!res.ok) {
      current = SAME_ORIGIN;
      return current;
    }
    // 파싱까지 해 본다 — 개발 루프에서는 여기로 SPA 의 index.html 이 200 으로 온다.
    const body = (await res.json()) as Record<string, unknown>;
    const apiBaseValue = body['api_url'];
    // **키가 없는 것과 값이 빈 것은 같은 뜻이다** — 둘 다 "같은 오리진" 이다. 앞문은
    // `NERV_API_URL` 이 비어 있으면 빈 문자열을 내어 주고, 그 배치는 한 호스트다.
    if (apiBaseValue === undefined || apiBaseValue === '') {
      current = SAME_ORIGIN;
      return current;
    }
    const origin = originOf(apiBaseValue);
    if (origin === null) {
      console.warn(
        `${CONFIG_PATH} 의 api_url("${String(apiBaseValue)}")을 오리진으로 읽지 못해 ` +
          // eslint-disable-next-line no-restricted-syntax -- 운영자용 콘솔 로그다(REQ-CB-022 예외): 배포 설정 오류라 화면 문구가 아니다
          '같은 오리진으로 돕니다 — 스킴부터 적으십시오(예 https://api.example.com).',
      );
      current = SAME_ORIGIN;
      return current;
    }
    current = { apiBase: origin };
    return current;
  } catch {
    // 네트워크 실패·JSON 아님 — 개발 루프의 정상 경로가 여기다(조용히 폴백한다).
    current = SAME_ORIGIN;
    return current;
  }
}
