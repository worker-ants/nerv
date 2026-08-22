// `nerv import spec|plan|docs|rebuild-map` 엔트리 — E07-S05 가 채운다.
//
// 이 워크스페이스는 컨테이너가 아니라 **설치되는 클라이언트**다(docs/04-mvp/codebase.md §1.3).
// DB 드라이버(pg·drizzle 런타임)와 apps/api 코드를 의존하지 않는다 — @nerv/schema 의 타입·zod 만
// 참조하고 서버에는 EP-IMP-01~05 HTTP 로만 붙는다(REQ-CB-016, lint 로 강제).

export function run(): void {
  throw new Error('E07-S05 에서 구현한다 — nerv import 엔트리');
}
