// 우리 주소 둘 — `NERV_WEB_URL` · `NERV_API_URL` (정본: docs/04-mvp/codebase.md §5.2 전표)
//
// **하나였던 이름이 두 가지 뜻을 겸하고 있었다.** `NERV_PUBLIC_URL` 은 화면의 주소이자
// API·플러그인 카탈로그의 주소였고, 둘이 우연히 같은 오리진이라 맞고 있었을 뿐이다.
// 이 저장소는 같은 부류로 이미 한 번 데었다 — `NERV_S3_PUBLIC_ENDPOINT` 가 별도 호스트가
// 된 이유가 정확히 그것이다(REQ-CB-034). 그래서 도메인을 나누기 **전에** 이름을 가른다
// (2026-09-13 사람 결정 · docs/04-mvp/scope.md §2.3 · REQ-CB-036).
//
// 뜻의 경계는 "누가 그 주소를 여는가" 다.
//   - `NERV_WEB_URL` — **사람이 브라우저로 여는 주소.** 스펙 딥링크가 그것으로 절대 URL 이 된다.
//   - `NERV_API_URL` — **프로그램이 붙는 주소.** 세션 핸들러·플러그인 카탈로그·요청 절대화 기준.
//
// 옛 이름은 **물려주지 않는다.** 한쪽이 물려받으면 "어느 뜻을 물려받았는가" 가 소비자마다
// 다시 물어야 할 질문이 된다. 그 대가로 기존 배치가 전부 깨지므로 아래가 거부한다(REQ-CB-037).

/**
 * 두 이름의 공통 기본값 — **compose 앞문의 주소**다(`NERV_HTTP_PORT` 의 기본값 · §5.2 전표).
 *
 * compose 는 앞문 하나가 화면과 API 를 함께 서빙하므로 두 값이 같다. **같은 값이라
 * 이름을 가른 의미가 없는 것이 아니다** — 소비자가 어느 뜻을 쓰는지가 코드에 적혀야
 * 나중에 호스트를 가를 때 고칠 자리를 찾을 수 있다.
 *
 * **개발 루프에는 그 앞문이 없다**(2026-09-14 정정 — 이 주석은 8080 을 "개발 루프의 한
 * 포트" 라 적고 있었다). 화면은 Vite 의 :5173 에 뜨고 API 는 :8080 이라 두 주소가 실제로
 * 갈리므로, 그 배치는 `NERV_WEB_URL=http://localhost:5173` 을 명시해야 한다 — 이 기본값에
 * 맡기면 스펙 딥링크가 **화면을 서빙하지 않는 API** 를 가리켜 404 다. 즉 이름을 가른
 * 이유(REQ-CB-036)는 앞으로의 도메인 분리가 아니라 개발 루프에 이미 실물로 있다.
 */
export const DEFAULT_ORIGIN = 'http://localhost:8080';

/** 오리진 기준값 주입 토큰 — 미주입이면 env → 기본값 순서로 떨어진다(§5.2 전표). */
export const NERV_API_URL = Symbol('NERV_API_URL');
export const NERV_WEB_URL = Symbol('NERV_WEB_URL');
/** 추가 허용 오리진 **목록**의 주입 토큰 — 값이 배열이라 토큰 없이는 Nest 가 해소하지 못한다. */
export const NERV_TRUSTED_ORIGINS = Symbol('NERV_TRUSTED_ORIGINS');

/** 프로그램이 붙는 주소. */
export function apiUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const value = (env['NERV_API_URL'] ?? '').trim();
  return value === '' ? DEFAULT_ORIGIN : value;
}

/** 사람이 브라우저로 여는 주소. */
export function webUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const value = (env['NERV_WEB_URL'] ?? '').trim();
  return value === '' ? DEFAULT_ORIGIN : value;
}

/**
 * URL 에서 스킴+호스트+포트만 남긴다. 파싱 불가면 null.
 *
 * `/mcp` Origin 가드와 아래 신뢰 오리진 파서가 **같은 함수로** 오리진을 읽는다 — 여기 둔
 * 이유가 그것이다(2026-09-14 이동). 전에는 가드 파일에 있었는데 그러면 이 파일이 가드를
 * import 해야 하고, 가드는 이미 이 파일을 import 하므로 고리가 된다.
 */
