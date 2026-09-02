// 워커 모듈 — 잡 러너만. HTTP 표면은 조립하지 않는다(REQ-CB-005).
//
// 잡은 도메인 서비스를 DI 로 받는다 — API 표면과 같은 판정 코드를 쓴다는 뜻이고,
// 그래서 회수·전이 규칙이 워커와 API 에서 갈라질 수 없다(D-05).
import { Module } from '@nestjs/common';
import { EventModule } from '../modules/event/event.module.js';
import { SpecModule } from '../modules/spec/spec.module.js';
import { SessionModule } from '../modules/session/session.module.js';
import { TaskModule } from '../modules/task/task.module.js';
import { AdvisoryLock } from './advisory-lock.js';
import { JobRunner } from './job-runner.js';
import { EmbeddingJob } from './jobs/embedding.job.js';
import { ExportJob } from './jobs/export.job.js';
import { LeaseReaperJob } from './jobs/lease-reaper.job.js';
import { NotificationJob } from './jobs/notification.job.js';
import { PartitionJob } from './jobs/partition.job.js';
import { RetentionJob } from './jobs/retention.job.js';
import { SessionStaleJob } from './jobs/session-stale.job.js';

@Module({
  imports: [TaskModule, SessionModule, EventModule, SpecModule],
  providers: [
    AdvisoryLock,
    JobRunner,
    LeaseReaperJob,
    SessionStaleJob,
    NotificationJob,
    PartitionJob,
    ExportJob,
    RetentionJob,
    EmbeddingJob,
  ],
  exports: [AdvisoryLock, JobRunner],
})
export class WorkerModule {}
