// 테넌시 표면의 요청 스키마 — 정본: api.md §2.1 (EP-ORG · EP-PRJ · EP-MBR · EP-TOK)
//
// **§1.7 이 "요청 열은 zod 스키마 이름이고 `packages/schema` export 와 1:1" 이라 못 박는데,
// 오랫동안 그 이름들이 실재하지 않았다.** 컨트롤러는 `Record<string, unknown>` 을 손으로
// 파싱했고, 이번 감사가 찾은 결함 넷(`relations`·하트비트 본문·`state_note`·검색 필터)이
// 전부 그 손 파싱에서 나왔다 — 받는다고 적어 두고 안 읽는 코드를 쓰기가 너무 쉬웠다.
//
// `.strict()` 가 요점이다. 알 수 없는 키를 조용히 버리면 보낸 쪽은 반영됐다고 믿는다 —
// REQ-API-074·082·090 이 세 번 이름 붙인 실패 모양이고, 그것을 **모양 검사 한 곳**에서 막는다.
//
// 어휘(enum)는 여기서 다시 적지 않는다. 도메인 서비스가 `@nerv/schema` 의 enum 으로
// 판정하고(REQ-API-112), 여기서 보는 것은 **모양**이다 — 둘은 다른 물음이라 자리를 나눈다.

import { z } from 'zod';

/** EP-ORG-03 */
export const OrgCreateInput = z
  .object({
    slug: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();

/** EP-ORG-04 — **slug 는 바꾸지 않는다**(링크의 축 · D-09) */
export const OrgUpdateInput = z.object({ name: z.string().min(1) }).strict();

/** EP-PRJ-02 */
export const ProjectCreateInput = z
  .object({
    slug: z.string().min(1),
    key: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullish(),
  })
  .strict();

/** EP-PRJ-04 — 전부 선택이다. 주지 않은 값은 건드리지 않는다 */
export const ProjectUpdateInput = z
  .object({
    name: z.string().min(1).nullish(),
    description: z.string().nullish(),
    repo_url: z.string().nullish(),
    default_branch: z.string().nullish(),
    /** 키 스키마는 `policy.ts` 가 정본이다 — 여기서는 객체라는 것만 본다 */
    gate_policy: z.record(z.string(), z.unknown()).nullish(),
    retention: z.record(z.string(), z.unknown()).nullish(),
  })
  .strict();

/** EP-MBR-02 — `role` 의 어휘 판정은 도메인이 한다(`member_role`) */
export const MemberAddInput = z
  .object({
    email: z.string().min(1),
    role: z.string().default('viewer'),
    /** 프로젝트 소속 배정이면 슬러그, 조직 전역이면 없다 */
    project: z.string().nullish(),
  })
  .strict();

/** EP-MBR-03 */
export const MemberUpdateInput = z.object({ role: z.string().min(1) }).strict();

/**
 * EP-TOK-01 — 발급.
 *
 * `scopes` 의 어휘는 도메인이 본다(`isAgentScope` — 사람 전용 권한은 토큰에 담기지
 * 않는다). 여기서 보는 것은 "문자열 배열인가" 뿐이다.
 */
export const TokenCreateInput = z
  .object({
    project: z.string().min(1),
    name: z.string().default('agent'),
    scopes: z.array(z.string()).default([]),
    expires_at: z.string().nullish(),
  })
  .strict();