export function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * 추가로 신뢰할 오리진 목록 — `NERV_TRUSTED_ORIGINS`(§5.2 전표).
 *
 * **구분자가 쉼표뿐이었다**(2026-09-14). 전표도 파서도 "쉼표 구분" 이었는데, 오리진을 한 줄에
 * 하나씩 적는 것이 k8s ConfigMap·compose 의 여러 줄 문자열에서는 자연스러운 모양이다 —
 * 그렇게 적은 배치에서는 목록 전체가 **한 덩어리의 못 쓰는 값**이 된다. 쉼표·공백·줄바꿈을
 * 모두 구분자로 받는다.
 *
 * **오리진으로 정규화한다.** `https://app.example.com/` 처럼 끝 슬래시가 붙거나 경로가 딸린
 * 값은 better-auth 의 대조에서 조용히 빗나간다 — 사람은 "적었는데 막힌다" 만 본다.
 *
 * **스킴이 없는 값은 버린다.** `localhost:5173` 은 URL 로 파싱된다(`localhost:` 가 스킴이 된다).
 * 그러나 그 오리진은 불투명 오리진, 즉 **문자열 `"null"`** 이다. 그대로 목록에 넣으면 브라우저가
 * `Origin: null` 을 싣는 요청(샌드박스 iframe · 일부 리다이렉트)이 통과한다 — 스킴을 빠뜨린
 * 오타 하나가 CSRF 방어선에 구멍을 내는 셈이다.
 *
 * **버리는 것도 조용히 하지 않는다.** 사람은 자기가 적은 값이 목록에 없다는 사실을 알아야
 * 한다 — 모르면 열어 둔 줄 알고 있는 오리진이 실은 없는 것이 된다.
 *
 * **이 함수가 목록 전부는 아니다**(2026-09-20 · REQ-CB-041). 허용 오리진은
 * `NERV_WEB_URL` 과의 합집합이고, 그 합집합을 만드는 것은 `allowedOriginsFromEnv` 다 —
 * CORS 와 better-auth 가 **같은 목록**을 봐야 하기 때문이다(docs/04-mvp/scope.md §2.3 2단계).
 */
export function trustedOriginsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  for (const value of (env['NERV_TRUSTED_ORIGINS'] ?? '').split(/[\s,]+/)) {
    if (value === '') continue;
    const origin = originOf(value);
    // 로거를 세우기 전에 불릴 수 있어 `console` 이다(아래 assertPublicUrlRetired 와 같은 이유).
    if (origin === null || origin === 'null') {
      console.warn(
        `NERV_TRUSTED_ORIGINS 의 "${value}" 은 오리진이 아니어서 버립니다 — ` +
          `스킴부터 적으십시오(예 https://app.example.com).`,
      );
      continue;
    }
    if (origin !== value) {
      console.warn(
        `NERV_TRUSTED_ORIGINS 의 "${value}" 을 오리진 "${origin}" 으로 읽습니다 — ` +
          `경로·질의·끝 슬래시는 대조에 쓰이지 않습니다.`,
      );
    }
    out.push(origin);
  }
  return [...new Set(out)];
}

/**
 * 브라우저가 이 API 를 부를 수 있는 오리진 전부 — **CORS 와 better-auth 가 같은 목록을 본다**
 * (2026-09-20 · REQ-CB-041 · docs/04-mvp/scope.md §2.3 2단계).
 *
 * **"같은 목록" 이 이 단계의 핵심이다.** 두 곳이 갈리면 증상이 사람을 엉뚱한 곳으로 보낸다 —
 * CORS 만 좁으면 **로그인은 되는데 그 다음 요청이 전부 막히고**, better-auth 만 좁으면
 * 프리플라이트는 통과하는데 로그인만 `INVALID_ORIGIN` 이다. 어느 쪽도 원인을 가리키지 않는다.
 *
 * 구성은 `NERV_WEB_URL` + `NERV_TRUSTED_ORIGINS` 의 합집합이고 **코드는 추측하지 않는다** —
 * 와일드카드도, 요청의 `Origin` 을 그대로 비추는 것도 없다: `credentials: true` 와 `*` 는
 * 함께 설 수 없고(브라우저가 거절한다), 비추는 순간 그것은 허용목록이 아니라 개방이다.
 *
 * **`NERV_API_URL` 은 여기 없다.** 자기 자신에게 보내는 요청은 애초에 CORS 가 아니고,
 * better-auth 는 `baseURL` 을 언제나 자기 신뢰 목록에 넣는다(실물 확인 — `getTrustedOrigins`).
 */
