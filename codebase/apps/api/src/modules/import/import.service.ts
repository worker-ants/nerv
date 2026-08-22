// 소급 적재 전용 경로 — 자연 키 대조 · 배치 upsert · 전이 검사 우회 · import.applied 이벤트
// 정본: docs/04-mvp/api.md §2.10 · docs/04-mvp/importer.md §3.2
//
// 두 가지가 이 모듈에서만 다르다.
//  ① 워크플로 전이 검사를 우회한다 — 소급 적재는 전이가 아니라 초기 적재라 전이 이벤트도 없다.
//     우회는 이 경로에서만 열리고 admin AND import:write 스코프가 그 문을 지킨다.
//  ② 무결성 제약은 그대로 받는다 — API 경유라 오히려 우회 불가능하다.
// 원본 파일은 만지지 않는다. 서버는 이미 파싱된 결과만 받는다(importer.md §3.2).
import { Injectable } from '@nestjs/common';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';
import { EventService } from '../event/event.service.js';

@Injectable()
export class ImportService {
  constructor(private readonly events: EventService) {}

  /** EP-IMP-01 — 자연 키 충돌 사전 판정. 서버 쓰기 0 */
  preflight(): never {
    throw new NotImplementedYetError('E07-S04', '임포트 preflight');
  }

  /** EP-IMP-02·03·04 — 항목 단위 트랜잭션, 배치당 import.applied 이벤트 1건 */
  applyBatch(): never {
    throw new NotImplementedYetError('E07-S04', '임포트 배치 적재');
  }
}
