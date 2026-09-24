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
import { rows, useRequirements, useSpecTree, useSpecVersions, useTask } from '../../lib/queries.js';
import { useEffect, useRef, useState } from 'react';
import { isDelegationFilled } from '@nerv/schema';
import type { MessageKey, Translator } from '@nerv/schema';
import { Button, Field, Input, Select, Textarea } from '../../components/ui/primitives.js';
import type { ProjectId } from '../../lib/query-keys.js';

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
  /**
   * **출처는 가치 사슬의 첫 고리다**(2026-09-07 · REQ-WEB-147). 웹에서 만든 Task 는 이 두
   * 값을 실을 수 없어 요구사항에 이어지지 않았고(실데이터 487건 중 출처 없음 214건),
   * 그러면 근거 카드는 비고 구현 축은 그 작업을 세지 못한다. 선택이다 — 스펙 없는 "별도 건"
   * 을 남기는 길은 남겨 둔다(스킬이 그렇게 지시한다).
   */
  source_spec_version_id: z.string().nullish(),
  source_requirement_id: z.string().nullish(),
});

export type DelegationInput = z.infer<typeof delegationSchema>;

const BRIEF_FIELDS = ['goal_md', 'output_format_md', 'tools_sources_md', 'boundaries_md'] as const;
type BriefField = (typeof BRIEF_FIELDS)[number];
const BRIEF_LABEL = {
  goal_md: 'task.brief.goal',
  output_format_md: 'task.brief.output',
  tools_sources_md: 'task.brief.tools',
  boundaries_md: 'task.brief.boundaries',
} as const satisfies Record<BriefField, MessageKey>;

/**
 * 수정 폼의 검증 — **채워지지 않았던 칸은 비워 둘 수 있다**(2026-09-24 · REQ-WEB-202).
 *
 * 임포트 작업의 네 칸에는 자리표시자 `(임포트 — 원본에 위임 명세 없음)` 이 들어 있다. 그 문장을
 * 값으로 채워 폼을 열던 동안 두 가지가 틀렸다 — ① 한 칸을 빠뜨려도 "비어 있지 않다" 를 통과해
 * 저장됐고(서버는 그 칸을 여전히 빈 것으로 봐 backlog 에 남는데, 사람은 다 채웠다고 믿었다),
 * ② 자리표시자를 조금만 고쳐도(괄호 하나를 지워도) 더는 자리표시자가 아니라 **찬 칸**으로 세어져,
 * 뜻 없는 지시문으로 ready 에 오를 수 있었다. 이제 그런 칸은 **빈 칸으로 열고**, 비워 둔 채
 * 저장하면 **보내지 않는다** — 서버의 PATCH 는 오지 않은 칸을 그대로 둔다(EP-TASK-05). 원래
 * 내용이 있던 칸은 지금처럼 비울 수 없다. 새 작업은 네 칸이 모두 필수다(`delegationSchema`).
 */
function editSchema(optional: ReadonlySet<BriefField>): typeof delegationSchema {
  const loose = Object.fromEntries([...optional].map((field) => [field, z.string()]));
  return delegationSchema.extend(loose) as unknown as typeof delegationSchema;
}

export interface DelegationFormProps {
  projectSlug: string;
  /**
   * 프로젝트 축(`lib/queries.ts` 의 "프로젝트 축" 규약). 스펙 트리와 무효화가
   * 둘 다 이 값으로 잡히므로, 없으면 출처 피커는 부르지 않고 저장 뒤 보드도
   * 갱신되지 않는다 — slug 로 대신 잡지 않는다.
   */
  projectId: ProjectId | undefined;
  taskKey: string | null;
  onDone: () => void;
  /** S3 에서 "이 버전에서 파생" 으로 들어온 경우 — 피커 대신 고정 표기다 */
  initial?: { specKey: string; versionId: string; versionNo: number; requirementId?: string };
}

