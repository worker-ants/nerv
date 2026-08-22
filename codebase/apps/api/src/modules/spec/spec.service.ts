// 스펙 도메인 서비스 — 상태 전이·게이트 판정의 단일 구현 (D-05 · REQ-CB-003)
//
// REST 컨트롤러(spec.controller.ts)와 MCP 도구(spec.tools.ts)가 **이 클래스의 같은 인스턴스**를
// 주입받는다. 표면에 조건 분기·게이트 규칙이 들어가면 결함이다.
// 메서드 이름은 docs/04-mvp/api.md §4 대응표의 "내부 서비스 메서드" 열과 1:1 이다.

import { Injectable } from '@nestjs/common';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';
import { EventService } from '../event/event.service.js';

@Injectable()
export class SpecService {
  constructor(private readonly events: EventService) {}

  /** nerv_spec_tree · EP-SPEC-01 */
  tree(): never {
    throw new NotImplementedYetError('E09-S01', '스펙 트리 조회');
  }

  /** nerv_spec_search · EP-SPEC-02 — 하이브리드 파이프라인(api.md §2.2b) */
  search(): never {
    throw new NotImplementedYetError('E09-S10', '하이브리드 검색');
  }

  /** nerv_spec_get · EP-SPEC-03 */
  get(): never {
    throw new NotImplementedYetError('E09-S01', '스펙 조회');
  }

  /** nerv_spec_draft_upsert · EP-SPEC-07·08 — base_version 409·편집 리스가 이 안에 있다 */
  draftUpsert(): never {
    throw new NotImplementedYetError('E10-S01', '초안 upsert(편집 리스·base_version)');
  }

  /** nerv_spec_submit_review · EP-SPEC-10 — A3, pending Approval 재사용 */
  submitReview(): never {
    throw new NotImplementedYetError('E10-S04', '검토 요청 제출');
  }

  /** nerv_spec_check · EP-SPEC-09 — 사전 검토 5검사기 */
  check(): never {
    throw new NotImplementedYetError('E09-S02', '사전 검토 5검사기');
  }

  /** nerv_spec_comment_resolve · EP-CMT-04 */
  resolveComment(): never {
    throw new NotImplementedYetError('E10-S03', '코멘트 해소');
  }

  /** EP-SPEC-15~17 — 메타 수정·아카이브·복원(대응 MCP 도구 없음) */
  updateMeta(): never {
    throw new NotImplementedYetError('E09-S08', '스펙 메타 수정');
  }

  /** EP-SPEC-18 — 양방향 관계·역참조 */
  relations(): never {
    throw new NotImplementedYetError('E09-S12', '관계 조회');
  }
}
