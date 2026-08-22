// 스펙 코멘트 — 헤딩 slug·REQ ref 앵커, open→resolved 추적 (data-model §2.2 · D-09)
import { Injectable } from '@nestjs/common';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';

@Injectable()
export class SpecCommentService {
  add(): never {
    throw new NotImplementedYetError('E10-S03', '코멘트 작성');
  }

  listOpen(): never {
    throw new NotImplementedYetError('E10-S03', 'open 코멘트 조회');
  }
}
