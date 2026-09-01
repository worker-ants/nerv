// 버전 diff — 정본: screens.md §2.4 · ui-wireframes §4.3 (REQ-WEB-121)
//
// **서버는 처음부터 이것을 줄 수 있었다.** EP-SPEC-06 이 요구사항 델타와 줄 diff 를 함께
// 돌려주는데(2026-08-22 부터), 웹이 그 경로를 한 번도 부르지 않았다 — 버전 레일은
// 누를 수 없는 글자였고, 사람은 "무엇이 바뀌었나"를 화면에서 답할 수 없었다(사람 요청).
//
// **요구사항 델타가 본문 diff 보다 앞에 온다.** 리뷰에서 사람이 실제로 묻는 것은 "문구가
// 어떻게 바뀌었나"가 아니라 **"약속이 늘었나 줄었나 달라졌나"**이기 때문이다(서비스 주석의
// 같은 문장). 화면의 순서도 그래야 한다.
//
// **기본은 변경분만이다**(§4.3). 1,000줄짜리 문서를 처음부터 읽게 만드는 순간 승인은
// 형식이 된다 — 안 바뀐 구간은 접고 앞뒤 몇 줄만 남긴다.

import { useT } from '../../lib/i18n.js';
import { cn } from '../../lib/utils.js';
import type { Row } from '../../lib/queries.js';

/** 변경 줄 앞뒤로 남기는 맥락 — 세 줄이면 그 문단이 어디인지 알아볼 수 있다 */
const CONTEXT = 3;

interface DiffLine {
  op: string;
  text: string;
}

export interface VersionDiffProps {
  diff: Row | undefined;
  isPending: boolean;
  isError: boolean;
  /** 고를 수 있는 버전들 — 양 끝을 사람이 바꾼다(임의 비교) */
  versions: readonly Row[];
  from: number | null;
  to: number | null;
  onChange: (from: number, to: number) => void;
  full: boolean;
  onToggleFull: () => void;
}

