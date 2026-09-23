// 메일 설정 — 정본: docs/04-mvp/codebase.md §5.2 (2026-09-22 · 사람 결정)
//
// **비어 있으면 꺼진다.** 이 저장소의 기존 규약을 그대로 따른다(`NERV_GITHUB_WEBHOOK_SECRET`
// 은 비면 웹훅이 401 이고, `NERV_EXPORT_DIR` 은 비면 미러를 만들지 않는다) — 메일이 꺼진
// 배치에서 가입과 초대는 오늘과 똑같이 굴러간다. 스위치는 `NERV_MAIL_HOST` 다.
//
// **접속 정보를 여섯 키로 나눈다**(2026-09-24 · 사람 결정 — 그전에는 `NERV_SMTP_URL` 한
// 줄이었다). 그때의 반대 이유는 "쪼개면 사람이 그중 하나, 대개 TLS 를 틀린다" 였고 그 걱정
// 자체는 맞다. 그래서 **`NERV_MAIL_SECURE` 는 비우면 포트에서 유도한다**(465 면 암묵 TLS,
// 그 밖은 STARTTLS) — 이 저장소가 `NERV_REQUIRE_EMAIL_VERIFICATION` 에서 이미 쓰는 관용구다.
//
// 뒤집은 이유는 그 결정이 보지 못한 자리에 있다: **URL 한 줄이면 전체가 비밀이 된다.**
// 자격증명이 문자열 안에 섞여 있어 k8s 에서는 통째로 Secret 으로 가야 하고, 그러면 호스트도
// 포트도 TLS 여부도 ConfigMap 에 못 적는다 — 운영자는 이 배치가 **어디로 보내는지** 설정을
// 읽어서는 알 수 없다. 나누면 `nerv-secrets` 로 가는 것은 **인증 두 키**(`NERV_MAIL_USER`·
// `_PASS`)뿐이고 주소 셋과 보내는 사람은 ConfigMap 에서 보인다. 사용자 이름은 비밀이 아닌데도
// 비밀번호와 함께 두는데, **아래 `assertMailConfig` 가 그 둘을 한 벌로 강제하기 때문**이다 —
// 갈라 두면 ConfigMap 과 Secret 이 서로 다른 배관으로 들어와 한쪽만 채워진 상태가 실제로 생긴다.
import { MAIL_IMPLICIT_TLS_PORT, MAIL_SUBMISSION_PORT } from '@nerv/schema';

/** nodemailer 에 그대로 넘기는 모양 — 조립은 이 파일 한 곳이다 */
export interface SmtpTransport {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string } | null;
}

/**
 * 값을 받아 판정한다 — **이름이 아니라 값을 받는 것이 중요하다.**
 *
 * `trimmedOrNull(env['NERV_MAIL_FROM'])` 처럼 이름을 넘기면 호출부에서 `env['NERV_MAIL_FROM']`
 * 리터럴이 사라지고, 그러면 `check-env-table.mjs` 가 **이 변수를 읽는 코드가 없다**고 본다
 * (④ 가 전표의 소비자 열을 실물과 견주는 방식이 그 리터럴을 세는 것이다). 게이트가 못 보는
 * 읽기는 유령 설정과 구별되지 않으므로, 호출부마다 이름을 그대로 적는다.
 */
function trimmedOrNull(raw: string | undefined): string | null {
  const value = (raw ?? '').trim();
  return value === '' ? null : value;
}

/**
 * 메일을 보낼 수 있는 배치인가 — **이 하나가 발신 기능 전체의 스위치다.**
 *
 * 호스트를 스위치로 고른 이유는 그것만이 없어서는 안 되는 값이기 때문이다. 포트·TLS 는
 * 기본값이 서고, 사용자·비밀번호는 인증 없는 사내 릴레이에서 아예 비어 있다.
 */
export function smtpHostFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  return trimmedOrNull(env['NERV_MAIL_HOST']);
}

