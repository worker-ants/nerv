// MCP — nerv_task_* 5종. REST 컨트롤러와 같은 TaskService 인스턴스를 쓴다(D-05).
import { Injectable } from '@nestjs/common';
import type { NervToolDefinition, NervToolProvider } from '../../mcp/tool-registry.js';
import { TaskService } from './task.service.js';

@Injectable()
export class TaskTools implements NervToolProvider {
  constructor(private readonly tasks: TaskService) {}

  readonly tools: readonly NervToolDefinition[] = [
    {
      name: 'nerv_task_next',
      tier: 'A1',
      phase: 'P0',
      summary: '클레임 직전',
      handler: async () => this.tasks.next(),
    },
    {
      name: 'nerv_task_claim',
      tier: 'A2',
      phase: 'P0',
      summary: '작업 착수',
      handler: async () => this.tasks.claim(),
    },
    {
      name: 'nerv_task_heartbeat',
      tier: 'A1',
      phase: 'P0',
      summary: '60초 주기',
      handler: async () => this.tasks.heartbeat(),
    },
    {
      name: 'nerv_task_release',
      tier: 'A2',
      phase: 'P0',
      summary: '세션 종료·작업 전환·중단',
      handler: async () => this.tasks.release(),
    },
    {
      name: 'nerv_task_update',
      tier: 'A2',
      phase: 'P1',
      summary: '상태 변화 시점(done 시도는 서버 게이트)',
      handler: async () => this.tasks.transition(),
    },
  ];
}
