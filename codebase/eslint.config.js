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

/**
 * REQ-CB-003 — 표면 파일에서의 저장 계층 직접 접근 차단 패턴.
 *
 * **이 가드는 반쪽이다**(2026-09-06 · 기록). 실제로 막는 것은 `drizzle-orm` 뿐이다 —
 * `@nerv/schema/tables` 는 그 패키지의 `exports` 에 **없어서** 애초에 import 할 수 없고,
 * 테이블 심볼은 본 배럴(`@nerv/schema`)이 재수출한다(`src/index.ts` 의 `export *`).
 * 표면이 그 배럴에서 테이블을 꺼내 오면 이 규칙은 아무 말도 하지 않는다.
 *
 * 지금 위반은 0건이고, 쿼리를 짜려면 `drizzle-orm` 이 필요하므로 실질적인 문은 여전히
 * 좁다. 그래도 **막힌다고 적어 두면 다음 사람은 규칙이 지켜 준다고 믿는다** — 믿게 두는
 * 것이 뚫린 것보다 나쁘다. 남은 반쪽을 닫으려면 테이블 export 이름을 `importNames` 로
 * 열거해야 하고, 그 목록은 테이블이 늘 때마다 조용히 낡는다. 그래서 지금은 **적어 둔다.**
 */
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
/**
 * 문장 하나로 볼 만한 한글 리터럴 — REQ-CB-022.
 *
 * 두 글자 이상 이어진 한글을 문장의 신호로 본다. `'가'` 같은 한 글자(정렬 키·구분자)는
 * 문구가 아니므로 걸지 않는다. 로그·설정 오류는 예외라 그 자리에는
 * `// eslint-disable-next-line no-restricted-syntax -- 운영자용 로그(REQ-CB-022)` 를 단다.
 */
const MESSAGE_KEY_ONLY =
  'REQ-CB-022: 사람에게 보이는 문구는 @nerv/schema 카탈로그의 키로만 참조한다(msg()/t()). ' +
  '운영자용 로그·설정 오류는 예외이며, 그 줄에 eslint-disable 과 사유를 남긴다.';

/**
 * **한 배열로 펼쳐 쓴다.** `no-restricted-syntax` 는 같은 이름이면 덮어쓰기라,
 * 블록마다 따로 선언하면 뒤에 오는 블록이 앞의 규칙을 통째로 지운다(실측: 처음에
 * 이 규칙을 따로 선언했더니 apps/web 블록이 덮어 아무것도 걸리지 않았다).
 *
 * **템플릿 리터럴은 보지 않는다.** `sql` 태그 템플릿 안의 한글 **주석**이 그대로 걸려
 * 오탐이 신호를 덮었다(실측: 1218건 중 대부분). 잡는 범위를 좁히는 대신 남는 경고를
 * 전부 진짜로 만든다 — 오탐이 섞인 규칙은 결국 통째로 꺼진다.
 * 대가는 분명하다: 보간이 섞인 문구(`` `${n}건 남음` ``)는 못 잡는다.
 */
const NO_HARDCODED_MESSAGES = [
  { selector: 'Literal[value=/[가-힣]{2,}/]', message: MESSAGE_KEY_ONLY },
];

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
    //
    // 동사 집합을 **열거한다**. `<리소스>.<아무거나>` 로 두면 `spec.key`(프로파일 필드 매핑)
    // 같은 무관한 문자열까지 잡는다 — 실측으로 오탐이 나서 좁혔다. 카탈로그에 동사가 늘면
    // 여기도 함께 늘린다(그 수고가 곧 "이벤트 이름은 정본이 있다"의 값이다).
    //
    // **가드가 반쪽이면 지켜 준다고 믿게 된다**(2026-09-07). 카탈로그 42종 중 다섯을 이
    // 정규식이 모르고 있었다 — 위반이 0건이라 드러나지 않았을 뿐이다. 이제 그 차이를
    // `packages/schema/src/events.spec.ts` 의 L1 이 센다(이 파일을 읽어 전수 대조한다).
    selector:
      'Literal[value=/^(spec|task|claim|session|approval|question|gate|comment|baseline|import|notification|finding|cr|evidence|review)\\.(draft_created|draft_updated|submitted|rejected|approved|superseded|deprecated|comment_added|commented|meta_updated|archived|restored|recheck_requested|resolved|created|cancelled|ready|claimed|blocked|done|rebrief_required|updated|conflict_warn|conflict_blocked|released|started|stale|complete|steered|requested|answered|bypassed|failopen|applied|opened|added|decided)$/]',
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
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // 밑줄 접두는 "의도적으로 쓰지 않는 값" 표시다 — 표면의 라우트 파라미터처럼
      // 시그니처에는 있어야 하지만 아직 소비되지 않는 인자가 여기 해당한다.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

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
      'no-restricted-syntax': [
        'error',
        ...NO_HARDCODED_CONTRACT_LITERALS,
        ...NO_HARDCODED_MESSAGES,
      ],
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

  // ── apps/web — 브라우저 전역 + 디자인 토큰 강제 (REQ-WEB-032) ─────────────
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-syntax': [
        'error',
        ...NO_HARDCODED_CONTRACT_LITERALS,
        ...NO_HARDCODED_MESSAGES,
        {
          // 색은 screens.md §4.2 매핑의 토큰으로만 고른다 — 임의 hex 는 팔레트를 조용히 갈라놓는다.
          selector: 'Literal[value=/#[0-9a-fA-F]{3,8}\\b/]',
          message:
            'REQ-WEB-032: 임의 hex 색 금지. src/styles/tokens.css 의 상태 토큰(§4.1·§4.2)을 쓴다.',
        },
        {
          selector: 'TemplateElement[value.raw=/#[0-9a-fA-F]{6}\\b/]',
          message:
            'REQ-WEB-032: 임의 hex 색 금지. src/styles/tokens.css 의 상태 토큰(§4.1·§4.2)을 쓴다.',
        },
      ],
    },
  },

  // ── 테스트는 표면이 아니다 — REQ-CB-022 의 문구 규칙에서 제외 ─────────────
  //
  // 테스트의 한글 문자열은 **검사 대상**이지 사용자에게 보이는 문구가 아니다.
  // 픽스처 제목·기대값·`it()` 이름이 전부 여기 해당한다(실측 1013건). 이것까지 잡으면
  // 규칙이 통째로 꺼지고, 그러면 진짜 문구 하나도 못 지킨다.
  {
    // `apps/**` 로 좁힌다. `packages/schema` 의 테스트는 애초에 이 규칙 밖이고,
    // 거기서 리터럴을 못 박는 것이 그 테스트의 일이다(카탈로그가 정본임을 지킨다).
    files: ['apps/**/*.spec.{ts,tsx}', 'apps/*/test/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...NO_HARDCODED_CONTRACT_LITERALS],
    },
  },

  // ── 생성물 — 라우트 트리는 @tanstack/router-plugin 산출물이라 손대지 않는다 ──
  {
    files: ['apps/web/src/routeTree.gen.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
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
