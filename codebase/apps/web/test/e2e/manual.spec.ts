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
    // 자리(첫째·둘째)가 아니라 **무엇이 든 상자인지**로 집는다 — 자리로 집으면
    // 나중에 aside 가 하나 늘 때 테스트가 조용히 다른 것을 재게 된다
    const asides = [...document.querySelectorAll('aside')] as HTMLElement[];
    const toc = asides.find((el) => el.querySelector('a[href="/help/specs"]')) as HTMLElement;
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

test('차례 위에서 굴린 바퀴는 본문을 움직이지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/help/tasks');
  await expect(page.getByTestId('manual-body')).toBeVisible({ timeout: 15000 });

  const toc = await page.locator('aside').first().boundingBox();
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
