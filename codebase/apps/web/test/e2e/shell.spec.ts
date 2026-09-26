// L3 웹 — compose 스택 상대의 브라우저 시나리오 (codebase.md §4.3 · backlog.md §5.4)
//
// 여기서만 확인할 수 있는 것을 확인한다: **빌드된 SPA 가 실제 브라우저에서 서고**, 인증
// 리다이렉트·쿠키·프록시가 운영과 같은 조립에서 동작하는가. jsdom 단위 테스트가 다 통과해도
// 번들·라우터 초기화·nginx 폴백에서 깨지는 일이 있고, 그건 사용자가 첫 화면에서 만난다.

import { expect, test } from '@playwright/test';
import { SEEDED_EMAIL, SEEDED_PASSWORD, STORAGE_STATE } from './global-setup.js';

// 이 스펙은 한국어 화면을 검사한다 — 기계의 locale 에 따라 대상이 바뀌지 않게 못 박는다
test.use({ locale: 'ko-KR' });

// **여기서는 시드 계정으로 로그인한다**(2026-09-22 개정). 예전에는 매 실행마다 새 계정을
// 만들어 들어왔는데, 가입 이메일 인증을 강제한 뒤로 갓 만든 계정은 **확인 전까지 로그인할 수
// 없다** — 이 스위트가 보려는 것은 "셸이 서는가 · 쿠키가 도는가" 이지 가입 절차가 아니다.
// 가입 → 확인 메일 → 링크 → 진입의 전 구간은 `signup-verify.spec.ts` 가 본다.
const EMAIL = SEEDED_EMAIL;
const PASSWORD = SEEDED_PASSWORD;

test.describe.configure({ mode: 'serial' });

test('미인증 사용자는 /login 으로 가고 원래 경로가 보존된다 (REQ-WEB-001)', async ({ page }) => {
  await page.goto('/p/clemvion/tasks');
  await page.waitForURL(/\/login/);
  expect(new URL(page.url()).searchParams.get('redirect')).toBe('/p/clemvion/tasks');
  await expect(page.getByText('스펙 단일 진실')).toBeVisible();
});

test('로그인 실패 사유는 폼 안에 뜨고 비밀번호만 지워진다 (REQ-WEB-005)', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('이메일').fill('nobody@example.com');
  await page.getByLabel('비밀번호').fill('wrong-password-1234');
  await page.getByRole('button', { name: /로그인/ }).click();

  await expect(page.getByTestId('login-error')).toBeVisible();
  await expect(page.getByLabel('비밀번호')).toHaveValue('');
  // 이메일은 지우지 않는다 — 다시 타이핑하게 만들지 않는다
  await expect(page.getByLabel('이메일')).toHaveValue('nobody@example.com');
});

test('로그인 → 셸 진입 · ⌘K 퀵 스위처 (REQ-WEB-006 · REQ-WEB-040)', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('이메일').fill(EMAIL);
  await page.getByLabel('비밀번호').fill(PASSWORD);
  await page.getByRole('button', { name: /로그인/ }).click();

  // 역할별 첫 화면으로 착지한다 — 조직이 0개면 온보딩이다(REQ-WEB-006)
  await page.waitForURL(/\/onboarding|\/inbox|\/p\/|\/$/);
  // 셸이 떴다는 것만 본다 — 로고 **글리프**를 문자로 못 박으면 조형을 바꿀 때마다
  // 깨진다(실측 2026-08-23: 글리프를 사각형 마크로 바꾸며 깨졌다). 이 테스트가 지키려는
  // 것은 브랜드 표기가 아니라 "가입 뒤 셸에 착지한다"이다.
  await expect(page.getByRole('link', { name: /NERV/ }).first()).toBeVisible();

  // ⌘K — 전 라우트 공통. 마우스 없이 열고 닫힌다
  await page.keyboard.press('Meta+k');
  await expect(page.getByTestId('quick-switcher')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('quick-switcher')).toHaveCount(0);
});

