// 알림 메일 요약을 로그인 없이 끄는 링크 (2026-09-28 · 사람 결정 EM8 · api.md REQ-API-234)
//
// **토큰은 원문을 두지 않는다** — 초대 토큰과 같다(`invitation.service.ts`). 메일에만 원문이 있고 DB 에는 해시만
// 남는다. 서명 키로 만드는 방법은 표가 필요 없지만 그 키를 잃으면 모든 링크가 죽는다(AGENTS.md 규약 8 의
// 사고가 바로 그 키였다). 토큰은 메일 한 통마다 새로 만들고 그 메일 행에 붙는다 — 행이 지워지면(보낸 지 7일)
// 링크도 죽는다.
//
// 주소는 둘이다. **메일 앱의 [구독 취소] 단추**는 머리글의 API 주소로 쿠키 없이 POST 한다(RFC 8058). **사람이
// 누르는 본문의 링크**는 화면 주소다 — 링크를 미리 열어 보는 메일 보안 검사기가 GET 만으로 끄지 않게, 화면이
// 한 번 더 묻고 POST 한다.
import { createHash, randomBytes } from 'node:crypto';
import { apiUrlFromEnv, webUrlFromEnv } from '../../common/origins.js';

export function newUnsubscribeToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashUnsubscribeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 메일 앱이 POST 하는 곳 — `List-Unsubscribe` 머리글 */
export function unsubscribeApiUrl(token: string): string {
  return `${apiUrlFromEnv().replace(/\/+$/, '')}/api/v1/mail/unsubscribe/${token}`;
}

/** 사람이 여는 곳 — 본문의 링크. 화면이 한 번 묻고 위 주소로 POST 한다 */
export function unsubscribeWebUrl(token: string): string {
  return `${webUrlFromEnv().replace(/\/+$/, '')}/unsubscribe/${token}`;
}