export function DelegationForm({
  projectSlug,
  projectId,
  taskKey,
  onDone,
  initial,
}: DelegationFormProps): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();
  const existing = useTask(projectSlug, taskKey ?? '');

  /** 저장된 값 — 없거나 문자열이 아니면 `null` */
  const stored = (field: BriefField): string | null => {
    const value = existing.data?.[field];
    return typeof value === 'string' ? value : null;
  };
  /** 수정에서 채워지지 않았던 칸(빈 칸 · NULL · 임포트 자리표시자) — 값이 아니라 빈 칸으로 연다 */
  const unfilled = new Set<BriefField>(
    taskKey === null || existing.data === undefined
      ? []
      : BRIEF_FIELDS.filter((field) => !isDelegationFilled(stored(field))),
  );
  const briefValue = (field: BriefField): string =>
    unfilled.has(field) ? '' : (stored(field) ?? '');
  /** 빈 칸의 안내 — 원본에 없던 것인지, 그냥 비어 있던 것인지 */
  const briefHint = (field: BriefField): string | undefined => {
    if (!unfilled.has(field)) return undefined;
    const value = stored(field);
    return t(value === null || value.trim() === '' ? 'task.brief.empty' : 'task.brief.placeholder');
  };

  // exactOptionalPropertyTypes 아래에서는 `values: undefined` 를 넘길 수 없다 —
  // 조건부 스프레드로 키 자체를 없앤다.
  const loaded =
    taskKey === null || existing.data === undefined
      ? null
      : {
          title: String(existing.data['title'] ?? ''),
          goal_md: briefValue('goal_md'),
          output_format_md: briefValue('output_format_md'),
          tools_sources_md: briefValue('tools_sources_md'),
          boundaries_md: briefValue('boundaries_md'),
          priority: (existing.data['priority'] as DelegationInput['priority']) ?? 'P2',
        };

  // 검증은 **지금** 채워지지 않은 칸을 본다 — 작업이 늦게 도착하면 그때 다시 정해진다.
  // 리졸버를 ref 로 부르는 이유는 useForm 이 첫 렌더의 옵션을 붙잡기 때문이다.
  const schemaRef = useRef(delegationSchema);
  schemaRef.current = taskKey === null ? delegationSchema : editSchema(unfilled);

  const form = useForm<DelegationInput>({
    resolver: (values, context, options) =>
      zodResolver(schemaRef.current)(values, context, options),
    defaultValues: {
      title: '',
      goal_md: '',
      output_format_md: '',
      tools_sources_md: '',
      boundaries_md: '',
      priority: 'P2',
      source_spec_version_id: initial?.versionId ?? null,
      source_requirement_id: initial?.requirementId ?? null,
    },
    ...(loaded === null ? {} : { values: loaded }),
  });

  // 출처 피커 — 스펙을 고르면 그 문서의 **승인본만** 버전 목록에 선다(D-02: 승인되지 않은
  // 버전에서 일을 파생하면 그 일은 아직 합의되지 않은 약속 위에 선다).
  const [sourceSpec, setSourceSpec] = useState(initial?.specKey ?? '');
  const specs = useSpecTree(projectSlug, projectId);
  const versions = useSpecVersions(projectSlug, sourceSpec);
  const requirements = useRequirements(projectSlug, sourceSpec);
  const approved = rows(versions.data).filter((v) => v['status'] === 'approved');
  const locked = initial !== undefined;

  // **열리면 눈이 따라온다**(2026-09-24 · REQ-WEB-202). 보드는 폼을 화면 맨 위에 여는데, 아래로
  // 내린 채 카드의 [채우기]를 누르면 아무 일도 없어 보였다 — 폼으로 옮기고 제목 칸에 커서를 둔다
  const formRef = useRef<HTMLFormElement>(null);
  const { setFocus } = form;
  useEffect(() => {
    formRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    setFocus('title');
  }, [setFocus]);

  const save = useMutation({
    mutationFn: async (input: DelegationInput) => {
      const {
        source_spec_version_id: version,
        source_requirement_id: requirement,
        ...rest
      } = input;
      if (taskKey === null) {
        return apiFetch<Record<string, unknown>>(`/projects/${projectSlug}/tasks`, {
          method: 'POST',
          body: {
            ...rest,
            ...(version == null || version === '' ? {} : { source_spec_version_id: version }),
            ...(requirement == null || requirement === ''
              ? {}
              : { source_requirement_id: requirement }),
          },
        });
      }
      // 수정은 출처를 바꾸지 않는다 — EP-TASK-05 가 받지 않는 값이고, 파생의 근거를
      // 나중에 갈아 끼우는 것은 다른 결정이다. **비워 둔 빈 칸은 보내지 않는다** — 보내지 않은
      // 칸을 서버는 그대로 두고(자리표시자는 자리표시자로 남아 ❌ 로 보인다), 빈 문자열을 보내면
      // 그 칸을 비운다
      const body = Object.fromEntries(
        Object.entries(rest).filter(
          ([field, value]) =>
            !(unfilled.has(field as BriefField) && String(value ?? '').trim() === ''),
        ),
      );
      return apiFetch<Record<string, unknown>>(`/projects/${projectSlug}/tasks/${taskKey}`, {
        method: 'PATCH',
        body,
      });
    },
    onSuccess: (result, input) => {
      // 축이 없으면 무효화하지 않는다 — 빈 축으로 부르면 아무 캐시에도 닿지 않고,
      // 그 침묵이 정확히 이 표시가 없애려는 결함이다(query-keys.ts `ProjectId`).
      if (projectId !== undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) });
      }
      // 상세에서 고쳤으면 상세도 다시 읽는다 — 그 자리에 고친 값이 보여야 한다
      if (taskKey !== null) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskKey) });
      }
      // 승격 여부를 알려준다 — 폼을 채운 사람이 알고 싶은 것은 저장 여부가 아니라 그것이다.
      // 수정이면 **아직 비어 있는 칸을 이름으로** 말한다 — "네 요소가 다 찼으면" 이라고만 하면
      // 한 칸을 빠뜨린 사람은 다 채웠다고 믿는다
      const stillEmpty = BRIEF_FIELDS.filter(
        (field) => unfilled.has(field) && String(input[field] ?? '').trim() === '',
      );
      const promoted = result['status'] === 'ready' && existing.data?.['status'] === 'backlog';
      pushToast({
        tone: 'ok',
        message:
          taskKey === null
            ? t('task.form.saved_backlog')
            : promoted
              ? t('task.form.promoted')
              : stillEmpty.length > 0
                ? t('task.form.saved_missing', {
                    fields: stillEmpty.map((field) => t(BRIEF_LABEL[field])).join(' · '),
                  })
                : result['status'] === 'backlog'
                  ? t('task.form.saved_deps_pending')
                  : t('task.form.saved'),
      });
      onDone();
    },
    onError: onApiError,
  });

  return (
    <form
      ref={formRef}
      data-testid="delegation-form"
      onSubmit={(e) => void form.handleSubmit((input) => save.mutate(input as DelegationInput))(e)}
      className="flex flex-col gap-3 rounded-nerv border border-border bg-bg-elev p-4"
    >
      <h2 className="text-sm font-semibold">
        {taskKey === null ? t('task.form.new') : t('task.form.edit', { key: taskKey })}
      </h2>
      {/* 4요소가 왜 필수인지, 저장하면 **어디에** 들어가는지 폼이 먼저 말한다 — 새 작업은 언제나
          backlog 이고(FR-05) 큐에 올리는 것은 보드의 [준비됨으로 올리기]다. 예전 안내("①~④ 가 모두
          차야 ready 로 승격합니다")는 생성 경로의 실제 동작과 달랐다 */}
      <p data-testid="delegation-lead" className="-mt-2 text-xs text-text-mute">
        {t(taskKey === null ? 'task.form.lead_new' : 'task.form.lead_edit')}
      </p>
      {/* **출처 — 가치 사슬의 첫 고리**(REQ-WEB-147). S3 에서 왔으면 고정 표기이고,
          아니면 승인본만 고를 수 있는 피커 셋이다. 선택이라 비워도 저장된다. */}
      {taskKey === null && (
        <div
          data-testid="task-source"
          className="flex flex-col gap-2 rounded-nerv-sm bg-bg-sunken p-3"
        >
          <p className="text-xs font-medium text-text">{t('task.form.source')}</p>
          {locked ? (
            <p data-testid="source-locked" className="text-xs text-text-mute">
              {t('task.form.source_locked', {
                spec: initial.specKey,
                version: String(initial.versionNo),
              })}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Select
                aria-label={t('task.form.source_spec')}
                data-testid="source-spec"
                value={sourceSpec}
                onChange={(e) => {
                  setSourceSpec(e.target.value);
                  form.setValue('source_spec_version_id', null);
                  form.setValue('source_requirement_id', null);
                }}
                className="w-52"
              >
                <option value="">{t('task.form.source_none')}</option>
                {rows(specs.data).map((sp) => (
                  <option key={String(sp['key'])} value={String(sp['key'])}>
                    {String(sp['key'])}
                  </option>
                ))}
              </Select>
              <Select
                aria-label={t('task.form.source_version')}
                data-testid="source-version"
                disabled={sourceSpec === ''}
                {...form.register('source_spec_version_id')}
                className="w-52"
              >
                <option value="">{t('task.form.source_none')}</option>
                {approved.map((v) => (
                  <option key={String(v['id'])} value={String(v['id'])}>
                    v{String(v['version_no'])}
                  </option>
                ))}
              </Select>
              <Select
                aria-label={t('task.form.source_requirement')}
                data-testid="source-requirement"
                disabled={sourceSpec === ''}
                {...form.register('source_requirement_id')}
                className="w-60"
              >
                <option value="">{t('task.form.source_none')}</option>
                {rows(requirements.data).map((r) => (
                  <option key={String(r['id'])} value={String(r['id'])}>
                    {String(r['ref'])}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <p className="text-xs text-text-faint">{t('task.form.source_hint')}</p>
        </div>
      )}
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
        <Textarea
          {...form.register('goal_md')}
          data-testid="brief-goal_md"
          placeholder={briefHint('goal_md')}
          rows={2}
        />
      </Field>
      <Field
        label={t('task.brief.output')}
        error={fieldError(t, form.formState.errors.output_format_md?.message)}
      >
        <Input
          {...form.register('output_format_md')}
          data-testid="brief-output_format_md"
          placeholder={briefHint('output_format_md')}
        />
      </Field>
      <Field
        label={t('task.brief.tools')}
        error={fieldError(t, form.formState.errors.tools_sources_md?.message)}
      >
        <Textarea
          {...form.register('tools_sources_md')}
          data-testid="brief-tools_sources_md"
          placeholder={briefHint('tools_sources_md')}
          rows={2}
        />
      </Field>
      <Field
        label={t('task.brief.boundaries')}
        error={fieldError(t, form.formState.errors.boundaries_md?.message)}
      >
        <Textarea
          {...form.register('boundaries_md')}
          data-testid="brief-boundaries_md"
          placeholder={briefHint('boundaries_md')}
          rows={2}
        />
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
