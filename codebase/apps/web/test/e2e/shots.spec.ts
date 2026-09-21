// 디자인 확인용 스크린샷 — 판정이 아니라 눈으로 보기 위한 것이다.
import { test } from '@playwright/test';
import { ADMIN_STORAGE_STATE } from './global-setup.js';

// 라이트/다크 양쪽을 다 본다 — 토큰을 두 벌 정의해 놓고 한쪽만 확인하면
// 나머지 한쪽은 아무도 안 본 채로 배포된다. NERV_SHOT_SCHEME=dark 로 바꾼다.
//
// **관측 신원은 조직 admin 이다**(`ADMIN_STORAGE_STATE` 주석). 그 전까지 설정 화면은
// 잠긴 컨트롤만 찍혀서, 디자인 확인의 대상인 실제 폼을 아무도 본 적이 없었다.
const SCHEME = process.env['NERV_SHOT_SCHEME'] === 'dark' ? 'dark' : 'light';

// **좁은 폭도 찍는다**(2026-09-21 · REQ-WEB-164). 이 목록이 1440px 하나였던 동안 휴대폰
// 폭의 화면은 **한 번도 그림으로 남은 적이 없고**, 그래서 헤더가 겹쳐 있고 프로젝트 메뉴로
// 갈 길이 없다는 것을 사람이 실제 기기에서 볼 때까지 아무도 몰랐다. `NERV_SHOT_VIEWPORT=mobile`
// 로 바꾼다 — 세로는 fullPage 가 늘리므로 값은 폭만 의미가 있다.
const MOBILE = process.env['NERV_SHOT_VIEWPORT'] === 'mobile';
const VIEWPORT = MOBILE ? { width: 390, height: 844 } : { width: 1440, height: 900 };

test.use({
  storageState: ADMIN_STORAGE_STATE,
  viewport: VIEWPORT,
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

const SHOT_DIR = process.env['NERV_SHOT_DIR'] ?? '/tmp/nerv-shots';

for (const [route, name] of SHOTS) {
  test(`shot ${name}`, async ({ page }) => {
    await page.goto(route);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: true });
  });
}

// 좁은 폭에서만 존재하는 화면이 하나 있다 — **열린 서랍**(REQ-WEB-164). 닫힌 모습만
// 찍으면 그 폭의 내비게이션은 여전히 아무도 본 적이 없는 것이 된다.
//
// **선언 자체를 가른다.** `test.skip(조건, …)` 을 파일 바닥에 두면 그것은 이 테스트가
// 아니라 **파일 전체**를 건너뛴다 — 넓은 폭의 그림 열한 장이 함께 사라진다(실측).
if (MOBILE) {
  test('shot drawer', async ({ page }) => {
    await page.goto('/p/clemvion');
    await page.getByTestId('nav-drawer-toggle').click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOT_DIR}/drawer.png` });
  });
}
