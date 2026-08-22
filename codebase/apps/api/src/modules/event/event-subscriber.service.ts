// 파드별 SUBSCRIBE nerv_events → 자기 소켓·SSE 스트림 emit (codebase.md §2.1)
//
// 크로스파드 socket.io 어댑터를 두지 않는 이유가 여기다 — 모든 emit 의 원천이 Valkey 방송이라
// 파드마다 구독만 걸면 자기에게 붙은 연결에 밀어줄 수 있다.

import { Injectable } from '@nestjs/common';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';
import { ValkeyService } from './valkey.service.js';

@Injectable()
export class EventSubscriberService {
  constructor(private readonly valkey: ValkeyService) {}

  start(): never {
    throw new NotImplementedYetError('E05-S02', '파드별 nerv_events 구독 팬아웃');
  }
}
