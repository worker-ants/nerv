// 사람이 지금 볼 수 있는 프로젝트 — 멤버십 판정 한 곳 (api.md §2.6·§2.7 · REQ-API-211·213)
//
// 받은 요청은 처음부터 "지금 그 프로젝트(또는 조직 전체)의 멤버인가" 를 보았는데, 알림은
// 받는 사람(`user_id`)만 보았다. 알림 행은 만들 때의 멤버에게 남으므로, 프로젝트에서 빠진
// 사람이 그 프로젝트의 스펙 키와 제목을 알림으로 계속 읽었다(2026-09-27 점검). 같은 판정을
// 목록마다 손으로 적으면 언젠가 한쪽만 고쳐진다 — 그래서 여기 한 곳에 둔다.

import { msg, NERV_ERROR } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { NervDb } from './database.module.js';
import { looksLikeUuid } from './entity-ref.js';
import { NervError } from './nerv-exception.filter.js';

/**
 * `p` 로 JOIN 한 프로젝트에 이 사람이 **지금** 멤버인가 — 조직 전체 멤버십(`project_id IS NULL`)도
 * 그 조직의 모든 프로젝트에 든다. 부르는 질의는 프로젝트를 `p` 라는 이름으로 JOIN 해야 한다.
 */
export function memberOfProjectSql(userId: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM membership m
     WHERE m.user_id = ${userId} AND m.org_id = p.org_id
       AND (m.project_id IS NULL OR m.project_id = p.id)
  )`;
}

export interface MemberProject {
  id: string;
  slug: string;
  org_slug: string;
}

/**
 * 모든 조직을 가로지르는 목록의 `project` 인자를 **내가 속한 프로젝트 하나**로 푼다(REQ-API-213).
 *
 * slug 는 조직 안에서만 유일하다(REQ-API-152). 예전에는 `p.slug = …` 로만 걸러, 두 조직에 같은
 * 이름의 프로젝트가 있으면 둘 다 걸렸다. 이제 UUID 나 `org` 한정자로 좁히고, 그래도 둘 이상이면
 * `ambiguous_project` 로 거절한다. 속하지 않은 프로젝트는 없는 프로젝트와 같은 답이다 — 있는지를
 * 알려 주는 것도 경계 밖의 정보다.
 */
export async function resolveMemberProject(
  db: NervDb,
  userId: string,
  ref: { project: string; org?: string | null },
): Promise<MemberProject> {
  const project = ref.project.trim();
  const org = ref.org?.trim() ?? '';
  const match = looksLikeUuid(project) ? sql`p.id = ${project}` : sql`p.slug = ${project}`;
  const { rows } = await db.execute<{ id: string; slug: string; org_slug: string }>(sql`
    SELECT p.id, p.slug, o.slug AS org_slug
      FROM project p
      JOIN organization o ON o.id = p.org_id
     WHERE ${match}
       ${org === '' ? sql`` : sql`AND o.slug = ${org}`}
       AND ${memberOfProjectSql(userId)}
     ORDER BY o.slug
  `);
  const only = rows[0];
  if (only === undefined) {
    throw new NervError(NERV_ERROR.PRECONDITION, msg('error.project.not_found'), {
      kind: 'not_found',
      field: 'project',
      project,
      ...(org === '' ? {} : { org }),
    });
  }
  if (rows.length > 1) {
    throw new NervError(
      NERV_ERROR.PRECONDITION,
      msg('error.project.ambiguous', { slug: project }),
      {
        kind: 'ambiguous_project',
        field: 'project',
        slug: project,
        orgs: rows.map((r) => r.org_slug),
      },
    );
  }
  return only;
}