export function VersionDiff({
  diff,
  isPending,
  isError,
  versions,
  from,
  to,
  onChange,
  full,
  onToggleFull,
}: VersionDiffProps): React.JSX.Element {
  const t = useT();
  const requirements = (diff?.['requirements'] ?? []) as Row[];
  const lines = (diff?.['body_diff'] ?? []) as DiffLine[];
  const counts = tally(requirements);
  const changed = requirements.filter((r) => r['delta'] !== 'unchanged');

  return (
    <section data-testid="version-diff" className="max-w-content">
      {/* 양 끝을 고른다 — 레일 클릭은 "이 버전과 직전"(빠른 길)이고 여기가 일반 길이다.
          주소(`?diff=v1..v3`)가 진실이라 이 화면은 공유·북마크가 된다 */}
      <header className="mb-3 flex flex-wrap items-center gap-2 border-b border-border pb-2.5">
        <VersionSelect
          label={t('spec.diff.from')}
          value={from}
          versions={versions}
          onPick={(v) => onChange(v, to ?? v)}
        />
        <span aria-hidden="true" className="text-text-faint">
          →
        </span>
        <VersionSelect
          label={t('spec.diff.to')}
          value={to}
          versions={versions}
          onPick={(v) => onChange(from ?? v, v)}
        />
        <button
          type="button"
          data-testid="diff-full-toggle"
          aria-pressed={full}
          onClick={onToggleFull}
          className="ml-auto rounded-nerv-sm border border-border px-2 py-0.5 text-2xs text-text-mute hover:border-border-strong hover:text-text"
        >
          {full ? t('spec.diff.changed_only') : t('spec.diff.show_all')}
        </button>
      </header>

      {isPending && <p className="text-sm text-text-mute">{t('common.loading')}</p>}
      {isError && <p className="text-sm text-status-danger">{t('spec.diff.failed')}</p>}

      {!isPending && !isError && (
        <>
          {/* **약속이 어떻게 변했나** — 이것이 첫 물음이다 */}
          <div data-testid="diff-requirements" className="mb-4">
            <p className="mb-1.5 flex flex-wrap items-center gap-2 text-sm">
              <Count n={counts.added} tone="ok" label={t('spec.diff.added')} />
              <Count n={counts.modified} tone="waiting" label={t('spec.diff.modified')} />
              <Count n={counts.removed} tone="danger" label={t('spec.diff.removed')} />
              {changed.length === 0 && (
                <span className="text-text-faint">{t('spec.diff.no_requirement_change')}</span>
              )}
            </p>
            <ul className="flex flex-col gap-1">
              {changed.map((r) => (
                <li key={String(r['ref'])} className="flex gap-2 text-sm">
                  <span
                    className={cn(
                      'w-14 shrink-0 font-mono text-2xs',
                      r['delta'] === 'added' && 'text-status-ok',
                      r['delta'] === 'removed' && 'text-status-danger',
                      r['delta'] === 'modified' && 'text-status-waiting',
                    )}
                  >
                    {t(`spec.diff.${String(r['delta'])}` as 'spec.diff.added')}
                  </span>
                  <span className="shrink-0 font-mono text-2xs text-text-faint">
                    {String(r['ref'])}
                  </span>
                  <span className="min-w-0 flex-1 text-text-mute">
                    {String(r['statement_md'] ?? '')}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div
            data-testid="diff-body"
            className="overflow-x-auto rounded-nerv border border-border bg-code-bg font-mono text-xs"
          >
            {render(lines, full).map((entry, i) =>
              entry.kind === 'gap' ? (
                <p
                  key={`gap-${String(i)}`}
                  data-testid="diff-gap"
                  className="border-y border-border bg-bg-sunken px-3 py-1 text-2xs text-text-faint"
                >
                  {t('spec.diff.skipped', { n: entry.n })}
                </p>
              ) : (
                <p
                  key={`line-${String(i)}`}
                  data-op={entry.line.op}
                  className={cn(
                    'px-3 py-0.5 whitespace-pre-wrap',
                    // 변경 문단은 좌측 세로 막대로 튄다(§4.3) — 색만으로 나르지 않는다
                    entry.line.op === 'add' && 'border-l-2 border-l-status-ok bg-status-ok-soft',
                    entry.line.op === 'del' &&
                      'border-l-2 border-l-status-danger bg-status-danger-soft',
                    entry.line.op === 'same' && 'border-l-2 border-l-transparent text-text-mute',
                  )}
                >
                  <span aria-hidden="true" className="mr-2 text-text-faint">
                    {entry.line.op === 'add' ? '+' : entry.line.op === 'del' ? '−' : ' '}
                  </span>
                  {entry.line.text === '' ? ' ' : entry.line.text}
                </p>
              ),
            )}
            {lines.length === 0 && (
              <p className="px-3 py-2 text-text-faint">{t('spec.diff.no_body_change')}</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function VersionSelect({
  label,
  value,
  versions,
  onPick,
}: {
  label: string;
  value: number | null;
  versions: readonly Row[];
  onPick: (versionNo: number) => void;
}): React.JSX.Element {
  return (
    <label className="flex items-center gap-1.5 text-2xs text-text-faint">
      {label}
      <select
        data-testid={`diff-${label}`}
        value={value ?? ''}
        onChange={(e) => onPick(Number(e.target.value))}
        className="rounded-nerv-sm border border-border bg-bg-elev px-1.5 py-0.5 font-mono text-xs text-text"
      >
        {versions.map((v) => (
          <option key={String(v['id'])} value={Number(v['version_no'])}>
            v{String(v['version_no'])}
          </option>
        ))}
      </select>
    </label>
  );
}

function Count({ n, tone, label }: { n: number; tone: string; label: string }): React.JSX.Element {
  return (
    <span
      className={cn(
        'font-medium tabular-nums',
        n === 0 && 'text-text-faint',
        n > 0 && tone === 'ok' && 'text-status-ok',
        n > 0 && tone === 'waiting' && 'text-status-waiting',
        n > 0 && tone === 'danger' && 'text-status-danger',
      )}
    >
      {label} {n}
    </span>
  );
}

function tally(requirements: readonly Row[]): {
  added: number;
  modified: number;
  removed: number;
} {
  const count = (kind: string): number => requirements.filter((r) => r['delta'] === kind).length;
  return { added: count('added'), modified: count('modified'), removed: count('removed') };
}

type Entry = { kind: 'line'; line: DiffLine } | { kind: 'gap'; n: number };

/**
 * 변경분만 남긴다 — 안 바뀐 구간은 앞뒤 `CONTEXT` 줄만 두고 접는다.
 *
 * 접은 자리를 **빈칸으로 두지 않는다**: 몇 줄을 건너뛰었는지 적어야 사람이 "여기서
 * 잘렸다"를 알고, 필요하면 전체 보기로 넘어간다.
 */
export function render(lines: readonly DiffLine[], full: boolean): Entry[] {
  if (full) return lines.map((line) => ({ kind: 'line', line }));
  const keep = new Set<number>();
  lines.forEach((line, i) => {
    if (line.op === 'same') return;
    for (let j = Math.max(0, i - CONTEXT); j <= Math.min(lines.length - 1, i + CONTEXT); j += 1) {
      keep.add(j);
    }
  });

  const out: Entry[] = [];
  let skipped = 0;
  lines.forEach((line, i) => {
    if (keep.has(i)) {
      if (skipped > 0) {
        out.push({ kind: 'gap', n: skipped });
        skipped = 0;
      }
      out.push({ kind: 'line', line });
      return;
    }
    skipped += 1;
  });
  if (skipped > 0) out.push({ kind: 'gap', n: skipped });
  return out;
}
