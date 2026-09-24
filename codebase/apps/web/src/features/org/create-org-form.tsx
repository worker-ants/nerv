// 조직 만들기 — 온보딩과 설정이 같이 쓴다 (screens.md §2.1 · §2.8 · REQ-WEB-205)
//
// 이 폼은 소속이 0개일 때 온보딩에만 있었다. 그래서 이미 한 조직에 속한 사람은 둘째 조직을 만들
// 길이 없었는데, 헤더 조직 드롭다운은 "조직 관리 · 새 조직" 이라고 약속하고 있었다(2026-09-24
// 사람 결정 — 설정에도 둔다). 서버(EP-ORG-03)는 소속이 있는 사람도 막지 않는다.
//
// **첫 프로젝트를 같이 만든다**(와이어프레임 §2.1 — "첫 프로젝트를 같이 만든다"). 조직만 만든 사람은
// 프로젝트 0개인 홈에 서서 다음 걸음을 찾아야 했다. 칸은 선택이다 — 비워 두면 조직만 만든다.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { describeApiError } from '../../lib/api-errors.js';
import { useT } from '../../lib/i18n.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import { fetchMe } from '../../lib/session.js';
import { projectKeyFromSlug, slugFromName } from '../../lib/slug.js';
import { Button, Field, Input } from '../../components/ui/primitives.js';

export interface CreateOrgFormProps {
  /** 만든 뒤 — `project` 는 첫 프로젝트까지 만들었을 때만 slug 다 */
  onCreated: (org: string, project: string | null) => void | Promise<void>;
}

export function CreateOrgForm({ onCreated }: CreateOrgFormProps): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [project, setProject] = useState('');
  const [error, setError] = useState<string | null>(null);
  // 프로젝트 이름이 한글뿐이면 규칙에서 빈 값이 나온다 — 그때는 조직 slug 를 빌린다(한 조직 안에서 유일하면 된다)
  const projectSlug = slugFromName(project) || slug.trim();

  const create = useMutation({
    mutationFn: async (): Promise<{ org: string; project: string | null }> => {
      const org = slug.trim();
      await apiFetch('/orgs', { method: 'POST', body: { slug: org, name: name.trim() } });
      if (project.trim() === '') return { org, project: null };
      // **조직은 이미 섰다** — 프로젝트가 실패해도 조직 생성까지 실패로 말하지 않는다. 그 사실만 알린다
      try {
        await apiFetch(`/orgs/${org}/projects`, {
          method: 'POST',
          body: { name: project.trim(), slug: projectSlug, key: projectKeyFromSlug(projectSlug) },
        });
        return { org, project: projectSlug };
      } catch (e) {
        pushToast({
          tone: 'warn',
          message: t('onboarding.step1_project_failed', { reason: describeApiError(t, e).message }),
        });
        return { org, project: null };
      }
    },
    onSuccess: async (created) => {
      // me 를 다시 읽어야 헤더의 조직 select 가 방금 만든 조직을 안다
      queryClient.setQueryData(queryKeys.me(), await fetchMe());
      void queryClient.invalidateQueries({ queryKey: ['org', created.org, 'projects'] });
      await onCreated(created.org, created.project);
    },
    // 폼 아래에서 말한다 — 문장은 표(§1.5)를 거친다(REQ-WEB-196)
    onError: (e: Error) => setError(describeApiError(t, e).message),
  });

  return (
    <>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          create.mutate();
        }}
      >
        <div className="min-w-56 flex-1">
          <Field label={t('onboarding.step1_org_name')}>
            <Input
              required
              data-testid="org-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSlug(slugFromName(e.target.value));
              }}
              className="h-9"
            />
          </Field>
        </div>
        <div className="min-w-40 flex-1">
          <Field
            label={t('settings.workspace.project_slug')}
            hint={t('onboarding.step1_slug_hint')}
          >
            <Input
              required
              data-testid="org-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="h-9 font-mono"
            />
          </Field>
        </div>
        <div className="min-w-56 basis-full">
          <Field
            label={t('onboarding.step1_first_project')}
            hint={t('onboarding.step1_first_project_hint')}
          >
            <Input
              data-testid="first-project-name"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className="h-9"
            />
          </Field>
        </div>
        <Button type="submit" variant="primary" disabled={create.isPending} className="h-9">
          {create.isPending ? t('onboarding.step1_creating') : t('onboarding.step1_create')}
        </Button>
      </form>
      {error !== null && (
        <p role="alert" className="mt-2 text-sm text-status-danger">
          ⚠ {error}
        </p>
      )}
    </>
  );
}
