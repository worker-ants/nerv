// 스펙 사이를 옮길 때 화면이 앞 문서를 들고 있지 않은지 — E2E 여야 하는 이유가 있다.
//
// 이 결함은 **실제 편집기와 실제 라우팅이 함께 있어야** 재현된다: 문서가 도착하기 전
// `doc_status` 기본값이 `draft` 라 편집기가 잠깐 편집 가능 상태가 되고, 그 사이 TipTap 이
// 울린 갱신이 부모의 `draft` 를 채운다. 라우트 파라미터만 바뀌면 그 `draft` 가 살아남아
// 다음 문서 위에 앞 문서의 본문이 그대로 남는다(실측 2026-08-23).
//
// jsdom 단위 테스트로 먼저 써 봤더니 **수정을 빼도 통과했다** — 잡지 못하는 테스트는
// 없는 것보다 나쁘다. 그래서 여기로 옮겼다.

import { expect, test } from '@playwright/test';
import { STORAGE_STATE } from './global-setup.js';

// 로그인 세션을 실어야 한다 — 빠뜨리면 테스트가 로그인 화면에서 조용히 실패한다(실측)
test.use({ storageState: STORAGE_STATE, locale: 'ko-KR' });

test('다른 스펙으로 옮기면 본문이 그 문서 것으로 바뀐다', async ({ page }) => {
  await page.goto('/p/clemvion/specs/SPC-CWC-007');
  const body = page.getByTestId('editor-content');
  await expect(body).toContainText('위젯', { timeout: 15000 });
  const first = (await body.textContent()) ?? '';

  // 사이드바 트리로 이동 — 새로고침이 아니라 **SPA 내비게이션**이어야 한다
  await page.getByTestId('spec-tree').first().getByText('세션 복원 API').first().click();
  await expect(page).toHaveURL(/SPC-CWC-012/);

  // 제목만 바뀌고 본문이 앞 문서로 남는 것이 이 결함이었다
  await expect(body).not.toHaveText(first, { timeout: 15000 });
  await expect(body).toContainText('세션 복원');
});

// 레일 탭 다섯(관계·요구사항·버전·첨부·코멘트)은 17rem 레일보다 넓다 — 그 자체는 정상이고,
// 문제는 **무엇이 밀리느냐**였다: 세로만 흐르게 하려던 `overflow-y-auto` 가 CSS 규칙상
// 가로도 `auto` 로 만들어(한 축이 visible 이 아니면 다른 축도 auto 다) 레일 전체가 가로
// 스크롤 상자가 됐고, 바닥의 막대를 밀면 탭 줄과 목록이 **함께** 옆으로 갔다(사람 보고
// 2026-09-08). 이 판정은 실제 폭이 있어야 성립한다 — jsdom 은 scrollWidth 를 재지 않아
// 클래스 이름밖에 못 본다(이 파일 머리의 이유와 같다).
test('레일이 좁아도 옆으로 미는 것은 탭 줄뿐이고, 마지막 탭에 닿는다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/p/clemvion/specs/SPC-CWC-007');
  const tabs = page.getByTestId('rail-tabs');
  await expect(tabs).toBeVisible({ timeout: 15000 });

  const overflow = await tabs.evaluate((el) => ({
    tabs: el.scrollWidth - el.clientWidth,
    rail: ((r) => (r === null ? -1 : r.scrollWidth - r.clientWidth))(el.closest('aside')),
  }));
  // 넘치지 않으면 이 테스트가 검사할 것이 없다 — 전제부터 확인한다(시드 실측 37px)
  expect(overflow.tabs).toBeGreaterThan(0);
  // 레일은 옆으로 밀리지 않는다: 목록이 탭을 따라 움직이면 고정된 탭 줄이 아니다
  expect(overflow.rail).toBeLessThanOrEqual(1);

  // 그리고 밀면 끝에 닿아야 한다 — 스크롤 상자인데 마지막 탭이 잘려 있으면 고친 것이 아니다
  await tabs.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  const last = page.getByTestId('rail-tab-comments');
  const [box, strip] = [await last.boundingBox(), await tabs.boundingBox()];
  expect(box).not.toBeNull();
  expect(strip).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(strip!.x - 1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(strip!.x + strip!.width + 1);
});
