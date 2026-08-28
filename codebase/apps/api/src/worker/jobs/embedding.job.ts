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
  readonly model = process.env['NERV_EMBED_MODEL'] ?? 'bge-m3';
  /** 스키마 vector(1024)·HNSW 인덱스가 차원에 묶인다 — 전 프로필 고정(REQ-CB-021). */
  readonly dimensions = 1024;

  private readonly logger = new Logger(EmbeddingJob.name);

  constructor(private readonly embeddings: EmbeddingService) {}

  async run(): Promise<IndexReport> {
    const report = await this.embeddings.runOnce();
    if (report.chunks_embedded > 0 || report.chunks_deleted > 0) {
      this.logger.log(
        `임베딩 ${report.chunks_embedded}청크 적재 · ${report.chunks_deleted}청크 삭제 ` +
          `(무변경 ${report.chunks_unchanged})` +
          // 시간 상한은 실패가 아니다 — 비싼 잡이 급한 잡(리스 회수·stale)을 굶기지 않으려는 것이고,
          // 남은 것은 다음 틱이 이어간다. 그래도 말은 해야 "왜 아직 다 안 됐나"에 답이 된다.
          // eslint-disable-next-line no-restricted-syntax -- 운영자용 로그(REQ-CB-022 예외)
          (report.stopped_early ? ' · 시간 상한에서 멈춤 — 다음 틱이 이어간다' : ''),
      );
    }
    // 제공자 무응답은 경고다 — 검색은 렉시컬로 degrade 되고(REQ-API-026) 다음 틱에 다시 시도한다.
    // **한 사건에 한 줄만 남긴다**: 서비스가 report.error 에 맥락(어느 문서에서 멈췄나)을 담고
    // 여기서 한 번 찍는다. 같은 실패를 두 계층이 각자 찍으면 로그가 두 배로 늘고 원인은 그대로다.
    if (report.error !== null) {
      this.logger.warn(
        `임베딩 중단(이번 판 ${report.chunks_embedded}청크 적재 후) — ${report.error}`,
      );
    }
    return report;
  }
}