export function allowedOriginsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const parsed = originOf(webUrlFromEnv(env));
  // 스킴을 빠뜨린 값(`app.nerv.example.com:8080`)은 URL 로 **파싱은 된다** — 호스트가 스킴이
  // 되고 오리진은 불투명, 즉 문자열 `"null"` 이다. 그대로 목록에 넣으면 `Origin: null` 을
  // 싣는 요청(샌드박스 iframe · 일부 리다이렉트)이 통과한다(`NERV_TRUSTED_ORIGINS` 와 같은 함정).
  const web = parsed === 'null' ? null : parsed;
  if (web === null) {
    // 로거를 세우기 전에 불릴 수 있어 `console` 이다(아래 기동 거부들과 같은 이유).
    console.warn(
      `NERV_WEB_URL("${webUrlFromEnv(env)}")을 오리진으로 읽지 못해 허용 오리진에서 뺍니다 — ` +
        // eslint-disable-next-line no-restricted-syntax -- 운영자용 기동 로그다(REQ-CB-022 예외): 화면에 나가지 않는다
        '스킴부터 적으십시오(예 https://app.example.com).',
    );
  }
  return [...new Set([...(web === null ? [] : [web]), ...trustedOriginsFromEnv(env)])];
}

/** `sub.example.com` 이 `example.com` 아래인가 — 라벨 경계에서만 맞는다(`notexample.com` 은 아니다). */
function isUnder(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** 호스트가 IP 인가 — IP 에는 `Domain` 속성을 붙일 수 없다(브라우저가 쿠키를 버린다). */
function isIpHost(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.startsWith('[');
}

/** 호스트만 꺼낸다 — 파싱 불가면 null. */
function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}
/* eslint-disable no-restricted-syntax -- 운영자용 설정 오류다(REQ-CB-022 예외): 기동 거부 사유와
   고치는 법을 적는 문구이며 화면에 나가지 않는다. 카탈로그 키로는 배포 설정 오류를 말할 수 없다. */

/**
 * 걷힌 이름을 만나면 기동을 거부한다 — REQ-CB-037.
 *
 * **기본값으로 떨어뜨리지 않는 이유.** `NERV_PUBLIC_URL` 만 적어 둔 배치를 조용히 기본값
 * (`http://localhost:8080`)으로 띄우면, 운영자는 자기가 옛 이름을 쓰고 있다는 사실을
 * **그 주소로 서명된 쿠키를 받고서야** 안다. 이 저장소가 `NERV_LOG_LEVEL` 에서 겪은
 * 유령 설정의 반대 방향이다 — 그때는 아무도 읽지 않는 이름이 문서에 있었고, 지금은
 * 아무도 읽지 않게 된 이름이 배치에 남는다. 둘 다 **아무 일도 일어나지 않는 것**이 문제다.
 *
 * 거부는 옛 이름이 있고 **새 둘이 다 비었을 때**다. 하나라도 새 이름이 있으면 운영자는
 * 이미 옮겨 온 것이므로 남은 옛 이름은 읽지 않는 값이라고 한 줄로 알린다.
 */
export function assertPublicUrlRetired(env: NodeJS.ProcessEnv = process.env): void {
  const retired = (env['NERV_PUBLIC_URL'] ?? '').trim();
  if (retired === '') return;

  const api = (env['NERV_API_URL'] ?? '').trim();
  const web = (env['NERV_WEB_URL'] ?? '').trim();
  if (api !== '' || web !== '') {
    // 로거를 세우기 전이라 `console` 이다.
    console.warn(
      `NERV_PUBLIC_URL 은 걷힌 이름입니다 — 읽지 않습니다(현재 값 "${retired}"). ` +
        `쓰이는 것은 NERV_WEB_URL="${web}" · NERV_API_URL="${api}" 입니다. ` +
        '배포 설정에서 옛 이름을 지우십시오(4.2 §5.2).',
    );
    return;
  }

  throw new Error(
    [
      `NERV_PUBLIC_URL("${retired}")은 걷힌 이름입니다 — 기동을 거부합니다.`,
      '이 이름은 화면의 주소와 API 의 주소를 겸하고 있었고, 둘로 갈렸습니다(4.2 §5.2).',
      '지금 값을 두 이름에 그대로 넣으면 동작은 바뀌지 않습니다:',
      `  NERV_WEB_URL=${retired}   # 사람이 브라우저로 여는 주소 — 스펙 딥링크가 이것으로 절대화된다`,
      `  NERV_API_URL=${retired}   # 프로그램이 붙는 주소 — 세션 핸들러·플러그인 카탈로그·/mcp Origin 기준`,
      '그 다음 NERV_PUBLIC_URL 을 지우십시오.',
      `기본값(${DEFAULT_ORIGIN})으로 떨어뜨리지 않는 이유는, 그러면 이 배치가 그 주소로`,
      '서명된 쿠키를 받고서야 설정이 틀렸다는 것을 알게 되기 때문입니다.',
    ].join('\n'),
  );
}

