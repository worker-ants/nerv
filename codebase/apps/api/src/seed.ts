// 개발 시드 엔트리 — `pnpm db:seed` (codebase.md §5.1)
//
// 도메인 데이터의 본체는 @nerv/schema 의 runSeed 다. 이 엔트리가 **하나 더** 하는 일은
// 로그인 자격증명 심기다: 시드는 `user` 행을 만들지만 `auth_account`(비밀번호 해시)는
// 만들지 않아, 시드만 돌리면 화면까지 가고도 들어갈 수가 없었다(실측).
//
// 자격증명이 여기 있는 이유는 경계다 — 해시 방식은 인증 스택(better-auth)의 것이고
// `@nerv/schema` 는 순수 선언 패키지라 better-auth 를 몰라야 한다(REQ-CB-001의 정신).
// 그래서 스키마는 도메인을, api 는 인증을 심는다.

import { Logger } from '@nestjs/common';
import { newId } from '@nerv/schema';
import { runSeed } from '@nerv/schema/migrate';
import { hashPassword } from 'better-auth/crypto';
import pg from 'pg';

/**
 * 개발 계정의 공통 비밀번호. **개발 전용이다** — 이 엔트리는 production 에서 돌지 않고,
 * 값은 문서(codebase.md §5.1)에 그대로 적혀 있다. 감추는 시늉을 하면 아무도 못 들어가면서
 * 보안은 하나도 늘지 않는다.
 */
const DEV_PASSWORD = process.env['NERV_SEED_PASSWORD'] ?? 'nerv-dev-1234';

async function seedCredentials(url: string): Promise<number> {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const { rows: users } = await pool.query<{ id: string; email: string }>(
      `SELECT id, email FROM "user" WHERE email LIKE '%@example.com'`,
    );
    const hash = await hashPassword(DEV_PASSWORD);
    let created = 0;

    for (const user of users) {
      // 이미 자격증명이 있으면 덮지 않는다 — 사람이 바꾼 비밀번호를 시드가 되돌리면
      // "재실행해도 같은 상태"가 아니라 "재실행하면 남의 설정이 사라진다"가 된다.
      // 세 필드가 다 맞아야 로그인이 된다(better-auth 1.7 sign-in): provider_id ·
      // **issuer** · account_id = user.id. issuer 를 빼먹으면 "User not found" 로 조용히
      // 실패한다 — 행은 있는데 못 찾는 상태라 원인을 찾기 어렵다(실측).
      const { rowCount } = await pool.query(
        `INSERT INTO auth_account (id, user_id, account_id, provider_id, issuer, password)
         SELECT $1, $2, $3, 'credential', 'local:credential', $4
          WHERE NOT EXISTS (
            SELECT 1 FROM auth_account WHERE user_id = $2 AND provider_id = 'credential'
          )`,
        [newId(), user.id, user.id, hash],
      );
      created += rowCount ?? 0;
    }
    return created;
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    Logger.error('DATABASE_URL 이 없습니다.', 'Seed');
    process.exitCode = 1;
    return;
  }
  if (process.env['NODE_ENV'] === 'production') {
    Logger.error('개발 시드는 production 에서 실행하지 않습니다.', 'Seed');
    process.exitCode = 1;
    return;
  }

  const result = await runSeed(url, process.argv.includes('--force'));
  const credentials = await seedCredentials(url);

  Logger.log(
    `시드 적재 완료 — 프로젝트 ${result.projects} · 스펙 ${result.specs} · Task ${result.tasks} ` +
      `· 클레임 ${result.claims} · 세션 ${result.sessions} · 이벤트 ${result.events}`,
    'Seed',
  );
  Logger.log(
    `로그인 계정 ${credentials}건 생성 — 비밀번호 "${DEV_PASSWORD}" ` +
      '(관리: admin@example.com = admin · 온보딩: jimin@example.com = planner 외 4)',
    'Seed',
  );
}

await main();
