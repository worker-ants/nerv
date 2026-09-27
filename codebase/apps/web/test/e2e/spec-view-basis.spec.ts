// 버전 기준 — 승인본 위의 다음 버전을 목록에서 찾아 연다 (2026-09-27 사람 결정 · REQ-WEB-248·249·251)
//
// 목록이 문서마다 최신 승인본만 읽던 동안, 승인된 문서 위에 올라온 초안은 목록 어디에도 없었다.
// **시드의 검토 중 버전에 기대지 않는다** — 받은 요청 시나리오가 먼저 그것을 승인하면 표시가 사라진다
// (로컬 첫 실행에서 실제로 그랬다). 승인본만 있는 문서 하나를 골라 그 위에 초안을 직접 만든다.

import { expect, test } from '@playwright/test';
import { STORAGE_STATE } from './global-setup.js';

test.use({ storageState: STORAGE_STATE, locale: 'ko-KR' });

interface TreeRow {
  key: string;
  doc_status: string | null;
  latest_version_no: number | null;
  approved_version_no: number | null;
}

test('승인본으로 읽어도 다음 버전이 보이고, 최신 기준으로 그 버전을 연다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/p/clemvion/specs');

  // 승인본만 있는 문서 하나에 초안을 만든다 — 화면과 같은 세션 쿠키로 부른다(planner)
  const { key, draftNo } = await page.evaluate(async () => {
    const base = '/api/v1/projects/clemvion/specs';
    const tree = (await (await fetch(`${base}/tree`)).json()) as TreeRow[];
    const target = tree
      .filter(
        (n) =>
          n.doc_status === 'approved' &&
          n.approved_version_no !== null &&
          n.latest_version_no === n.approved_version_no,
      )
      .at(-1);
    if (target === undefined) throw new Error('승인본만 있는 문서가 없다');
    const doc = (await (await fetch(`${base}/${target.key}`)).json()) as {
      body_md: string;
      content_hash: string;
    };
    const res = await fetch(`${base}/${target.key}/draft`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body_markdown: `${doc.body_md}\n\n## L3 에서 더한 절\n\n다음 버전의 초안이다.`,
        base_hash: doc.content_hash,
        change_summary: 'L3 — 승인본 위의 초안',
      }),
    });
    if (!res.ok) throw new Error(`초안 저장 실패 ${String(res.status)} ${await res.text()}`);
    const saved = (await res.json()) as { version_no: number };
    return { key: target.key, draftNo: saved.version_no };
  });
  const approvedNo = draftNo - 1;
  await page.reload();

  // 승인본으로 읽는 줄 끝에 "vN 초안" 표시가 있다
  const row = page.locator('li', { has: page.locator(`[data-tree-key="${key}"]`) }).first();
  await expect(row.getByTestId('tree-row-newer')).toHaveText(`v${String(draftNo)} 초안`);

  // "새 버전 진행 중" — 최신으로 읽으며 그런 문서들만 남긴다
  await page.getByTestId('spec-status-newer').click();
  await expect(page).toHaveURL(/basis=latest/);
  await expect(page).toHaveURL(/status=newer/);

  // 줄을 누르면 기준이 상세까지 이어지고, 가장 새 버전이 열린다
  await page.locator(`[data-tree-key="${key}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`/specs/${key}\\?.*basis=latest`));
  await expect(page.getByTestId('spec-version')).toHaveText(`v${String(draftNo)}`);
  await expect(page.getByTestId('spec-latest-basis')).toContainText(`v${String(approvedNo)}`);
});