/**
 * 포트 — 비우면 **587**(submission · STARTTLS)이다.
 *
 * 25 를 기본으로 두지 않는 이유는 그것이 서버 간 릴레이 포트이고 클라우드 사업자 대부분이
 * 막아 두기 때문이다. 숫자가 아니면 기본값으로 **떨어지지 않는다** — `assertMailConfig` 이
 * 기동을 거부한다(조용히 587 로 가면 운영자는 자기 오타를 영영 모른다).
 */
export function smtpPortFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = trimmedOrNull(env['NERV_MAIL_PORT']);
  if (raw === null) return MAIL_SUBMISSION_PORT;
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : Number.NaN;
}

/**
 * 암묵 TLS 인가 — **비우면 포트에서 유도한다**(465 면 참, 그 밖은 거짓).
 *
 * 쪼개기를 미루던 시절의 반대 이유가 정확히 이 값이었다: "사람은 그중 하나, 대개 TLS 를
 * 틀린다." 465 는 접속하자마자 TLS 이고 587·25 는 평문으로 열어 `STARTTLS` 로 올린다 —
 * 둘을 바꿔 적으면 연결이 걸린 채 타임아웃하거나 핸드셰이크가 깨지고, 어느 쪽도 원인을
 * 가리키지 않는다. 그래서 **기본값을 두지 않고 포트를 따르게 한다.** 명시하면 그 값이 이긴다
 * (게이트웨이가 비표준 포트에서 암묵 TLS 를 받는 배치가 있다).
 */
export function smtpSecureFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env['NERV_MAIL_SECURE'] ?? '').trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return smtpPortFromEnv(env) === MAIL_IMPLICIT_TLS_PORT;
}

/**
 * 인증 정보 — **둘 다 있거나 둘 다 없거나**다.
 *
 * 한쪽만 있으면 nodemailer 는 `auth` 를 만들지 못해 **인증 없이 붙는다**. 사내 릴레이라면
 * 그대로 통과해 버려서, 운영자는 비밀번호가 읽히지 않는다는 사실을 영영 모른다 — 그 배치는
 * 뜨지 않는 편이 싸다(`assertMailConfig` 이 거부한다).
 */
export function smtpAuthFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): { user: string; pass: string } | null {
  const user = trimmedOrNull(env['NERV_MAIL_USER']);
  const pass = trimmedOrNull(env['NERV_MAIL_PASS']);
  if (user === null || pass === null) return null;
  return { user, pass };
}

/** 여섯 키를 nodemailer 의 모양으로 — 꺼진 배치면 null 이다 */
export function smtpTransportFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpTransport | null {
  const host = smtpHostFromEnv(env);
  if (host === null) return null;
  return {
    host,
    port: smtpPortFromEnv(env),
    secure: smtpSecureFromEnv(env),
    auth: smtpAuthFromEnv(env),
  };
}

export function mailFromFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  return trimmedOrNull(env['NERV_MAIL_FROM']);
}

export function mailReplyToFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  return trimmedOrNull(env['NERV_MAIL_REPLY_TO']);
}

/** 아웃박스는 쌓되 보내지는 않는다 — 첫 배포에서 무엇이 나갈지 먼저 본다 */
export function mailDryRunFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env['NERV_MAIL_DRY_RUN'] ?? '').trim().toLowerCase() === 'true';
}

export function mailEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return smtpHostFromEnv(env) !== null;
}

/**
 * 가입 이메일 인증을 강제하는가 — **강제는 메일을 보낼 수 있을 때만 성립한다**
 * (2026-09-22 사람 결정: "강제").
 *
 * 그래서 기본값을 메일 설정에서 **유도한다**: 메일이 있는 배치는 강제이고, 없는 배치는 애초에
 * 인증 메일을 보낼 수 없으므로 강제할 수도 없다. 명시적으로 적으면 그 값이 이긴다 —
 * `false` 로 끄는 길이 있어야 "메일은 쓰지만 가입은 막지 않는" 배치가 가능하고, `true` 로
 * 켜 놓고 메일을 비우면 아래 `assertMailConfig` 가 **기동을 거부한다**(아무도 가입하지
 * 못하는 서버가 조용히 서는 것보다 뜨지 않는 편이 싸다).
 */
