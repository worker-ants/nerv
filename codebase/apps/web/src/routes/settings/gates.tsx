// /settings/gates — S8 게이트 정책 (api.md §2.1a · D-06 · FR-14)
//
// 여기서 고치는 것은 `spec_gate.*` 두 키(`tier_boundaries` · `dynamic_escalation`)와 `done_gate.*` 두 키(`evidence_source` ·
// `review_coverage` — 2026-09-28 · REQ-WEB-285)다. `failopen`·`retention` 은 표시만 한다(§2.1a).
// **admin 아닌 역할에는 API 와 UI 양쪽이 거부한다**: 여기서는 비활성 + 사유, 서버에서는 403.
// 둘 중 하나만 있으면 게이트가 우회 가능해지거나 사용자가 이유 없이 막힌다.
//
// **경계는 칸 셋이다**(2026-09-24 — UI/UX 검토 · REQ-WEB-201). 예전에는 "2, 4, 6" 을 적는 자유 입력
// 한 칸이라 형식 검증이 없었고(잘못 친 값은 [저장] 뒤 서버 오류로 돌아왔다), 어느 수가 무슨 티어인지,
// 올리면 사람을 덜 거친다는 방향도 칸 옆에 없었다. 바뀐 것이 없어도 [저장]이 켜져 있어 저장할 것이
// 있는지 알 수 없었고, 고친 채 프로젝트를 바꾸면 입력이 말없이 버려졌다. 경계를 올리는 저장은 그
// 순간부터 더 많은 스펙이 **사람 없이 승인되게** 만드는데 확인이 없었다 — 그 방향만 한 번 더 묻는다.

import { useT } from '../../lib/i18n.js';
import { useApiError } from '../../lib/api-errors.js';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { GatePolicySchema, reviewKind } from '@nerv/schema';
import type { GatePolicy } from '@nerv/schema';
import { apiFetch } from '../../lib/api.js';
import { rows, useMe, useMembers, useProject } from '../../lib/queries.js';
import { rolesInProject } from '../../lib/session.js';
import { useScope } from '../../lib/scope.js';
import { useRealtime } from '../../lib/realtime.js';
import { queryKeys } from '../../lib/query-keys.js';
import {
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  SectionTitle,
  Select,
} from '../../components/ui/primitives.js';
import { ConfirmAction, ConfirmBar } from '../../components/ui/confirm-action.js';
import { ErrorState, failedWithoutData } from '../../components/query-state.js';
import { ReadOnlyNotice, scopeAdmins } from '../../components/read-only-notice.js';
import type { Translator } from '@nerv/schema';

export const Route = createFileRoute('/settings/gates')({
  /**
   * **고치는 프로젝트는 주소에 산다**(2026-09-25 — 사람 결정 D1 · NAV-10 · REQ-WEB-227). 컴포넌트 상태였을 때는
   * "clemvion 의 게이트 정책을 봐 달라" 를 링크로 건넬 수 없었고, 프로젝트 사이드바에서 곧장 올 길도 없었다
   */
  validateSearch: (search: Record<string, unknown>): { project?: string } =>
    typeof search['project'] === 'string' && search['project'] !== ''
      ? { project: search['project'] }
      : {},
  component: GatesTab,
});

const TIERS = ['T1', 'T2', 'T3'] as const;

type Coverage = GatePolicy['done_gate']['review_coverage'];
type CoverageMode = 'off' | 'any' | 'kinds';
const REVIEW_KINDS = reviewKind.enumValues;

const modeOf = (coverage: Coverage): CoverageMode =>
  coverage === false ? 'off' : coverage === true ? 'any' : 'kinds';

/** 리뷰 조건을 한 줄로 — 저장 전 "무엇이 바뀌나" 에 쓴다 */
export function coverageLabel(t: Translator, coverage: Coverage): string {
  if (coverage === false) return t('settings.gates.coverage_off');
  if (coverage === true) return t('settings.gates.coverage_any_short');
  return coverage.map((kind) => t(`review.kind.${kind}`)).join(' · ');
}

