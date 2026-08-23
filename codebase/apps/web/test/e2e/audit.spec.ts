// 문서 대조용 실물 덤프 — 판정이 아니라 관측이다.
import { expect, test } from '@playwright/test';
import { STORAGE_STATE } from './global-setup.js';

// 저장된 세션을 쓴다 — 이 스위트의 목적은 화면 구조 관측이지 로그인 검증이 아니다.
test.use({ storageState: STORAGE_STATE, locale: 'ko-KR' });

const ROUTES = [
  '/',
  '/inbox',
  '/notifications',
  '/settings/members',
  '/settings/tokens',
  '/settings/gates',
  '/p/clemvion',
  '/p/clemvion/specs',
  '/p/clemvion/specs/SPC-CWC-007',
  '/p/clemvion/tasks',
  '/p/clemvion/tasks/CLV-T-0CFQC2',
  '/p/clemvion/sessions',
];

test('로그인 후 전 라우트 구조 덤프', async ({ page }) => {
  for (const route of ROUTES) {
    await page.goto(route);
    await page.waitForTimeout(700);
    const info = await page.evaluate(() => {
      const text = (el: Element | null): string => (el?.textContent ?? '').trim().slice(0, 120);
      return {
        headings: [...document.querySelectorAll('h1, h2')].map((h) => text(h)).filter(Boolean),
        nav: [...document.querySelectorAll('header a, header button')].map((a) => text(a)),
        aside: [...document.querySelectorAll('aside a, aside span, aside button')]
          .map((a) => text(a))
          .filter(Boolean),
        testids: [...document.querySelectorAll('[data-testid]')].map((e) =>
          e.getAttribute('data-testid'),
        ),
        bodyStart: text(document.querySelector('main')).slice(0, 200),
      };
    });
    console.info(
      `\n===== ${route}\n  h: ${info.headings.join(' | ')}\n  header: ${info.nav.join(' | ')}\n  aside: ${info.aside.join(' | ')}\n  testid: ${info.testids.join(',')}\n  main: ${info.bodyStart}`,
    );
  }
  expect(true).toBe(true);
});
