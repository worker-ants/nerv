// 검색 인덱스 — 헤딩 청크 임베딩 upsert·구판 정리 (database.md §2.15 · REQ-DB-017)
// 제공자 호출은 OpenAI 호환 /v1/embeddings 단일 계약이다(REQ-CB-020) — 제공자별 분기를 두지
// 않는다. 응답 차원이 1024가 아니면 적재하지 않고 오류로 기록한다(REQ-CB-021).
import { Injectable, Logger } from '@nestjs/common';
import { HEARTBEAT_INTERVAL_SECONDS } from '@nerv/schema';
import { EmbeddingService } from '../../modules/spec/embedding.service.js';
import type { IndexReport } from '../../modules/spec/embedding.service.js';

/**
 * 할 일이 있을 때의 주기 — 기본 1초, 즉 **연달아** 돈다.
 *
 * 한 판은 시간 상한(`NERV_EMBED_PASS_MS`)에서 끊기므로, 밀린 색인은 "20초 일하고 1초 쉬고"를
 * 반복해 빨리 따라잡는다. 예전의 5분 고정 주기로는 판당 20초씩 5분마다여서 가동률이 6.7%
 * 였고, 문서 140편을 채우는 데 몇 시간이 걸렸다(실측 2026-08-28).
 */
function fastMs(): number {
  return Number(process.env['NERV_EMBED_EVERY_MS'] ?? 1000);
}

/**
 * 할 일이 없을 때의 주기 — 하트비트의 5배(5분). 예전의 고정 주기가 여기로 남았다.
 *
 * **다 채운 뒤에도 1초마다 도는 것은 순수 낭비다.** 할 일이 없어도 한 판은 대상 버전을 전부
 * 훑으며 버전마다 기존 청크 해시를 읽는다 — 140편이면 한 판에 약 142개 질의다. 초당 142
 * 질의로 "바뀐 것 없음"만 확인하게 두지 않는다.
 */
function idleMs(): number {
  return HEARTBEAT_INTERVAL_SECONDS * 1000 * 5;
}

@Injectable()
export class EmbeddingJob {
  readonly name = 'embedding';
  readonly embedUrl = process.env['NERV_EMBED_URL'] ?? 'http://localhost:8090/v1';
  readonly model = process.env['NERV_EMBED_MODEL'] ?? 'bge-m3';
  /** 스키마 vector(1024)·HNSW 인덱스가 차원에 묶인다 — 전 프로필 고정(REQ-CB-021). */
  readonly dimensions = 1024;

  private readonly logger = new Logger(EmbeddingJob.name);
  /** 다음 판까지의 간격 — 기동 직후는 빠르게(밀린 것이 있다고 보고 확인부터 한다) */
  private nextEveryMs = fastMs();

  constructor(private readonly embeddings: EmbeddingService) {}

  /**
   * 잡 루프가 매 틱 읽는 값 — **이 잡만 주기가 변한다**(다른 다섯은 상수다).
   * 일감이 있으면 붙어서 돌고 없으면 물러난다.
   */
  get everyMs(): number {
    return this.nextEveryMs;
  }

  /** 이번 판이 실제로 무언가 했나 — 그 답이 다음 주기를 정한다. */
  private didWork(report: IndexReport): boolean {
    // 시간 상한에서 끊겼다면 남은 일이 있다는 뜻이므로 붙어서 계속한다.
    if (report.stopped_early) return true;
    // 오류는 **물러난다**: 제공자가 죽어 있으면 1초마다 두드려 봐야 같은 실패이고,
    // 그 사이 다른 잡의 자리만 좁힌다. 다음 판은 5분 뒤에 다시 시도한다.
    if (report.error !== null) return false;
    return report.chunks_embedded > 0 || report.chunks_deleted > 0;
  }

  async run(): Promise<IndexReport> {
    const report = await this.embeddings.runOnce();
    this.nextEveryMs = this.didWork(report) ? fastMs() : idleMs();
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
