// md 미러(P1 후반). read-only git export 는 Phase 2 — M2 컷오버 시점(scope.md §5).
import { Injectable } from '@nestjs/common';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';

@Injectable()
export class ExportJob {
  readonly name = 'export';

  run(): never {
    throw new NotImplementedYetError('E09-S01', 'md 미러 생성');
  }
}
