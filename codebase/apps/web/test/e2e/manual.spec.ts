// 제품 매뉴얼(/help) — 무엇이 흐르는 상자인가 (screens.md §2.10 · REQ-WEB-157)
//
// S3 에서 고친 것과 같은 결함이 여기에도 있었다(§2.4 · REQ-WEB-156): 스크롤 상자가
// **페이지**라, 차례 위에서 굴린 바퀴가 본문을 움직였다 — 차례가 더 흘릴 것이 없으면
// 스크롤은 페이지로 넘어간다. 나란히 놓인 두 칸이 서로의 스크롤에 반응하면 그것은
// 두 칸이 아니다.
//
// 이 판정은 실제로 스크롤이 일어나야 성립한다 — jsdom 은 무엇이 흐르는 상자인지 재지
// 못하고 클래스 이름밖에 못 본다(계약은 L1 이 태운다).

import { expect, test } from '@playwright/test';
import { STORAGE_STATE } from './global-setup.js';

test.use({ storageState: STORAGE_STATE, locale: 'ko-KR' });

test('본문을 내려도 페이지·차례·문서 안 목차는 제자리다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/help/tasks');
  await expect(page.getByTestId('manual-body')).toBeVisible({ timeout: 15000 });

  const moved = await page.getByTestId('manual-content').evaluate((content) => {
    const doc = document.documentElement;
    // 자리(첫째·둘째)가 아니라 **이름과 든 것**으로 집는다 — 자리로 집으면 나중에 열이 하나 늘 때 테스트가
    // 조용히 다른 것을 재게 된다(차례는 2026-09-25 부터 사이드바가 아니라 둘째 열이다 · REQ-WEB-232)
    const toc = document.querySelector('[data-testid="manual-toc"]') as HTMLElement;
    const asides = [...document.querySelectorAll('aside')] as HTMLElement[];
    const onThisPage = asides.find((el) => el.querySelector('a[href^="#"]')) as HTMLElement;
    const before = {
      toc: toc.getBoundingClientRect().top,
      onThisPage: onThisPage.getBoundingClientRect().top,
    };
    content.scrollTop = 400;
    return {
      // 전제 — 이 장은 화면보다 길다(짧으면 아래 판정이 아무것도 증명하지 않는다)
      overflows: content.scrollHeight - content.clientHeight,
      scrolled: Math.round(content.scrollTop),
      docOverflow: doc.scrollHeight - doc.clientHeight,
      tocShift: Math.abs(Math.round(toc.getBoundingClientRect().top - before.toc)),
      onThisPageShift: Math.abs(
        Math.round(onThisPage.getBoundingClientRect().top - before.onThisPage),
      ),
    };
  });

  expect(moved.overflows).toBeGreaterThan(0);
  expect(moved.scrolled).toBeGreaterThan(0);
  // 페이지에는 스크롤이 없다 — 본문이 아무리 길어도 문서가 자라지 않는다
  expect(moved.docOverflow).toBeLessThanOrEqual(1);
  // 차례와 "이 문서 안" 은 따라 움직이지 않는다
  expect(moved.tocShift).toBeLessThanOrEqual(1);
  expect(moved.onThisPageShift).toBeLessThanOrEqual(1);
});

// **차례는 사이드바 오른쪽의 둘째 열이다**(2026-09-25 사람 지시 · REQ-WEB-232). 사이드바의 [도움말] 아래에
// 펼쳐지던 동안 열 장이 프로젝트 목록과 한 열에서 자리를 다퉜다 — 스펙 상세의 트리 열과 같은 자리·같은 뼈대다.
test('차례는 사이드바가 아니라 그 오른쪽의 둘째 열에 선다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/help/tasks');
  const toc = page.getByTestId('manual-toc');
  await expect(toc).toBeVisible({ timeout: 15000 });
  const rail = page.getByTestId('nav-rail');
  expect(await rail.getByTestId('manual-toc').count()).toBe(0);
  const railBox = (await rail.boundingBox())!;
  const tocBox = (await toc.boundingBox())!;
  const bodyBox = (await page.getByTestId('manual-body').boundingBox())!;
  // 사이드바 · 차례 · 본문 순서로 나란히 — 겹치지 않는다
  expect(tocBox.x).toBeGreaterThanOrEqual(railBox.x + railBox.width - 1);
  expect(bodyBox.x).toBeGreaterThanOrEqual(tocBox.x + tocBox.width - 1);
  await expect(toc.getByRole('link', { name: '작업' })).toHaveAttribute('aria-current', 'page');
});

