// NERV 경계 규칙 — 정본: docs/04-mvp/codebase.md §4.2
//
// lint 로 강제하는 것은 세 가지다.
//   ① REQ-CB-001  apps/* 간 직접 import 금지 (공유 계약은 packages/schema 경유)
//   ② REQ-CB-006  apps/* 안에서 도메인 상수·이벤트 이름·에러 코드 하드코딩 금지
//   ③ REQ-CB-003  표면 파일(*.controller.ts · *.tools.ts · *.gateway.ts)의 drizzle 직접 import 금지
//                 — 표면은 번역만 하고 판정은 도메인 서비스 한 곳에 있다
//   + REQ-CB-016  apps/cli 는 DB 드라이버를 의존하지 않는다 (임포터가 DB 에 직접 붙는 경로를 없앤다)
//
// 규칙 조정은 이 파일 한 곳에서만 한다.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/** REQ-CB-001 — apps/* 간 직접 import 차단 패턴 */
const CROSS_APP_IMPORTS = {
  group: [
    '@nerv/api',
    '@nerv/api/*',
    '@nerv/web',
    '@nerv/web/*',
    '@nerv/cli',
    '@nerv/cli/*',
    '**/apps/api/**',
    '**/apps/web/**',
    '**/apps/cli/**',
  ],
  message:
    'REQ-CB-001: apps/* 간 직접 import 는 금지다. 공유 계약(zod 스키마·타입·상수)은 @nerv/schema 를 거친다.',
};

/** REQ-CB-003 — 표면 파일에서의 저장 계층 직접 접근 차단 패턴 */
const SURFACE_FORBIDDEN_IMPORTS = {
  group: ['drizzle-orm', 'drizzle-orm/*', '@nerv/schema/tables', '@nerv/schema/tables/*'],
  message:
    'REQ-CB-003: 표면(컨트롤러·게이트웨이·도구)은 번역만 한다. 저장 계층 접근과 판정은 도메인 서비스에서만.',
};

/** REQ-CB-016 — apps/cli 의 DB 드라이버 의존 차단 패턴 */
const CLI_FORBIDDEN_IMPORTS = {
  group: ['pg', 'pg/*', 'postgres', 'drizzle-orm', 'drizzle-orm/*'],
  message:
    'REQ-CB-016: apps/cli 는 DB 드라이버를 의존하지 않는다. 서버에는 EP-IMP-* HTTP 클라이언트로만 붙는다.',
};

/** REQ-CB-006 — 하드코딩 금지 리터럴 (정본: @nerv/schema 의 errors.ts · events.ts · constants.ts) */
const NO_HARDCODED_CONTRACT_LITERALS = [
  {
    // 에러 코드 10종 — 정본 docs/04-mvp/api.md §1.4
    selector:
      'Literal[value=/^NERV_(UNAUTHENTICATED|FORBIDDEN|PRECONDITION|CONFLICT_SCOPE|LEASE_EXPIRED|DRAFT_LEASED|APPROVAL_REQUIRED|HUMAN_ONLY|RATE_LIMIT|UNAVAILABLE)$/]',
    message:
      'REQ-CB-006: NERV_* 에러 코드는 @nerv/schema 의 NERV_ERROR 에서 import 한다 (하드코딩 금지).',
  },
  {
    // 이벤트 이름 <리소스>.<동사> — 정본 docs/03-proposal/spec-workflow.md §6 + docs/04-mvp/api.md §3.3
    selector:
      'Literal[value=/^(spec|task|claim|session|approval|question|gate|comment|baseline|import|notification|finding|cr)\\.[a-z][a-z_]*$/]',
    message:
      'REQ-CB-006: 이벤트 이름은 @nerv/schema 의 NERV_EVENT 에서 import 한다 (하드코딩 금지).',
  },
  {
    // Valkey 방송 채널 — 정본 docs/04-mvp/database.md §3
    selector: 'Literal[value="nerv_events"]',
    message: 'REQ-CB-006: 방송 채널 이름은 @nerv/schema 의 EVENTS_CHANNEL 을 쓴다 (하드코딩 금지).',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.tsbuild/**',
      '**/coverage/**',
      'packages/schema/drizzle/**',
      'deploy/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
  },

  // ── apps/* 공통 — REQ-CB-001 · REQ-CB-006 ────────────────────────────────
  {
    files: ['apps/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [CROSS_APP_IMPORTS] }],
      'no-restricted-syntax': ['error', ...NO_HARDCODED_CONTRACT_LITERALS],
    },
  },

  // ── 표면 파일 — REQ-CB-003 (위 apps/* 패턴을 재선언해 합친다: 같은 규칙 이름은 덮어쓰기다) ──
  {
    files: ['apps/**/*.controller.ts', 'apps/**/*.tools.ts', 'apps/**/*.gateway.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [CROSS_APP_IMPORTS, SURFACE_FORBIDDEN_IMPORTS] },
      ],
    },
  },

  // ── apps/cli — REQ-CB-016 ────────────────────────────────────────────────
  {
    files: ['apps/cli/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [CROSS_APP_IMPORTS, CLI_FORBIDDEN_IMPORTS] }],
    },
  },

  // ── packages/schema — 순수 선언 + 마이그레이터만 (§1.2 "하지 않는 일") ──────
  {
    files: ['packages/schema/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@nerv/api',
                '@nerv/api/*',
                '@nerv/web',
                '@nerv/web/*',
                '@nerv/cli',
                '@nerv/cli/*',
              ],
              message:
                '@nerv/schema 는 어떤 앱도 import 하지 않는다 — 의존 방향은 apps/* → packages/schema 한쪽뿐이다.',
            },
          ],
        },
      ],
    },
  },
);
