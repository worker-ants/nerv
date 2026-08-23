// md 미러 파일 생성 (P1 후반) — read-only git export 는 Phase 2, M2 컷오버 시점(scope.md §5)
//
// **DB 가 진실이고 md 는 표현이다**(D-09). 이 잡은 그 표현을 파일로 떨어뜨려, git 을 보는
// 도구·사람이 NERV 없이도 승인된 스펙을 읽을 수 있게 한다 — 반대 방향(파일 → DB)은 없다.
// 파일에서 DB 로 되돌아오는 경로를 열면 두 개의 진실이 생긴다.
//
// Phase 2 의 git export 와 다른 점: 여기서는 **커밋하지 않는다**. 디렉터리에 쓰기만 하고,
// 그것을 어떻게 배포할지(git push·오브젝트 스토리지·정적 호스팅)는 운영의 선택이다.
import { Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { SpecService } from '../../modules/spec/spec.service.js';

export interface ExportReport {
  root: string | null;
  projects: number;
  files: number;
  skipped: string | null;
}

@Injectable()
export class ExportJob {
  readonly name = 'export';
  private readonly logger = new Logger(ExportJob.name);

  constructor(
    private readonly specs: SpecService,
    @InjectDb() private readonly db: NervDb,
  ) {}

  async run(): Promise<ExportReport> {
    const root = process.env['NERV_EXPORT_DIR'];
    // 경로가 없으면 **아무것도 하지 않는다.** 임의의 위치에 파일을 흩뿌리는 것이
    // 이 잡이 할 수 있는 최악이다 — 운영이 명시적으로 켠 경우에만 돈다.
    if (root === undefined || root === '') {
      // eslint-disable-next-line no-restricted-syntax -- 운영자용 로그(REQ-CB-022)
      return { root: null, projects: 0, files: 0, skipped: 'NERV_EXPORT_DIR 미설정' };
    }

    const { rows: projects } = await this.db.execute<{ id: string; slug: string; name: string }>(
      sql`SELECT id, slug, name FROM project WHERE archived_at IS NULL`,
    );

    let files = 0;
    for (const project of projects) {
      const dir = join(root, project.slug);
      await mkdir(join(dir, 'specs'), { recursive: true });

      await writeFile(
        join(dir, 'llms.txt'),
        await this.specs.llmsTxt({ projectId: project.id, projectName: project.name }),
        'utf8',
      );
      files += 1;

      // 승인된 것만 내보낸다 — draft 를 파일로 떨어뜨리면 "승인 전 문서가 승인된 것처럼"
      // 읽히는 경로가 생긴다(문서 축 상태가 파일에서는 보이지 않기 때문이다).
      const nodes = await this.specs.tree({ projectId: project.id });
      for (const node of nodes) {
        if (node.doc_status !== 'approved') continue;
        const markdown = await this.specs.mirrorMarkdown({
          projectId: project.id,
          specKey: node.key,
        });
        await writeFile(join(dir, 'specs', `${node.key}.md`), markdown, 'utf8');
        files += 1;
      }
    }

    this.logger.log(`md 미러 ${files}개 파일 생성 (${projects.length}개 프로젝트)`);
    return { root, projects: projects.length, files, skipped: null };
  }
}
