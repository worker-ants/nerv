// AGENTS.md 생성 — EP-PRJ-06 (2026-10-16 · 사람 결정 ① · api.md §2.1 · REQ-API-326 · plugin.md §5.3)
//
// **서버는 본문만 만든다.** 저장소에 쓰는 것은 사람의 기계에서 도는 `nerv-init` 이다 — 서버는 대상 저장소에 접근하지
// 않는다(4.5 §2.8). 본문은 `@nerv/schema` 의 템플릿에 그 프로젝트의 서버 주소 · 키 · 규약 스펙 목록을 채운 것이다.
// 목록은 `nerv_bootstrap` 의 `conventions` 와 같은 질의다(`conventions.ts`) — 어디서 읽어도 같은 규약을 안다.
//
// **규약 버전은 본문을 만드는 입력의 지문이다.** 템플릿 원문 · 서버 주소 · 프로젝트(slug · 키 · 이름) · 보관되지 않은
// 규약 스펙 전부(키 · 종류 · 제목 · 부모 · 승인 버전 번호)를 sha256 으로 묶어 앞 12자리를 쓴다. 그래서 ① 같은 버전이면
// 생성일 말고는 같은 본문이고 ② 규약 스펙 하나라도 새 버전이 승인되면 — 목록에 접힌 하위 규약이어도 — 버전이 바뀐다.
// 초안 저장은 바꾸지 않는다. 하나씩 올리는 번호는 그 번호를 적어 둘 자리(테이블)가 있어야 하는데, `nerv-init --check` 가
// 묻는 것은 "다시 받으면 달라지는가" 하나라 지문으로 충분하다. 서버를 올려 템플릿이 바뀌어도 버전이 바뀐다 — 낡은 문장을
// 가진 AGENTS.md 도 낡았다고 알려야 한다.

import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  AGENTS_MD_TEMPLATE,
  CONVENTIONS_LIMIT,
  msg,
  NERV_ERROR,
  renderAgentsMd,
} from '@nerv/schema';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { NERV_API_URL, apiUrlFromEnv } from '../../common/origins.js';
import { conventionFingerprintRows, foldedConventions } from './conventions.js';

/** 규약 버전의 길이 — sha256 hex 의 앞자리. 프로젝트 하나의 규약 상태를 가르는 데 48비트면 충분하다 */
const VERSION_HEX = 12;

export interface AgentsMdResult {
  markdown: string;
  version: string;
}

@Injectable()
export class AgentsMdService {
  constructor(
    @InjectDb() private readonly db: NervDb,
    @Optional()
    @Inject(NERV_API_URL)
    private readonly apiUrl: string = apiUrlFromEnv(),
  ) {}

  async render(projectId: string, now: Date = new Date()): Promise<AgentsMdResult> {
    const { rows } = await this.db.execute<{ slug: string; key: string; name: string }>(
      sql`SELECT slug, key, name FROM project WHERE id = ${projectId}`,
    );
    const project = rows[0];
    if (project === undefined) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.project.not_found'), {
        kind: 'not_found',
      });
    }
    // 주소는 `NERV_API_URL` 에서만 온다 — 요청의 `Host` 를 읽지 않는다(플러그인 카탈로그와 같은 규율 · REQ-API-086)
    const serverUrl = this.apiUrl.replace(/\/+$/, '');
    const [folded, all] = await Promise.all([
      foldedConventions(this.db, projectId),
      conventionFingerprintRows(this.db, projectId),
    ]);
    const version = createHash('sha256')
      .update(
        JSON.stringify({
          template: AGENTS_MD_TEMPLATE,
          server: serverUrl,
          project: { slug: project.slug, key: project.key, name: project.name },
          conventions: all,
          limit: CONVENTIONS_LIMIT,
        }),
      )
      .digest('hex')
      .slice(0, VERSION_HEX);
    const markdown = renderAgentsMd({
      projectName: project.name,
      projectSlug: project.slug,
      projectKey: project.key,
      serverUrl,
      version,
      generatedOn: now.toISOString().slice(0, 10),
      conventions: folded.items,
      conventionsTotal: folded.total,
      conventionsLimit: CONVENTIONS_LIMIT,
    });
    return { markdown, version };
  }
}
