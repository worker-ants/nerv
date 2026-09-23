// 받은 요청의 일괄 승인 — screens.md §2.7 · REQ-WEB-181~183 · REQ-API-162~164
//
// **이 판정이 여기 있는 이유.** 선택 집합과 확인 목록의 규칙은 L1 이 태우고, 저위험 판정과
// 항목별 결과는 L2 가 태운다(`approval.spec.ts`). 여기서만 확인할 수 있는 것은 그 셋이
// **한 화면에서 한 줄로 이어지는가**다 — 서버가 매긴 `can_bulk_approve` 가 체크박스와 확인
// 목록을 실제로 가르고, 눌렀을 때 그 목록대로만 결정되는가.
//
// **2026-09-24 까지 이 판정을 쓸 수 없었다.** 시드에 대기 중인 결재가 한 건도 없어서
// (`approval` 한 행은 이미 결정이 끝난 면제였다) 받은 요청은 L3 에서도 디자인 확인용
// 스크린샷에서도 **늘 빈 상태**로만 찍혔다 — 일괄 승인·거절은 들어온 날부터 이 길을 한 번도
// 지나가지 못했다. 시드가 저위험 셋과 T3 하나를 심고 나서야 길이 생겼다(database.md §4).
//
// **이 스위트는 시드를 쓰고 — 고친다.** 승인한 둘은 목록에서 사라진다. `test:e2e` 는 매 실행
// 앞서 스택을 기동 직후 상태로 되돌리므로(시드 재적재 · `scripts/e2e-stack.mjs`) 연속 실행이
// 서로를 밟지 않는다. 저위험을 **셋** 심은 것도 그래서다: 둘을 쓰고도 하나가 남아, 뒤에 도는
// `shots.spec.ts` 의 받은 요청 그림에 체크박스가 선 카드가 남는다.

import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { STORAGE_STATE } from './global-setup.js';

// 시드의 신원은 지민(planner + developer)이다 — 결재권이 있고, 이 넷 중 어느 것의 요청자도
// 작성자도 아니라 `can_approve` 가 참이다(지시자≠승인자 세 축 · database.md §4)
test.use({ storageState: STORAGE_STATE, locale: 'ko-KR' });

// 순서가 뜻을 만든다 — 둘째 테스트가 첫째가 센 카드 둘을 가져간다
test.describe.configure({ mode: 'serial' });

/** 일괄로 지나가는 저위험 둘 — 확인 목록이 이 둘만 담아야 한다 */
const BULK_A = 'SPC-SRC-008';
const BULK_B = 'SPC-ACC-002';
/** 슬롯이 둘이라 일괄에서 빠지는 T3 */
const T3 = 'SPC-ACC-007';

/** 키로 카드를 집는다 — 목록 순서는 대기 시간이 정하므로 자리로 집지 않는다 */
function card(page: Page, key: string): Locator {
  return page.getByTestId('approval-card').filter({ hasText: key });
}

test('받은 요청에 섞인 카드가 선다 — 저위험 셋 · T3 하나 · 질문 하나', async ({ page }) => {
  await page.goto('/inbox');
  await expect(page.getByTestId('approval-card').first()).toBeVisible({ timeout: 15000 });

  // 승인 카드 넷과 질문 하나. 질문은 `approval` 행이 아니라 같은 목록에 서는 다른 유형이다
  await expect(page.locator('[data-testid="approval-card"][data-kind="approval"]')).toHaveCount(4);
  await expect(page.locator('[data-testid="approval-card"][data-kind="question"]')).toHaveCount(1);

  // **잠긴 단추가 아니다.** 시드의 요청자나 작성자가 지민이면 카드는 있는데 아무것도 누를 수
  // 없고, 그건 빈 화면보다 나쁘다 — 그 상태로 굳지 않게 여기서 못 박는다
  await expect(card(page, BULK_A).getByTestId('approve')).toBeEnabled();
  await expect(card(page, BULK_A).getByTestId('self-requested-note')).toHaveCount(0);

  // T3 는 **몇 명 중 몇 명인지** 말한다(REQ-WEB-146) — 첫 승인자가 자기를 마지막 결재라고
  // 믿지 않게 하는 표시다. 저위험 카드에는 없다(정족수가 1이라 말할 것이 없다)
  await expect(card(page, T3).getByTestId('quorum')).toHaveText('0/2 승인');
  await expect(card(page, BULK_A).getByTestId('quorum')).toHaveCount(0);

  // 질문에는 체크박스가 없다 — 답은 건마다 다르고 일괄의 대상이 아니다
  await expect(page.getByTestId('bulk-select')).toHaveCount(4);
  await expect(
    page.locator('[data-testid="approval-card"][data-kind="question"]').getByTestId('bulk-select'),
  ).toHaveCount(0);
});

