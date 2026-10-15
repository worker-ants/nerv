// 운영자 비밀번호 재설정 링크 — `node dist/reset-link.js <이메일>` (2026-10-15 · 사람 결정 · docs/04-mvp/codebase.md §5.2 ·
// REQ-CB-061)
//
// 메일을 보내지 않는 배치에서 비밀번호를 잊은 사람을 위한 운영자 명령이다. api 이미지 안에 들어 있어(`migrate.js` 와
// 같은 자리) compose 는 `docker compose exec api node dist/reset-link.js <이메일>`, k8s 는
// `kubectl -n nerv exec deploy/nerv-api -- node dist/reset-link.js <이메일>` 로 부른다. 출력의 마지막 줄이 링크다(60분 · 한 번).
// 그 링크를 받은 사람이 화면에서 비밀번호를 직접 정한다. 계정이 없으면 0 이 아닌 코드로 끝난다.
//
// production 에서 실행을 거부하지 않는다 — 개발 시드(`seed.ts`)와 달리 운영에서 쓰라고 있는 명령이다.

import { Logger } from '@nestjs/common';
import pg from 'pg';
import { issueResetLink } from './modules/auth/operator-reset.js';

/**
 * 명령 한 번 — 종료 코드를 돌려준다(0 발급 · 1 계정 없음 또는 설정 오류 · 2 사용법). 링크는 `write` 로 내보낸다.
 * L2 가 이 함수를 그대로 부른다 — 빌드 산출물을 띄우지 않고도 종료 코드와 출력을 본다.
 */
export async function runResetLink(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  write: (line: string) => void = (line) => void process.stdout.write(line),
): Promise<number> {
  const url = env['DATABASE_URL'];
  if (url === undefined || url === '') {
    // eslint-disable-next-line no-restricted-syntax -- 설정 오류(REQ-CB-022)
    Logger.error('DATABASE_URL 이 없습니다.', 'ResetLink');
    return 1;
  }
  const email = args[0]?.trim() ?? '';
  if (email === '') {
    // eslint-disable-next-line no-restricted-syntax -- 운영자용 사용법(REQ-CB-022)
    Logger.error('사용법: node dist/reset-link.js <이메일>', 'ResetLink');
    return 2;
  }
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const issued = await issueResetLink(pool, email);
    if (issued === null) {
      // 운영자용 오류다(REQ-CB-022) — 사람의 화면에는 나가지 않는다
      Logger.error(`그 이메일의 계정이 없습니다: ${email}`, 'ResetLink');
      return 1;
    }
    // 누가 아니라 **어떤 사용자에게 언제** 발급했는지 — 이벤트 표는 프로젝트에 매여 있어(event.project_id NOT NULL)
    // 프로젝트가 없는 계정 일은 로그 한 줄로 남긴다. 주소는 적지 않는다
    Logger.log(
      `비밀번호 재설정 링크를 발급했습니다 — 사용자 ${issued.userId} · ${issued.expiresAt.toISOString()}까지 한 번`,
      'ResetLink',
    );
    // 링크는 출력의 마지막 줄이다 — 앞의 로그 줄과 섞이지 않게 따로 한 줄로
    write(`${issued.url}\n`);
    return 0;
  } finally {
    await pool.end();
  }
}

// 엔트리로 직접 실행될 때만 돈다(테스트는 `runResetLink` 만 쓴다 — main.ts 와 같은 방식)
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runResetLink(process.argv.slice(2));
}
