// MCP — nerv_task_* 5종. REST 컨트롤러와 같은 TaskService 인스턴스를 쓴다(D-05).
//
// 도구 본체 배선은 E03-S03 이다. TaskService 의 엔진(클레임·리스·ready)은 E04 에서 구현됐고
// L2 가 지키고 있으나, 도구가 넘겨야 할 세션 컨텍스트(PAT → session_id)가 E03-S02 에서 온다.
import { Injectable } from '@nestjs/common';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';
import type { NervToolDefinition, NervToolProvider } from '../../mcp/tool-registry.js';
import { TaskService } from './task.service.js';

function notWired(tool: string): never {
  throw new NotImplementedYetError('E03-S03', `${tool} 도구 배선`);
}

@Injectable()
export class TaskTools implements NervToolProvider {
  constructor(private readonly tasks: TaskService) {}

  readonly tools: readonly NervToolDefinition[] = [
    {
      name: 'nerv_task_next',
      tier: 'A1',
      phase: 'P0',
      summary: '클레임 직전',
      handler: async () => notWired('nerv_task_next'),
    },
    {
      name: 'nerv_task_claim',
      tier: 'A2',
      phase: 'P0',
      summary: '작업 착수',
      handler: async () => notWired('nerv_task_claim'),
    },
    {
      name: 'nerv_task_heartbeat',
      tier: 'A1',
      phase: 'P0',
      summary: '60초 주기',
      handler: async () => notWired('nerv_task_heartbeat'),
    },
    {
      name: 'nerv_task_release',
      tier: 'A2',
      phase: 'P0',
      summary: '세션 종료·작업 전환·중단',
      handler: async () => notWired('nerv_task_release'),
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
