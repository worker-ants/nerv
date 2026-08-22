// 검색 인덱스 — 헤딩 청크 임베딩 upsert·구판 정리 (database.md §2.15 · REQ-DB-017)
// 제공자 호출은 OpenAI 호환 /v1/embeddings 단일 계약이다(REQ-CB-020) — 제공자별 분기를 두지
// 않는다. 응답 차원이 1024가 아니면 적재하지 않고 오류로 기록한다(REQ-CB-021).
import { Injectable, Logger } from '@nestjs/common';
import { EmbeddingService } from '../../modules/spec/embedding.service.js';
import type { IndexReport } from '../../modules/spec/embedding.service.js';

@Injectable()
export class EmbeddingJob {
  readonly name = 'embedding';
  readonly embedUrl = process.env['NERV_EMBED_URL'] ?? 'http://localhost:8090/v1';
  readonly model = process.env['NERV_EMBED_MODEL'] ?? 'BAAI/bge-m3';
  /** 스키마 vector(1024)·HNSW 인덱스가 차원에 묶인다 — 전 프로필 고정(REQ-CB-021). */
  readonly dimensions = 1024;

  private readonly logger = new Logger(EmbeddingJob.name);

  constructor(private readonly embeddings: EmbeddingService) {}

  async run(): Promise<IndexReport> {
    const report = await this.embeddings.runOnce();
    if (report.chunks_embedded > 0 || report.chunks_deleted > 0) {
      this.logger.log(
        `임베딩 ${report.chunks_embedded}청크 적재 · ${report.chunks_deleted}청크 삭제 ` +
          `(무변경 ${report.chunks_unchanged})`,
      );
    }
    // 제공자 무응답은 경고다 — 검색은 렉시컬로 degrade 되고(REQ-API-026) 다음 틱에 다시 시도한다.
    if (report.error !== null) this.logger.warn(`임베딩 제공자 오류 — ${report.error}`);
    return report;
  }
}
