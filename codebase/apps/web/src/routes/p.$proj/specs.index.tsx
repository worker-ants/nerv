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
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">스펙</h1>
        <form
          className="ml-auto flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(query);
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="검색 (한국어·안정 ID 모두)"
            className="rounded border border-border bg-bg-elev px-2 py-1 text-sm"
          />
          <button type="submit" className="rounded border border-border px-2 py-1 text-sm">
            검색
          </button>
        </form>
      </header>

      {search.data?.degraded !== null && search.data?.degraded !== undefined && (
        // degrade 를 숨기지 않는다 — 결과가 왜 얕은지 모르면 사람은 검색을 탓한다(REQ-API-026)
        <div
          data-testid="degraded-banner"
          className="rounded border border-border bg-status-waiting-soft px-3 py-1 text-sm text-status-waiting"
        >
          의미 검색이 잠시 꺼져 있어 키워드 검색 결과만 보여줍니다.
        </div>
      )}

      {submitted.trim() === '' ? (
        <SpecTree
          projectSlug={proj}
          projectId={typeof projectId === 'string' ? projectId : undefined}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-text-mute">
              결과 {search.data?.items.length ?? 0}건
            </h2>
            <ul className="flex flex-col gap-2">
              {(search.data?.items ?? []).map((hit) => (
                <li key={`${String(hit['spec_id'])}-${String(hit['anchor'] ?? '')}`}>
                  <Link
                    to="/p/$proj/specs/$spec"
                    params={{ proj, spec: String(hit['key']) }}
                    className="block rounded border border-border bg-bg-elev p-2"
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono text-xs text-text-faint">
                        {String(hit['key'])}
                      </span>
                      <span className="font-medium">{String(hit['title'])}</span>
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
                      {/* 어느 경로로 들어왔는지 — 신뢰의 문제다 */}
                      <span className="ml-auto text-xs text-text-faint">
                        {(hit['matched_by'] as string[] | undefined)?.join('·')}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-text-mute">
                      {String(hit['snippet'] ?? '')}
                    </p>
                  </Link>
                </li>
              ))}
              {search.isFetched && (search.data?.items.length ?? 0) === 0 && (
                <li className="text-sm text-text-mute">결과가 없습니다.</li>
              )}
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-text-mute">
              관계로 걸린 문서{' '}
              <span className="font-normal text-text-faint">— 질의에 없지만 연결된 것</span>
            </h2>
            <ul className="flex flex-col gap-1 text-sm">
              {(search.data?.related ?? []).map((r) => (
                <li key={String(r['spec_id'])}>
                  <Link
                    to="/p/$proj/specs/$spec"
                    params={{ proj, spec: String(r['key']) }}
                    className="text-link underline"
                  >
                    {String(r['title'])}
                  </Link>
                  <span className="ml-1 text-xs text-text-faint">{String(r['via_kind'])}</span>
                </li>
              ))}
              {(search.data?.related ?? []).length === 0 && (
                <li className="text-text-faint">없습니다.</li>
              )}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
