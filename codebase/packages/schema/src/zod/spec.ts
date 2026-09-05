// 스펙·코멘트·요구사항 표면의 요청 스키마 — 정본: api.md §2.2 (EP-SPEC · EP-CMT · EP-REQ)
//
// 규율은 `tenancy.ts` 와 같다: `.strict()` 로 알 수 없는 키를 거절하고, **어휘(enum)는
// 여기서 보지 않는다**(도메인이 `@nerv/schema` 의 enum 으로 판정한다 — REQ-API-112).
//
// 이 파일이 특히 필요한 이유가 하나 더 있다. 2026-09-05 감사가 찾은 결함 넷 중 **둘이
// 여기서 났다** — `PUT …/draft` 가 `relations` 를 읽지 않았고, 검색이 `type`·`status` 를
// 받지 않았다. 둘 다 "전표에는 있는데 컨트롤러가 그 키를 안 읽는" 모양이었고, 스키마가
// 있었으면 쓰기 어려운 코드다.

import { z } from 'zod';

/**
 * 선언 관계 한 줄 — `refines`·`depends_on`·`duplicates`·`supersedes`.
 *
 * `base_hash` 가 필수인 이유는 §1.4h 다: 본문을 안 고치고 관계만 바꾸는 저장이 허용되는
 * 만큼, 그 경로가 검사 없는 뒷문이 되면 안 된다.
 */
export const SpecRelationInput = z
  .object({
    to: z.string().min(1),
    kind: z.string().min(1),
    base_hash: z.string().nullish(),
  })
  .strict();

/** EP-SPEC-07 — 새 스펙. `body_md` 는 옛 이름이고 둘 다 받는다 */
export const SpecCreateInput = z
  .object({
    key: z.string().min(1),
    title: z.string().min(1),
    type: z.string().default('feature'),
    body_markdown: z.string().nullish(),
    body_md: z.string().nullish(),
    parent_id: z.string().nullish(),
  })
  .strict();

/**
 * EP-SPEC-08 — 초안 이어쓰기.
 *
 * `base_hash` 는 **무엇을 보고 썼는가**다(§1.4g 비교-교환). `base_version` 은
 * 2026-08-30 에 표면에서 걷었다 — 계보는 서버가 채운다.
 */
export const SpecDraftUpsertInput = z
  .object({
    body_markdown: z.string().nullish(),
    body_md: z.string().nullish(),
    base_hash: z.string().nullish(),
    change_summary: z.string().nullish(),
    /** 남의 리스를 뺏는다(§1.4h) — 뺏어도 본문은 `base_hash` 가 지킨다 */
    takeover: z.boolean().nullish(),
    /** 주지 않으면 건드리지 않고, 빈 배열은 "전부 지워라" 다 */
    relations: z.array(SpecRelationInput).nullish(),
  })
  .strict();

/**
 * EP-SPEC-15 — 메타 수정. **`parent_key: null` 은 "부모에서 떼라"** 이고
 * 키가 아예 없는 것과 다르다 — 그래서 `nullable().optional()` 을 쓴다.
 */
export const SpecMetaUpdateInput = z
  .object({
    title: z.string().nullish(),
    parent_key: z.string().nullable().optional(),
    sort_key: z.string().nullish(),
    owner_role: z.string().nullish(),
  })
  .strict();

/** EP-SPEC-12 — 기준선 생성. `items` 를 주지 않으면 현재 승인본으로 채운다 */
export const BaselineCreateInput = z
  .object({
    name: z.string().min(1),
    note_md: z.string().nullish(),
    items: z.array(z.string()).nullish(),
  })
  .strict();

/** EP-REQ-03 — 증적. `kind` 의 어휘는 도메인이 본다(`evidence_kind` 6종) */
export const EvidenceCreateInput = z
  .object({
    kind: z.string().default('pr'),
    locator: z.string().min(1),
    repo: z.string().nullish(),
  })
  .strict();

/** EP-CMT-02 — 코멘트. 앵커는 헤딩 slug 또는 요구사항 ref 다(D-09) */
export const CommentCreateInput = z
  .object({
    anchor: z.string().min(1),
    body_md: z.string().min(1),
  })
  .strict();

/** EP-CMT-03 */
export const CommentUpdateInput = z.object({ body_md: z.string().min(1) }).strict();

/** EP-CMT-04 — 해소. 무엇을 고쳐서 해소했는지 버전으로 남길 수 있다 */
export const CommentResolveInput = z
  .object({
    resolution_note: z.string().nullish(),
    resolved_in_version_id: z.string().nullish(),
  })
  .strict();
