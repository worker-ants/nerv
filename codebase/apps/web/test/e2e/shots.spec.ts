// 디자인 확인용 스크린샷 — 판정이 아니라 눈으로 보기 위한 것이다.
import { test } from '@playwright/test';
import { STORAGE_STATE } from './global-setup.js';

// 라이트/다크 양쪽을 다 본다 — 토큰을 두 벌 정의해 놓고 한쪽만 확인하면
// 나머지 한쪽은 아무도 안 본 채로 배포된다. NERV_SHOT_SCHEME=dark 로 바꾼다.
const SCHEME = process.env['NERV_SHOT_SCHEME'] === 'dark' ? 'dark' : 'light';

test.use({
  storageState: STORAGE_STATE,
  viewport: { width: 1440, height: 900 },
  locale: 'ko-KR',
  colorScheme: SCHEME,
});

const SHOTS: [string, string][] = [
  ['/', 'home'],
  ['/inbox', 'inbox'],
  ['/p/clemvion', 'project'],
  ['/p/clemvion/specs/SPC-CWC-007', 'spec'],
  ['/p/clemvion/tasks', 'tasks'],
  ['/p/clemvion/sessions', 'sessions'],
  ['/p/clemvion/reviews', 'reviews'],
  ['/settings/tokens', 'settings'],
];

for (const [route, name] of SHOTS) {
  test(`shot ${name}`, async ({ page }) => {
    await page.goto(route);
    await page.waitForTimeout(600);
    await page.screenshot({
      path: `${process.env['NERV_SHOT_DIR'] ?? '/tmp/nerv-shots'}/${name}.png`,
      fullPage: true,
    });
  });
}
