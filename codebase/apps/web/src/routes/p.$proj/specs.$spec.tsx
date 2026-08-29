// /p/:proj/specs/:spec → S3 스펙 상세 (ui-wireframes §2.3 · screens.md §2.4 · §3)
//
// 3열이다: 좌 트리 · 중앙 본문 · 우 상태 패널. 우측이 이 화면의 무게중심인데, 거기 있는 것이
// **버전 · 관계(역참조) · 코멘트 · 승인**이기 때문이다 — "이 문서를 고치면 무엇이 흔들리는가"에
// 답하지 못하는 편집기는 문서를 고치게 만들지 말아야 한다.

import { useT } from '../../lib/i18n.js';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { MetaDialog } from '../../features/spec-editor/meta-dialog.js';
import { SpecEditor } from '../../features/spec-editor/editor.js';
import { RelationTabs } from '../../components/relation-tabs.js';
import type { RelationDirection } from '../../components/relation-tabs.js';
import { StatusBadge } from '../../components/status-badge.js';
import { SPEC_VERSION_TOKEN } from '../../components/status-token.js';
import { NERV_ERROR, statusLabelKey } from '@nerv/schema';
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
import { relativeTime } from '../../lib/format.js';
import { rolesInProject } from '../../lib/session.js';
import { useScope } from '../../lib/scope.js';
import { cn } from '../../lib/utils.js';
import { Avatar, Button, Input, Mono, Textarea } from '../../components/ui/primitives.js';
import type { StatusToken } from '../../components/status-badge.js';

export const Route = createFileRoute('/p/$proj/specs/$spec')({ component: SpecDetail });

/** 리스 갱신 주기 — 하트비트 상수와 같은 값을 쓴다(§3.4 "갱신"). */
const LEASE_REFRESH_MS = 60_000;

