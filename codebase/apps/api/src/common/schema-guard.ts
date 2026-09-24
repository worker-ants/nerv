// DB 스키마가 이 코드를 따라왔는가 — 뒤처졌으면 뜨지 않는다 (REQ-CB-056 · codebase.md §5.1)
//
// 2026-09-24 실측: 개발 DB 에 마이그레이션 27건만 적용된 채(코드는 31건) api 가 떠 있었다.
// `pnpm dev` 는 마이그레이션을 돌리지 않고, 뜬 api 는 없는 칸을 읽는 질의마다 500 을 줬다 —
// 홈의 받은 초대(`invitation.last_sent_at` · 0027), 받은 요청의 처리됨 탭
// (`approval.decided_by_user_id` · 0029), 세션의 플러그인 표시(`plugin_version` · 0030).
// 증상은 화면마다 흩어진 500 이고 어느 것도 원인을 가리키지 않는다. 기동할 때 한 번 보면
// 원인이 이름으로 한 줄에 선다.
//
// **앞선 것은 막지 않는다.** 롤링 배포 중에는 옛 파드가 새 스키마 위에서 잠시 돈다
// (expand-contract · codebase.md §6.3). 개발 DB 를 함께 쓰는 다른 워크트리가 먼저 올려 둔
// 경우도 같다. 막는 것은 **이 코드가 기대하는 파일이 DB 에 없는** 경우 하나다.

import { Logger } from '@nestjs/common';
import { schemaStatus } from '@nerv/schema/migrate';
import type { SchemaStatus } from '@nerv/schema/migrate';

/* eslint-disable no-restricted-syntax -- 운영자용 기동 거부 사유다(REQ-CB-022 예외): 화면에 뜨지 않는다 */

/** 뒤처졌으면 운영자가 읽을 한 줄, 아니면 null */
export function schemaBehindMessage(status: SchemaStatus): string | null {
  if (status.pending.length === 0) return null;
  return (
    `DB 스키마가 이 코드보다 뒤처졌습니다 — 적용 ${status.applied}건 · 코드 ${status.expected}건, ` +
    `남은 것: ${status.pending.join(', ')}. ` +
    '마이그레이션을 먼저 적용하세요: pnpm db:migrate ' +
    '(compose 는 migrate 서비스 · k8s 는 nerv-migrate Job — codebase.md §5.1·§6.3)'
  );
}

/**
 * 기동 전에 부른다. 뒤처졌으면 던진다 — 엔트리가 비영 종료한다(다른 기동 검사와 같은 모양).
 *
 * **DB 에 닿지 못하는 것은 이 검사의 일이 아니다.** 지금까지처럼 뜨고, 질의가 실패를
 * 말한다 — 여기서 막으면 DB 가 잠깐 늦게 뜨는 개발 루프가 전부 멈춘다.
 */
export async function assertSchemaCurrent(
  env: NodeJS.ProcessEnv = process.env,
  read: (databaseUrl: string) => Promise<SchemaStatus> = schemaStatus,
): Promise<void> {
  const url = env['DATABASE_URL'];
  // 비어 있으면 DatabaseModule 이 따로 멈춘다 — 같은 말을 두 번 하지 않는다
  if (url === undefined || url === '') return;
  let status: SchemaStatus;
  try {
    status = await read(url);
  } catch (error) {
    Logger.warn(`스키마 확인을 건너뜁니다 — DB 에 닿지 못했습니다: ${String(error)}`, 'Schema');
    return;
  }
  const message = schemaBehindMessage(status);
  if (message !== null) throw new Error(message);
}
