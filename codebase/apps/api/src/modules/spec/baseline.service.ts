// 베이스라인 동결·조회 + as-of/baseline manifest
// 정본: docs/03-proposal/spec-workflow.md §3.6 · REQ-API-015
import { Injectable } from '@nestjs/common';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';

@Injectable()
export class BaselineService {
  /** EP-SPEC-12 — approved 가 아닌 SpecVersion 이 섞이면 전체 거부 */
  create(): never {
    throw new NotImplementedYetError('E09-S06', '베이스라인 생성');
  }

  /** EP-SPEC-14 — 핀된 버전이 이후 superseded 여도 결과는 불변 */
  manifest(): never {
    throw new NotImplementedYetError('E09-S06', '베이스라인 manifest');
  }
}