function SpecDetail(): React.JSX.Element {
  const t = useT();
  const { proj, spec } = Route.useParams();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const me = useMe();
  const { orgSlug } = useScope(proj);
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
  // 레일 탭 — 관계가 기본이다: "이 문서를 고치면 무엇이 흔들리나"가 이 레일의 첫 질문이다
  const [railTab, setRailTab] = useState<'relations' | 'versions' | 'comments'>('relations');
  // 관계 안의 두 방향은 **다른 질문**이다: 역참조는 "고치면 무엇이 흔들리나",
  // 레퍼런스는 "이 문서가 무엇에 기대나". 섞어 놓으면 둘 다 훑어야 답이 나온다.
  const [relTab, setRelTab] = useState<RelationDirection>('all');

  // **스펙이 바뀌면 이 화면의 상태는 전부 남의 것이 된다.** 라우트 파라미터만 바뀌면
  // 리액트는 같은 컴포넌트를 재사용하므로 `draft`·리스 보유자·충돌이 그대로 살아남는다.
  // 화면으로는 앞 문서의 본문이 계속 보였고(실측 2026-08-23 — 트리로 이동하면 제목만
  // 바뀌고 본문은 앞 문서였다), 더 나쁜 것은 **저장이다**: 앞 문서의 draft 를 들고 있는
  // 채로 저장하면 남의 본문을 이 문서에 덮어쓴다.
  useEffect(() => {
    setDraft(null);
    setRoundTrip(null);
    setLeaseHolder(null);
    setConflict(null);
    setHandoffRequested(false);
    setShowImpact(false);
    setMetaOpen(false);
    setRailTab('relations');
  }, [spec]);

  const body = String(detail.data?.['body_md'] ?? '');
  // area 는 임포터가 디렉터리에서 만든 **묶음 노드**다 — 본문이 없는 것이 정상일 수 있다
  const isArea = String(detail.data?.['type'] ?? '') === 'area';
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
            ? t('spec.saved')
            : t('spec.saved_unknown_refs', { refs: unknownRefs.join(', ') }),
      });
    },
    onError: (error: Error) => {
      if (error instanceof NervApiError && error.code === NERV_ERROR.PRECONDITION) {
        setConflict(error.body.details);
        return;
      }
      if (error instanceof NervApiError && error.code === NERV_ERROR.DRAFT_LEASED) {
        setLeaseHolder(String(error.body.details['holder'] ?? t('spec.lease_other_default')));
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
            ? t('spec.gate_passed', { tier: gate?.tier ?? 'T0' })
            : t('spec.submit_done'),
      });
    },
    onError: (error: Error) => pushToast({ tone: 'warn', message: error.message }),
  });

  // **복구는 이 화면에만 있다**(REQ-WEB-105). 보관한 문서는 목록·트리에서 빠지므로
  // 되살릴 손잡이를 목록에 둘 수 없다 — 주소로 들어온 이 자리가 그 손잡이의 유일한 집이다.
  const projectUuid =
    typeof detail.data?.['project_id'] === 'string' ? detail.data['project_id'] : proj;
  const restore = useMutation({
    mutationFn: () =>
      apiFetch<Record<string, unknown>>(`/projects/${proj}/specs/${spec}/restore`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.spec(spec) });
      // 목록으로 돌아오는 것이 복구의 요점이다 — 트리와 표(그래프 응답)를 함께 새로 받는다
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectSpecTree(projectUuid) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectSpecGraph(projectUuid) });
      pushToast({ tone: 'ok', message: t('spec.restore_done') });
    },
    onError: (error: Error) => {
      // 상위가 보관돼 있으면 되살릴 자리가 없다 — 무엇을 먼저 복구해야 하는지 이름으로 말한다
      if (
        error instanceof NervApiError &&
        error.body.details['kind'] === 'parent_archived' &&
        typeof error.body.details['parent'] === 'string'
      ) {
        pushToast({
          tone: 'warn',
          message: t('spec.restore_blocked_parent', { parent: error.body.details['parent'] }),
        });
        return;
      }
      pushToast({ tone: 'warn', message: error.message });
    },
  });

  // 리스 주기 갱신 — 에디터가 열려 있는 동안 저장 없이도 붙잡고 있어야 한다(REQ-WEB-029)
  useEffect(() => {
    if (!editable || draft === null) return;
    const timer = setInterval(() => save.mutate(draft), LEASE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [draft, editable, save]);

  const relationItems = relations.data?.items ?? [];
  const backlinks = relationItems.filter((r) => r['direction'] === 'in');
  const outgoing = relationItems.filter((r) => r['direction'] !== 'in');
  const shownRelations = relTab === 'in' ? backlinks : relTab === 'out' ? outgoing : relationItems;
  // 역할은 me 의 멤버십에서 온다 — 권한 판정의 정본은 서버지만, 화면은 미리 알려준다.
  // **합집합으로 본다**: 멤버십 한 행만 보면 조직 단위 admin 이 어느 프로젝트에서도
  // 역할이 없는 사람이 되어, 서버가 허용할 편집을 화면이 막는다(실측 2026-08-24).
  const canEditMeta = rolesInProject(me.data, orgSlug, proj).some(
    (r) => r === 'planner' || r === 'admin',
  );

  return (
    // 3열 중 **좌측 트리는 셸 사이드바가 소유한다**(§1.3 — "S3 좌측 트리와 같은 컴포넌트").
    // 여기서 또 그리면 같은 트리가 두 개 뜨고 스크롤 위치도 갈라진다.
    <div className="mx-auto grid w-full max-w-[80rem] gap-6 px-6 py-6 lg:grid-cols-[1fr_17rem]">
      {/* **본문 폭을 읽는 폭으로 좁힌다**(2026-08-23 재검토). 1008px 짜리 줄은 눈이
          다음 줄 머리를 못 찾아 문서가 평문 덩어리로 읽힌다 — 44rem(704px)이 한 줄에
          70~80자로, 긴 글을 읽는 표준 폭이다. 화면은 넓게 쓰되 글은 좁게 흐른다. */}
      <main className="mx-auto min-w-0 max-w-[44rem]">
        {/* 시안의 문서 머리: **메타 줄 → 큰 제목 → 곁줄** 세 층이다. 제목 옆에 배지를
            늘어놓던 이전 배치는 제목이 배지들과 폭을 다퉜다 — 문서의 이름은 문서에서
            가장 큰 글자여야 하고(33px), 신원(키·타입·버전)은 그 위에 조용히 눕는다.
            세 층을 `<header>` 로 묶지 **않는다**: `position: sticky` 는 부모 상자 안에서만
            붙어 있으므로, 150px 짜리 머리 안에 제목을 두면 머리가 화면을 떠날 때 제목도
            같이 떠난다(실측 2026-08-27 — 그래서 처음 시도가 동작하지 않았다). 제목이
            본문 끝까지 붙어 있으려면 본문만큼 긴 상자의 자식이어야 한다. */}
        <div className="flex flex-wrap items-center gap-[7px]">
          <StatusBadge
            token={
              (SPEC_VERSION_TOKEN[docStatus as keyof typeof SPEC_VERSION_TOKEN] ??
                'idle') as StatusToken
            }
            label={t(statusLabelKey('spec', docStatus))}
          />
          <Mono className="text-xs">{spec}</Mono>
          {typeof detail.data?.['type'] === 'string' && (
            <>
              <span aria-hidden="true" className="text-text-ghost">
                ·
              </span>
              <span className="text-sm text-text-faint">{String(detail.data['type'])}</span>
            </>
          )}
          <span aria-hidden="true" className="text-text-ghost">
            ·
          </span>
          <span className="text-sm text-text-faint">
            v{String(detail.data?.['version_no'] ?? '')}
          </span>
          {detail.data?.['basis_superseded'] === true && (
            <StatusBadge token="waiting" label={t('spec.badge_superseded')} />
          )}
          {/* 참조 갱신 배지(REQ-WEB-037) — 내가 참조하는 문서가 나보다 앞서 갔다는 신호.
                이게 없으면 낡은 근거 위에서 계속 쓰게 된다 */}
          {relationItems.some((r) => r['direction'] === 'out' && r['doc_status'] === 'approved') &&
            detail.data?.['doc_status'] === 'draft' && (
              <span data-testid="recheck-badge">
                <StatusBadge token="waiting" label={t('spec.recheck')} />
              </span>
            )}
          <Button
            size="sm"
            variant="ghost"
            data-testid="meta-open"
            onClick={() => setMetaOpen(true)}
            className="ml-auto"
          >
            {t('spec.meta_button')}
          </Button>
        </div>
        {/* **이름은 화면을 떠나지 않는다**(2026-08-27 — 사람 요청). 스펙 본문은 길다
            (clemvion 실측: `data-model` 50,685px = 화면 56장). 몇 장만 내려가도 지금
            보는 것이 어느 문서인지가 화면에서 사라지고, 트리에서 눌러 들어온 사람은
            되짚을 것이 스크롤바밖에 없다. 셸 헤더 바로 아래에 붙고, 아래로 흐르는
            본문을 덮어야 하므로 배경은 **불투명**하다. */}
        <h1
          data-testid="spec-title"
          className="sticky top-header z-20 mt-[7px] bg-bg pt-1.5 pb-0.5 text-3xl font-bold tracking-[-0.026em]
            after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-2
            after:bg-gradient-to-b after:from-bg after:to-transparent after:content-['']"
        >
          {String(detail.data?.['title'] ?? spec)}
        </h1>
        {/* 곁줄 — 이 문서의 이력·무게가 한 줄로 요약된다(시안: 승인자 · 파생 · 역참조) */}
        <div className="mt-2 mb-3 flex flex-wrap items-center gap-2 border-b border-border pb-[22px] text-sm text-text-mute">
          <Byline detail={detail.data} backlinks={backlinks.length} t={t} />
        </div>

        {/* 보관 배너 — 목록에 없는 문서를 주소로 열었을 때, 화면이 그 사실을 **먼저** 말한다.
            이게 없으면 보관된 문서가 평소와 똑같이 열려 살아 있는 기준으로 읽힌다 */}
        {detail.data?.['archived_at'] != null && (
          <div
            data-testid="archived-banner"
            className="mb-3 flex flex-wrap items-center gap-3 rounded-nerv border border-border bg-bg-sunken px-3 py-2 text-sm text-text-mute"
          >
            <StatusBadge token="idle" label={t('specs.archived_badge')} />
            <span className="min-w-0 flex-1">{t('spec.archived_banner')}</span>
            {canEditMeta && (
              <Button
                size="sm"
                data-testid="spec-restore"
                disabled={restore.isPending}
                onClick={() => restore.mutate()}
              >
                {t('spec.restore')}
              </Button>
            )}
          </div>
        )}

        {/* 내가 리스를 쥐고 있다는 사실을 보인다(REQ-WEB-029) — 안 보이면 사람은 자기가
            문서를 잠그고 있는 줄 모르고 자리를 뜬다 */}
        {leaseHolder === null && editable && draft !== null && (
          <div
            data-testid="lease-badge"
            className="mb-2 rounded-nerv bg-status-action-soft px-3 py-1.5 text-sm text-status-action"
          >
            {t('spec.lease_mine', { name: me.data?.display_name ?? t('spec.lease_mine_anon') })}
          </div>
        )}

        {leaseHolder !== null && (
          <div
            data-testid="lease-banner"
            className="mb-2 flex flex-wrap items-center gap-2 rounded-nerv bg-status-waiting-soft px-3 py-1.5 text-sm text-status-waiting"
          >
            <span>{t('spec.lease_other', { name: leaseHolder })}</span>
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
                  message: t('spec.handoff_sent', { name: leaseHolder }),
                });
              }}
              className="rounded-nerv-sm border border-border bg-bg-elev px-2 py-0.5 disabled:opacity-50"
            >
              {handoffRequested ? t('spec.handoff_requested') : t('spec.handoff_request')}
            </button>
          </div>
        )}

        {conflict !== null && (
          <div
            data-testid="conflict-dialog"
            className="mb-2 rounded-nerv border border-status-danger bg-status-danger-soft px-3 py-2.5 text-sm"
          >
            <p className="font-medium text-status-danger">{t('spec.conflict_title')}</p>
            <p className="text-text-mute">
              {t('spec.conflict_body_pre')} <b>{t('spec.conflict_body_strong')}</b>
              {t('spec.conflict_body_post')}
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
                {t('spec.conflict_reload')}
              </button>
              <button
                type="button"
                data-testid="conflict-copy"
                className="rounded-nerv-sm border border-border bg-bg-elev px-2 py-1"
                onClick={() => {
                  // 클립보드가 막힌 환경도 있다 — 실패해도 본문은 화면에 그대로 있다
                  void navigator.clipboard?.writeText(draft ?? body).catch(() => undefined);
                  pushToast({ tone: 'ok', message: t('spec.conflict_copied') });
                }}
              >
                {t('spec.conflict_copy')}
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
            {t('spec.roundtrip_unstable')}
          </div>
        )}

        {check.data !== undefined && rows(check.data['findings']).length > 0 && (
          <section
            data-testid="check-findings"
            className="mb-3 rounded-nerv border border-border bg-bg-elev p-3 text-sm"
          >
            <h2 className="mb-1.5 text-xs font-semibold tracking-wide text-text-mute uppercase">
              {t('spec.check_title')}{' '}
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

        {/* **본문 없는 묶음 노드를 빈 화면으로 두지 않는다**(2026-08-24 · REQ-WEB-068).
            임포터는 디렉터리마다 area 노드를 만드는데, 원본에 `_product-overview.md` 가
            없으면 본문이 없다(4.7 §2.2 — clemvion 실측 area 16개 중 9개). 그냥 비워 두면
            "내용이 사라졌다"로 읽힌다 — 무엇이고 어디로 가면 되는지 말해야 한다(§1.5).
            **편집 권한과 무관하게** 띄운다: 빈 이유를 알아야 하는 것은 읽는 사람도 같다. */}
        {body.trim() === '' && (
          <div
            data-testid="spec-empty-body"
            className="mb-3 rounded-nerv border border-border bg-bg-sunken px-3 py-2 text-sm text-text-mute"
          >
            {isArea ? t('spec.empty.area') : t('spec.empty.body')}
          </div>
        )}

        {/* **문서마다 새 편집기다.** 본문이 앞 문서로 남던 결함을 고치는 것은 위의 상태
            초기화이고(실측으로 갈라 확인했다), 이 `key` 가 막는 것은 다른 것이다:
            TipTap 인스턴스가 살아남으면 **되돌리기 이력도 살아남아** 문서 B 에서 ⌘Z 를
            누르면 문서 A 의 글이 돌아온다. 이력은 문서에 속한다. */}
        <SpecEditor
          key={spec}
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
            {t('common.save')}
          </Button>
          <Button
            data-testid="submit-review"
            disabled={
              docStatus !== 'draft' || submit.isPending || check.data?.['verdict'] === 'block'
            }
            title={check.data?.['verdict'] === 'block' ? t('spec.submit_blocked') : undefined}
            onClick={() => setShowImpact(true)}
          >
            {t('spec.submit_review')}
          </Button>
          {showImpact && (
            <div
              role="dialog"
              aria-label={t('spec.impact_dialog')}
              data-testid="impact-preview"
              className="w-full rounded-nerv border border-border bg-bg-elev p-3 text-sm"
            >
              <p className="font-medium">{t('spec.impact_title')}</p>
              <ul className="mt-1 flex flex-col gap-0.5 text-text-mute">
                {/* 승인 전에 "무엇이 흔들리나"를 보이는 것이 이 화면의 요점이다 —
                    승인하고 나서 알게 되면 되돌리는 비용이 훨씬 크다 */}
                <li>{t('spec.impact_backlinks', { count: backlinks.length })}</li>
                <li>{t('spec.impact_tasks', { count: rows(detail.data?.['tasks']).length })}</li>
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
                  {t('spec.impact_send')}
                </Button>
                <Button size="sm" onClick={() => setShowImpact(false)}>
                  {t('common.cancel')}
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
          // 역할은 me 의 멤버십에서 온다 — 권한 판정의 정본은 서버지만, 화면은 미리 알려준다.
          // **합집합으로 본다**: 멤버십 한 행만 보면 조직 단위 admin 이 어느 프로젝트에서도
          // 역할이 없는 사람이 되어, 서버가 허용할 편집을 화면이 막는다(실측 2026-08-24).
          canEdit={canEditMeta}
          onClose={() => setMetaOpen(false)}
        />
      )}

      {/* 우측이 이 화면의 무게중심이다 — 화면을 내려도 따라와야 "무엇이 흔들리나"를
          본문과 나란히 볼 수 있다 */}
      {/* **레일도 스스로 스크롤한다.** `sticky` 로 붙여만 두면 내용이 화면보다 길 때
          아래쪽이 영영 닿지 않는다 — 역참조 18건이면 이미 그렇다(실측 2026-08-23).
          높이를 뷰포트에 묶고 넘치면 레일 안에서 흐르게 한다. */}
      <aside className="flex flex-col text-sm lg:sticky lg:top-[calc(var(--spacing-header)+1.5rem)] lg:max-h-[calc(100vh-var(--spacing-header)-3rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
        {/* **탭이다**(시안). 버전·역참조·코멘트를 세로로 쌓으면 레일이 세 화면 길이가
            되고, 그때 코멘트는 스크롤 끝의 소문이 된다. 한 번에 하나를 보이되 수는
            탭 이름 옆에 미리 적는다 — 눌러 보기 전에 "있는지"는 알아야 한다. */}
        <div className="flex border-b border-border">
          {(
            [
              ['relations', t('spec.rail.relations'), relationItems.length],
              ['versions', t('spec.versions'), rows(versions.data).length],
              ['comments', t('spec.comments'), rows(comments.data).length],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              data-testid={`rail-tab-${key}`}
              onClick={() => setRailTab(key)}
              className={cn(
                'flex items-center gap-[5px] border-b-2 px-[11px] pt-1 pb-2.5 text-sm transition-colors',
                railTab === key
                  ? 'border-text font-semibold text-text'
                  : 'border-transparent text-text-faint hover:text-text',
              )}
            >
              {label}
              <span className="text-2xs text-text-ghost tabular-nums">{count}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1 pt-2.5">
          {railTab === 'relations' && (
            <>
              {/* **하위 탭은 방향으로 가른다**(사람 지시 2026-08-24). 관계가 스무 건이
                  넘으면 "이 문서를 고치면 무엇이 흔들리나"와 "이 문서가 무엇에 기대나"가
                  한 목록에 섞여, 둘 중 하나를 보려면 목록 전체를 훑어야 한다.
                  수는 **누르기 전에** 적는다 — 빈 탭을 열어 보게 하지 않는다. */}
              <RelationTabs
                value={relTab}
                onChange={setRelTab}
                counts={{ all: relationItems.length, in: backlinks.length, out: outgoing.length }}
                className="px-1 pb-1.5"
              />

              {shownRelations.length === 0 && (
                <p className="px-2 text-text-faint">{t('common.not_yet')}</p>
              )}

              {/* 역참조 무리 — 설명은 **머리에** 단다(사람 지시 2026-08-24). 꼬리에 달면
                  스무 줄을 다 내려간 뒤에야 "이게 뭐였나"를 알게 되고, 그때는 이미 다
                  읽은 뒤다. 그리고 그 설명이 무엇을 가리키는지는 **보이는 목록에 역참조가
                  있을 때만** 성립한다 — 레퍼런스만 보는 중에 떠 있으면 지금 보고 있는
                  것을 잘못 읽게 된다. */}
              {relTab !== 'out' && backlinks.length > 0 && (
                <>
                  <p className="px-2 pb-1 text-2xs text-text-ghost">{t('spec.backlinks_hint')}</p>
                  {backlinks.map((r) => (
                    <RelationRow key={relationKey(r)} relation={r} proj={proj} t={t} />
                  ))}
                </>
              )}

              {/* 전체 탭에서 **방향이 바뀌는 자리**에 선을 긋는다(사람 지시 2026-08-24).
                  화살표만으로는 무리가 바뀐 것을 눈이 알아채지 못한다 — 한쪽이 비어
                  있으면 나눌 것도 없으므로 선도 없다. */}
              {relTab === 'all' && backlinks.length > 0 && outgoing.length > 0 && (
                <hr data-testid="rel-divider" className="my-1.5 border-t border-border" />
              )}

              {relTab !== 'in' &&
                outgoing.map((r) => (
                  <RelationRow key={relationKey(r)} relation={r} proj={proj} t={t} />
                ))}
            </>
          )}

          {railTab === 'versions' && (
            <ul className="flex flex-col gap-1 px-2">
              {rows(versions.data)
                .slice(0, 8)
                .map((v) => (
                  <li key={String(v['id'])} className="flex items-center gap-2 py-0.5">
                    <span className="w-8 shrink-0 font-mono text-xs text-text-faint">
                      v{String(v['version_no'])}
                    </span>
                    <StatusBadge
                      token={
                        (SPEC_VERSION_TOKEN[
                          String(v['status']) as keyof typeof SPEC_VERSION_TOKEN
                        ] ?? 'idle') as StatusToken
                      }
                      label={t(statusLabelKey('spec', String(v['status'])))}
                    />
                  </li>
                ))}
            </ul>
          )}

          {railTab === 'comments' && (
            <div className="px-2">
              <CommentList
                projectSlug={proj}
                specKey={spec}
                versionId={versionId}
                comments={rows(comments.data)}
              />
            </div>
          )}
        </div>

        <section className="mt-4 border-t border-border px-2 pt-3 text-2xs text-text-faint">
          {me.data !== undefined && t('spec.viewer', { name: me.data.display_name })}
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
  const t = useT();
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
              {t('spec.comment_resolve')}
            </button>
          </li>
        ))}
        {open.length === 0 && (
          <li className="text-xs text-text-faint">{t('spec.no_open_comments')}</li>
        )}
      </ul>
      <div className="mt-1 flex flex-col gap-1.5 border-t border-border pt-2">
        <Input
          value={anchor}
          onChange={(e) => setAnchor(e.target.value)}
          placeholder={t('spec.comment_anchor')}
          aria-label={t('spec.comment_anchor_label')}
          className="h-7 text-xs"
        />
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('spec.comments')}
          aria-label={t('spec.comments')}
          rows={2}
          className="text-xs"
        />
        <Button
          size="sm"
          disabled={anchor.trim() === '' || body.trim() === '' || add.isPending}
          onClick={() => add.mutate()}
          className="self-start"
        >
          {t('spec.comment_add')}
        </Button>
      </div>
    </div>
  );
}

