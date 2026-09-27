// 프로젝트마다 알림을 받는 수준 — 모두 · 중요만 · 알리지 않음 (2026-09-27 사람 결정 N3 · REQ-WEB-259·260)
//
// 알림을 끄거나 줄일 방법이 없어서, 한 프로젝트의 한 종류가 안 읽은 알림 대부분을 차지해도 할 수 있는
// 것은 [모두 읽음]뿐이었다. 고른 수준 밖의 알림은 버리지 않고 읽음으로 들어온다 — 배지에 잡히지 않지만
// 그 프로젝트를 골라 "전체" 로 보면 기록이 남아 있다. 받은 요청에는 닿지 않는다(REQ-API-219).
//
// 고르는 자리는 둘이고 같은 부품을 쓴다 — 알림 센터에서 그 프로젝트로 좁혔을 때, 그리고 내 계정 설정.

import { NOTIFICATION_LEVELS } from '@nerv/schema';
import type { NotificationLevel } from '@nerv/schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api.js';
import { useApiError } from '../../lib/api-errors.js';
import { useT } from '../../lib/i18n.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import { Segmented } from '../../components/ui/primitives.js';

/** 서버가 준 값을 어휘로 좁힌다 — 모르는 값은 기본(`all`)이다 */
export function levelOf(value: unknown): NotificationLevel {
  return (NOTIFICATION_LEVELS as readonly string[]).includes(String(value))
    ? (value as NotificationLevel)
    : 'all';
}

export function NotificationLevelControl({
  org,
  project,
  scope,
  level,
  testIdPrefix,
}: {
  org: string;
  project: string;
  /** 토스트가 적는 이름 — "Default / sudoku" */
  scope: string;
  level: NotificationLevel;
  testIdPrefix: string;
}): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();
  const labelOf = (value: NotificationLevel): string => t(`notif.level.${value}`);
  const save = useMutation({
    mutationFn: (next: NotificationLevel) =>
      apiFetch<{ ok: true; level: string }>('/me/notifications/level', {
        method: 'PUT',
        body: { org, project, level: next },
      }),
    onSuccess: (result) => {
      // 칸 · 설정 · 개요가 같은 범위별 수(`scopes`)를 본다 — 상위 키 하나로 함께 간다
      void queryClient.invalidateQueries({ queryKey: queryKeys.myNotifications() });
      pushToast({
        tone: 'ok',
        message: t('notif.level.saved', { scope, level: labelOf(levelOf(result.level)) }),
      });
    },
    onError: onApiError,
  });
  return (
    <Segmented
      label={t('notif.level.label')}
      value={level}
      options={NOTIFICATION_LEVELS.map((value) => ({ value, label: labelOf(value) }))}
      onChange={(next) => {
        if (next !== level && !save.isPending) save.mutate(next);
      }}
      testIdPrefix={testIdPrefix}
    />
  );
}