test('차례 위에서 굴린 바퀴는 본문을 움직이지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/help/tasks');
  await expect(page.getByTestId('manual-body')).toBeVisible({ timeout: 15000 });

  // **자리가 아니라 이름으로 집는다** — 위 테스트가 적어 둔 그 규칙이다. `aside` 의
  // 첫째로 집던 동안 셸의 사이드바가 그 자리에 들어왔고(2026-09-21 · REQ-WEB-164),
  // 프로젝트 밖에서는 그것이 접혀 있어 `boundingBox()` 가 `null` 이었다.
  const toc = await page.getByTestId('manual-toc').boundingBox();
  expect(toc).not.toBeNull();
  await page.mouse.move(toc!.x + toc!.width / 2, toc!.y + toc!.height / 2);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(300);

  // 차례가 더 흘릴 것이 없으면 예전에는 스크롤이 페이지로 넘어가 **본문이** 움직였다
  expect(
    await page.evaluate(() => ({
      page: Math.round(document.documentElement.scrollTop),
      content: Math.round(
        (document.querySelector('[data-testid="manual-content"]') as HTMLElement).scrollTop,
      ),
    })),
  ).toEqual({ page: 0, content: 0 });
});

// ── 설치 장은 이 배치의 값으로 말한다 (screens.md §2.10 · REQ-WEB-165) ───────
//
// **여기서만 확인할 수 있는 것은 "앞문이 내어 준 주소가 실제로 문서에 들어가는가" 다.**
// 치환과 폴백 판정은 L1 이 전수로 세지만(`lib/manual-vars.spec.ts`), 그 값의 출처는
// nginx 가 만든 `/config.json` 이다(`runtime-config.spec.ts`) — 그 둘이 이어져 있는지는
// 실물 스택에서만 보인다. 끊겨 있으면 문서는 조용히 예시 주소를 보여 주고, 그것을
// 복사한 사람은 남의 서버를 가리키게 된다.
test('설치 장의 주소가 이 배치의 주소다 — 예시 주소가 남지 않는다', async ({ page, baseURL }) => {
  // 복사 단추를 실제로 누른다 — Chromium 은 권한 없이 `clipboard.writeText` 를 거절한다
  await page.context().grantPermissions(['clipboard-write']);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/help/install');
  await expect(page.getByTestId('manual-env-card')).toBeVisible({ timeout: 15000 });

  const origin = new URL(baseURL ?? '').origin;
  await expect(page.getByTestId('manual-env-card')).toContainText(origin);

  const body = page.getByTestId('manual-body');
  const text = (await body.textContent()) ?? '';
  expect(text).toContain(origin);
  expect(text).not.toContain('api.nerv.example.com');
  // 자리표시자가 그대로 찍히면 채우는 쪽이 끊긴 것이다 — 빈칸보다 이쪽이 더 흔하다
  expect(text).not.toMatch(/\{\{\w+\}\}/);

  // **이 스택은 http://localhost 다 — 설치가 거부되는 바로 그 주소다**(4.6 §3.5).
  // 판정은 L1 이 전수로 세지만(`help.spec.tsx`), 그 판정이 읽는 값은 앞문이 만든
  // `/config.json` 이라 여기서만 끝까지 이어진다. 정상 운영(https + 공개 호스트)에서는
  // 이 줄이 보이지 않는다.
  await expect(page.getByTestId('manual-env-blocked')).toContainText('https');

  // 코드블록은 복사하라고 있는 것이다 — 단추가 붙었고 눌러서 글자가 바뀌는지까지 본다
  const copy = body.locator('[data-copy]').first();
  await expect(copy).toHaveText('복사');
  await copy.click();
  await expect(copy).toHaveText('복사했습니다');
});