/**
 * **완료 조건이 느슨해지는 방향**(REQ-WEB-285) — 리뷰 조건을 끄거나, 고른 종류를 빼거나, 종류별 판정(warning 도
 * 막음)에서 종류 무관(critical 만)으로 내리거나, 증적을 누구의 것이든 받게 바꾸면 더 적게 검토한 작업이 닫힌다.
 */
export function doneGateLoosens(
  before: GatePolicy['done_gate'],
  after: GatePolicy['done_gate'],
): boolean {
  if (before.evidence_source === 'ci_or_human' && after.evidence_source === 'any') return true;
  const was = before.review_coverage;
  const now = after.review_coverage;
  if (was === false) return false;
  if (now === false) return true;
  if (Array.isArray(was)) return now === true || was.some((kind) => !now.includes(kind));
  return false;
}

/** 칸의 글자 → 정수. 빈 칸·소수·음수는 경계가 아니다 */
function parseBoundary(value: string): number | null {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/** 경계 셋이 성립하는가 — 0 이상의 정수이고 T1 ≤ T2 ≤ T3(같으면 그 사이 티어가 비어 있을 뿐이다) */
export function validBoundaries(values: readonly (number | null)[]): values is number[] {
  return (
    values.length === 3 &&
    values.every((v) => v !== null) &&
    (values[0] as number) <= (values[1] as number) &&
    (values[1] as number) <= (values[2] as number)
  );
}

/**
 * 경계 → 티어마다의 점수 구간. 서버의 `tierOf` 와 같은 규칙이다(점수 ≥ 경계면 그 티어 ·
 * `apps/api/src/modules/spec/gate-tier.ts`). 빈 구간은 "없음" 이다.
 */
export function tierRanges(
  t: Translator,
  [t1, t2, t3]: readonly number[],
): { tier: string; range: string; rule: string }[] {
  const span = (lo: number, hi: number): string =>
    lo > hi
      ? t('settings.gates.range_none')
      : lo === hi
        ? t('settings.gates.points', { range: String(lo) })
        : t('settings.gates.points', { range: `${lo}~${hi}` });
  return [
    { tier: 'T0', range: span(0, (t1 ?? 0) - 1), rule: t('settings.gates.rule_auto') },
    { tier: 'T1', range: span(t1 ?? 0, (t2 ?? 0) - 1), rule: t('settings.gates.rule_auto') },
    { tier: 'T2', range: span(t2 ?? 0, (t3 ?? 0) - 1), rule: t('settings.gates.rule_one') },
    {
      tier: 'T3',
      range: t('settings.gates.points_from', { n: t3 ?? 0 }),
      rule: t('settings.gates.rule_two'),
    },
  ];
}

function GatesTab(): React.JSX.Element {
  const t = useT();
  const me = useMe();
  // 소속은 헤더의 select 와 같은 규칙으로 정한다(scope.ts) — 예전에는 멤버십 한 행의
  // `project_slug` 를 썼고, 조직 단위 멤버십만 가진 admin 은 그 값이 `null` 이라
  // **자기 조직의 게이트 정책을 아예 열지 못했다**(실측 2026-08-24).
  const { orgSlug, projectSlug, projects, projectsLoaded } = useScope();
  const navigate = useNavigate();
  const { project: fromUrl } = Route.useSearch();
  /**
   * **고치는 프로젝트를 이 화면이 고른다**(2026-09-24 · REQ-WEB-191). 게이트 정책은 프로젝트의
   * 것인데, 예전에는 대상이 헤더가 **기억한** 프로젝트였고 제목 어디에도 이름이 없었다 —
   * admin 이 마지막으로 들렀던 프로젝트의 정책을 모르고 바꿀 수 있었다. 기억은 초깃값일 뿐이다.
   */
  // 주소의 프로젝트가 **이 조직의 것일 때만** 쓴다 — 다른 조직에서 건너온 주소면 기억한 프로젝트로 떨어진다
  const picked =
    fromUrl !== undefined && (!projectsLoaded || projects.some((p) => p['slug'] === fromUrl))
      ? fromUrl
      : null;
  // 프로젝트가 없으면 편집할 정책도 없다 — 빈 slug 로 서버를 부르지 않는다(조용한 500 의 원인)
  const slug = picked ?? projectSlug ?? '';
  const project = useProject(slug);
  const members = useMembers(orgSlug);
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();
  // `membership?.role` 은 **없는 필드**였다(멤버십이 나르는 것은 `roles` 배열이다).
  // `Membership` 이 `Record<string, unknown>` 을 확장해 타입이 잡지 못했고, 그래서
  // 이 탭은 누구에게나 읽기 전용이었다 — admin 에게도.
  const isAdmin = rolesInProject(me.data, orgSlug, slug === '' ? null : slug).includes('admin');
  const nameOf = (s: string): string =>
    String(projects.find((p) => p['slug'] === s)?.['name'] ?? s);

  // **받아 오기 전에는 저장하지 않는다**(REQ-WEB-198). 저장 본문은 정책 전체를 펼쳐 보내므로
  // (`...policy`), 불러오는 중·실패 중에 보이던 **기본 정책**을 누르면 그 프로젝트의 정책이
  // 통째로 기본값으로 덮였다.
  const loaded = project.data !== undefined;
  const stored = GatePolicySchema.safeParse(project.data?.['gate_policy'] ?? {});
  const policy = stored.success ? stored.data : GatePolicySchema.parse({});
  // **읽지 못한 정책은 저장하지 않는다**(2026-09-28 · REQ-WEB-280). 저장 본문은 정책 전체를 펼쳐
  // 보내므로, 읽지 못해 기본값으로 그린 정책을 저장하면 `done_gate` 처럼 이 화면에 없는 설정이
  // 통째로 기본값으로 덮였다 — 서버가 이 화면보다 새 정책 모양을 쓰는 동안 그럴 수 있다
  const unreadable = loaded && !stored.success;
  const current = policy.spec_gate.tier_boundaries;

  /** 고친 칸 — 손대지 않았으면 `null` 이고 저장된 값을 그린다 */
  const [draft, setDraft] = useState<string[] | null>(null);
  const [dynamicEscalation, setDynamicEscalation] = useState<boolean | null>(null);
  const [evidenceDraft, setEvidenceDraft] = useState<'any' | 'ci_or_human' | null>(null);
  const [coverageDraft, setCoverageDraft] = useState<{
    mode: CoverageMode;
    kinds: string[];
  } | null>(null);
  /** 고친 채 다른 프로젝트를 고르면 — 버릴지 묻는 동안 여기 둔다 */
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);

  const texts = draft ?? current.map(String);
  const parsed = texts.map(parseBoundary);
  const valid = validBoundaries(parsed);
  const next = valid ? parsed : current;
  const dynamic = dynamicEscalation ?? policy.spec_gate.dynamic_escalation;
  const boundariesChanged = valid && next.some((n, i) => n !== current[i]);
  const dynamicChanged = dynamic !== policy.spec_gate.dynamic_escalation;
  // **완료 조건**(2026-09-28 · clemvion 요청 N6 · 사람 결정 D9 · REQ-WEB-285)
  const done = policy.done_gate;
  const evidence = evidenceDraft ?? done.evidence_source;
  const coverageForm = coverageDraft ?? {
    mode: modeOf(done.review_coverage),
    kinds: Array.isArray(done.review_coverage) ? [...done.review_coverage] : [],
  };
  const kindsValid = coverageForm.mode !== 'kinds' || coverageForm.kinds.length > 0;
  const coverage: Coverage =
    coverageForm.mode === 'off'
      ? false
      : coverageForm.mode === 'any'
        ? true
        : (REVIEW_KINDS.filter((k) => coverageForm.kinds.includes(k)) as Exclude<
            Coverage,
            boolean
          >);
  const nextDone = { evidence_source: evidence, review_coverage: coverage };
  const evidenceChanged = evidence !== done.evidence_source;
  const coverageChanged =
    kindsValid && JSON.stringify(coverage) !== JSON.stringify(done.review_coverage);
  const dirty =
    draft !== null ||
    dynamicEscalation !== null ||
    evidenceDraft !== null ||
    coverageDraft !== null;
  const changed = boundariesChanged || dynamicChanged || evidenceChanged || coverageChanged;
  // **자동 통과가 넓어지는 방향** — 경계 하나라도 올리거나 동적 강화를 끄면 사람을 덜 거친다
  const specLoosens =
    (boundariesChanged && next.some((n, i) => n > (current[i] ?? 0))) ||
    (dynamicChanged && !dynamic);
  const loosens = specLoosens || (kindsValid && doneGateLoosens(done, nextDone));

  const switchTo = (target: string): void => {
    // 고르면 주소가 바뀐다 — 이력은 쌓지 않는다(고를 때마다 뒤로가기가 한 칸씩 늘지 않게)
    void navigate({ to: '/settings/gates', search: { project: target }, replace: true });
    // 다른 프로젝트의 값을 들고 가면 그 프로젝트에 **옛 프로젝트의 경계**가 저장된다
    setDraft(null);
    setDynamicEscalation(null);
    setEvidenceDraft(null);
    setCoverageDraft(null);
    setPendingSwitch(null);
  };

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${slug}`, {
        method: 'PATCH',
        body: {
          gate_policy: {
            ...policy,
            spec_gate: { tier_boundaries: next, dynamic_escalation: dynamic },
            done_gate: nextDone,
          },
        },
      }),
    onSuccess: () => {
      setDraft(null);
      setDynamicEscalation(null);
      setEvidenceDraft(null);
      setCoverageDraft(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectBySlug(slug) });
      pushToast({ tone: 'ok', message: t('settings.gates.saved') });
    },
    onError: onApiError,
  });

  const onOff = (value: boolean): string => t(value ? 'settings.gates.on' : 'settings.gates.off');
  /** 전후 — 무엇이 바뀌는지를 저장 전에 보인다 */
  const changes = [
    boundariesChanged &&
      t('settings.gates.change_boundaries', {
        from: current.join(' · '),
        to: next.join(' · '),
      }),
    dynamicChanged &&
      t('settings.gates.change_dynamic', {
        from: onOff(policy.spec_gate.dynamic_escalation),
        to: onOff(dynamic),
      }),
    evidenceChanged &&
      t('settings.gates.change_evidence', {
        from: t(`settings.gates.evidence_${done.evidence_source}`),
        to: t(`settings.gates.evidence_${evidence}`),
      }),
    coverageChanged &&
      t('settings.gates.change_coverage', {
        from: coverageLabel(t, done.review_coverage),
        to: coverageLabel(t, coverage),
      }),
  ].filter((line): line is string => typeof line === 'string');

  const saveBlocked =
    !isAdmin || slug === '' || !loaded || unreadable || !valid || !kindsValid || !changed;
  const saveTitle = !isAdmin
    ? t('settings.gates.admin_only_title')
    : !loaded
      ? t('settings.gates.loading_locked')
      : unreadable
        ? t('settings.gates.unreadable_locked')
        : !valid
          ? t('settings.gates.invalid')
          : !kindsValid
            ? t('settings.gates.coverage_kinds_empty')
            : !changed
              ? t('settings.gates.nothing_changed')
              : undefined;

  return (
    <section className="flex max-w-2xl flex-col gap-5">
      <PageHeader
        title={
          slug === ''
            ? t('settings.tab.gates')
            : t('settings.gates.title_project', { project: nameOf(slug) })
        }
      />
      <Field label={t('common.project')} hint={t('settings.gates.project_hint')}>
        <Select
          data-testid="gates-project"
          value={slug}
          onChange={(e) => {
            // **고친 것을 말없이 버리지 않는다** — 바뀐 값이 있으면 먼저 묻는다
            if (dirty) setPendingSwitch(e.target.value);
            else switchTo(e.target.value);
          }}
          className="max-w-xs"
        >
          {projects.map((p) => (
            <option key={String(p['slug'])} value={String(p['slug'])}>
              {String(p['name'])} ({String(p['slug'])})
            </option>
          ))}
        </Select>
      </Field>
      {pendingSwitch !== null && (
        <ConfirmBar
          testIdBase="gates-switch"
          message={t('settings.gates.switch_confirm', { project: nameOf(pendingSwitch) })}
          confirmLabel={t('settings.gates.switch_discard')}
          onConfirm={() => switchTo(pendingSwitch)}
          onCancel={() => setPendingSwitch(null)}
        />
      )}
      {!isAdmin && (
        <ReadOnlyNotice
          admins={
            members.data === undefined
              ? undefined
              : scopeAdmins(rows(members.data), slug === '' ? null : slug)
          }
        >
          {t('settings.gates.admin_only_pre')} <code className="font-mono">admin</code>{' '}
          {t('settings.gates.admin_only_post')}
        </ReadOnlyNotice>
      )}

      {unreadable && (
        <p role="alert" data-testid="gates-unreadable" className="text-sm text-status-danger">
          {t('settings.gates.unreadable')}
        </p>
      )}

      {failedWithoutData(project) && (
        <ErrorState error={project.error} onRetry={() => void project.refetch()} />
      )}

      <Card className="flex flex-col gap-4">
        {/* 없으면 비활성 필드가 **고장으로** 읽힌다 — 무엇이 편집 대상인지 먼저 말한다 */}
        <p className="text-xs text-text-mute">{t('settings.gates.lead')}</p>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-medium text-text-mute">
            {t('settings.gates.boundaries')}
          </legend>
          <div className="flex flex-wrap gap-3">
            {TIERS.map((tier, i) => (
              <Field key={tier} label={t('settings.gates.tier_field', { tier })} className="w-28">
                <Input
                  data-testid={`gate-boundary-${tier}`}
                  inputMode="numeric"
                  value={texts[i] ?? ''}
                  aria-invalid={parsed[i] === null || undefined}
                  onChange={(e) => {
                    const copy = [...texts];
                    copy[i] = e.target.value;
                    setDraft(copy);
                  }}
                  disabled={!isAdmin}
                />
              </Field>
            ))}
          </div>
          <p className="text-2xs text-text-faint">{t('settings.gates.boundaries_hint')}</p>
          {!valid && (
            <p role="alert" data-testid="gates-invalid" className="text-xs text-status-danger">
              {t('settings.gates.invalid')}
            </p>
          )}
          {/* 입력값으로 **바로** 다시 그린다 — 칸 셋만 보고는 어느 점수가 사람을 거치는지 모른다 */}
          <ul data-testid="gates-summary" className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {tierRanges(t, next).map((row) => (
              <li key={row.tier} className="text-text-mute">
                <span className="font-mono font-medium text-text">{row.tier}</span> {row.range} ·{' '}
                {row.rule}
              </li>
            ))}
          </ul>
        </fieldset>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={dynamic}
            onChange={(e) => setDynamicEscalation(e.target.checked)}
            disabled={!isAdmin}
            className="mt-1"
          />
          <span>
            {t('settings.gates.dynamic')}
            <span className="block text-xs text-text-mute">{t('settings.gates.dynamic_hint')}</span>
          </span>
        </label>
        <fieldset
          data-testid="gates-done"
          className="flex flex-col gap-3 border-t border-border pt-4"
        >
          <legend className="sr-only">{t('settings.gates.done_gate')}</legend>
          <div>
            <SectionTitle>{t('settings.gates.done_gate')}</SectionTitle>
            <p className="text-xs text-text-mute">{t('settings.gates.done_gate_hint')}</p>
          </div>
          <Field label={t('settings.gates.evidence_source')} className="max-w-sm">
            <Select
              data-testid="gates-evidence"
              value={evidence}
              onChange={(e) => setEvidenceDraft(e.target.value as 'any' | 'ci_or_human')}
              disabled={!isAdmin}
            >
              <option value="any">{t('settings.gates.evidence_any')}</option>
              <option value="ci_or_human">{t('settings.gates.evidence_ci_or_human')}</option>
            </Select>
          </Field>
          <Field label={t('settings.gates.review_coverage')} className="max-w-sm">
            <Select
              data-testid="gates-coverage"
              value={coverageForm.mode}
              onChange={(e) =>
                setCoverageDraft({ ...coverageForm, mode: e.target.value as CoverageMode })
              }
              disabled={!isAdmin}
            >
              <option value="off">{t('settings.gates.coverage_off')}</option>
              <option value="any">{t('settings.gates.coverage_any')}</option>
              <option value="kinds">{t('settings.gates.coverage_kinds')}</option>
            </Select>
          </Field>
          {coverageForm.mode === 'kinds' && (
            <div className="flex flex-col gap-1.5">
              <div data-testid="gates-coverage-kinds" className="flex flex-wrap gap-x-4 gap-y-1.5">
                {REVIEW_KINDS.map((kind) => (
                  <label key={kind} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      data-testid={`gates-coverage-kind-${kind}`}
                      checked={coverageForm.kinds.includes(kind)}
                      onChange={(e) =>
                        setCoverageDraft({
                          mode: 'kinds',
                          kinds: e.target.checked
                            ? [...coverageForm.kinds, kind]
                            : coverageForm.kinds.filter((k) => k !== kind),
                        })
                      }
                      disabled={!isAdmin}
                    />
                    {t(`review.kind.${kind}`)}
                  </label>
                ))}
              </div>
              <p className="text-2xs text-text-faint">{t('settings.gates.coverage_kinds_hint')}</p>
              {!kindsValid && (
                <p
                  role="alert"
                  data-testid="gates-coverage-empty"
                  className="text-xs text-status-danger"
                >
                  {t('settings.gates.coverage_kinds_empty')}
                </p>
              )}
            </div>
          )}
        </fieldset>
        {changes.length > 0 && (
          <div data-testid="gates-unsaved" className="text-xs">
            <p className="font-medium text-status-waiting">{t('settings.gates.unsaved')}</p>
            <ul className="mt-0.5 text-text-mute">
              {changes.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="self-start">
          {loosens && !saveBlocked ? (
            <ConfirmAction
              label={t('common.save')}
              variant="primary"
              size="md"
              testId="gates-save"
              block
              message={t(
                specLoosens
                  ? 'settings.gates.loosen_confirm'
                  : 'settings.gates.loosen_done_confirm',
              )}
              detail={changes.join(' · ')}
              confirmLabel={t('settings.gates.loosen_save')}
              pending={save.isPending}
              onConfirm={() => save.mutate()}
            />
          ) : (
            <Button
              variant="primary"
              data-testid="gates-save"
              disabled={saveBlocked || save.isPending}
              onClick={() => save.mutate()}
              title={saveTitle}
            >
              {t('common.save')}
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <SectionTitle>{t('settings.gates.failopen')}</SectionTitle>
        <p className="text-sm text-text-mute">
          {t('settings.gates.failopen_body', {
            count: policy.failopen.escalate_count,
            hours: policy.failopen.window_hours,
          })}
        </p>
      </Card>
    </section>
  );
}
