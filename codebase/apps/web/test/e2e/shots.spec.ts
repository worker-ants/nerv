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
  // 소스 탭은 2026-09-22 에 생긴 면이다(REQ-WEB-173). 뷰어만 찍으면 그 탭은 **한 번도
  // 그림으로 남지 않는다** — 이 저장소가 좁은 폭에서 배운 것과 같은 이유다(REQ-WEB-164).
  ['/p/clemvion/specs/SPC-CWC-007?body=source', 'spec-source'],
  ['/p/clemvion/tasks', 'tasks'],
  ['/p/clemvion/sessions', 'sessions'],
  ['/p/clemvion/reviews', 'reviews'],
  ['/settings/tokens', 'settings'],
  // **이 둘은 2026-09-10 까지 한 번도 찍힌 적이 없다.** 목록에 없기도 했고, 있었더라도
  // 그때의 관측 신원(planner)에게는 잠긴 컨트롤만 보였다 — 역할 셀렉트·초대 폼·tier 입력이
  // 디자인 확인의 대상인데 그 대상이 그림에 없었다.
  ['/settings/members', 'settings-members'],
  // 멤버와 초대는 탭이다(2026-09-26 · REQ-WEB-242) — 초대 폼은 둘째 탭에 있어서 따로 찍어야 그림에 남는다
  ['/settings/members?tab=invites', 'settings-invites'],
  ['/settings/org', 'settings-org'],
  ['/settings/projects', 'settings-projects'],
  ['/settings/gates', 'settings-gates'],
  // 매뉴얼도 화면이다 — 디자인 확인에서 빠지면 여기만 아무도 안 본 채로 배포된다
  ['/help/tasks', 'manual'],
  // 설치 장은 다른 장에 없는 것을 인다(값 카드·복사 단추 · REQ-WEB-165) — 한 장만 찍으면
  // 그 둘은 그림에 없다. 이 저장소가 좁은 폭에서 배운 것과 같은 이유다.
  ['/help/install', 'manual-install'],
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

// **관계 그래프는 탭 안에 있어서 주소로 갈 수 없다.** 그래서 목록 화면을 찍어도 이 화면은
// 그림으로 남지 않았고, 시드에 `spec_relation` 이 0건이던 동안에는 눌러도 빈 상태였다
// (2026-09-22 에 영역 4 · 종류 6 · 관계 28 을 심었다 — database.md §4). 밀도가 유일한
// 설계 문제인 화면이라(§2.4a), 색·크기·범례·영역 상자가 실제로 어떻게 보이는지는
// 캔버스를 찍어야만 안다. 좁은 폭에서도 접히지 않으므로 두 폭 다 찍는다.
test('shot spec-graph', async ({ page }) => {
  await page.goto('/p/clemvion/specs');
  await page.getByTestId('view-graph').click();
  await page.getByTestId('spec-graph').waitFor();
  // fcose 가 낸 답을 정리 패스가 한 벌 더 돈다(REQ-WEB-174·175) — 그 전에 찍으면
  // 겹친 상자가 그림에 남는다
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOT_DIR}/spec-graph.png` });
});