export function requireEmailVerificationFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env['NERV_REQUIRE_EMAIL_VERIFICATION'] ?? '').trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return mailEnabled(env);
}

/* eslint-disable no-restricted-syntax -- 운영자용 설정 오류다(REQ-CB-022 예외): 기동 거부 사유와
   고치는 법을 적는 문구이며 화면에 나가지 않는다. 카탈로그 키로는 배포 설정 오류를 말할 수 없다. */

/**
 * 걷힌 이름 셋째 — `NERV_SMTP_URL` (2026-09-24 · REQ-CB-050).
 *
 * **기본값으로 떨어뜨리지 않는 이유는 앞의 둘과 같다.** URL 만 적어 둔 배치를 조용히
 * "메일 꺼짐" 으로 띄우면, 운영자는 초대가 나가지 않는다는 사실을 **아무도 초대를 못 받았다는
 * 신고를 받고서야** 안다 — 그것도 아웃박스에 줄이 쌓이지 않으므로 뒤늦게 보낼 수조차 없다.
 *
 * 거부는 옛 이름이 있고 **`NERV_MAIL_HOST` 가 비었을 때**다. 새 이름이 있으면 운영자는 이미
 * 옮겨 온 것이므로 남은 옛 이름은 읽지 않는 값이라고 한 줄로 알린다(`assertPublicUrlRetired`
 * 와 같은 모양이다 — REQ-CB-037).
 */
export function assertSmtpUrlRetired(env: NodeJS.ProcessEnv = process.env): void {
  const retired = (env['NERV_SMTP_URL'] ?? '').trim();
  if (retired === '') return;

  const host = smtpHostFromEnv(env);
  if (host !== null) {
    // 로거를 세우기 전이라 `console` 이다.
    console.warn(
      `NERV_SMTP_URL 은 걷힌 이름입니다 — 읽지 않습니다(현재 값 "${retired}"). ` +
        `쓰이는 것은 NERV_MAIL_HOST="${host}" 입니다. ` +
        '배포 설정에서 옛 이름을 지우십시오(4.2 §5.2).',
    );
    return;
  }

  // 옮겨 적을 값을 문구가 대신 풀어 준다 — 파싱이 실패해도 거부는 그대로다.
  const parsed = ((): { host: string; port: string; secure: string; user: string } | null => {
    try {
      const url = new URL(retired);
      const secure = url.protocol === 'smtps:';
      return {
        host: url.hostname,
        port:
          url.port !== ''
            ? url.port
            : String(secure ? MAIL_IMPLICIT_TLS_PORT : MAIL_SUBMISSION_PORT),
        secure: String(secure),
        user: decodeURIComponent(url.username),
      };
    } catch {
      return null;
    }
  })();

  throw new Error(
    [
      `NERV_SMTP_URL 은 걷힌 이름입니다 — 기동을 거부합니다.`,
      '접속 정보가 URL 한 줄에 섞여 있어 배포에서 통째로 비밀이 되고,',
      '운영자는 이 배치가 어디로 보내는지 설정을 읽어서는 알 수 없었습니다(4.2 §5.2).',
      '여섯 키로 나눴습니다 — 비밀인 것은 NERV_MAIL_PASS 하나입니다:',
      parsed === null
        ? '  NERV_MAIL_HOST= / NERV_MAIL_PORT= / NERV_MAIL_SECURE= / NERV_MAIL_USER= / NERV_MAIL_PASS='
        : [
            `  NERV_MAIL_HOST=${parsed.host}`,
            `  NERV_MAIL_PORT=${parsed.port}`,
            `  NERV_MAIL_SECURE=${parsed.secure}   # 비우면 포트에서 유도한다(465 면 참)`,
            `  NERV_MAIL_USER=${parsed.user}`,
            '  NERV_MAIL_PASS=<위 URL 의 비밀번호>   # k8s 는 nerv-secrets 의 몫이다',
          ].join('\n'),
      '그 다음 NERV_SMTP_URL 을 지우십시오.',
      '"메일 꺼짐" 으로 떨어뜨리지 않는 이유는, 그러면 초대가 나가지 않는다는 것을',
      '아무도 받지 못했다는 신고로 알게 되고 아웃박스에 줄조차 쌓이지 않기 때문입니다.',
    ].join('\n'),
  );
}

