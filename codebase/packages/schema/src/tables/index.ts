// drizzle 테이블 선언 29종의 배럴 — E02-S01 이 채운다.
//
// 분할은 모듈 소유와 같다(docs/04-mvp/codebase.md §2.3 · §3.1):
//   tenancy.ts · spec.ts · task.ts · session.ts · review.ts · approval.ts · event.ts
// DDL 정본은 docs/04-mvp/database.md §2, 필드 의미 정본은 docs/03-proposal/data-model.md.
//
// drizzle.config.ts 의 `schema` 가 이 파일을 가리킨다 — 선언이 추가되면 여기서 재수출한다.

export {};
