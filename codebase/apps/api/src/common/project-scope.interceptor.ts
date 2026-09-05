// 요청 컨텍스트의 project_id 자동 주입 — 권한 없는 질의가 컴파일되지 않게 하는 원칙의 표면 절반.
// 정본: docs/04-mvp/codebase.md §2.2
//
// 경로 파라미터 {proj} 는 project.slug 다(api.md §1.2). slug → project_id 해소와 멤버십 검사는
// AuthModule 의 몫이라 E03-S02 이후에 연결한다. 지금은 slug 를 요청 컨텍스트에 싣기만 한다.

import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';

export interface ProjectScope {
  /** URL 두 번째 세그먼트 — project.slug (예: clemvion) */
  slug: string;
  /** 해소된 내부 uuid. 해소기는 E03-S02 가 연결한다. */
  projectId: string | null;
}

@Injectable()
export class ProjectScopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      params?: Record<string, string | undefined>;
      nervProjectScope?: ProjectScope;
    }>();
    const slug = req.params?.['proj'];
    if (slug !== undefined && slug !== '') {
      req.nervProjectScope = { slug, projectId: null };
    }
    return next.handle();
  }
}
