// /p/:proj/specs — 스펙 목록(트리 전체 화면) + 검색 결과 뷰 (screens.md §2.4 · REQ-WEB-041~043)
//
// 검색 결과가 이 화면의 절반이다. `related[]`(관계 확장)를 **본 결과와 구분해서** 보여주는
// 것이 요점 — 관계는 관련성의 근거이지 질의 일치가 아니다. 섞으면 사람은 왜 이게 나왔는지
// 알 수 없고, 그러면 검색을 믿지 않게 된다.

import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SpecTree } from '../../components/spec-tree.js';
import { StatusBadge } from '../../components/status-badge.js';
import { SPEC_VERSION_TOKEN } from '../../components/status-token.js';
import { apiFetch } from '../../lib/api.js';
import { useProject } from '../../lib/queries.js';
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
  const { proj } = Route.useParams();
  const project = useProject(proj);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');

  const search = useQuery({
    queryKey: ['project', proj, 'search', submitted],
    queryFn: () =>
      apiFetch<SearchResult>(`/projects/${proj}/specs/search?q=${encodeURIComponent(submitted)}`),
    enabled: submitted.trim() !== '',
  });

  const projectId = project.data?.['id'];

  return (
    <PageBody wide>
      <PageHeader
        title="스펙"
        description="한국어로 물어도, 안정 ID로 물어도 찾습니다."
        actions={
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
              placeholder="검색 (한국어·안정 ID 모두)"
              className="w-64"
            />
            <Button type="submit">검색</Button>
            {submitted !== '' && (
              <Button
                variant="ghost"
                onClick={() => {
                  setQuery('');
                  setSubmitted('');
                }}
              >
                전체 트리로
              </Button>
            )}
          </form>
        }
      />

      {search.data?.degraded !== null && search.data?.degraded !== undefined && (
        // degrade 를 숨기지 않는다 — 결과가 왜 얕은지 모르면 사람은 검색을 탓한다(REQ-API-026)
        <div
          data-testid="degraded-banner"
          className="mb-3 flex items-center gap-2 rounded-nerv border border-border bg-status-waiting-soft px-3 py-2 text-sm text-status-waiting"
        >
          <span aria-hidden="true">●</span>
          의미 검색이 잠시 꺼져 있어 키워드 검색 결과만 보여줍니다.
        </div>
      )}

      {submitted.trim() === '' ? (
        <Card padded={false} className="p-3">
          <SpecTree
            projectSlug={proj}
            projectId={typeof projectId === 'string' ? projectId : undefined}
          />
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
          <section>
            <SectionTitle>결과 {search.data?.items.length ?? 0}건</SectionTitle>
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
                            label={String(hit['doc_status'])}
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
                    title="결과가 없습니다."
                    hint="안정 ID(SPC-…·REQ-…)로도 찾을 수 있습니다."
                  />
                </li>
              )}
            </ul>
          </section>

          <section>
            <SectionTitle>관계로 걸린 문서</SectionTitle>
            <p className="mb-2 text-2xs text-text-faint">
              질의에 없지만 연결된 것 — 관련성의 근거이지 질의 일치가 아닙니다.
            </p>
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
                <li className="py-1.5 text-sm text-text-faint">없습니다.</li>
              )}
            </ul>
          </section>
        </div>
      )}
    </PageBody>
  );
}
