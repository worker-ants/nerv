// 리뷰 센터의 스크롤 상자 — screens.md §2.6a · REQ-WEB-158
//
// 스크롤 상자가 **페이지**였다: 발견 큐는 50건이면 이미 화면보다 길고, 그래서 바퀴를 필터나
// 레일 위에서 굴려도 움직이는 것은 큐였다(옆 칸이 더 흘릴 것이 없으면 스크롤은 페이지로
// 넘어간다). 게이트 현황은 그 세 칸을 다 지난 바닥에 따로 누워 있었다.
//
// **이 판정은 실제로 스크롤이 일어나야 성립한다** — jsdom 은 무엇이 흐르는 상자인지 재지
// 못하고 클래스 이름밖에 못 본다(§2.4 의 같은 판정이 L3 에 있는 이유와 같다). L1 은 계약을,
// 여기서는 배치의 사실을 잰다.

import { expect, test } from '@playwright/test';
import { STORAGE_STATE } from './global-setup.js';

// 로그인 세션을 실어야 한다 — 빠뜨리면 테스트가 로그인 화면에서 조용히 실패한다
test.use({ storageState: STORAGE_STATE, locale: 'ko-KR' });

test('큐를 내려도 페이지와 필터는 제자리다 — 흐르는 것은 컨텐츠 칸뿐이다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/p/clemvion/reviews');
  const content = page.getByTestId('review-content');
  await expect(content).toBeVisible({ timeout: 15000 });

  // 시드의 발견 3건으로는 큐가 화면을 넘치지 않는다(사람이 본 것은 18,650건짜리 큐다).
  // 높이를 만들어 준 뒤 내린다 — 여기서 재는 것은 큐의 내용이 아니라 **무엇이 흐르는
  // 상자인가** 다. (2026-09-10 정정: 예전 주석은 "시드에 발견이 없어서" 라고 적었는데
  // 그것은 사실이 아니었다 — 비어 있던 것은 `evidence` 뿐이다.)
  await content.evaluate((box) => {
    const filler = document.createElement('div');
    filler.style.height = '3000px';
    box.appendChild(filler);
  });

  const moved = await content.evaluate((box) => {
    const filters = document.querySelector('[data-testid="review-filters"]') as HTMLElement;
    const doc = document.documentElement;
    const filtersTop = filters.getBoundingClientRect().top;
    box.scrollTop = 600;
    return {
      scrolled: Math.round(box.scrollTop),
      docOverflow: doc.scrollHeight - doc.clientHeight,
      filtersShift: Math.abs(Math.round(filters.getBoundingClientRect().top - filtersTop)),
    };
  });

  // 전제 — 컨텐츠 칸이 실제로 흘렀다(흐르지 않았으면 나머지는 아무것도 증명하지 않는다)
  expect(moved.scrolled).toBeGreaterThan(0);
  // 페이지에는 스크롤이 없다: 큐가 아무리 길어도 문서가 자라지 않는다
  expect(moved.docOverflow).toBeLessThanOrEqual(1);
  // 필터는 따라 움직이지 않는다 — 이것이 사람이 본 그 결함이다
  expect(moved.filtersShift).toBeLessThanOrEqual(1);
});

test('게이트 현황은 컨텐츠 칸 안에 있어 칸을 가둔 뒤에도 닿는다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/p/clemvion/reviews');
  const content = page.getByTestId('review-content');
  await expect(content).toBeVisible({ timeout: 15000 });

  // 표가 있든(브랜치가 있으면) 빈 상태이든 **제목은 언제나 선다** — 그 제목이 어느 칸에
  // 사는지가 이 판정이다. 페이지 바닥에 있으면 칸을 가둔 순간 닿는 길이 사라진다.
  const inside = await content.evaluate((box) => {
    const title = [...box.querySelectorAll('h2, h3, p, section')].some((el) =>
      (el.textContent ?? '').includes('게이트 현황'),
    );
    return { title, docOverflow: document.documentElement.scrollHeight - window.innerHeight };
  });
  expect(inside.title).toBe(true);
  expect(inside.docOverflow).toBeLessThanOrEqual(1);
});

/**
 * **레일은 넓은 화면의 향상이지 유일한 경로가 아니다**(REQ-WEB-161).
 *
 * 곁레일이 서지 않는 폭에서 고른 발견을 카드 아래에서 펴는 판정이다. L1 은 `matchMedia` 를
 * 손잡이로 만들어 양쪽을 태우지만, **실제 폭에서 자리가 갈리는지**는 여기서만 잰다 —
 * jsdom 은 미디어 질의를 스스로 판정하지 않는다.
 *
 * 이 판정은 2026-09-10 까지 없었다. 그때 적은 이유("시드에 발견이 0건이라 누를 것이 없다")가
 * 사실이 아니었다 — 시드는 처음부터 발견 3건을 심고 있었다.
 */
test('좁은 폭에서는 고른 발견이 카드 아래에서 펴진다 — 레일은 서지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 1152, height: 900 });
  await page.goto('/p/clemvion/reviews');
  const cards = page.getByTestId('finding-card');
  await expect(cards.first()).toBeVisible({ timeout: 15000 });

  await cards.first().click();
  const inline = page.getByTestId('finding-rail-inline');
  await expect(inline).toBeVisible();
  // 레일이 펴는 것에 실제로 닿는다 — 카드가 자르는 자리다
  await expect(inline.getByTestId('promote-task')).toBeVisible();
  // 그리고 한 벌뿐이다: 두 벌이면 코멘트 입력의 상태가 갈린다
  await expect(page.getByTestId('finding-rail')).toHaveCount(1);
  await expect(page.getByTestId('review-rail')).toHaveCount(0);
});

test('넓은 폭에서는 곁레일에만 있다 — 카드 아래에 또 그리지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/p/clemvion/reviews');
  const cards = page.getByTestId('finding-card');
  await expect(cards.first()).toBeVisible({ timeout: 15000 });

  await cards.first().click();
  await expect(page.getByTestId('review-rail')).toBeVisible();
  await expect(page.getByTestId('finding-rail-inline')).toHaveCount(0);
  await expect(page.getByTestId('finding-rail')).toHaveCount(1);
});
