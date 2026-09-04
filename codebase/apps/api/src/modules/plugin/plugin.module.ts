// PluginModule — 소유 테이블 없음. 배포 산출물(`plugin-dist/`)을 읽어 서빙하기만 한다.
//
// 도메인 의존이 없다 — 인증도 프로젝트 스코프도 타지 않는 무인증 표면이라(4.6 §3.5)
// AuthModule 을 import 하지 않는다. 표면 하나가 서비스 하나를 쓰는 가장 얇은 모듈이다.
import { Module } from '@nestjs/common';
import { PluginController } from './plugin.controller.js';
import { PluginService } from './plugin.service.js';

@Module({
  controllers: [PluginController],
  providers: [PluginService],
  exports: [PluginService],
})
export class PluginModule {}