test('체크박스로 고른 둘을 한 번에 승인한다 — T3 는 확인 목록에서 빠진다 (REQ-WEB-181~183)', async ({
  page,
}) => {
  await page.goto('/inbox');
  await expect(page.getByTestId('approval-card').first()).toBeVisible({ timeout: 15000 });

  // 저위험 둘을 고른다 — 선택 바는 고른 것이 있을 때만 선다
  await card(page, BULK_A).getByTestId('bulk-select').check();
  await card(page, BULK_B).getByTestId('bulk-select').check();
  await expect(page.getByTestId('bulk-bar')).toBeVisible();
  await expect(page.getByTestId('bulk-approvable')).toHaveText('승인 가능 2건');

  // **T3 도 고른다.** 골라 봐야 빠지는 것이 보인다 — 선택 가능 집합은 승인 가능 집합보다
  // 넓고(거절은 요청자도 할 수 있다) 그 차이를 선택 바가 수로 말해야 한다
  await card(page, T3).getByTestId('bulk-select').check();
  await expect(page.getByTestId('bulk-bar')).toContainText('3건 선택');
  await expect(page.getByTestId('bulk-approvable')).toHaveText('승인 가능 2건');

  await page.getByTestId('bulk-approve').click();

  // **무엇을 승인하는지 나열한다** — 본문을 열지 않고 결정하는 조작이라 이 목록이 남은
  // 유일한 "무엇을 승인하는가" 다(spec-workflow §6.4)
  await expect(page.getByTestId('bulk-confirm')).toContainText('2건을 승인합니다');
  await expect(page.getByTestId('bulk-list').locator('li')).toHaveCount(2);
  await expect(page.getByTestId('bulk-list')).toContainText(BULK_A);
  await expect(page.getByTestId('bulk-list')).toContainText(BULK_B);
  await expect(page.getByTestId('bulk-list')).not.toContainText(T3);
  // 빠진 건이 있으면 **그 사실도 누르기 전에** 말한다
  await expect(page.getByTestId('bulk-skipped')).toHaveText('일괄 승인할 수 없는 1건은 빠집니다');

  await page.getByTestId('bulk-submit').click();

  // 전부 지나갔으면 초록이다(`partial` 은 경고색이고 남은 건수를 말한다)
  const toast = page.getByTestId('toast').filter({ hasText: '처리했습니다' });
  await expect(toast).toBeVisible({ timeout: 15000 });
  await expect(toast).toHaveAttribute('data-tone', 'ok');
  await expect(toast).toContainText('2건');

  // 승인된 둘은 목록에서 빠지고 — 문서가 approved 로 옮겨 갔다 — T3 와 남은 저위험 하나는
  // 그대로다. 골라 놓고 지나가지 못한 T3 가 함께 사라지면 사람은 그것도 처리했다고 읽는다
  await expect(card(page, BULK_A)).toHaveCount(0);
  await expect(card(page, BULK_B)).toHaveCount(0);
  await expect(card(page, T3)).toHaveCount(1);
  await expect(page.locator('[data-testid="approval-card"][data-kind="approval"]')).toHaveCount(2);

  // 고른 것이 전부 지나갔으니 선택도 비었다 — 실패한 것만 선택에 남는다(REQ-WEB-183)
  await expect(page.getByTestId('bulk-bar')).toHaveCount(0);
  await expect(page.getByTestId('bulk-failure')).toHaveCount(0);
});
