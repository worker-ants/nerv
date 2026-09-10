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

  // 시드에는 발견이 없어 큐가 넘치지 않는다(사람이 본 것은 18,650건짜리 큐다). 높이를
  // 만들어 준 뒤 내린다 — 여기서 재는 것은 큐의 내용이 아니라 **무엇이 흐르는 상자인가** 다.
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
