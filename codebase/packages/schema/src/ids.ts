// ID 발급 — 정본: docs/03-proposal/data-model.md §5.1
//
// 서버 발급 **UUIDv7**이고 클라이언트 발급은 금지다. v7 을 쓰는 이유는 시간 정렬성이다 —
// event·activity 처럼 시간축으로 자라는 테이블에서 PK 가 삽입 순서와 같은 방향으로 커지면
// 인덱스 페이지 분할이 줄고 시간 범위 스캔이 자연스러워진다.
//
// DB DEFAULT 를 두지 않는 것과 짝이다(database.md §1.3) — 발급 주체는 앱 계층 하나뿐이어야 한다.

import { v7 as uuidv7 } from 'uuid';

/** 새 엔티티 ID. */
export function newId(): string {
  return uuidv7();
}

/** 표시 키 발급 규칙(`<project.key>-<타입>-<base32 6자>`)은 data-model §5.1 — E09 소관이다. */