/**
 * 문서 곁줄 — **누가 언제 승인했고 무엇이 이 문서에 매달려 있는가.**
 * 승인자가 없으면(초안) 작성 흐름의 정보만 남는다. 파생 작업 수는 상세 응답에 없으면
 * 조용히 생략한다 — 없는 숫자를 0 으로 지어내지 않는다.
 */
function Byline({
  detail,
  backlinks,
  t,
}: {
  detail: Record<string, unknown> | undefined;
  backlinks: number;
  t: ReturnType<typeof useT>;
}): React.JSX.Element {
  const approver =
    typeof detail?.['approved_by_name'] === 'string' ? detail['approved_by_name'] : null;
  const approvedAt = typeof detail?.['approved_at'] === 'string' ? detail['approved_at'] : null;
  return (
    <>
      {approver !== null && (
        <span className="flex items-center gap-2">
          <Avatar name={approver} size="sm" />
          {approvedAt === null
            ? t('spec.byline.approved_by', { name: approver })
            : t('spec.byline.approved_when', {
                name: approver,
                when: relativeTime(t, approvedAt),
              })}
        </span>
      )}
      {approver !== null && (
        <span aria-hidden="true" className="text-text-ghost">
          ·
        </span>
      )}
      <span>{t('spec.byline.backlinks', { count: backlinks })}</span>
    </>
  );
}

