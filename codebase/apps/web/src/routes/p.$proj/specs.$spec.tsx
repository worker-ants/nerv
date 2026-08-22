// /p/:proj/specs/:spec → S3 스펙 상세 (ui-wireframes §2.3 · screens.md §2.4 · §3)
//
// 3열이다: 좌 트리 · 중앙 본문 · 우 상태 패널. 우측이 이 화면의 무게중심인데, 거기 있는 것이
// **버전 · 관계(역참조) · 코멘트 · 승인**이기 때문이다 — "이 문서를 고치면 무엇이 흔들리는가"에
// 답하지 못하는 편집기는 문서를 고치게 만들지 말아야 한다.

import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { SpecEditor } from '../../features/spec-editor/editor.js';
import { SpecTree } from '../../components/spec-tree.js';
import { StatusBadge } from '../../components/status-badge.js';
import { SPEC_VERSION_TOKEN } from '../../components/status-token.js';
import { NERV_ERROR } from '@nerv/schema';
import { apiFetch, NervApiError } from '../../lib/api.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import {
  rows,
  useMe,
  useSpec,
  useSpecComments,
  useSpecRelations,
  useSpecVersions,
} from '../../lib/queries.js';
import type { RoundTripResult } from '../../features/spec-editor/editor.js';
import type { StatusToken } from '../../components/status-badge.js';

export const Route = createFileRoute('/p/$proj/specs/$spec')({ component: SpecDetail });

/** 리스 갱신 주기 — 하트비트 상수와 같은 값을 쓴다(§3.4 "갱신"). */
const LEASE_REFRESH_MS = 60_000;

