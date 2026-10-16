// 구현 현황 드릴다운 — screens.md §2.3a · REQ-WEB-315~317 · E15-S01 · E15-S02 (2026-10-15)
//
// **이 판정이 여기 있는 이유.** 화면의 규칙(거르기 · 펼치기 · 잠금)은 L1 이 태운다(`coverage-drilldown.spec.tsx`). 여기서
// 보는 것은 그 규칙이 **실제 서버가 준 값 위에서** 이어지는가다 — 커버리지의 영역 · 문서 수, 요구사항 행의 표시, 상세의
// 발견 · 리뷰 라운드, 최신 승인본으로 만든 파생 폼의 주소까지가 한 줄에 걸려 있고, 하나만 빠져도 드릴다운은 중간에 끊긴다.
// 시드의 REQ-CWC-031 은 작업 · 증적 · 발견 둘 · 리뷰 라운드 둘을 모두 갖고 서명된 test 증적이 없다 — 끝까지 내려갈 재료다.

import { expect, test } from '@playwright/test';
import { ADMIN_STORAGE_STATE, STORAGE_STATE } from './global-setup.js';

test.describe('시드 요구사항으로 끝까지 내려간다', () => {
  test.use({ storageState: STORAGE_STATE, locale: 'ko-KR' });

  test('개요의 구현 현황에서 영역 → 문서 → 요구사항으로 내려가 검증 작업 폼까지 간다', async ({
    page,
  }) => {
    await page.goto('/p/clemvion');
    await page.getByTestId('coverage-drilldown').click();
    await expect(page).toHaveURL(/\/p\/clemvion\/coverage$/);

    const area = page.getByTestId('coverage-area-row').filter({ hasText: '채널 · 웹챗' });
    await expect(area).toBeVisible({ timeout: 15000 });
    await area.getByTestId('coverage-area-row-open').click();
    await expect(page).toHaveURL(/area=channel-web-chat/);

    const spec = page.getByTestId('coverage-spec-row').filter({ hasText: '웹챗 위젯 임베드 v2' });
    await spec.getByTestId('coverage-spec-row-open').click();
    await expect(page).toHaveURL(/spec=SPC-CWC-007/);

    const row = page.locator('[data-testid="coverage-req"][data-ref="REQ-CWC-031"]');
    await row.getByTestId('coverage-req-toggle').click();
    await expect(page).toHaveURL(/req=REQ-CWC-031/);
    const detail = row.getByTestId('coverage-req-detail');
    await expect(detail.getByTestId('coverage-req-task').first()).toContainText('CLV-T-1KTDCK', {
      timeout: 15000,
    });
    // 그 요구사항을 가리키는 발견 — 리뷰 센터의 그 지적으로 간다
    await expect(detail.getByTestId('coverage-req-finding').first()).toContainText('세션 토큰');
    // 그 작업이 받은 리뷰 라운드
    await expect(detail.getByTestId('coverage-req-review').first()).toContainText(
      'feature/widget-v2',
    );

    // 드릴다운의 끝은 행동이다 — 서명된 test 증적이 없으니 검증 작업을 만든다
    await detail.getByTestId('make-verification').click();
    await expect(page).toHaveURL(/\/p\/clemvion\/tasks\?.*requirement=/);
    await expect(page.getByTestId('delegation-form')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('source-locked')).toContainText('SPC-CWC-007');
  });
});

test.describe('임포트 값의 출처', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE, locale: 'ko-KR' });

  test('작업이 없는 임포트 요구사항은 값을 그대로 두고 「출처: 임포트」로 표시된다', async ({
    page,
  }) => {
    // 임포트 표면(EP-IMP-02)으로 문서 하나를 넣는다 — 문서가 `implemented` 라고 적은 요구사항 하나
    const stamp = Date.now().toString(36).toUpperCase();
    const key = `SPC-E2E-${stamp}`;
    const ref = `REQ-E2E${stamp}-001`;
    await page.goto('/p/clemvion');
    const status = await page.evaluate(
      async ({ key, ref }) => {
        const res = await fetch('/api/v1/projects/clemvion/import/specs', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            profile: 'clemvion',
            kind: 'document',
            items: [
              {
                source_path: `spec/${key}.md`,
                key,
                parent_key: null,
                type: 'feature',
                title: `임포트 확인 ${key}`,
                body_md: `# ${key}\n\n- ${ref} WHEN 조건이면 THE SYSTEM SHALL 동작한다\n`,
                doc_status: 'approved',
                requirements: [
                  {
                    ref,
                    text: 'WHEN 조건이면 THE SYSTEM SHALL 동작한다',
                    priority: 'must',
                    impl_status: 'implemented',
                  },
                ],
                evidence: [],
              },
            ],
          }),
        });
        return res.status;
      },
      { key, ref },
    );
    expect(status).toBe(201);

    await page.goto(`/p/clemvion/coverage?spec=${key}&filter=import`);
    const row = page.locator(`[data-testid="coverage-req"][data-ref="${ref}"]`);
    await expect(row).toBeVisible({ timeout: 15000 });
    // 임포트 값은 덮지 않았다 — 구현됨 그대로이고 출처가 표시된다
    await expect(row).toContainText('구현됨');
    await expect(row.getByTestId('import-source')).toHaveText('출처: 임포트');
    // 2-8 의 두 수가 함께 나온다
    await expect(page.getByTestId('coverage-derived')).toContainText('임포트 값');
  });
});
