// 프로젝트 스펙 전체 내보내기 — EP-MIR-03 `export.zip` (2026-09-28 · clemvion 요청 N5 · 사람 결정 D7 · D8 · REQ-API-251)
//
// 문서마다 GET 하면 446번이고 분당 300건 한도에 걸렸다. 롤백 백업과 첫 전체 미러를 한 번의 요청으로 받게 한다.
//
// - **같은 기준이면 같은 바이트다.** 문서는 키 순서, 첨부는 id 순서로 넣고 시각을 고정한다. 목록 파일에 만든
//   시각을 적지 않는 이유도 그것이다 — 두 번 받은 zip 이 같은지 해시 하나로 확인한다.
// - **문서는 md 미러와 같은 바이트다**(EP-MIR-01 · frontmatter 포함). 목록의 `content_hash` 로 대조가 된다.
// - **승인본이 없는 문서는 현재 버전으로 넣고** `status` · `read_as` 로 구분한다(D7 — 화면 · MCP 와 같다).
// - **첨부는 요청해야 넣는다**(D8). 넣으면 내보낸 버전의 본문이 가리키는 첨부만이다 — 목록에서 내린 것도 그
//   버전이 가리키면 넣는다(REQ-API-231 과 같은 규칙). 본문은 바꾸지 않는다. 주소 → zip 안의 경로는 목록의
//   `attachments[].id` → `path` 로 받는 쪽이 푼다.
// - **zip32 다.** 총 크기가 4GB 를 넘으면 시작하기 전에 413 으로 알린다 — 첨부 없이 받으면 된다.

import { Injectable, Logger } from '@nestjs/common';
import { msg, NERV_ERROR } from '@nerv/schema';
import { sql } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import { InjectDb } from '../../common/database.module.js';
import type { NervDb } from '../../common/database.module.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { assertVocab } from '../../common/query-vocab.js';
import { safePathSegment } from '../../common/safe-path.js';
import { StorageService } from '../../common/storage.service.js';
import { ZIP32_LIMIT, ZipStream, zipOverhead } from '../../common/zip-stream.js';
import { SpecService } from './spec.service.js';

export const EXPORT_BASES = ['approved', 'latest'] as const;
export const EXPORT_LAYOUTS = ['flat', 'tree'] as const;
export const EXPORT_INCLUDES = ['attachments'] as const;

/** 이미 압축된 형식 — 다시 압축하면 시간만 들고 작아지지 않는다 */
const PRECOMPRESSED = /^(image\/(png|jpeg|gif|webp)|application\/(pdf|zip))$/;

interface ExportedDoc {
  key: string;
  path: string;
  markdown: string;
  version: number | null;
  status: string | null;
  read_as: string;
  content_hash: string | null;
  body: string;
}

interface ExportedAttachment {
  id: string;
  path: string;
  filename: string;
  content_type: string;
  bytes: number;
  checksum: string;
  storage_key: string;
  referenced_by: string[];
}

@Injectable()
export class SpecExportService {
  private readonly logger = new Logger(SpecExportService.name);

  constructor(
    @InjectDb() private readonly db: NervDb,
    private readonly specs: SpecService,
    private readonly storage: StorageService,
  ) {}