/**
 * 걷힌 이름 둘째 — `NERV_HTTP_PORT` (REQ-CB-039).
 *
 * **한 이름이 두 층을 겸하고 있었다.** 앞문을 호스트에 내보내는 포트와 앞문이 리슨하는
 * 포트가 한 값으로 맞고 있었을 뿐이다 — `NERV_PUBLIC_URL` 과 같은 부류다(REQ-CB-036). 층을
 * 가른 뒤에는 `NERV_WEB_PORT` 하나가 둘을 함께 정한다(컨테이너 안팎이 같은 포트다).
 *
 * **compose 는 모르는 변수를 조용히 무시한다.** 그래서 그냥 걷으면 옛 이름을 둔 배치가
 * 아무 말 없이 기본값으로 뜬다 — 약속한 거부가 유령이 된다. 거부를 실물로 만들려면
 * compose 가 이 이름을 api 에 넘겨야 하고(§5.3 의 `NERV_HTTP_PORT: ${NERV_HTTP_PORT:-}`),
 * 그 넘김이 없으면 이 함수는 아무것도 보지 못한다. 대가는 명시해 둔다: **compose 를 거치지
 * 않는 배치**(맨 `docker run` · 다른 오케스트레이터)에서는 옛 이름이 여전히 조용히 무시된다.
 *
 * 판정 모양은 `assertPublicUrlRetired` 와 같다 — 새 이름이 비어 있을 때만 거부한다.
 */
export function assertHttpPortRetired(env: NodeJS.ProcessEnv = process.env): void {
  const retired = (env['NERV_HTTP_PORT'] ?? '').trim();
  if (retired === '') return;

  const webPort = (env['NERV_WEB_PORT'] ?? '').trim();
  if (webPort !== '') {
    // 로거를 세우기 전이라 `console` 이다.
    console.warn(
      `NERV_HTTP_PORT 은 걷힌 이름입니다 — 읽지 않습니다(현재 값 "${retired}"). ` +
        `쓰이는 것은 NERV_WEB_PORT="${webPort}" 입니다. 배포 설정에서 옛 이름을 지우십시오(4.2 §5.2).`,
    );
    return;
  }

  throw new Error(
    [
      `NERV_HTTP_PORT("${retired}")은 걷힌 이름입니다 — 기동을 거부합니다.`,
      '이 이름은 앞문을 호스트에 내보내는 포트와 앞문이 리슨하는 포트를 겸하고 있었고,',
      '한 이름으로 합쳐졌습니다(4.2 §5.2). 지금 값을 그대로 넣으면 동작은 바뀌지 않습니다:',
      `  NERV_WEB_PORT=${retired}   # 앞문이 리슨하는 포트 — compose 는 같은 포트로 내보낸다`,
      '그 다음 NERV_HTTP_PORT 를 지우십시오.',
      '기본값으로 떨어뜨리지 않는 이유는, 그러면 이 배치가 옛 포트로 열린 줄 알고 있다가',
      '앞문에 닿지 않는 주소를 사람에게 주게 되기 때문입니다.',
    ].join('\n'),
  );
}

/**
 * 걷힌 이름 전부를 한 자리에서 본다 — 엔트리(api·worker)가 기동 전에 부른다.
 * 문구는 이름마다 달라야 해서(무엇을 어디에 넣으라는 말이 다르다) 판정은 각자 한다.
 */
export function assertRetiredNames(env: NodeJS.ProcessEnv = process.env): void {
  assertPublicUrlRetired(env);
  assertHttpPortRetired(env);
}

