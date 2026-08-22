// SpecModule — 소유 테이블 9종: spec · spec_version · requirement · requirement_version
// · spec_relation · spec_comment · change_request · spec_baseline · spec_baseline_item (§2.3)
import { Module } from '@nestjs/common';
import { EventModule } from '../event/event.module.js';
import { BaselineService } from './baseline.service.js';
import { SpecCommentService } from './spec-comment.service.js';
import { SpecController } from './spec.controller.js';
import { SpecService } from './spec.service.js';
import { SpecTools } from './spec.tools.js';

@Module({
  imports: [EventModule],
  controllers: [SpecController],
  providers: [SpecService, SpecCommentService, BaselineService, SpecTools],
  exports: [SpecService],
})
export class SpecModule {}
