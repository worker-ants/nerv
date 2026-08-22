// REST — preflight · specs · tasks · links · map (EP-IMP-01~05)
// 권한: admin **AND** import:write 스코프. import:write 는 도구 대응이 없는 유일한 REST 전용
// 스코프다(api.md §1.3) — 임포트 MCP 도구는 만들지 않는다(scope.md §4.2).
import { Controller, Post } from '@nestjs/common';
import { ImportService } from './import.service.js';

@Controller('api/v1/projects/:proj/import')
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  /** EP-IMP-01 */
  @Post('preflight')
  preflight(): never {
    return this.imports.preflight();
  }

  /** EP-IMP-02 */
  @Post('specs')
  specs(): never {
    return this.imports.applyBatch();
  }

  /** EP-IMP-03 */
  @Post('tasks')
  tasks(): never {
    return this.imports.applyBatch();
  }

  /** EP-IMP-04 */
  @Post('links')
  links(): never {
    return this.imports.applyBatch();
  }
}