test('로그인 화면을 거쳐 들어와도 실시간이 붙는다 (연결 표시가 걸린 채로 남지 않는다)', async ({
  page,
}) => {
  // **저장된 세션으로 시작하지 않는다**는 것이 이 테스트의 전부다.
  // 다른 E2E 는 storageState 로 이미 로그인된 채 시작해서 첫 WS 핸드셰이크가 성공한다 —
  // 그래서 "로그인 화면에서 붙었다가 거절당한 소켓은 다시 붙지 않는다"를 아무도 못 봤다.
  // socket.io 는 **서버가 끊은 연결**을 자동 재연결하지 않는다(`io server disconnect`).
  await page.goto('/login');
  await page.getByLabel('이메일').fill(EMAIL);
  await page.getByLabel('비밀번호').fill(PASSWORD);
  await page.getByRole('button', { name: /로그인/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));

  // 실시간이 끊기면 헤더에 연결 표시가 선다(§1.3 · 2026-09-26 개정 — 배너는 오프라인에만) — 붙었으면 없어야 한다
  await expect(page.getByTestId('connection-mark')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('connection-banner')).toHaveCount(0);
});

test('로그아웃하면 세션이 끊기고 보호 경로가 다시 막힌다', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('이메일').fill(EMAIL);
  await page.getByLabel('비밀번호').fill(PASSWORD);
  await page.getByRole('button', { name: /로그인/ }).click();
  await expect(page.getByRole('link', { name: /NERV/ }).first()).toBeVisible();

  // 로그아웃은 사용자 메뉴 안에 있다(§1.3 "[사용자 메뉴 ▾]") — 헤더에 평문 버튼으로
  // 늘어놓지 않는 이유는 자주 쓰지 않는 항목이 자주 쓰는 항목의 자리를 먹기 때문이다.
  await page.getByTestId('user-menu').click();
  await page.getByRole('button', { name: '로그아웃' }).click();
  await page.waitForURL(/\/login/);

  await page.goto('/inbox');
  await page.waitForURL(/\/login/);
});

