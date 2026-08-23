// 도메인 값 → 문구 키 — 정본: docs/04-mvp/screens.md §4.3
//
// **식별자는 번역하지 않는다.** `spec.approved` 도 `ready` 도 데이터이고 로그이고 API 값이라,
// 로케일마다 달라지면 화면과 기록이 갈라진다. 번역되는 것은 사람에게 보여주는 라벨뿐이고,
// 그 라벨은 식별자에서 **기계적으로** 키를 얻는다 — 표를 두 벌 관리하지 않기 위해서다.
//
// 카탈로그에 빠진 값이 있으면 `i18n.spec.ts` 가 잡는다(이벤트 카탈로그 전수 대조).

import type { NervEventName } from '../events.js';
import type { MessageKey } from './ko.js';

/** 이벤트 이름은 `<리소스>.<동사>` 라 키가 곧 `event.<그것>` 이다 */
export type EventLabelKey = `event.${NervEventName}`;

export function eventLabelKey(type: string): EventLabelKey {
  return `event.${type}` as EventLabelKey;
}

/** 상태 라벨을 갖는 엔티티 — screens.md §4.2 매핑표의 열과 같다 */
export type LabeledEntity = 'spec' | 'requirement' | 'task' | 'session';

export type StatusLabelKey = MessageKey & `status.${string}`;

export function statusLabelKey(entity: LabeledEntity, value: string): StatusLabelKey {
  return `status.${entity}.${value}` as StatusLabelKey;
}
