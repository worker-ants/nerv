// 플러그인 활성화 현황 — screens.md §2.6 · REQ-WEB-189 (2026-09-24 · E12-S03)
//
// 백로그 E12-S03 의 수용 기준은 "관리형 settings 로 배포하면 참여 호스트의 **활성화 여부를
// 서버에서 확인** 가능하게 한다(목표 100%)" 다. 배포하는 사람이 묻는 것은 하나 — **어느 기계가
// 아직 꺼져 있는가.** 그래서 한 줄 요약이 먼저 서고, 펼치면 꺼진 기계가 위다.
//
// 세션 모니터에 두는 이유: 꺼진 기계는 이 화면에서 **흔적이 얇게** 보인다(훅이 없어 활동·
// 브랜치가 비어 있다). "왜 이 세션은 비어 있나" 를 묻는 자리에서 답이 보여야 한다.

import { useState } from 'react';
import { useT } from '../../lib/i18n.js';
import { relativeTime } from '../../lib/format.js';
import { usePluginCoverage } from '../../lib/queries.js';
import { Disclosure } from '../../components/ui/primitives.js';
import { StatusBadge } from '../../components/status-badge.js';
import type { ProjectId } from '../../lib/query-keys.js';

export function PluginCoverage({
  projectSlug,
  projectId,
}: {
  projectSlug: string;
  projectId: ProjectId | undefined;
}): React.JSX.Element | null {
  const t = useT();
  const coverage = usePluginCoverage(projectSlug, projectId);
  const [open, setOpen] = useState(false);
  const data = coverage.data;
  // 불러오는 중에는 자리를 비운다 — "0 / 0" 을 먼저 보이면 그것이 사실처럼 읽힌다
  if (data === undefined) return null;

  const allOn = data.total > 0 && data.active === data.total;
  return (
    <section data-testid="plugin-coverage" className="mb-4 text-sm">
      {/* 겉모습이 상태 배지 하나라 "어느 기계가 꺼져 있나" 가 이 안에 있는 줄 몰랐다 — 펼치기 한 벌(REQ-WEB-276) */}
      <Disclosure expanded={open} testId="plugin-coverage-toggle" onToggle={() => setOpen(!open)}>
        <StatusBadge
          token={data.total === 0 ? 'idle' : allOn ? 'ok' : 'waiting'}
          label={t('sessions.plugin.summary', { active: data.active, total: data.total })}
        />
      </Disclosure>
      {open && (
        <div className="mt-2 rounded-nerv border border-border bg-bg-elev p-3">
          <p className="mb-2 text-xs text-text-faint">
            {t('sessions.plugin.window', { days: data.window_days })}
          </p>
          {data.total === 0 ? (
            <p className="text-text-mute">
              {t('sessions.plugin.empty', { days: data.window_days })}
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-1">
                {data.hosts.map((host) => (
                  <li
                    key={`${host.user_id}:${host.hostname}`}
                    data-testid="plugin-host"
                    data-active={host.active}
                    className="flex items-center gap-2"
                  >
                    <StatusBadge
                      token={host.active ? 'ok' : 'waiting'}
                      label={
                        host.active
                          ? t('sessions.plugin.on', { version: host.plugin_version ?? '' })
                          : t('sessions.plugin.off')
                      }
                    />
                    <span className="font-mono text-xs">{host.hostname}</span>
                    <span className="text-text-mute">{host.user_name}</span>
                    <span className="ml-auto text-xs text-text-faint">
                      {relativeTime(t, host.last_seen_at)}
                    </span>
                  </li>
                ))}
              </ul>
              {!allOn && (
                <p className="mt-2 text-xs text-text-mute">{t('sessions.plugin.off_hint')}</p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
