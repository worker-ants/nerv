// 위임 명세 4요소 폼 — FR-05 · screens.md §2.5 (REQ-WEB-016)
//
// **네 요소가 다 차야 ready 로 간다.** 서버가 최종 판정하지만(그리고 DB CHECK 가 마지막으로
// 막지만), 폼이 먼저 막는 이유는 다르다: 거부당하고 나서 무엇이 빠졌는지 찾는 것과,
// 채우기 전에 무엇을 채워야 하는지 아는 것은 다른 경험이다.
//
// 4요소의 의미(spec-workflow §4.1): 목표 · 산출물 형식 · 도구·출처 · 경계.
// "경계"가 빠진 지시가 clemvion 에서 가장 비싼 실수였다 — 에이전트가 어디까지 건드려도 되는지
// 모르면 리뷰가 그 판단을 대신하게 되고, 그때는 이미 코드가 쓰인 뒤다.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { apiFetch } from '../../lib/api.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import { useTask } from '../../lib/queries.js';
import { Button, Field, Input, Select, Textarea } from '../../components/ui/primitives.js';

/** 4요소는 공백만으로 채워질 수 없다 — 형식적 충족을 막는 최소선이다. */
export const delegationSchema = z.object({
  title: z.string().min(1, '제목이 필요합니다.'),
  goal_md: z.string().trim().min(1, '목표를 적어주세요.'),
  output_format_md: z.string().trim().min(1, '산출물 형식을 적어주세요(예: PR).'),
  tools_sources_md: z.string().trim().min(1, '쓸 도구·참고할 출처를 적어주세요.'),
  boundaries_md: z.string().trim().min(1, '건드리면 안 되는 범위를 적어주세요.'),
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
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
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
          result['status'] === 'ready'
            ? '위임 명세가 완결돼 ready 로 승격했습니다.'
            : '저장했습니다 — 아직 backlog 입니다.',
      });
      onDone();
    },
    onError: (error: Error) => pushToast({ tone: 'warn', message: error.message }),
  });

  return (
    <form
      data-testid="delegation-form"
      onSubmit={(e) => void form.handleSubmit((input) => save.mutate(input as DelegationInput))(e)}
      className="flex flex-col gap-3 rounded-nerv border border-border bg-bg-elev p-4"
    >
      <h2 className="text-sm font-semibold">
        {taskKey === null ? '새 작업' : `작업 수정 — ${taskKey}`}
      </h2>
      {/* 4요소가 왜 필수인지 폼이 먼저 말한다 — 저장을 눌러야 알게 되면 늦다 */}
      <p className="-mt-2 text-xs text-text-mute">
        ①~④ 가 모두 차야 <code className="font-mono">ready</code> 로 승격합니다. 비면 backlog 에
        남습니다.
      </p>
      <Field label="제목" error={form.formState.errors.title?.message}>
        <Input {...form.register('title')} />
      </Field>
      <Field label="① 목표" error={form.formState.errors.goal_md?.message}>
        <Textarea {...form.register('goal_md')} rows={2} />
      </Field>
      <Field label="② 산출물 형식" error={form.formState.errors.output_format_md?.message}>
        <Input {...form.register('output_format_md')} />
      </Field>
      <Field label="③ 도구·출처" error={form.formState.errors.tools_sources_md?.message}>
        <Textarea {...form.register('tools_sources_md')} rows={2} />
      </Field>
      <Field label="④ 경계" error={form.formState.errors.boundaries_md?.message}>
        <Textarea {...form.register('boundaries_md')} rows={2} />
      </Field>
      <div className="flex items-center gap-2 border-t border-border pt-3">
        <Select {...form.register('priority')} aria-label="우선순위">
          {['P0', 'P1', 'P2', 'P3'].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          저장
        </Button>
        <Button onClick={onDone}>취소</Button>
      </div>
    </form>
  );
}
