// /p/:proj/specs — 스펙 목록(트리 전체 화면) + 검색 결과 뷰 (screens.md §2.4 · REQ-WEB-041~043)
//
// 검색 결과가 이 화면의 절반이다. `related[]`(관계 확장)를 **본 결과와 구분해서** 보여주는
// 것이 요점 — 관계는 관련성의 근거이지 질의 일치가 아니다. 섞으면 사람은 왜 이게 나왔는지
// 알 수 없고, 그러면 검색을 믿지 않게 된다.

import { statusLabelKey } from '@nerv/schema';
import { useT } from '../../lib/i18n.js';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { lazy, Suspense, useState } from 'react';

// 그래프 라이브러리는 **탭을 누를 때** 받는다 — gzip 173KB 다. 대부분의 방문은 트리만 쓰는데
// 그 비용을 목록 화면 전체가 미리 치를 이유가 없다.
const SpecGraph = lazy(async () => ({
  default: (await import('../../features/spec-graph/graph.js')).SpecGraph,
}));
const SpecTable = lazy(async () => ({
  default: (await import('../../features/spec-graph/table.js')).SpecTable,
}));
import { useQuery } from '@tanstack/react-query';
import { SpecTree } from '../../components/spec-tree.js';

import { StatusBadge } from '../../components/status-badge.js';
import { SPEC_VERSION_TOKEN } from '../../components/status-token.js';
import { apiFetch } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { useProject, useSpecGraph } from '../../lib/queries.js';
import {
  Button,
  Card,
  EmptyState,
  Input,
  Mono,
  PageBody,
  PageHeader,
  SectionTitle,
  Skeleton,
} from '../../components/ui/primitives.js';
import type { StatusToken } from '../../components/status-badge.js';

export const Route = createFileRoute('/p/$proj/specs/')({ component: SpecListScreen });

interface SearchResult {
  items: Record<string, unknown>[];
  related: Record<string, unknown>[];
  degraded: string | null;
}

