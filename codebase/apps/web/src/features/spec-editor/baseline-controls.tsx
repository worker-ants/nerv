// 버전 기준 선택기와 기준선 동결 다이얼로그 (REQ-WEB-135·136·248 · screens.md §2.4)
//
// **이 화면이 없어서 기준선이 0개였다**(실측 2026-09-04). 테이블도 엔드포인트 넷도
// 2026-08 부터 있었고 L2 도 있었는데, 사람이 만들 진입점이 웹에 없었다. 서버에 기능이
// 있다는 것과 그 기능이 쓰인다는 것은 다른 일이다 — 이 저장소가 스펙 생성 진입점에서
// 이미 같은 것을 겪었다(4.5 v0.63: 웹에서 `POST …/specs` 를 부르는 코드가 0건이었다).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { describeApiError } from '../../lib/api-errors.js';
import { rows as asRows } from '../../lib/queries.js';
import { useT } from '../../lib/i18n.js';
import { Button, Input } from '../../components/ui/primitives.js';
import { Modal } from '../../components/ui/modal.js';
import { viewBasisFromKey, viewBasisKey, type ViewBasis } from '../../lib/view-basis.js';

export interface Baseline {
  id: string;
  name: string;
  note_md: string | null;
  item_count: number;
  created_at: string;
}

export function useBaselines(projectSlug: string): ReturnType<typeof useQuery<Baseline[]>> {
  // 유한 목록이라 `{items, total}` 봉투로 온다(REQ-API-155) — 훅이 풀어 준다
  return useQuery({
    queryKey: ['project', projectSlug, 'baselines'],
    queryFn: () =>
      apiFetch<{ items: Baseline[]; total: number }>(`/projects/${projectSlug}/baselines`),
    select: (data) => data.items,
  });
}

/**
 * **버전 기준 선택기**(2026-09-27 사람 결정 V1 · REQ-WEB-248) — 승인본(기본) · 최신 · 기준선들.
 *
 * 기준선 선택기였던 것을 넓혔다. 목록은 문서마다 최신 승인본만 읽어서 승인본 위의 초안은 어디에도
 * 없었고, 그것을 보려면 문서를 하나씩 열어야 했다. 셋은 모두 "어느 버전을 읽는가" 에 대한 답이라
 * 한 선택기에서 고른다(서버도 함께 받지 않는다 — REQ-API-196). 고른 값은 **주소에 남는다**(뷰 상태
 * 규약, ui-wireframes §1.4) — 링크로 건네면 상대도 같은 기준으로 본다.
 *
 * 기준선이 하나도 없어도 그린다. 최신은 기준선과 상관없이 늘 고를 수 있다.
 */
export function ViewBasisSelect({
  projectSlug,
  value,
  onChange,
}: {
  projectSlug: string;
  value: ViewBasis;
  onChange: (next: ViewBasis) => void;
}): React.JSX.Element {
  const t = useT();
  const baselines = useBaselines(projectSlug);
  // **배열이 아닌 응답에 화면이 죽지 않는다.** 목록 하나가 이상해서 스펙 화면 전체가
  // 빈 화면이 되는 것은 어떤 경우에도 맞지 않는다 — 저장소의 `rows()` 규율이 그것이다.
  const rows = asRows(baselines.data);

  return (
    <label
      className="flex items-center gap-1.5 text-xs whitespace-nowrap text-text-mute"
      title={t('specs.basis_hint')}
    >
      {t('specs.basis')}
      <select
        data-testid="basis-select"
        className="rounded-nerv border border-border bg-bg-elev px-1.5 py-1 text-xs"
        value={viewBasisKey(value)}
        onChange={(e) => onChange(viewBasisFromKey(e.target.value))}
      >
        <option value="">{t('specs.basis_approved')}</option>
        <option value={viewBasisKey({ latest: true })}>{t('specs.basis_latest')}</option>
        {rows.length > 0 && (
          <optgroup label={t('specs.basis_baselines')}>
            {rows.map((b) => (
              <option key={String(b['id'])} value={viewBasisKey({ baseline: String(b['name']) })}>
                {String(b['name'])} ({Number(b['item_count'] ?? 0)})
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  );
}

/**
 * 동결 — **사람 전용**이고 planner·admin 만 누른다(EP-SPEC-12).
 *
 * 항목을 고르지 않으면 서버가 "스펙별 최신 approved 전체"를 담는다. 큐레이션은 나중 일이고,
 * 지금 필요한 것은 **한 번이라도 동결이 일어나는 것**이다.
 */
export function FreezeDialog({
  projectSlug,
  onClose,
}: {
  projectSlug: string;
  onClose: () => void;
}): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [note, setNote] = useState('');

  // Esc·Tab 가둠·포커스 복귀는 공용 모달이 한다(REQ-WEB-224) — 여기서 따로 창 전체의 Esc 를 듣던
  // 동안 aria-modal 이 없어 보조기기에는 모달이 아니었다

  const freeze = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${projectSlug}/baselines`, {
        method: 'POST',
        body: { name: name.trim(), note_md: note.trim() === '' ? null : note.trim() },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project', projectSlug, 'baselines'] });
      onClose();
    },
    // 실패는 다이얼로그 안에서 말한다 — 기본 처리기(토스트)가 같은 것을 한 번 더 말하지 않게
    meta: { inlineError: true },
  });

  return (
    <Modal label={t('specs.freeze')} onClose={onClose} testId="freeze-dialog">
      <h2 className="mb-1 text-sm font-semibold">{t('specs.freeze')}</h2>
      {/* 무엇이 담기는지 **누르기 전에** 말한다 — 불변이라 되돌릴 수 없다 */}
      <p className="mb-3 text-xs text-text-mute">{t('specs.freeze_hint')}</p>

      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('specs.baseline_name_placeholder')}
        aria-label={t('specs.baseline_name')}
        className="mb-2 w-full"
      />
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('specs.baseline_note_placeholder')}
        aria-label={t('specs.baseline_note')}
        className="mb-3 w-full"
      />

      {freeze.isError && (
        <p role="alert" className="mb-2 text-xs text-status-danger">
          {describeApiError(t, freeze.error).message}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          data-testid="freeze-submit"
          disabled={name.trim() === '' || freeze.isPending}
          onClick={() => freeze.mutate()}
        >
          {t('specs.freeze_submit')}
        </Button>
      </div>
    </Modal>
  );
}
