// 원자적 클레임 · scope 겹침 검사 · 리스 연장 (D-04)
// 정본: docs/03-proposal/spec-workflow.md §4.3~4.5 · FR-06
//
// Phase 0 의 핵심 검증 대상이다. 동시성은 mock 으로 검증하지 않는다 — L2 통합 테스트가
// 실제 Postgres 를 상대로 검증한다(codebase.md §4.3).
import { Injectable } from '@nestjs/common';
import { LEASE_TTL_SECONDS } from '@nerv/schema';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';

@Injectable()
export class ClaimService {
  /** Task 클레임 리스와 초안 편집 리스가 같은 상수를 쓴다(D-04 · scope.md §3.5) */
  readonly leaseTtlSeconds = LEASE_TTL_SECONDS;

  /** ready → claimed 단일 트랜잭션 전환(FOR UPDATE) */
  claimAtomic(): never {
    throw new NotImplementedYetError('E04-S01', '원자적 클레임 트랜잭션');
  }

  /** spec_ids · file_globs 교집합 계산 — 경고/차단 2단계 */
  detectOverlap(): never {
    throw new NotImplementedYetError('E04-S02', 'scope 겹침 판정');
  }

  renewLease(): never {
    throw new NotImplementedYetError('E04-S03', '리스 연장');
  }

  /** 만료 리스 회수 — 워커의 lease-reaper 잡이 호출한다 */
  reapExpired(): never {
    throw new NotImplementedYetError('E04-S04', '만료 리스 자동 회수');
  }
}
