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
 * 목록의 **구성은 바꾸지 않는다** — `NERV_WEB_URL` 을 자동으로 더하지 않는다. 그것은 쿠키
 * 도메인·CORS 와 한 묶음의 결정이라 2단계의 몫이다(docs/04-mvp/scope.md §2.3).
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

/* eslint-enable no-restricted-syntax */
