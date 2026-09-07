// ClaimModule — 회수·겹침 판정 한 벌 (D-05 · REQ-CB-005)
//
// `ClaimService` 만 담는 모듈이 따로 있는 이유는 **쓰는 쪽이 둘**이기 때문이다:
// Task 표면(클레임·해제)과 세션 표면(종료·중단·stale 회수). TaskModule 이 이미
// SessionModule 을 import 하므로 반대 방향을 열면 순환이 되고, 양쪽에 provider 를
// 따로 두면 인스턴스가 둘이 된다 — 워커의 잡과 API 가 다른 객체를 쥐는 순간
// "회수 규칙이 한 곳" 이라는 D-05 의 문장이 코드에서 거짓이 된다(app.module.spec 이 그것을 센다).
import { Module } from '@nestjs/common';
import { ClaimService } from './claim.service.js';

@Module({
  providers: [ClaimService],
  exports: [ClaimService],
})
export class ClaimModule {}
