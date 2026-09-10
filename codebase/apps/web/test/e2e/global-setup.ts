// Playwright 전역 준비 — **로그인을 한 번만 한다**.
//
// 테스트마다 로그인하면 스위트 자신이 무차별 대입 방어(api.md §1.8 IP당 30 req/min)에 걸린다.
// 실측으로 그걸 확인했다: 전 스위트 재실행이 429 를 만들었다. 한도를 낮추는 대신 테스트를
// 고치는 쪽이 맞다 — 사람도 화면을 볼 때마다 로그인하지 않는다.
//
// 로그인 경로 자체를 검증하는 테스트(REQ-WEB-001·005·006)는 이 상태를 쓰지 않고 직접 로그인한다.

import { chromium } from '@playwright/test';
import type { Browser, FullConfig } from '@playwright/test';

export const SEEDED_PASSWORD = 'nerv-dev-1234';

export const SEEDED_EMAIL = 'jimin@example.com';
export const STORAGE_STATE = 'test-results/.auth/seeded.json';

/**
 * **관측 스펙(`audit`·`shots`)만 쓰는 두 번째 신원.** 가른 이유가 둘이다.
 *
 * ① **쿼터.** 요청 쿼터의 주체는 사용자다(api.md §1.8 · 웹 600/분). 스위트 전체가 한
 *    사람으로 돌면 그 한도가 곧 **스위트가 자랄 수 있는 상한**이 된다 — 실측 2026-09-10:
 *    한 번이 375~465 요청이라 이미 60~77% 를 쓰고 있었고, 연속 실행은 넘겼다. 신원을
 *    나누면 한도는 사람 수만큼 늘어난다. 관측 스펙을 고른 것은 그 둘이 로드의 절반
 *    가까이(46 중 21)를 쓰면서 **판정이 하나도 없기** 때문이다.
 *
 * ② **본 적 없는 화면.** 시드의 `jimin` 은 프로젝트 planner + developer 이고 조직 admin 이
 *    아니다. 그래서 `/settings/members`·`/settings/gates` 는 **잠긴 컨트롤만** 찍혀 왔다 —
 *    디자인 확인의 대상인 실제 폼(역할 셀렉트·초대·tier 입력)을 아무도 본 적이 없다.
 *    `admin@example.com` 은 조직 스코프 멤버십(`project_id` NULL)이라 `rolesInProject` 가
 *    그것을 포함해 **프로젝트 화면은 그대로 다 보인다**(lib/session.ts).
 *
 * 잠긴 쪽의 **판정**은 L1 이 태운다(`routes/settings/workspace.spec.tsx`) — 여기서 잃는 것은
 * 그림뿐이고, 그 그림은 원래 아무도 확인에 쓰지 않던 것이다.
 */
export const ADMIN_EMAIL = 'admin@example.com';
export const ADMIN_STORAGE_STATE = 'test-results/.auth/admin.json';

/**
 * **개발 스택을 향해 돌지 않는다.** E2E 는 가입·로그인·스펙 수정을 실제로 하므로, 개발
 * 스택을 가리킨 채 돌면 사람이 쓰던 데이터가 조용히 바뀐다(그 사고가 이 분리의 계기였다).
 * 의도적으로 그렇게 하려면 `NERV_E2E_ALLOW_DEV_STACK=1` 을 명시해야 한다.
 */
const DEV_STACK_PORT = '8080';

function assertNotDevStack(baseURL: string): void {
  if (process.env['NERV_E2E_ALLOW_DEV_STACK'] === '1') return;
  if (new URL(baseURL).port !== DEV_STACK_PORT) return;
  throw new Error(
    [
      `E2E 대상이 개발 스택(${baseURL})입니다 — 테스트가 개발 데이터를 고칩니다.`,
      'E2E 전용 스택을 쓰세요:  pnpm e2e:up  (포트는 세션마다 할당된다)',
      '정말 개발 스택을 쓰려면 NERV_E2E_ALLOW_DEV_STACK=1 을 명시하세요.',
    ].join('\n'),
  );
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:19000';
  assertNotDevStack(baseURL);
  const browser = await chromium.launch();
  try {
    await signIn(browser, baseURL, SEEDED_EMAIL, STORAGE_STATE);
    await signIn(browser, baseURL, ADMIN_EMAIL, ADMIN_STORAGE_STATE);
  } finally {
    await browser.close();
  }
}

/**
 * 한 사람을 로그인시켜 세션을 파일로 남긴다. **문맥을 사람마다 새로 연다** — 같은 문맥에서
 * 두 번 로그인하면 앞사람의 쿠키가 남아 두 파일이 같은 세션을 담는다.
 */
async function signIn(
  browser: Browser,
  baseURL: string,
  email: string,
  path: string,
): Promise<void> {
  // 로그인 폼의 라벨이 화면 언어를 따른다 — 준비 절차는 한국어로 못 박는다.
  // 그러지 않으면 이 스크립트가 실행 기계의 locale 에 따라 다른 화면을 찾게 된다.
  const context = await browser.newContext({ baseURL, locale: 'ko-KR' });
  const page = await context.newPage();

  // 스택이 안 떠 있으면 여기서 바로 알려준다 — 36개 테스트가 각자 타임아웃으로 죽는 것보다 낫다
  try {
    await page.goto('/login', { timeout: 15_000 });
  } catch {
    await context.close();
    throw new Error(`E2E 스택에 연결할 수 없습니다(${baseURL}). 먼저 기동하세요:  pnpm e2e:up`);
  }
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill(SEEDED_PASSWORD);
  await page.getByRole('button', { name: /로그인/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });

  await context.storageState({ path });
  await context.close();
}
