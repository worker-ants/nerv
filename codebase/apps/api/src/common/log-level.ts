// 로그 수준 — `NERV_LOG_LEVEL` (정본: docs/04-mvp/codebase.md §5.2 전표)
//
// **전표가 소비자를 적으면 그것이 계약이다.** §5.2 는 이 변수의 소비자를 "api · worker" 라
// 적어 두었는데 2026-09-06 까지 저장소 전체에서 `LOG_LEVEL` 참조가 **0건**이었다 —
// 운영자가 값을 바꿔도 아무 일이 일어나지 않았고, 장애 때 로그를 늘릴 손잡이가 실은
// 없었다(재배포 말고는). 유령 인자·유령 응답 필드와 같은 부류의, **유령 설정**이다.
//
// 두 진입점(`main.ts` · `worker.ts`)이 같은 함수를 쓴다. 두 곳에서 따로 파싱하면
// 언젠가 한쪽만 값을 늘리거나 기본값이 갈린다.

import type { LogLevel } from '@nestjs/common';

/**
 * 심각도 오름차순. 고른 수준과 **그보다 심각한 것**을 켠다 — `warn` 을 고른 사람은
 * 경고와 오류를 보고 싶은 것이지 경고만 보고 싶은 것이 아니다.
 */
const LEVELS: readonly LogLevel[] = ['verbose', 'debug', 'log', 'warn', 'error', 'fatal'];

/** 기본은 `log` — 운영에서 `debug` 를 기본으로 두면 비밀이 로그에 실릴 창이 넓어진다 */
const DEFAULT_LEVEL: LogLevel = 'log';

/**
 * 운영자가 쓰는 이름을 받는다.
 *
 * compose·k8s 가 이미 `NERV_LOG_LEVEL:-info` 를 넘기고 있고, `info`·`warning`·`trace` 는
 * 다른 스택에서 몸에 밴 이름이다. Nest 의 어휘로만 받으면 **배포 파일을 전부 고쳐야 하고
 * 그때까지 운영자가 친 값은 조용히 기본으로 떨어진다** — 받는 쪽이 이름을 아는 편이 싸다.
 */
const ALIASES: Readonly<Record<string, LogLevel>> = {
  info: 'log',
  warning: 'warn',
  trace: 'verbose',
  critical: 'fatal',
};

export function logLevelsFromEnv(env: NodeJS.ProcessEnv = process.env): LogLevel[] {
  const typed = (env['NERV_LOG_LEVEL'] ?? '').trim().toLowerCase();
  const raw = ALIASES[typed] ?? typed;
  const index = LEVELS.indexOf(raw as LogLevel);
  // **모르는 값에 침묵하지 않는다.** 오타(`warning`·`INFO`)로 로그가 통째로 꺼지면
  // 그 사실을 알려 줄 로그마저 없다 — 기본으로 떨어지되 한 줄 남긴다.
  if (typed !== '' && index === -1) {
    // 로거를 세우기 전이라 `console` 이다 — 운영자용 설정 오류는 카탈로그 밖이다(REQ-CB-022 예외)
    console.warn(
      `NERV_LOG_LEVEL="${typed}" 은 알 수 없는 값입니다 — ${DEFAULT_LEVEL} 로 시작합니다. ` +
        `가능한 값: ${LEVELS.join(' · ')} (별칭: ${Object.keys(ALIASES).join(' · ')})`,
    );
  }
  const from = index === -1 ? LEVELS.indexOf(DEFAULT_LEVEL) : index;
  return [...LEVELS.slice(from)];
}
