// SpecModule — 소유 테이블 9종: spec · spec_version · requirement · requirement_version
// · spec_relation · spec_comment · change_request · spec_baseline · spec_baseline_item (§2.3)
import { Module } from '@nestjs/common';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import { EventModule } from '../event/event.module.js';
import { BaselineService } from './baseline.service.js';
import { SpecCommentService } from './spec-comment.service.js';
import { MirrorController } from './mirror.controller.js';
import { SpecController } from './spec.controller.js';
import { SpecCheckService } from './spec-check.service.js';
import { SpecRelationService } from './spec-relation.service.js';
import { SearchService } from './search.service.js';
import { EmbeddingService } from './embedding.service.js';
import { SpecService } from './spec.service.js';
import { AttachmentService } from './attachment.service.js';
import { StorageService } from '../../common/storage.service.js';
import { SpecTools } from './spec.tools.js';

@Module({
  imports: [EventModule, AuthModule],
  controllers: [SpecController, MirrorController],
  providers: [
    AttachmentService,
    StorageService,
    SpecService,
    SpecCheckService,
    SpecRelationService,
    SearchService,
    EmbeddingService,
    SpecCommentService,
    BaselineService,
    SpecTools,
    ProjectAccessGuard,
  ],
  exports: [
    SpecService,
    SpecCommentService,
    SpecRelationService,
    SearchService,
    EmbeddingService,
    BaselineService,
  ],
})
export class SpecModule {}