/**
 * 세션 쿠키의 `Domain` — `NERV_COOKIE_DOMAIN`(§5.2 전표 · REQ-CB-042).
 *
 * **비우는 것이 기본이고, 비면 호스트 전용 쿠키다** — 지금까지의 동작이 그것이다.
 *
 * **서브도메인으로 가른다고 이 값이 필요해지는 것은 아니다.** 세션 쿠키는 API 호스트가
 * 내주고 브라우저는 **그 호스트로 보내는 요청에** 도로 싣는다. `SameSite=Lax` 가 보는 것은
 * 오리진이 아니라 **사이트**라, 두 호스트가 같은 등록 도메인 아래면 그대로 선다 — 4.1 §2.3
 * 의 확정이 "같은 등록 도메인 아래여야 한다" 인 이유가 그것이다. 이 손잡이는 쿠키를 한
 * 호스트보다 **넓게** 두어야 할 때의 것이다(같은 도메인 아래의 다른 화면·프리뷰가 같은
 * 세션을 써야 하는 배치).
 *
 * **넓히는 것은 공짜가 아니다** — 그 도메인 아래의 모든 호스트가 세션 쿠키를 받게 되므로,
 * 신뢰하지 않는 호스트를 그 아래 두지 않는다는 운영 약속이 함께 간다(4.1 §2.3 의 "대가").
 *
 * **틀린 값은 조용하다 — 그래서 기동을 거부한다.** 브라우저는 자기 호스트의 상위가 아닌
 * `Domain` 쿠키를 **버리면서 아무 말도 하지 않는다**: 로그인 응답은 200 인데 다음 요청에
 * 세션이 없고, 사람이 보는 것은 "로그인이 안 된다" 하나다. 뜨기 전에 잡는 편이 싸다.
 *
 * 앞의 점은 값의 일부가 아니다 — `.example.com` 과 `example.com` 은 같은 뜻이고(RFC 6265
 * 는 앞의 점을 무시한다), 전표에 어느 모양으로 적혀 있든 여기서 한 모양으로 읽는다.
 */
export function cookieDomainFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env['NERV_COOKIE_DOMAIN'] ?? '').trim();
  if (raw === '') return null;

  const domain = raw.replace(/^\./, '').toLowerCase();
  const webUrl = webUrlFromEnv(env);
  const apiUrl = apiUrlFromEnv(env);
  const hosts = [
    { name: 'NERV_WEB_URL', host: hostOf(webUrl) },
    { name: 'NERV_API_URL', host: hostOf(apiUrl) },
  ];

  const why = (reason: string): never => {
    throw new Error(
      [
        `NERV_COOKIE_DOMAIN("${raw}")으로는 세션 쿠키를 세울 수 없습니다 — 기동을 거부합니다.`,
        reason,
        `  NERV_WEB_URL=${webUrl}`,
        `  NERV_API_URL=${apiUrl}`,
        '두 주소의 **공통 상위 도메인**을 적거나(예 두 호스트가 app.nerv.example.com ·',
        'api.nerv.example.com 이면 nerv.example.com), 이 값을 비우십시오 — 비우면 쿠키는',
        '호스트 전용이 되고, 두 호스트가 같은 등록 도메인 아래이기만 하면 그대로 동작합니다.',
        '거부하는 이유는, 틀린 값을 그대로 띄우면 브라우저가 쿠키를 조용히 버려서',
        '로그인은 200 인데 세션이 없는 상태를 사람이 "로그인이 안 된다" 로만 만나기 때문입니다.',
      ].join('\n'),
    );
  };

  if (isIpHost(domain)) why('IP 주소에는 Domain 속성을 붙일 수 없습니다.');

  for (const { name, host } of hosts) {
    if (host === null) why(`${name} 을 URL 로 읽지 못했습니다.`);
    else if (!isUnder(host, domain)) {
      why(`"${domain}" 은 ${name} 의 호스트("${host}")의 상위가 아닙니다.`);
    }
  }

  // 라벨이 하나인 값(`com`·`example`)은 두 호스트의 상위일 수는 있어도 **브라우저가 받지
  // 않는다** — 공개 접미사이기 때문이다. 다만 두 호스트가 실제로 그 한 라벨이면(개발 루프의
  // `localhost`) 그것은 호스트 전용 쿠키와 같은 뜻이라 통과시킨다.
  if (!domain.includes('.') && !hosts.every(({ host }) => host === domain)) {
    why(`"${domain}" 은 라벨이 하나입니다 — 브라우저는 공개 접미사에 쿠키를 세우지 않습니다.`);
  }

  return domain;
}

/**
 * 쿠키 도메인을 **Nest 초기화 전에** 본다 — 엔트리(api·worker)가 부른다.
 *
 * 값을 읽는 자리는 better-auth 를 만드는 생성자이므로 거기서도 던지지만, 그때는 이미
 * Nest 의 초기화 중이다 — `NestFactory` 의 기본값이 `abortOnError: true` 라 초기화 중의
 * 예외는 **프로세스를 abort 시킨다**(SIGABRT · 스택 덤프). 운영자가 받아야 하는 것은
 * 무엇을 어떻게 고치라는 문구지 덤프가 아니라서, 뜨기 전에 한 번 더 본다.
 */
export function assertCookieDomain(env: NodeJS.ProcessEnv = process.env): void {
  cookieDomainFromEnv(env);
}

/* eslint-enable no-restricted-syntax */
