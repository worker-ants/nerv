// /p/:proj/specs/:spec → S3 스펙 상세 (ui-wireframes §2.3 · screens.md §2.4 · §3)
//
// 3열이다: 좌 트리 · 중앙 본문 · 우 상태 패널. 우측이 이 화면의 무게중심인데, 거기 있는 것이
// **버전 · 관계(역참조) · 코멘트 · 승인**이기 때문이다 — "이 문서를 고치면 무엇이 흔들리는가"에
// 답하지 못하는 편집기는 문서를 고치게 만들지 말아야 한다.

import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { MetaDialog } from '../../features/spec-editor/meta-dialog.js';
import { SpecEditor } from '../../features/spec-editor/editor.js';
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
  useSpecCheck,
  useSpecComments,
  useSpecRelations,
  useSpecVersions,
} from '../../lib/queries.js';
import type { RoundTripResult } from '../../features/spec-editor/editor.js';
import { Button, Input, Mono, SectionTitle, Textarea } from '../../components/ui/primitives.js';
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
  const check = useSpecCheck(proj, String(detail.data?.['version_id'] ?? ''));

  const [draft, setDraft] = useState<string | null>(null);
  const [roundTrip, setRoundTrip] = useState<RoundTripResult | null>(null);
  const [leaseHolder, setLeaseHolder] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Record<string, unknown> | null>(null);
  const [handoffRequested, setHandoffRequested] = useState(false);
  const [showImpact, setShowImpact] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);

  const body = String(detail.data?.['body_md'] ?? '');
  const docStatus = String(detail.data?.['doc_status'] ?? 'draft');
  const versionId = String(detail.data?.['version_id'] ?? '');
  const editable = docStatus === 'draft' && leaseHolder === null;

  const save = useMutation({
    mutationFn: (markdown: string) =>
      apiFetch<Record<string, unknown>>(`/projects/${proj}/specs/${spec}/draft`, {
        method: 'PUT',
        body: {
          body_markdown: markdown,
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
      apiFetch<Record<string, unknown>>(`/projects/${proj}/spec-versions/${versionId}/submit`, {
        method: 'POST',
        body: {},
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
    // 3열 중 **좌측 트리는 셸 사이드바가 소유한다**(§1.3 — "S3 좌측 트리와 같은 컴포넌트").
    // 여기서 또 그리면 같은 트리가 두 개 뜨고 스크롤 위치도 갈라진다.
    <div className="mx-auto grid w-full max-w-[80rem] gap-6 px-6 py-6 lg:grid-cols-[1fr_17rem]">
      <main className="min-w-0">
        <header className="mb-4 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">
            {String(detail.data?.['title'] ?? spec)}
          </h1>
          <Mono>{spec}</Mono>
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
            <StatusBadge token="waiting" label="이미 지나간 판" />
          )}
          {/* 참조 갱신 배지(REQ-WEB-037) — 내가 참조하는 문서가 나보다 앞서 갔다는 신호.
              이게 없으면 낡은 근거 위에서 계속 쓰게 된다 */}
          {relationItems.some((r) => r['direction'] === 'out' && r['doc_status'] === 'approved') &&
            detail.data?.['doc_status'] === 'draft' && (
              <span data-testid="recheck-badge">
                <StatusBadge token="waiting" label="참조 문서 갱신됨 — 근거를 재확인하세요" />
              </span>
            )}
          <Button
            size="sm"
            variant="ghost"
            data-testid="meta-open"
            onClick={() => setMetaOpen(true)}
            className="ml-auto"
          >
            ⋯ 메타
          </Button>
        </header>

        {/* 내가 리스를 쥐고 있다는 사실을 보인다(REQ-WEB-029) — 안 보이면 사람은 자기가
            문서를 잠그고 있는 줄 모르고 자리를 뜬다 */}
        {leaseHolder === null && editable && draft !== null && (
          <div
            data-testid="lease-badge"
            className="mb-2 rounded-nerv bg-status-action-soft px-3 py-1.5 text-sm text-status-action"
          >
            ✏️ 편집 중 — {me.data?.display_name ?? '나'} · 웹 · 자동 갱신(30분)
          </div>
        )}

        {leaseHolder !== null && (
          <div
            data-testid="lease-banner"
            className="mb-2 flex flex-wrap items-center gap-2 rounded-nerv bg-status-waiting-soft px-3 py-1.5 text-sm text-status-waiting"
          >
            <span>✏️ {leaseHolder} 이(가) 편집 중입니다 — 읽기 전용으로 전환했습니다.</span>
            <button
              type="button"
              data-testid="handoff-request"
              disabled={handoffRequested}
              onClick={() => {
                // 인계는 **보유자가 놓아야** 이뤄진다 — 뺏는 경로를 만들면 편집 리스가
                // 의미를 잃는다. MVP 는 요청만 보낸다(질문 카드와 같은 사람 경로).
                setHandoffRequested(true);
                pushToast({
                  tone: 'ok',
                  message: `${leaseHolder} 에게 인계를 요청했습니다 — 보유자가 놓으면 이어서 쓸 수 있습니다.`,
                });
              }}
              className="rounded-nerv-sm border border-border bg-bg-elev px-2 py-0.5 disabled:opacity-50"
            >
              {handoffRequested ? '요청함' : '인계 요청'}
            </button>
          </div>
        )}

        {conflict !== null && (
          <div
            data-testid="conflict-dialog"
            className="mb-2 rounded-nerv border border-status-danger bg-status-danger-soft px-3 py-2.5 text-sm"
          >
            <p className="font-medium text-status-danger">저장 충돌 — 기준 버전이 달라졌습니다.</p>
            <p className="text-text-mute">
              다른 표면에서 먼저 저장된 내용이 있습니다. 덮어쓰지 않았고,{' '}
              <b>지금 쓰던 본문도 그대로 남아 있습니다</b> — 아래에서 고르세요.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="conflict-reload"
                className="rounded-nerv-sm border border-border bg-bg-elev px-2 py-1"
                onClick={() => {
                  // 내 편집분을 버리고 서버 최신으로 간다 — 명시적으로 고른 경우에만
                  setConflict(null);
                  setDraft(null);
                  void queryClient.invalidateQueries({ queryKey: queryKeys.spec(spec) });
                }}
              >
                서버 최신 보기(내 편집 버림)
              </button>
              <button
                type="button"
                data-testid="conflict-copy"
                className="rounded-nerv-sm border border-border bg-bg-elev px-2 py-1"
                onClick={() => {
                  // 클립보드가 막힌 환경도 있다 — 실패해도 본문은 화면에 그대로 있다
                  void navigator.clipboard?.writeText(draft ?? body).catch(() => undefined);
                  pushToast({ tone: 'ok', message: '내 본문을 클립보드에 복사했습니다.' });
                }}
              >
                내 본문 복사
              </button>
            </div>
          </div>
        )}

        {/* 왕복 경고는 **편집 중일 때만** 뜬다. 읽기 전용 문서에서 "저장을 막았습니다"는
            막을 저장이 없는데 경고하는 것이라 사람을 혼란스럽게 한다(REQ-WEB-031 은 저장
            경로의 규칙이다). 읽기 전용에서는 소스 보기 토글이 같은 역할을 한다. */}
        {editable && draft !== null && roundTrip !== null && !roundTrip.stable && (
          // §3.2 규칙 2 — 직렬화가 불안정하면 저장을 막는다
          <div
            data-testid="roundtrip-error"
            className="mb-2 rounded-nerv border border-status-danger bg-status-danger-soft px-3 py-2 text-sm text-status-danger"
          >
            직렬화 왕복이 불안정합니다 — 저장을 막았습니다. 소스 보기로 확인하세요.
          </div>
        )}

        {check.data !== undefined && rows(check.data['findings']).length > 0 && (
          <section
            data-testid="check-findings"
            className="mb-3 rounded-nerv border border-border bg-bg-elev p-3 text-sm"
          >
            <h2 className="mb-1.5 text-xs font-semibold tracking-wide text-text-mute uppercase">
              사전 검토 —{' '}
              <span
                className={
                  check.data['verdict'] === 'block' ? 'text-status-danger' : 'text-status-waiting'
                }
              >
                {String(check.data['verdict'])}
              </span>
            </h2>
            <ul className="flex flex-col gap-1">
              {rows(check.data['findings']).map((f, i) => (
                <li key={`${String(f['checker'])}-${i}`} className="flex flex-wrap gap-2 text-xs">
                  <span className="font-mono text-text-faint">{String(f['checker'])}</span>
                  <span
                    className={
                      f['severity'] === 'block' ? 'text-status-danger' : 'text-status-waiting'
                    }
                  >
                    {String(f['severity'])}
                  </span>
                  {/* 앵커가 없는 지적은 지적이 아니다 — 어디를 고칠지 못 가리키기 때문이다 */}
                  {f['anchor'] !== null && (
                    <span className="font-mono text-text-mute">{String(f['anchor'])}</span>
                  )}
                  <span className="min-w-0 flex-1">{String(f['message'])}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <SpecEditor
          value={draft ?? body}
          readOnly={!editable}
          onChange={(markdown, result) => {
            setDraft(markdown);
            setRoundTrip(result);
          }}
        />

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button
            variant="primary"
            disabled={
              !editable ||
              draft === null ||
              save.isPending ||
              (roundTrip !== null && !roundTrip.stable)
            }
            onClick={() => draft !== null && save.mutate(draft)}
          >
            저장
          </Button>
          <Button
            data-testid="submit-review"
            disabled={
              docStatus !== 'draft' || submit.isPending || check.data?.['verdict'] === 'block'
            }
            title={
              check.data?.['verdict'] === 'block'
                ? '사전 검토에 block 이 있습니다 — 앵커가 가리키는 곳을 먼저 고치세요'
                : undefined
            }
            onClick={() => setShowImpact(true)}
          >
            검토 요청
          </Button>
          {showImpact && (
            <div
              role="dialog"
              aria-label="검토 요청 영향"
              data-testid="impact-preview"
              className="w-full rounded-nerv border border-border bg-bg-elev p-3 text-sm"
            >
              <p className="font-medium">이 변경이 흔드는 것</p>
              <ul className="mt-1 flex flex-col gap-0.5 text-text-mute">
                {/* 승인 전에 "무엇이 흔들리나"를 보이는 것이 이 화면의 요점이다 —
                    승인하고 나서 알게 되면 되돌리는 비용이 훨씬 크다 */}
                <li>역참조 문서 {backlinks.length}건 — 승인 시 재확인 요청이 간다</li>
                <li>
                  파생 Task {rows(detail.data?.['tasks']).length}건 — 기준 버전이 바뀌면 재브리핑
                </li>
              </ul>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  data-testid="impact-confirm"
                  disabled={submit.isPending}
                  onClick={() => {
                    setShowImpact(false);
                    submit.mutate();
                  }}
                >
                  검토 요청 보내기
                </Button>
                <Button size="sm" onClick={() => setShowImpact(false)}>
                  취소
                </Button>
              </div>
            </div>
          )}

          {/* 터미널 이어쓰기 — 복사용 명령 한 줄(§3.4) */}
          <code className="ml-auto rounded-nerv-sm bg-code-bg px-2 py-1 font-mono text-xs text-code-text">
            claude &quot;/nerv:spec edit {spec}&quot;
          </code>
        </div>
      </main>

      {metaOpen && (
        <MetaDialog
          projectSlug={proj}
          projectId={
            typeof detail.data?.['project_id'] === 'string' ? detail.data['project_id'] : undefined
          }
          specKey={spec}
          title={String(detail.data?.['title'] ?? spec)}
          // 역할은 me 의 멤버십에서 온다 — 권한 판정의 정본은 서버지만, 화면은 미리 알려준다
          canEdit={['planner', 'admin'].includes(
            me.data?.memberships.find((m) => m.project_slug === proj)?.role ?? '',
          )}
          onClose={() => setMetaOpen(false)}
        />
      )}

      {/* 우측이 이 화면의 무게중심이다 — 화면을 내려도 따라와야 "무엇이 흔들리나"를
          본문과 나란히 볼 수 있다 */}
      <aside className="flex flex-col gap-5 text-sm lg:sticky lg:top-[calc(var(--spacing-header)+1.5rem)] lg:self-start">
        <section>
          <SectionTitle>버전</SectionTitle>
          <ul className="flex flex-col gap-1">
            {rows(versions.data)
              .slice(0, 8)
              .map((v) => (
                <li key={String(v['id'])} className="flex items-center gap-2">
                  <span className="w-8 shrink-0 font-mono text-xs text-text-faint">
                    v{String(v['version_no'])}
                  </span>
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
          <SectionTitle>역참조 {backlinks.length}건</SectionTitle>
          <p className="mb-1.5 text-2xs text-text-faint">고치면 흔들리는 문서</p>
          <ul className="flex flex-col gap-1">
            {backlinks.map((r) => (
              <li key={String(r['spec_id'])}>
                <Link
                  to="/p/$proj/specs/$spec"
                  params={{ proj, spec: String(r['key']) }}
                  className="text-link hover:underline"
                >
                  {String(r['title'])}
                </Link>
              </li>
            ))}
            {backlinks.length === 0 && <li className="text-text-faint">아직 없습니다.</li>}
          </ul>
        </section>

        <section>
          <SectionTitle>코멘트</SectionTitle>
          <CommentList
            projectSlug={proj}
            specKey={spec}
            versionId={versionId}
            comments={rows(comments.data)}
          />
        </section>

        <section className="border-t border-border pt-3 text-2xs text-text-faint">
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
          <li key={String(c['id'])} className="rounded-nerv border border-border p-2">
            {/* 앵커가 코멘트의 전부다 — 위치 없는 지적은 고칠 수 없다(D-09) */}
            <Mono>{String(c['anchor'])}</Mono>
            <div className="mt-0.5 text-sm">{String(c['body_md'])}</div>
            <button
              type="button"
              className="mt-1 text-xs text-link hover:underline"
              onClick={() => resolve.mutate(String(c['id']))}
            >
              해소
            </button>
          </li>
        ))}
        {open.length === 0 && <li className="text-xs text-text-faint">열린 코멘트가 없습니다.</li>}
      </ul>
      <div className="mt-1 flex flex-col gap-1.5 border-t border-border pt-2">
        <Input
          value={anchor}
          onChange={(e) => setAnchor(e.target.value)}
          placeholder="앵커 (헤딩 slug 또는 REQ-…)"
          aria-label="앵커"
          className="h-7 text-xs"
        />
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="코멘트"
          aria-label="코멘트"
          rows={2}
          className="text-xs"
        />
        <Button
          size="sm"
          disabled={anchor.trim() === '' || body.trim() === '' || add.isPending}
          onClick={() => add.mutate()}
          className="self-start"
        >
          코멘트 달기
        </Button>
      </div>
    </div>
  );
}
