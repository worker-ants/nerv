// 세션 표면의 요청 스키마 — 정본: api.md §2.4 (EP-SES)
//
// 규율은 `tenancy.ts` 와 같다. 어휘(`steer`/`stop`)의 판정은 도메인이 하고, 여기서
// 보는 것은 모양이다 — 예전에는 컨트롤러가 `kind !== 'stop' ? 'steer'` 로 **조용히
// 바꾸고** 있었다(내려놓기 사유에서 겪은 것과 같은 모양이다).

import { z } from 'zod';

/**
 * EP-SES-04 — steer · stop.
 *
 * **사람 전용이다**(판정은 `SessionService.steer` 안에 있다 — REQ-API-111).
 * `stop` 은 전달을 기다리지 않고 즉시 클레임을 회수한다.
 */
export const SessionSteerInput = z
  .object({
    kind: z.enum(['steer', 'stop']).default('steer'),
    message: z.string().default(''),
  })
  .strict();
