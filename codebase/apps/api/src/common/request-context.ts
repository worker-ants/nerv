// 요청 맥락 — 요청 ID 와, 로그 한 줄이 어느 요청의 것인지 (정본: docs/04-mvp/codebase.md §5.5 · REQ-CB-052)
//
// **로그 줄끼리 이을 수단이 없었다**(2026-09-24). 서비스가 남기는 경고는 문장뿐이라
// "감사 이벤트를 남기지 못했다" 가 어느 요청·어느 사람의 것인지 알 수 없었다. 요청 ID 를
// 인자로 끌고 다니면 도메인 서비스가 표면을 알게 된다(D-05) — 그래서 AsyncLocalStorage 가
// 요청을 들고, 로거(`nerv-logger.ts`)가 거기서 읽는다. 서비스 코드는 한 줄도 바뀌지 않는다.

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/** 요청 ID 를 싣는 헤더 — 앞문이 넘기고(§5.4) api 가 응답에 되돌린다 */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * 받아 주는 요청 ID 의 모양. nginx `$request_id` 는 hex 32자, ingress-nginx 도 같다.
 * 문자 집합을 좁히는 이유는 **이 값이 로그 줄에 그대로 실리기 때문이다** — 개행이나
 * 공백을 받으면 부르는 쪽이 가짜 로그 줄을 끼워 넣을 수 있다.
 */
const INBOUND_ID = /^[A-Za-z0-9._:-]{8,128}$/;

type HeaderValue = string | string[] | undefined;

/** 모양이 맞는 헤더 값 — 아니면 null. 로그에 싣기 전에 거르는 자리다 */
export function acceptedId(header: HeaderValue): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  return value !== undefined && INBOUND_ID.test(value) ? value : null;
}

/**
 * 요청 ID — `X-Request-Id` 가 쓸 만하면 그 값, 아니면 `CF-Ray`, 둘 다 아니면 새로 만든다.
 *
 * **CF-Ray 를 두 번째로 받는 이유**(2026-09-24 사람 결정): 운영은 Cloudflare Tunnel 뒤다.
 * Cloudflare 의 오류 화면과 대시보드는 Ray ID 를 보여 주므로, 사용자가 그 값만 알려 줘도 우리
 * 로그의 그 요청 줄을 찾는다. 모양 검사(`INBOUND_ID`)는 같다 — `8c1b2e3f4a5b6c7d-ICN` 이 통과한다.
 */
export function requestIdFrom(header: HeaderValue, cfRay?: HeaderValue): string {
  return acceptedId(header) ?? acceptedId(cfRay) ?? randomUUID();
}

/** 로거가 읽는 요청 맥락. 주체는 가드가 나중에 채우므로 요청 객체를 그대로 든다 */
export interface RequestContext {
  readonly requestId: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/** 지금 실행이 요청 안이면 그 ID — 워커·기동 로그는 null 이다 */
export function currentRequestId(): string | null {
  return requestContext.getStore()?.requestId ?? null;
}