/**
 * 기동 시 한 번 — **켜 놓고 비운 자리**를 여기서 잡는다. api·worker 두 엔트리가 함께 부른다.
 *
 * **워커도 부르는 것이 중요하다**(2026-09-24). 실제로 보내는 것은 워커이고 `NERV_MAIL_FROM`
 * 의 소비자도 워커인데, 2026-09-22~24 동안 이 검사는 api 에만 있었다 — api 는 거부하고
 * 워커는 그대로 떠서 **절반만 거부하는 배포**였다(`NERV_COOKIE_DOMAIN` 이 REQ-CB-042 에서
 * 피한 모양이다).
 */
export function assertMailConfig(env: NodeJS.ProcessEnv = process.env): void {
  assertSmtpUrlRetired(env);

  if (!mailEnabled(env)) {
    // 메일이 없는데 인증을 강제하면 **아무도 가입하지 못한다** — 인증 메일을 보낼 길이
    // 없기 때문이다. 유도값이 아니라 사람이 손으로 `true` 를 적은 경우에만 여기 온다.
    if (requireEmailVerificationFromEnv(env)) {
      throw new Error(
        'NERV_REQUIRE_EMAIL_VERIFICATION 이 켜져 있는데 NERV_MAIL_HOST 가 비어 있습니다 — ' +
          '인증 메일을 보낼 길이 없어 아무도 가입하지 못합니다. ' +
          '메일 호스트를 설정하거나 이 값을 false 로 두세요 (codebase.md §5.2)',
      );
    }
    return;
  }

  if (mailFromFromEnv(env) === null) {
    throw new Error(
      'NERV_MAIL_HOST 가 설정됐는데 NERV_MAIL_FROM 이 비어 있습니다 — ' +
        '보내는 사람이 없는 메일은 거절되거나 스팸함으로 갑니다. ' +
        '예: NERV_MAIL_FROM="NERV <no-reply@example.com>" (codebase.md §5.2)',
    );
  }

  if (Number.isNaN(smtpPortFromEnv(env))) {
    throw new Error(
      `NERV_MAIL_PORT("${(env['NERV_MAIL_PORT'] ?? '').trim()}")를 포트로 읽을 수 없습니다 — ` +
        '1~65535 의 정수를 적거나 비워 두세요(비우면 587 입니다). ' +
        '기본값으로 떨어뜨리지 않는 이유는 그러면 오타가 영영 드러나지 않기 때문입니다.',
    );
  }

  const user = trimmedOrNull(env['NERV_MAIL_USER']);
  const pass = trimmedOrNull(env['NERV_MAIL_PASS']);
  if ((user === null) !== (pass === null)) {
    throw new Error(
      `${user === null ? 'NERV_MAIL_PASS 만' : 'NERV_MAIL_USER 만'} 설정됐습니다 — ` +
        '인증은 둘 다 있거나 둘 다 없어야 합니다. 한쪽만 있으면 인증 없이 붙고, ' +
        '릴레이가 그대로 받아 주면 비밀번호가 읽히지 않는다는 사실이 드러나지 않습니다 ' +
        '(codebase.md §5.2)',
    );
  }
}
/* eslint-enable no-restricted-syntax */