test.describe('시드 세션', () => {
  // 저장된 세션을 쓴다 — 조직 스위처는 소속이 있어야 뜨므로 멤버십 있는 계정이어야 하고,
  // 매 테스트 로그인하면 스위트가 자기 인증 쿼터를 먹는다(§1.8).
  test.use({ storageState: STORAGE_STATE });

  test('사이드바 머리에 조직 스위처, 헤더에 사용자 메뉴가 있다 (§1.3 레이아웃)', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: /NERV/ }).first()).toBeVisible();

    // 어느 조직을 보고 있는지가 화면에 없으면 다중 조직에서 길을 잃는다 — 2026-09-25 부터 그 자리는
    // 모든 화면에 서는 사이드바의 머리다(D1 · REQ-WEB-225)
    await expect(page.getByTestId('nav-rail').getByTestId('org-switcher')).toBeVisible();

    await page.getByTestId('user-menu').click();
    // 사이드바에도 [설정]이 있다 — 사용자 메뉴 안의 것을 본다
    await expect(
      page.locator('#shell-menu-user').getByRole('link', { name: '설정' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible();

    // 바깥을 누르면 닫힌다 — 열린 채로 남으면 다음 클릭이 먹히지 않는다
    await page.mouse.click(400, 400);
    await expect(page.getByRole('button', { name: '로그아웃' })).toHaveCount(0);
  });

  test('사이드바는 모든 화면에 선다 — 펼쳐지는 것만 라우트가 정한다 (REQ-WEB-225)', async ({
    page,
  }) => {
    // 2026-09-25 까지는 /p/:proj/* 에서만 섰다 — 홈·받은 요청·알림·설정에서는 열이 통째로 사라져
    // 본문이 가운데로 뛰었다(NAV-06). 이제 열은 어디서나 서고, 조직 범위 화면에서는 어느 프로젝트도
    // 펼치지 않는다.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/inbox');
    const rail = page.getByTestId('nav-rail');
    await expect(rail).toBeVisible();
    await expect(rail.getByTestId('rail-project-current')).toHaveCount(0);
    await expect(page.getByTestId('spec-tree')).toHaveCount(0);
    const mainOnInbox = await page.locator('main#main').boundingBox();

    // **열은 다시 그려지지 않는다** — 화면을 옮겨도 같은 요소다(표식이 남는다) · 본문의 왼쪽 끝이 그대로다
    await rail.evaluate((el) => el.setAttribute('data-probe', 'kept'));
    await rail.getByTestId('rail-project-clemvion').click();
    await page.waitForURL(/\/p\/clemvion$/);
    await expect(rail.getByTestId('rail-project-current')).toBeVisible();
    // 스펙 트리는 사이드바에 없다 — 스펙 상세에서만 서는 둘째 열이다(REQ-WEB-226)
    await expect(page.getByTestId('spec-tree')).toHaveCount(0);
    await expect(rail).toHaveAttribute('data-probe', 'kept');
    const mainOnProject = await page.locator('main#main').boundingBox();
    expect(mainOnProject?.x).toBe(mainOnInbox?.x);

    // 헤더는 지금 자리를 말한다 — 고르는 자리는 헤더에 없다
    await expect(page.getByTestId('crumb-project')).toHaveText(/clemvion/i);
    await expect(page.getByTestId('crumb-screen')).toHaveText('개요');
    await expect(page.locator('header').getByTestId('org-switcher')).toHaveCount(0);

    // S3 — 좌측 트리는 셸이 세우는 둘째 열 하나다(중복 렌더가 없어야 한다 — 대조에서 발견).
    // 이 폭(xl)에서는 제자리에 선다
    await page.goto('/p/clemvion/specs/SPC-CWC-007');
    await expect(page.getByTestId('spec-tree')).toHaveCount(1);
    await expect(page.getByTestId('spec-column-panel')).toBeVisible();

    // 스펙 목록도 하나다 — 본문의 전수 트리가 그 열의 전체 화면 판이라 열이 서지 않는다(§2.4 · REQ-WEB-226).
    // 2026-09-25 까지 여기서 둘이었다(사이드바 + 본문) — 같은 트리가 한 화면에 두 번이었다(OBS-01)
    await page.goto('/p/clemvion/specs');
    await expect(page.getByTestId('spec-tree')).toHaveCount(1);
    await expect(page.getByTestId('spec-column')).toHaveCount(0);
  });

  test('스펙 트리의 둘째 열 — 접은 것은 남고 본문이 그 폭을 받는다 (REQ-WEB-226)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/p/clemvion/specs/SPC-CWC-007');
    const panel = page.getByTestId('spec-column-panel');
    await expect(panel).toBeVisible({ timeout: 15000 });
    const bodyOpen = await page.getByTestId('spec-body').boundingBox();

    await panel.getByTestId('spec-column-toggle').click();
    await expect(panel).toBeHidden();
    const bodyClosed = await page.getByTestId('spec-body').boundingBox();
    // 접으면 본문이 열의 폭(16rem)에서 띠(2rem)를 뺀 만큼 넓어진다
    expect((bodyClosed?.width ?? 0) - (bodyOpen?.width ?? 0)).toBeGreaterThan(180);

    // 다시 열어도 접은 채다 — 사람이 정한 것은 이 브라우저가 기억한다
    await page.reload();
    await expect(page.getByTestId('spec-body')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('spec-column-panel')).toBeHidden();
    await page.getByTestId('spec-column-toggle').click();
    await expect(page.getByTestId('spec-column-panel')).toBeVisible();
  });

  // **폭의 판정은 여기서만 성립한다** — jsdom 은 폭을 재지 않으므로 "헤더가 겹쳤다"도
  // "사이드바가 없다"도 L1 에서는 보이지 않는다(REQ-WEB-151 이 같은 이유로 여기 있다).
  test('좁은 화면 — 헤더가 넘치지 않고 서랍이 프로젝트 탭을 연다 (REQ-WEB-164)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/p/clemvion');
    await expect(page.getByTestId('user-menu')).toBeVisible();

    // ① 사이드바는 접히고 [☰] 가 그 자리를 대신한다
    await expect(page.getByTestId('nav-rail')).toBeHidden();
    const toggle = page.getByTestId('nav-drawer-toggle');
    await expect(toggle).toBeVisible();

    // ② 헤더가 제 폭 안에 든다. 2026-09-21 까지 이 값은 양수였고, 넘친 것이 잘리지 않고
    //    **겹쳐 그려져** 헤더의 글자를 아무도 읽을 수 없었다.
    const overflow = await page.evaluate(() => {
      const header = document.querySelector('header');
      return {
        header: header === null ? -1 : header.scrollWidth - header.clientWidth,
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(overflow.header).toBeLessThanOrEqual(0);
    expect(overflow.page).toBeLessThanOrEqual(0);

    // ③ 서랍이 프로젝트 탭을 연다 — 그 폭에서 갈 길이 사라지지 않는다
    await toggle.click();
    const rail = page.getByTestId('nav-rail');
    await expect(rail).toBeVisible();
    await rail.getByRole('link', { name: /리뷰/ }).click();
    await page.waitForURL(/\/p\/clemvion\/reviews/);

    // ④ 떠났으면 닫힌다 — 열린 채로 남으면 그 아래 화면에 손이 닿지 않는다
    await expect(rail).toBeHidden();

    // ⑤ 스펙 트리는 서랍이 아니라 문서 옆의 띠에 있다(REQ-WEB-226) — 누르면 본문 위에 열리고,
    //    문서를 고르면 닫힌다. 그 폭에서도 페이지가 옆으로 밀리지 않는다
    await page.goto('/p/clemvion/specs/SPC-CWC-007');
    const strip = page.getByTestId('spec-column-toggle');
    await expect(strip).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('spec-column-panel')).toBeHidden();
    await strip.click();
    const panel = page.getByTestId('spec-column-panel');
    await expect(panel).toBeVisible();
    await panel.getByText('세션 복원 API').first().click();
    await page.waitForURL(/SPC-CWC-012/);
    await expect(panel).toBeHidden();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });

  // **항목이 열보다 많아도 가려지는 것이 없다**(2026-09-25 사람 보고 · REQ-WEB-232). 프로젝트 구역이 남는 높이에
  // 맞춰 줄어드는 칸이던 동안, 열이 모자라면 스크롤이 생기는 대신 목록이 바닥의 설정·도움말 뒤로 겹쳤다 —
  // 그 자리를 누르면 겹친 블록이 눌렸다. jsdom 은 높이를 재지 못해 여기서만 잰다.
  test('낮은 창에서도 사이드바의 어떤 항목도 가려지지 않는다 — 넘치면 열이 흐른다', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 460 });
    await page.goto('/p/clemvion/tasks');
    const rail = page.getByTestId('nav-rail');
    await expect(rail.getByTestId('rail-project-settings')).toBeAttached({ timeout: 15000 });
    // 전제 — 열이 화면보다 길다(짧으면 아래 판정이 아무것도 증명하지 않는다)
    expect(await rail.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0);
    for (const id of ['rail-project-settings', 'rail-settings', 'rail-help']) {
      const item = rail.getByTestId(id);
      await item.scrollIntoViewIfNeeded();
      // 그 자리를 누르면 **그 항목이** 눌린다 — 다른 블록이 위에 겹쳐 있지 않다
      const covered = await item.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return hit === null || !el.contains(hit);
      });
      expect(covered, id).toBe(false);
    }
    // 열이 흘러도 페이지는 흐르지 않는다 — 바퀴가 본문을 움직이지 않게
    expect(await page.evaluate(() => Math.round(document.documentElement.scrollTop))).toBe(0);
  });

  // **요약 줄이 좁은 폭에서 줄을 바꾼다**(2026-09-25 — D4 · UI/UX 검토 SYS-13 · REQ-WEB-234). 줄바꿈 없는 한 줄이던
  // 동안 폰 폭의 작업 보드가 문서를 가로로 17px 밀었고 필터 단추가 잘렸다(실측) — 모바일 폭 검사는 개요만 쟀다.
  // 홈은 자기 여백(40px)을 좁은 폭에서도 그대로 써서 본문이 295px 였다
  test('폰 폭에서 작업 보드·리뷰·홈이 문서를 가로로 밀지 않는다', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ['/p/clemvion/tasks', '/p/clemvion/reviews', '/']) {
      await page.goto(path);
      await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 15000 });
      // 요약 줄은 받은 뒤에 선다 — 숫자가 들어온 모양으로 잰다(실시간 연결이 있어 networkidle 은 오지 않는다)
      await page.waitForTimeout(1000);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});