function SpecDetail(): React.JSX.Element {
  const { proj, spec } = Route.useParams();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const me = useMe();
  const detail = useSpec(proj, spec);
  const versions = useSpecVersions(proj, spec);
  const comments = useSpecComments(proj, spec);
  const relations = useSpecRelations(proj, spec);

  const [draft, setDraft] = useState<string | null>(null);
  const [roundTrip, setRoundTrip] = useState<RoundTripResult | null>(null);
  const [leaseHolder, setLeaseHolder] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Record<string, unknown> | null>(null);

  const body = String(detail.data?.['body_md'] ?? '');
  const docStatus = String(detail.data?.['doc_status'] ?? 'draft');
  const versionId = String(detail.data?.['version_id'] ?? '');
  const editable = docStatus === 'draft' && leaseHolder === null;

  const save = useMutation({
    mutationFn: (markdown: string) =>
      apiFetch<Record<string, unknown>>(`/projects/${proj}/specs/draft`, {
        method: 'PUT',
        body: {
          spec_id: detail.data?.['spec_id'],
          body_md: markdown,
          // 낙관적 동시성의 최후 방어선 — 리스가 뚫려도 여기서 막힌다(§3.4)
          base_version: versionId,
        },
      }),
    onSuccess: (result) => {
      setConflict(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.spec(spec) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.specVersions(spec) });
      const relationSync = result['relations'] as { unknown?: string[] } | undefined;
      const unknownRefs = relationSync?.unknown ?? [];
      pushToast({
        tone: 'ok',
        message:
          unknownRefs.length === 0
            ? '초안을 저장했습니다.'
            : `초안 저장 — 아직 없는 참조: ${unknownRefs.join(', ')}`,
      });
    },
    onError: (error: Error) => {
      if (error instanceof NervApiError && error.code === NERV_ERROR.PRECONDITION) {
        setConflict(error.body.details);
        return;
      }
      if (error instanceof NervApiError && error.code === NERV_ERROR.DRAFT_LEASED) {
        setLeaseHolder(String(error.body.details['holder'] ?? '다른 사용자'));
        return;
      }
      pushToast({ tone: 'warn', message: error.message });
    },
  });

  const submit = useMutation({
    mutationFn: () =>
      apiFetch<Record<string, unknown>>(`/projects/${proj}/specs/submit`, {
        method: 'POST',
        body: { spec_version_id: versionId },
        idempotencyKey: `submit-${versionId}`,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.spec(spec) });
      const gate = result['gate'] as { tier?: string } | undefined;
      pushToast({
        tone: 'ok',
        message:
          result['status'] === 'approved'
            ? `${gate?.tier ?? 'T0'} — 승인 없이 통과했습니다(이벤트로 기록됨).`
            : '검토를 요청했습니다.',
      });
    },
    onError: (error: Error) => pushToast({ tone: 'warn', message: error.message }),
  });

  // 리스 주기 갱신 — 에디터가 열려 있는 동안 저장 없이도 붙잡고 있어야 한다(REQ-WEB-029)
  useEffect(() => {
    if (!editable || draft === null) return;
    const timer = setInterval(() => save.mutate(draft), LEASE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [draft, editable, save]);

  const relationItems = relations.data?.items ?? [];
  const backlinks = relationItems.filter((r) => r['direction'] === 'in');

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr_18rem]">
      <aside className="hidden lg:block">
        <SpecTree projectSlug={proj} activeKey={spec} />
      </aside>

      <main className="min-w-0">
        <header className="mb-3 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">{String(detail.data?.['title'] ?? spec)}</h1>
          <span className="font-mono text-xs text-text-faint">{spec}</span>
          <StatusBadge
            token={
              (SPEC_VERSION_TOKEN[docStatus as keyof typeof SPEC_VERSION_TOKEN] ??
                'idle') as StatusToken
            }
            label={docStatus}
          />
          <span className="text-xs text-text-mute">
            v{String(detail.data?.['version_no'] ?? '')}
          </span>
          {detail.data?.['basis_superseded'] === true && (
            <span className="text-xs text-status-waiting">이 버전은 이미 지나간 판입니다</span>
          )}
        </header>

        {leaseHolder !== null && (
          <div
            data-testid="lease-banner"
            className="mb-2 rounded border border-border bg-status-waiting-soft px-3 py-1 text-sm text-status-waiting"
          >
            ✏️ {leaseHolder} 이(가) 편집 중입니다 — 읽기 전용으로 전환했습니다.
          </div>
        )}

        {conflict !== null && (
          <div
            data-testid="conflict-dialog"
            className="mb-2 rounded border border-status-danger px-3 py-2 text-sm"
          >
            <p className="font-medium text-status-danger">저장 충돌 — 기준 버전이 달라졌습니다.</p>
            <p className="text-text-mute">
              다른 표면에서 먼저 저장된 내용이 있습니다. 새로고침해 최신 초안을 받은 뒤 다시
              적용하세요. 덮어쓰지 않았습니다.
            </p>
            <button
              type="button"
              className="mt-1 text-link underline"
              onClick={() => {
                setConflict(null);
                setDraft(null);
                void queryClient.invalidateQueries({ queryKey: queryKeys.spec(spec) });
              }}
            >
              최신 초안 불러오기
            </button>
          </div>
        )}

        {roundTrip !== null && !roundTrip.stable && (
          // §3.2 규칙 2 — 직렬화가 불안정하면 저장을 막는다
          <div
            data-testid="roundtrip-error"
            className="mb-2 rounded border border-status-danger px-3 py-2 text-sm text-status-danger"
          >
            직렬화 왕복이 불안정합니다 — 저장을 막았습니다. 소스 보기로 확인하세요.
          </div>
        )}

        <SpecEditor
          value={draft ?? body}
          readOnly={!editable}
          onChange={(markdown, result) => {
            setDraft(markdown);
            setRoundTrip(result);
          }}
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={
              !editable ||
              draft === null ||
              save.isPending ||
              (roundTrip !== null && !roundTrip.stable)
            }
            onClick={() => draft !== null && save.mutate(draft)}
            className="rounded bg-status-action px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            저장
          </button>
          <button
            type="button"
            disabled={docStatus !== 'draft' || submit.isPending}
            onClick={() => submit.mutate()}
            className="rounded border border-border px-3 py-1 text-sm disabled:opacity-50"
          >
            검토 요청
          </button>
          {/* 터미널 이어쓰기 — 복사용 명령 한 줄(§3.4) */}
          <code className="ml-auto rounded bg-code-bg px-2 py-1 text-xs text-code-text">
            claude &quot;/nerv:spec edit {spec}&quot;
          </code>
        </div>
      </main>

      <aside className="flex flex-col gap-4 text-sm">
        <section>
          <h2 className="mb-1 font-semibold text-text-mute">버전</h2>
          <ul className="flex flex-col gap-1">
            {rows(versions.data)
              .slice(0, 8)
              .map((v) => (
                <li key={String(v['id'])} className="flex items-center gap-2">
                  <span className="font-mono text-xs">v{String(v['version_no'])}</span>
                  <StatusBadge
                    token={
                      (SPEC_VERSION_TOKEN[String(v['status']) as keyof typeof SPEC_VERSION_TOKEN] ??
                        'idle') as StatusToken
                    }
                    label={String(v['status'])}
                  />
                </li>
              ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-1 font-semibold text-text-mute">
            역참조 {backlinks.length}건{' '}
            <span className="font-normal text-text-faint">— 고치면 흔들리는 문서</span>
          </h2>
          <ul className="flex flex-col gap-1">
            {backlinks.map((r) => (
              <li key={String(r['spec_id'])}>
                <Link
                  to="/p/$proj/specs/$spec"
                  params={{ proj, spec: String(r['key']) }}
                  className="text-link underline"
                >
                  {String(r['title'])}
                </Link>
              </li>
            ))}
            {backlinks.length === 0 && <li className="text-text-faint">아직 없습니다.</li>}
          </ul>
        </section>

        <section>
          <h2 className="mb-1 font-semibold text-text-mute">코멘트</h2>
          <CommentList
            projectSlug={proj}
            specKey={spec}
            versionId={versionId}
            comments={rows(comments.data)}
          />
        </section>

        <section className="text-xs text-text-faint">
          {me.data !== undefined && `보는 사람: ${me.data.display_name}`}
        </section>
      </aside>
    </div>
  );
}

function CommentList({
  projectSlug,
  specKey,
  versionId,
  comments,
}: {
  projectSlug: string;
  specKey: string;
  versionId: string;
  comments: Record<string, unknown>[];
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [anchor, setAnchor] = useState('');
  const [body, setBody] = useState('');

  const add = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${projectSlug}/spec-versions/${versionId}/comments`, {
        method: 'POST',
        body: { anchor, body_md: body },
      }),
    onSuccess: () => {
      setBody('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.specComments(specKey) });
    },
  });

  const resolve = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/projects/${projectSlug}/comments/${id}/resolve`, { method: 'POST', body: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.specComments(specKey) }),
  });

  const open = comments.filter((c) => c['status'] === 'open');

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1">
        {open.map((c) => (
          <li key={String(c['id'])} className="rounded border border-border p-2">
            {/* 앵커가 코멘트의 전부다 — 위치 없는 지적은 고칠 수 없다(D-09) */}
            <div className="font-mono text-xs text-text-faint">{String(c['anchor'])}</div>
            <div className="text-sm">{String(c['body_md'])}</div>
            <button
              type="button"
              className="mt-1 text-xs text-link underline"
              onClick={() => resolve.mutate(String(c['id']))}
            >
              해소
            </button>
          </li>
        ))}
        {open.length === 0 && <li className="text-text-faint">열린 코멘트가 없습니다.</li>}
      </ul>
      <input
        value={anchor}
        onChange={(e) => setAnchor(e.target.value)}
        placeholder="앵커 (헤딩 slug 또는 REQ-…)"
        className="rounded border border-border bg-bg px-2 py-1 text-xs"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="코멘트"
        rows={2}
        className="rounded border border-border bg-bg px-2 py-1 text-xs"
      />
      <button
        type="button"
        disabled={anchor.trim() === '' || body.trim() === '' || add.isPending}
        onClick={() => add.mutate()}
        className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
      >
        코멘트 달기
      </button>
    </div>
  );
}
