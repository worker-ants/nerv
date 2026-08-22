// Valkey 클라이언트 provider — PUBLISH·SUBSCRIBE 공용 커넥션 관리 (codebase.md §2.2)
// 접속 정보는 NERV_VALKEY_URL(.env 전표 §5.2). 무영속 pub/sub 전용이라 유실을 허용한다(D-14).

import { Injectable, Logger } from '@nestjs/common';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';

@Injectable()
export class ValkeyService {
  private readonly logger = new Logger(ValkeyService.name);
  readonly url = process.env['NERV_VALKEY_URL'] ?? 'redis://localhost:6379';

  publish(): never {
    throw new NotImplementedYetError('E02-S03', 'Valkey PUBLISH 커넥션');
  }

  subscribe(): never {
    throw new NotImplementedYetError('E02-S03', 'Valkey SUBSCRIBE 커넥션');
  }
}
