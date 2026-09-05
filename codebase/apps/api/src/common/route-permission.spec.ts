// 프로젝트 경로의 모든 라우트가 권한을 선언했는가 (REQ-API-075)
//
// 이 파일이 있는 이유는 결함의 모양 때문이다. 판정 함수(`assertScope`)는 처음부터 있었고,
// 빠진 것은 **부르는 것**이었다 — task·approval·session 컨트롤러는 한 번도 부르지 않았고
// 그래서 `viewer` 로 Task 생성·클레임·전이·초안 저장이 통과했다. 런타임 가드는 fail-closed
// 라 새 라우트가 열려 있지는 않지만, 그것은 **요청이 와야** 드러난다.
//
// 여기서는 요청 없이 드러낸다: 라우트 목록과 선언 목록을 맞춰 본다. 새 라우트를 열고
// 선언을 잊으면 이 테스트가 먼저 말한다.

import { RequestMethod } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

// Nest 가 라우트 데코레이터에 심는 메타데이터 키. `@nestjs/common/constants` 는 타입 선언이
// 없어 루트 `tsc -b` 가 걸린다(같은 자리를 20e8736 이 이미 한 번 고쳤다) — 프레임워크 상수라
// 도메인 어휘가 아니고, 값만 여기 둔다.
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';
import { ROUTE_PERMISSION } from './route-permission.js';
import type { RoutePermission } from './route-permission.js';
import { ProjectController } from '../modules/auth/auth.controller.js';
import { ApprovalController } from '../modules/approval/approval.controller.js';
import { EventController } from '../modules/event/event.controller.js';
import { ImportController } from '../modules/import/import.controller.js';
import { ReviewController } from '../modules/review/review.controller.js';
import { SessionController } from '../modules/session/session.controller.js';
import { MirrorController } from '../modules/spec/mirror.controller.js';
import { SpecController } from '../modules/spec/spec.controller.js';
import { TaskController } from '../modules/task/task.controller.js';

/** ProjectAccessGuard 를 쓰는 컨트롤러 전부 — 새 컨트롤러가 생기면 여기에 더한다 */
const CONTROLLERS = [
  ApprovalController,
  EventController,
  ImportController,
  MirrorController,
  ProjectController,
  ReviewController,
  SessionController,
  SpecController,
  TaskController,
];

interface Route {
  where: string;
  path: string;
  /** POST·PUT·PATCH·DELETE 인가 */
  write: boolean;
  permission: RoutePermission | undefined;
}

const WRITE_METHODS = new Set<number>([
  RequestMethod.POST,
  RequestMethod.PUT,
  RequestMethod.DELETE,
  RequestMethod.PATCH,
]);

function routesOf(controller: new (...args: never[]) => object): Route[] {
  const prefix = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
  const proto = controller.prototype as Record<string, unknown>;
  const out: Route[] = [];
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor') continue;
    const handler = proto[name];
    if (typeof handler !== 'function') continue;
    if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
    const path = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
    const method = Number(Reflect.getMetadata(METHOD_METADATA, handler));
    out.push({
      where: `${controller.name}.${name}`,
      path: `${prefix}/${path}`.replace(/\/+/g, '/'),
      write: WRITE_METHODS.has(method),
      permission: Reflect.getMetadata(ROUTE_PERMISSION, handler) as RoutePermission | undefined,
    });
  }
  return out;
}

const ALL = CONTROLLERS.flatMap(routesOf);
const PROJECT_ROUTES = ALL.filter((r) => r.path.includes(':proj'));

describe('라우트 권한 선언 (api.md §2 전표의 권한 열)', () => {
  it('프로젝트 경로의 라우트를 실제로 모은다 — 목록이 비면 이 검사가 빈 검사가 된다', () => {
    expect(PROJECT_ROUTES.length).toBeGreaterThan(50);
  });

  it('프로젝트 경로의 모든 라우트가 권한을 선언한다', () => {
    const undeclared = PROJECT_ROUTES.filter((r) => r.permission === undefined).map((r) => r.where);
    expect(undeclared).toEqual([]);
  });

  it('선언은 권한나 역할 중 하나를 담거나, 멤버십으로 충분함을 명시한다', () => {
    const malformed = PROJECT_ROUTES.filter((r) => {
      const p = r.permission!;
      const scopes = p.scopes ?? [];
      const roles = p.roles ?? [];
      // 빈 선언(`@MemberOnly`)은 의도이므로 통과 — 형태만 본다
      return scopes.some((s) => typeof s !== 'string') || roles.some((s) => typeof s !== 'string');
    }).map((r) => r.where);
    expect(malformed).toEqual([]);
  });

  it('`spec:read` 만으로 쓰는 라우트는 넷뿐이다 — 나머지 조건은 서비스가 본다', () => {
    // 읽기 권한으로 쓰기가 열리는 자리는 **의도된 것뿐이어야 한다**. 늘어났다면 둘 중
    // 하나다: 전표가 그렇게 정했거나(그러면 여기에 더한다), 권한을 잘못 붙였거나.
    const writeWithReadOnly = PROJECT_ROUTES.filter(
      (r) => r.write && (r.permission?.scopes ?? []).join() === 'spec:read',
    ).map((r) => r.where);
    expect(writeWithReadOnly.sort()).toEqual([
      'ApprovalController.answer', // EP-QST-02 — 대상 역할·지정자는 서비스가 본다
      'SessionController.steer', // EP-SES-04 — 세션 소유자·admin, 사람 전용
      'SpecController.addComment', // EP-CMT-02 — viewer 포함이 전표의 결정이다
      'SpecController.updateComment', // EP-CMT-03 — 작성자 본인
    ]);
  });
});
