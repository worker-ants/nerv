// @nerv/schema — 타입·상수의 단일 정본 (docs/04-mvp/codebase.md §3)
//
// apps/* 는 도메인 상수·이벤트 이름·에러 코드·검증 스키마를 여기서만 import 한다(REQ-CB-006).
// 이 패키지는 순수 선언 + 마이그레이터만 갖는다 — 런타임 로직을 두지 않는다(§1.2).

export * from './constants.js';
export * from './ids.js';
export * from './scopes.js';
export * from './errors.js';
export * from './events.js';
export * from './tables/index.js';
export * from './zod/index.js';

// i18n — 카탈로그는 순수 선언이고, 번역기는 자리표시자 치환뿐인 순수 함수다(§1.2 예외).
// 웹·API·CLI 가 같은 문구를 쓰게 하려면 정본이 여기 있어야 한다.
export * from './i18n/index.js';

// 마이그레이터·시드는 **여기서 내보내지 않는다** — `@nerv/schema/migrate` 서브패스다.
// 이 배럴은 브라우저(apps/web)도 import 하는데, 그 둘은 `pg` 드라이버를 끌고 온다.
// 재수출하면 브라우저가 Postgres 드라이버를 평가하다 죽는다(§3.1 — 실측 2026-08-23).
