// 기준선 선택기와 동결 다이얼로그 (REQ-WEB-135·136 · screens.md §2.4)
//
// **이 화면이 없어서 기준선이 0개였다**(실측 2026-09-04). 테이블도 엔드포인트 넷도
// 2026-08 부터 있었고 L2 도 있었는데, 사람이 만들 진입점이 웹에 없었다. 서버에 기능이
// 있다는 것과 그 기능이 쓰인다는 것은 다른 일이다 — 이 저장소가 스펙 생성 진입점에서
// 이미 같은 것을 겪었다(4.5 v0.63: 웹에서 `POST …/specs` 를 부르는 코드가 0건이었다).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { rows as asRows } from '../../lib/queries.js';
import { useT } from '../../lib/i18n.js';
import { Button, Input } from '../../components/ui/primitives.js';

export interface Baseline {
  id: string;
  name: string;
  note_md: string | null;
  item_count: number;
  created_at: string;
}

export function useBaselines(projectSlug: string): ReturnType<typeof useQuery<Baseline[]>> {
  return useQuery<Baseline[]>({
    queryKey: ['project', projectSlug, 'baselines'],
    queryFn: () => apiFetch<Baseline[]>(`/projects/${projectSlug}/baselines`),
  });
}

/**
 * 선택기 — 고른 값은 **주소에 남는다**(뷰 상태 규약, ui-wireframes §1.4).
 *
 * 링크로 건네면 상대도 같은 기준으로 본다. 그것이 기준선의 요점이다 — "내가 본 그 세트"를
 * 말로 설명하지 않아도 되는 것.
 */
export function BaselineSelect({
  projectSlug,
  value,
  onChange,
}: {
  projectSlug: string;
  value: string | null;
  onChange: (name: string | null) => void;
}): React.JSX.Element | null {
  const t = useT();
  const baselines = useBaselines(projectSlug);
  // **배열이 아닌 응답에 화면이 죽지 않는다.** 목록 하나가 이상해서 스펙 화면 전체가
  // 빈 화면이 되는 것은 어떤 경우에도 맞지 않는다 — 저장소의 `rows()` 규율이 그것이다.
  const rows = asRows(baselines.data);

  // 하나도 없으면 선택기를 그리지 않는다 — 고를 것이 없는 드롭다운은 자리만 먹는다.
  // [동결] 버튼은 목록 툴바에 따로 있으므로 그래도 보인다 — 첫 개를 만들 길이 있어야 한다.
  if (rows.length === 0) return null;

  return (
    <label
      className="flex items-center gap-1.5 text-xs whitespace-nowrap text-text-mute"
      title={t('specs.baseline_hint')}
    >
      {t('specs.baseline')}
      <select
        data-testid="baseline-select"
        className="rounded-nerv border border-border bg-surface px-1.5 py-1 text-xs"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      >
        <option value="">{t('specs.baseline_current')}</option>
        {rows.map((b) => (
          <option key={String(b['id'])} value={String(b['name'])}>
            {String(b['name'])} ({Number(b['item_count'] ?? 0)})
          </option>
        ))}
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

  // Esc 로 닫힌다 — 다이얼로그의 기본 기대다(새 스펙 다이얼로그와 같은 규율)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={t('specs.freeze')}
        data-testid="freeze-dialog"
        className="w-full max-w-md rounded-nerv border border-border bg-surface p-4"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
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
          <p className="mb-2 text-xs text-status-warn">{(freeze.error as Error).message}</p>
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
      </div>
    </div>
  );
}
