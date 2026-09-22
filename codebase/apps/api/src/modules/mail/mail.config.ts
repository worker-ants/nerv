// 메일 설정 — 정본: docs/04-mvp/codebase.md §5.2 (2026-09-22 · 사람 결정)
//
// **비어 있으면 꺼진다.** 이 저장소의 기존 규약을 그대로 따른다(`NERV_GITHUB_WEBHOOK_SECRET`
// 은 비면 웹훅이 401 이고, `NERV_EXPORT_DIR` 은 비면 미러를 만들지 않는다) — 메일이 꺼진
// 배치에서 가입과 초대는 오늘과 똑같이 굴러간다.
//
// **접속 정보를 URL 한 줄로 받는 것은 의도다.** 호스트·포트·사용자·비밀번호·TLS 를 다섯 키로
// 쪼개면 전표가 다섯 줄 늘고, 사람은 그중 하나(대개 TLS)를 틀린다. 세밀한 조정이 필요해지는
// 날 쪼개면 된다 — 그날이 오기 전에 쪼개지 않는다.

/** 메일을 보낼 수 있는 배치인가 — 이 하나가 발신 기능 전체의 스위치다 */
export function smtpUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env['NERV_SMTP_URL'] ?? '').trim();
  return raw === '' ? null : raw;
}

export function mailFromFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env['NERV_MAIL_FROM'] ?? '').trim();
  return raw === '' ? null : raw;
}

export function mailReplyToFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env['NERV_MAIL_REPLY_TO'] ?? '').trim();
  return raw === '' ? null : raw;
}

/** 아웃박스는 쌓되 보내지는 않는다 — 첫 배포에서 무엇이 나갈지 먼저 본다 */
export function mailDryRunFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env['NERV_MAIL_DRY_RUN'] ?? '').trim().toLowerCase() === 'true';
}

export function mailEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return smtpUrlFromEnv(env) !== null;
}

/**
 * 기동 시 한 번 — **켜 놓고 비운 자리**를 여기서 잡는다.
 *
 * SMTP 를 설정했는데 보내는 사람이 없으면 메일 서버가 거절하거나(RFC 상 `From` 은 필수다)
 * 받는 쪽 스팸함으로 간다. 둘 다 **보냈다고 믿는데 닿지 않는** 모양이라, 그 배치는 뜨지
 * 않는 편이 싸다 — `NERV_COOKIE_DOMAIN` 에서 이미 고른 규약이다(REQ-CB-042).
 */
export function assertMailConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (!mailEnabled(env)) return;
  if (mailFromFromEnv(env) === null) {
    /* eslint-disable no-restricted-syntax -- 운영자용 설정 오류다(REQ-CB-022 예외): 기동 거부
       사유는 화면이 아니라 컨테이너 로그에 나가고, 읽는 사람은 배포한 사람이다. */
    throw new Error(
      'NERV_SMTP_URL 이 설정됐는데 NERV_MAIL_FROM 이 비어 있습니다 — ' +
        '보내는 사람이 없는 메일은 거절되거나 스팸함으로 갑니다. ' +
        '예: NERV_MAIL_FROM="NERV <no-reply@example.com>" (codebase.md §5.2)',
    );
    /* eslint-enable no-restricted-syntax */
  }
}