  async archive(input: {
    projectId: string;
    projectSlug: string;
    basis: string | null;
    layout: string | null;
    include: readonly string[];
  }): Promise<{ stream: Readable; filename: string; bytes: number }> {
    const basis = assertVocab([input.basis ?? 'approved'], EXPORT_BASES, 'basis')[0]!;
    const layout = assertVocab([input.layout ?? 'flat'], EXPORT_LAYOUTS, 'layout')[0]!;
    const include = new Set(assertVocab(input.include, EXPORT_INCLUDES, 'include'));

    const nodes = (await this.specs.tree({ projectId: input.projectId, basis })).sort((a, b) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
    );
    const docs: ExportedDoc[] = [];
    for (const node of nodes) {
      const doc = await this.specs.mirrorDocument({
        projectId: input.projectId,
        specKey: node.key,
        basis,
      });
      const file = `${safePathSegment(doc.meta.key)}.md`;
      // tree: area 문서는 자기 폴더에, 그 밖은 가장 가까운 area 조상 폴더에, area 조상이 없으면 맨 위에
      const folder =
        layout === 'flat' ? null : doc.meta.type === 'area' ? doc.meta.key : doc.meta.area;
      docs.push({
        key: doc.meta.key,
        path: folder === null ? `specs/${file}` : `specs/${safePathSegment(folder)}/${file}`,
        markdown: doc.markdown,
        version: doc.meta.version,
        status: doc.meta.status,
        read_as: doc.readAs,
        content_hash: doc.meta.contentHash,
        body: doc.meta.body,
      });
    }

    const attachments = include.has('attachments')
      ? await this.referencedAttachments(input.projectId, docs)
      : [];

    const pathOf = new Map(docs.map((d) => [d.key, d.path]));
    const llms = Buffer.from(
      await this.specs.llmsTxt({
        projectId: input.projectId,
        projectName: input.projectSlug,
        linkOf: (key) => `./${pathOf.get(key) ?? `specs/${safePathSegment(key)}.md`}`,
      }),
      'utf8',
    );
    const manifest = Buffer.from(
      `${JSON.stringify(
        {
          project: input.projectSlug,
          basis,
          layout,
          include: [...include],
          specs: docs.map((d) => ({
            key: d.key,
            path: d.path,
            version: d.version,
            status: d.status,
            read_as: d.read_as,
            content_hash: d.content_hash,
          })),
          attachments: attachments.map((a) => ({
            id: a.id,
            path: a.path,
            filename: a.filename,
            content_type: a.content_type,
            bytes: a.bytes,
            checksum: a.checksum,
            referenced_by: a.referenced_by,
          })),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    // **시작하기 전에 센다** — 흘려보내기 시작한 뒤에는 상태 코드를 바꿀 수 없다. 압축하지 않았다고 치고 센다
    const bodies = docs.map((d) => Buffer.from(d.markdown, 'utf8'));
    const entries: { path: string; bytes: number }[] = [
      { path: 'manifest.json', bytes: manifest.length },
      { path: 'llms.txt', bytes: llms.length },
      ...docs.map((d, i) => ({ path: d.path, bytes: bodies[i]!.length })),
      ...attachments.map((a) => ({ path: a.path, bytes: a.bytes })),
    ];
    const total = entries.reduce((sum, e) => sum + e.bytes + zipOverhead(e.path), 22);
    if (total > ZIP32_LIMIT) {
      throw new NervError(NERV_ERROR.PRECONDITION, msg('error.export.too_large'), {
        kind: 'too_large',
        total_bytes: total,
        limit_bytes: ZIP32_LIMIT,
        ...(include.has('attachments') ? { retry_without: 'include=attachments' } : {}),
      });
    }

    const zip = new ZipStream();
    void (async (): Promise<void> => {
      try {
        await zip.add('manifest.json', manifest);
        await zip.add('llms.txt', llms);
        for (const [i, d] of docs.entries()) await zip.add(d.path, bodies[i]!);
        // 첨부는 하나씩(파일당 상한 10MB) 읽어 흘려보낸다 — zip 전체를 메모리에 모으지 않는다
        for (const a of attachments) {
          const object = await this.storage.get(a.storage_key);
          if (object === null) throw new Error(`첨부를 스토리지에서 찾지 못했다: ${a.id}`);
          const chunks: Buffer[] = [];
          for await (const chunk of object.body) chunks.push(Buffer.from(chunk as Uint8Array));
          await zip.add(a.path, Buffer.concat(chunks), !PRECOMPRESSED.test(a.content_type));
        }
        await zip.finish();
      } catch (e) {
        // 받는 쪽이 잘린 zip 을 끝난 것으로 읽지 않게 오류로 닫는다
        this.logger.warn(`내보내기가 중간에 멈췄다 (project=${input.projectId}): ${String(e)}`);
        zip.fail(e instanceof Error ? e : new Error(String(e)));
      }
    })();

    return {
      stream: zip.stream,
      filename: `${safePathSegment(input.projectSlug)}-specs-${basis}.zip`,
      bytes: total,
    };
  }

  /**
   * 내보낸 버전의 본문이 가리키는 첨부 — 본문의 `/api/v1/projects/{p}/attachments/{id}` 주소를 찾는다. 확정 전(올리다 만)
   * 첨부는 넣지 않고, 목록에서 내린 첨부는 가리키면 넣는다(REQ-API-231).
   */
  private async referencedAttachments(
    projectId: string,
    docs: readonly ExportedDoc[],
  ): Promise<ExportedAttachment[]> {
    const { rows } = await this.db.execute<{
      id: string;
      filename: string;
      content_type: string;
      bytes: number;
      checksum: string;
      storage_key: string;
    }>(sql`
      SELECT id, filename, content_type, bytes, checksum, storage_key FROM attachment
       WHERE project_id = ${projectId} AND committed_at IS NOT NULL
       ORDER BY id
    `);
    const out: ExportedAttachment[] = [];
    for (const row of rows) {
      const referencedBy = docs.filter((d) => d.body.includes(row.id)).map((d) => d.key);
      if (referencedBy.length === 0) continue;
      out.push({
        ...row,
        path: `attachments/${row.id}/${safePathSegment(row.filename)}`,
        referenced_by: referencedBy,
      });
    }
    return out;
  }
}