function SpecListScreen(): React.JSX.Element {
  const t = useT();
  const { proj } = Route.useParams();
  const navigate = useNavigate();
  const project = useProject(proj);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  // 트리와 그래프는 **같은 질문의 두 답**이다 — 계층으로 찾을 때와 관계로 찾을 때.
  // 다른 라우트로 가르면 둘을 오가며 비교할 수 없다.
  const [view, setView] = useState<'tree' | 'table' | 'graph'>('tree');

  const search = useQuery({
    queryKey: ['project', proj, 'search', submitted],
    queryFn: () =>
      apiFetch<SearchResult>(`/projects/${proj}/specs/search?q=${encodeURIComponent(submitted)}`),
    enabled: submitted.trim() !== '',
  });

  const projectId = project.data?.['id'];
  const graph = useSpecGraph(proj, typeof projectId === 'string' ? projectId : undefined);

  return (
    // 화면 높이만큼을 쓰고 **남는 세로는 본문이 가진다**(아래 `flex-1`). 그래프는 밀도가
    // 전부인 그림이라 캔버스 100px 이 곧 읽을 수 있는 노드 수다.
    <PageBody wide className="flex min-h-[calc(100dvh-var(--spacing-header))] flex-col">
      <PageHeader
        title={t('specs.title')}
        description={t('specs.lead')}
        actions={
          // 검색 줄과 탭 줄을 **머리 안에 포갠다**. 탭이 따로 한 줄을 차지하면 제목 오른쪽의
          // 빈자리는 그대로 둔 채 본문만 46px 밀려 내려간다 — 화면에서 가장 비싼 것은 세로다.
          <div className="flex flex-col items-end gap-2">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setSubmitted(query);
              }}
            >
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('specs.search_placeholder')}
                className="w-64"
              />
              <Button type="submit">{t('common.search')}</Button>
              {submitted !== '' && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setQuery('');
                    setSubmitted('');
                  }}
                >
                  {t('specs.back_to_tree')}
                </Button>
              )}
            </form>
            {submitted.trim() === '' && (
              <nav
                aria-label={t('specs.title')}
                className="inline-flex rounded-nerv-sm border border-border p-0.5 text-xs"
              >
                {(['tree', 'table', 'graph'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    data-testid={`view-${mode}`}
                    onClick={() => setView(mode)}
                    className={cn(
                      'rounded-nerv-sm px-3 py-1',
                      view === mode ? 'bg-bg-active font-medium' : 'text-text-mute hover:text-text',
                    )}
                  >
                    {t(
                      mode === 'tree'
                        ? 'graph.tab.tree'
                        : mode === 'table'
                          ? 'specs.tab.table'
                          : 'graph.tab.graph',
                    )}
                  </button>
                ))}
              </nav>
            )}
          </div>
        }
      />

      {search.data?.degraded !== null && search.data?.degraded !== undefined && (
        // degrade 를 숨기지 않는다 — 결과가 왜 얕은지 모르면 사람은 검색을 탓한다(REQ-API-026)
        <div
          data-testid="degraded-banner"
          className="mb-3 flex items-center gap-2 rounded-nerv border border-border bg-status-waiting-soft px-3 py-2 text-sm text-status-waiting"
        >
          <span aria-hidden="true">●</span>
          {t('specs.degraded')}
        </div>
      )}

      {submitted.trim() === '' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {view === 'tree' ? (
            <Card padded={false} className="p-3">
              <SpecTree
                projectSlug={proj}
                projectId={typeof projectId === 'string' ? projectId : undefined}
              />
            </Card>
          ) : graph.data === undefined ? (
            <Skeleton rows={6} />
          ) : view === 'table' ? (
            <Suspense fallback={<Skeleton rows={6} />}>
              <SpecTable nodes={graph.data.nodes} edges={graph.data.edges} projectSlug={proj} />
            </Suspense>
          ) : graph.data.edges.length === 0 ? (
            <EmptyState icon="◎" title={t('graph.empty')} hint={t('graph.empty_hint')} />
          ) : (
            <Suspense fallback={<Skeleton rows={6} />}>
              <SpecGraph
                nodes={graph.data.nodes}
                edges={graph.data.edges}
                onOpen={(key) =>
                  void navigate({ to: '/p/$proj/specs/$spec', params: { proj, spec: key } })
                }
              />
            </Suspense>
          )}
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
          <section>
            <SectionTitle>
              {t('specs.results', { count: search.data?.items.length ?? 0 })}
            </SectionTitle>
            {search.isFetching && <Skeleton rows={3} />}
            <ul className="flex flex-col gap-2">
              {(search.data?.items ?? []).map((hit) => (
                <li key={`${String(hit['spec_id'])}-${String(hit['anchor'] ?? '')}`}>
                  <Link
                    to="/p/$proj/specs/$spec"
                    params={{ proj, spec: String(hit['key']) }}
                    className="block"
                  >
                    <Card interactive padded={false} className="px-3 py-2.5">
                      <div className="flex items-center gap-2 text-sm">
                        <Mono>{String(hit['key'])}</Mono>
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {String(hit['title'])}
                        </span>
                        {hit['doc_status'] !== null && (
                          <StatusBadge
                            token={
                              (SPEC_VERSION_TOKEN[
                                String(hit['doc_status']) as keyof typeof SPEC_VERSION_TOKEN
                              ] ?? 'idle') as StatusToken
                            }
                            label={t(statusLabelKey('spec', String(hit['doc_status'])))}
                          />
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-text-mute">
                        {String(hit['snippet'] ?? '')}
                      </p>
                      {/* 어느 경로로 들어왔는지 — 신뢰의 문제다 */}
                      <p className="mt-1.5 flex gap-1 text-2xs text-text-faint">
                        {((hit['matched_by'] as string[] | undefined) ?? []).map((by) => (
                          <span key={by} className="rounded-nerv-sm bg-bg-sunken px-1.5 py-0.5">
                            {by}
                          </span>
                        ))}
                      </p>
                    </Card>
                  </Link>
                </li>
              ))}
              {search.isFetched && (search.data?.items.length ?? 0) === 0 && (
                <li>
                  <EmptyState
                    icon="🔍"
                    title={t('specs.no_results')}
                    hint={t('specs.no_results_hint')}
                  />
                </li>
              )}
            </ul>
          </section>

          <section>
            <SectionTitle>{t('specs.related')}</SectionTitle>
            <p className="mb-2 text-2xs text-text-faint">{t('specs.related_hint')}</p>
            <ul className="flex flex-col">
              {(search.data?.related ?? []).map((r) => (
                <li
                  key={String(r['spec_id'])}
                  className="border-b border-border py-1.5 last:border-0"
                >
                  <Link
                    to="/p/$proj/specs/$spec"
                    params={{ proj, spec: String(r['key']) }}
                    className="text-sm text-link hover:underline"
                  >
                    {String(r['title'])}
                  </Link>
                  <span className="ml-1.5 text-2xs text-text-faint">{String(r['via_kind'])}</span>
                </li>
              ))}
              {(search.data?.related ?? []).length === 0 && (
                <li className="py-1.5 text-sm text-text-faint">{t('common.none')}</li>
              )}
            </ul>
          </section>
        </div>
      )}
    </PageBody>
  );
}
