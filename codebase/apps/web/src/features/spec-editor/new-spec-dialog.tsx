// 새 스펙 만들기 — 웹에서 문서를 **시작하는** 유일한 길 (screens.md §2.4 · REQ-WEB-043)
//
// 이 화면이 없는 동안 웹은 스펙을 **읽기만** 할 수 있었다(실측 2026-09-03: 스펙 158개가
// 보이는 목록에 생성 진입점이 하나도 없었고, 저장소 전체에서 `POST …/specs` 를 부르는
// 웹 코드가 0건이었다). 서버 표면은 처음부터 있었으므로 빠져 있던 것은 문 하나다.
//
// 그것이 P7(비개발자 참여)의 첫 걸음이다 — 터미널을 열지 않는 기획자에게 "스펙을 쓴다"는
// 여기서 시작하고, 여기가 없으면 그 사람에게 이 제품은 읽기 전용이다.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { useT } from '../../lib/i18n.js';
import { useRealtime } from '../../lib/realtime.js';
import { Button, Field, Input } from '../../components/ui/primitives.js';

/** 만들 수 있는 종류 — 어휘의 정본은 서버의 `spec_type` 이고 여기서는 고르게만 한다. */
const TYPES = ['feature', 'design', 'convention', 'adr', 'area'] as const;

export function NewSpecDialog({
  projectSlug,
  onClose,
}: {
  projectSlug: string;
  onClose: () => void;
}): React.JSX.Element {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const [key, setKey] = useState('');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<string>('feature');

  // **Esc 로 닫힌다.** 같은 저장소의 메타 대화상자가 이것을 빠뜨려 마우스 없이는 빠져나올
  // 수 없었다(실측 2026-09-03) — 새로 만드는 문에서 같은 함정을 되풀이하지 않는다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const create = useMutation({
    mutationFn: () =>
      apiFetch<Record<string, unknown>>(`/projects/${projectSlug}/specs`, {
        method: 'POST',
        body: {
          key: key.trim(),
          title: title.trim(),
          type,
          // 본문은 제목 한 줄로 시작한다 — 빈 본문으로 만들면 편집기가 무엇을 이어 쓸지
          // 알 수 없고, 사람은 첫 화면에서 빈 종이를 본다.
          body_markdown: `# ${title.trim()}\n\n`,
        },
      }),
    onSuccess: (result) => {
      // 트리는 projectId 축이라 여기서는 넓게 무효화한다 — 새 노드가 즉시 보여야 한다
      void queryClient.invalidateQueries();
      pushToast({ tone: 'ok', message: t('specs.new.created') });
      onClose();
      void navigate({
        to: '/p/$proj/specs/$spec',
        params: { proj: projectSlug, spec: String(result['key'] ?? key.trim()) },
      });
    },
    onError: (error: Error) => pushToast({ tone: 'warn', message: error.message }),
  });

  const ready = key.trim() !== '' && title.trim() !== '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('specs.new.dialog')}
      data-testid="new-spec-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-text/20 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <form
        className="w-full max-w-md rounded-nerv-lg border border-border bg-bg-elev p-5 shadow-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !create.isPending) create.mutate();
        }}
      >
        <h2 className="mb-1 text-lg font-semibold tracking-tight">{t('specs.new.dialog')}</h2>
        <p className="mb-3 text-xs text-text-mute">{t('specs.new.lead')}</p>

        <div className="mb-4 flex flex-col gap-3">
          <Field label={t('specs.new.key_field')} hint={t('specs.new.key_hint')}>
            <Input
              value={key}
              autoFocus
              data-testid="new-spec-key"
              onChange={(e) => setKey(e.target.value)}
              placeholder="SPC-…"
              className="font-mono"
            />
          </Field>
          <Field label={t('spec.meta.title_field')}>
            <Input
              value={title}
              data-testid="new-spec-title"
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label={t('specs.new.type_field')}>
            <select
              value={type}
              data-testid="new-spec-type"
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-nerv-sm border border-border bg-bg px-2 py-1.5 text-sm"
            >
              {TYPES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            data-testid="new-spec-submit"
            disabled={!ready || create.isPending}
          >
            {t('common.create')}
          </Button>
        </div>
      </form>
    </div>
  );
}
