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
 * 두 이름의 공통 기본값 — 개발 루프의 한 포트.
 *
 * compose 는 앞문 하나가 화면과 API 를 함께 서빙하므로 두 값이 같다. **같은 값이라
 * 이름을 가른 의미가 없는 것이 아니다** — 소비자가 어느 뜻을 쓰는지가 코드에 적혀야
 * 나중에 호스트를 가를 때 고칠 자리를 찾을 수 있다.
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
