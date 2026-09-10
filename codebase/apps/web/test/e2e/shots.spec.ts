// 디자인 확인용 스크린샷 — 판정이 아니라 눈으로 보기 위한 것이다.
import { test } from '@playwright/test';
import { ADMIN_STORAGE_STATE } from './global-setup.js';

// 라이트/다크 양쪽을 다 본다 — 토큰을 두 벌 정의해 놓고 한쪽만 확인하면
// 나머지 한쪽은 아무도 안 본 채로 배포된다. NERV_SHOT_SCHEME=dark 로 바꾼다.
//
// **관측 신원은 조직 admin 이다**(`ADMIN_STORAGE_STATE` 주석). 그 전까지 설정 화면은
// 잠긴 컨트롤만 찍혀서, 디자인 확인의 대상인 실제 폼을 아무도 본 적이 없었다.
const SCHEME = process.env['NERV_SHOT_SCHEME'] === 'dark' ? 'dark' : 'light';

test.use({
  storageState: ADMIN_STORAGE_STATE,
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
  // **이 둘은 2026-09-10 까지 한 번도 찍힌 적이 없다.** 목록에 없기도 했고, 있었더라도
  // 그때의 관측 신원(planner)에게는 잠긴 컨트롤만 보였다 — 역할 셀렉트·초대 폼·tier 입력이
  // 디자인 확인의 대상인데 그 대상이 그림에 없었다.
  ['/settings/members', 'settings-members'],
  ['/settings/gates', 'settings-gates'],
  // 매뉴얼도 화면이다 — 디자인 확인에서 빠지면 여기만 아무도 안 본 채로 배포된다
  ['/help/tasks', 'manual'],
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