/** 관계 한 줄의 키 — 같은 문서가 kind·방향을 달리해 두 번 나올 수 있다 */
function relationKey(r: Record<string, unknown>): string {
  return `${String(r['spec_id'])}-${String(r['kind'])}-${String(r['direction'])}`;
}

/**
 * 관계 한 줄 — 역참조 무리와 레퍼런스 무리가 **같은 컴포넌트**를 쓴다.
 * 무리마다 따로 그리면 둘의 생김새가 조용히 갈라지고, 그때 사람은 방향이 아니라
 * 모양의 차이를 먼저 읽는다.
 */
function RelationRow({
  relation,
  proj,
  t,
}: {
  relation: Record<string, unknown>;
  proj: string;
  t: ReturnType<typeof useT>;
}): React.JSX.Element {
  const incoming = relation['direction'] === 'in';
  return (
    <Link
      to="/p/$proj/specs/$spec"
      params={{ proj, spec: String(relation['key']) }}
      className="flex items-start gap-[9px] rounded-nerv px-2 py-2 transition-colors hover:bg-bg-hover"
    >
      {/* 방향 표식(시안): 들어오는 것은 조용히, 나가는 것은 물들여서 */}
      <span
        aria-hidden="true"
        className={cn(
          'mt-px inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] text-[9.5px] font-semibold',
          incoming ? 'bg-bg-sunken text-text-mute' : 'bg-status-action-soft text-status-action',
        )}
      >
        {incoming ? '↓' : '↑'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm leading-[1.45] text-text">
          {String(relation['title'])}
        </span>
        <span className="mt-0.5 block text-2xs text-text-faint">
          {incoming ? t('spec.rail.backlink') : String(relation['kind'])} ·{' '}
          {String(relation['key'])}
        </span>
      </span>
    </Link>
  );
}
