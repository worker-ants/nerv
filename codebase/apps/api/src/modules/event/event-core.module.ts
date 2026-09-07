// EventCoreModule — **의존이 없는 핵**(2026-09-07 · REQ-API-151)
//
// `EventModule` 은 `AuthModule` 을 import 한다(가드가 멤버십을 본다). 그런데 감사 축을
// 채우려면 `AuthService` 가 `EventService` 를 받아야 한다 — 그러면 순환이다.
//
// `forwardRef` 로 순환을 감추는 대신 **의존이 없는 부분을 갈라냈다.** `EventService` 와
// `ValkeyService` 는 DB 와 Valkey 만 알고 인증을 모른다. 그 둘만 담은 모듈은 누구든
// import 할 수 있고, 순환은 애초에 생기지 않는다 — 감춘 순환은 부팅에는 성공하고
// 초기화 순서에서만 터진다(그때는 원인이 보이지 않는다).

import { Module } from '@nestjs/common';
import { EventService } from './event.service.js';
import { ValkeyService } from './valkey.service.js';

@Module({
  providers: [EventService, ValkeyService],
  exports: [EventService, ValkeyService],
})
export class EventCoreModule {}
