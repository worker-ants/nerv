// 위임 명세 4요소 폼 — FR-05 · screens.md §2.5 (REQ-WEB-016)
//
// **네 요소가 다 차야 ready 로 간다.** 서버가 최종 판정하지만(그리고 DB CHECK 가 마지막으로
// 막지만), 폼이 먼저 막는 이유는 다르다: 거부당하고 나서 무엇이 빠졌는지 찾는 것과,
// 채우기 전에 무엇을 채워야 하는지 아는 것은 다른 경험이다.
//
// 4요소의 의미(spec-workflow §4.1): 목표 · 산출물 형식 · 도구·출처 · 경계.
// "경계"가 빠진 지시가 clemvion 에서 가장 비싼 실수였다 — 에이전트가 어디까지 건드려도 되는지
// 모르면 리뷰가 그 판단을 대신하게 되고, 그때는 이미 코드가 쓰인 뒤다.

import { useT } from '../../lib/i18n.js';
import { useApiError } from '../../lib/api-errors.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { apiFetch } from '../../lib/api.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import { useTask } from '../../lib/queries.js';
import type { MessageKey, Translator } from '@nerv/schema';
import { Button, Field, Input, Select, Textarea } from '../../components/ui/primitives.js';

/** 4요소는 공백만으로 채워질 수 없다 — 형식적 충족을 막는 최소선이다. */
export const delegationSchema = z.object({
  // 메시지 자리에 **키**를 담는다 — 이 스키마는 모듈 로드 시점에 만들어지고
  // 그때는 사용자의 로케일을 모른다. 문장은 아래 fieldError() 가 만든다.
  title: z.string().min(1, 'task.form.err.title'),
  goal_md: z.string().trim().min(1, 'task.form.err.goal'),
  output_format_md: z.string().trim().min(1, 'task.form.err.output'),
  tools_sources_md: z.string().trim().min(1, 'task.form.err.tools'),
  boundaries_md: z.string().trim().min(1, 'task.form.err.boundaries'),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']),
});

export type DelegationInput = z.infer<typeof delegationSchema>;

export interface DelegationFormProps {
  projectSlug: string;
  taskKey: string | null;
  onDone: () => void;
}

export function DelegationForm({
  projectSlug,
  taskKey,
  onDone,
}: DelegationFormProps): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();
  const existing = useTask(projectSlug, taskKey ?? '');

  // exactOptionalPropertyTypes 아래에서는 `values: undefined` 를 넘길 수 없다 —
  // 조건부 스프레드로 키 자체를 없앤다.
  const loaded =
    taskKey === null || existing.data === undefined
      ? null
      : {
          title: String(existing.data['title'] ?? ''),
          goal_md: String(existing.data['goal_md'] ?? ''),
          output_format_md: String(existing.data['output_format_md'] ?? ''),
          tools_sources_md: String(existing.data['tools_sources_md'] ?? ''),
          boundaries_md: String(existing.data['boundaries_md'] ?? ''),
          priority: (existing.data['priority'] as DelegationInput['priority']) ?? 'P2',
        };

  const form = useForm<DelegationInput>({
    resolver: zodResolver(delegationSchema),
    defaultValues: {
      title: '',
      goal_md: '',
      output_format_md: '',
      tools_sources_md: '',
      boundaries_md: '',
      priority: 'P2',
    },
    ...(loaded === null ? {} : { values: loaded }),
  });

  const save = useMutation({
    mutationFn: async (input: DelegationInput) => {
      if (taskKey === null) {
        return apiFetch<Record<string, unknown>>(`/projects/${projectSlug}/tasks`, {
          method: 'POST',
          body: input,
        });
      }
      return apiFetch<Record<string, unknown>>(`/projects/${projectSlug}/tasks/${taskKey}`, {
        method: 'PATCH',
        body: input,
      });
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectTasks(projectSlug) });
      // 승격 여부를 알려준다 — 폼을 채운 사람이 알고 싶은 것은 저장 여부가 아니라 그것이다.
      pushToast({
        tone: 'ok',
        message:
          result['status'] === 'ready' ? t('task.form.promoted') : t('task.form.saved_backlog'),
      });
      onDone();
    },
    onError: onApiError,
  });

  return (
    <form
      data-testid="delegation-form"
      onSubmit={(e) => void form.handleSubmit((input) => save.mutate(input as DelegationInput))(e)}
      className="flex flex-col gap-3 rounded-nerv border border-border bg-bg-elev p-4"
    >
      <h2 className="text-sm font-semibold">
        {taskKey === null ? t('task.form.new') : t('task.form.edit', { key: taskKey })}
      </h2>
      {/* 4요소가 왜 필수인지 폼이 먼저 말한다 — 저장을 눌러야 알게 되면 늦다 */}
      <p className="-mt-2 text-xs text-text-mute">
        {t('task.form.lead_pre')} <code className="font-mono">ready</code>
        {t('task.form.lead_post')}
      </p>
      <Field
        label={t('task.form.title')}
        error={fieldError(t, form.formState.errors.title?.message)}
      >
        <Input {...form.register('title')} />
      </Field>
      <Field
        label={t('task.brief.goal')}
        error={fieldError(t, form.formState.errors.goal_md?.message)}
      >
        <Textarea {...form.register('goal_md')} rows={2} />
      </Field>
      <Field
        label={t('task.brief.output')}
        error={fieldError(t, form.formState.errors.output_format_md?.message)}
      >
        <Input {...form.register('output_format_md')} />
      </Field>
      <Field
        label={t('task.brief.tools')}
        error={fieldError(t, form.formState.errors.tools_sources_md?.message)}
      >
        <Textarea {...form.register('tools_sources_md')} rows={2} />
      </Field>
      <Field
        label={t('task.brief.boundaries')}
        error={fieldError(t, form.formState.errors.boundaries_md?.message)}
      >
        <Textarea {...form.register('boundaries_md')} rows={2} />
      </Field>
      <div className="flex items-center gap-2 border-t border-border pt-3">
        <Select {...form.register('priority')} aria-label={t('task.form.priority')}>
          {['P0', 'P1', 'P2', 'P3'].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {t('common.save')}
        </Button>
        <Button onClick={onDone}>{t('common.cancel')}</Button>
      </div>
    </form>
  );
}

/**
 * zod 가 담아 둔 키를 문장으로. 키가 아닌 문자열(라이브러리 기본 메시지)이 오면 그대로 보인다 —
 * 번역이 없다고 오류를 감추면 사용자는 왜 저장이 안 되는지 모른다.
 */
function fieldError(t: Translator, message: string | undefined): string | undefined {
  if (message === undefined) return undefined;
  return message.startsWith('task.form.err.')
    ? t(message as MessageKey & `task.form.err.${string}`)
    : message;
}
