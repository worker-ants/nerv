// drizzle 테이블 선언 33종의 배럴 — 분할은 모듈 소유와 같다(codebase.md §2.3 · §3.1).
//
// DDL 정본은 docs/04-mvp/database.md §2, 필드 의미 정본은 docs/03-proposal/data-model.md 다.
// drizzle.config.ts 의 `schema` 가 이 파일을 가리킨다.
//
// 합계 검산 — AuthModule 5 + invitation 1 + SpecModule 9 + attachment 1 + TaskModule 4
//            + SessionModule 2 + ApprovalModule 2 + ReviewModule 5 + EventModule 2 + question 1
//            + idempotency_key 1
//            = **33종**(2026-09-02 — 멱등 저장소 신설. 32 는 그 이전의 수다)
// spec_chunk_embedding(§2.15)은 도메인 엔티티가 아니라 재생성 가능한 파생 데이터라
// 이 카운트에 들지 않는다 — E02 후속에서 별도로 선언한다.

export * from './auth.js';
export * from './tenancy.js'; // organization · user · project · membership · api_token
export * from './invitation.js'; // invitation (조직 초대 — 2026-08-27)
export * from './session.js'; // agent_session · activity
export * from './spec.js'; // spec · spec_version · requirement · requirement_version
//                            · spec_relation · spec_comment · spec_baseline
//                            · spec_baseline_item · change_request
export * from './task.js'; // task · task_dependency · claim · evidence
export * from './review.js'; // review_session · reviewer_report · finding
//                              · finding_occurrence · resolution
export * from './approval.js'; // approval · question
export * from './event.js'; // event · notification
export * from './idempotency.js'; // idempotency_key (표면 공용 멱등 저장소 — api.md §1.5)

// 도메인 엔티티가 아니다 — 재생성 가능한 검색 인덱스의 물리 테이블(database.md §2.15).
// 33종 카운트에 들지 않지만 마이그레이션에는 포함돼야 하므로 배럴에서 재수출한다.
export * from './search.js'; // spec_chunk_embedding
