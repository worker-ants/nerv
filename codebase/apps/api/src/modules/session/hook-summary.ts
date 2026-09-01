// 도구 호출 한 줄 요약 — 정본: screens.md §2.6 (REQ-WEB-123)
//
// 예전에는 `title = tool_name` 이라 타임라인이 "Bash / Bash" 를 383번 반복했다(실측
// 2026-09-01). 도구 이름은 **무엇을 했는가**가 아니다 — 그 답은 인자에 있다.
//
// 요약은 **인용이지 추정이 아니다**: 원문을 보관하므로(REQ-API-065) 여기서 만드는 것은
// 펼치기 전에 보이는 한 줄일 뿐이고, 틀리면 펼쳐서 바로 확인된다.

/** 한 줄이 넘어가면 목록이 아니라 문단이 된다 */
const TITLE_LIMIT = 80;

function str(value: unknown, key: string): string {
  if (typeof value !== 'object' || value === null) return '';
  const found = (value as Record<string, unknown>)[key];
  return typeof found === 'string' ? found : '';
}

/** 경로는 **끝이 정보다** — 앞을 접는다(`apps/api/…/spec.service.ts`) */
export function shortPath(path: string, cwd = ''): string {
  const relative = cwd !== '' && path.startsWith(cwd) ? path.slice(cwd.length + 1) : path;
  const parts = relative.split('/').filter((p) => p !== '');
  if (parts.length <= 3) return relative;
  return `${parts[0] ?? ''}/${parts[1] ?? ''}/…/${parts[parts.length - 1] ?? ''}`;
}

/** 첫 줄만, 그리고 짧게 — 여러 줄 명령은 목록을 무너뜨린다 */
function firstLine(text: string): string {
  const line = text.split('\n')[0]?.trim() ?? '';
  return line.length > TITLE_LIMIT ? `${line.slice(0, TITLE_LIMIT - 1)}…` : line;
}

/**
 * 도구·인자 → 사람이 읽는 한 줄.
 *
 * **도구마다 정보가 있는 자리가 다르다**: Bash 는 명령, 편집기는 경로, nerv 도구는 대상 키.
 * 모르는 도구는 이름만 남긴다 — 지어내지 않는다.
 */
export function summarize(toolName: string, toolInput: unknown, cwd = ''): string {
  const command = str(toolInput, 'command');
  if (command !== '') return `${toolName} · ${firstLine(command)}`;

  const path =
    str(toolInput, 'file_path') || str(toolInput, 'path') || str(toolInput, 'notebook_path');
  if (path !== '') return `${toolName} · ${shortPath(path, cwd)}`;

  const pattern = str(toolInput, 'pattern');
  if (pattern !== '') {
    const scope = str(toolInput, 'glob') || str(toolInput, 'path');
    return `${toolName} · ${firstLine(pattern)}${scope === '' ? '' : ` in ${shortPath(scope, cwd)}`}`;
  }

  // nerv 도구는 대상이 곧 제목이다 — 어느 스펙·어느 Task 인가
  const subject =
    str(toolInput, 'spec_id') ||
    str(toolInput, 'task_id') ||
    str(toolInput, 'key') ||
    str(toolInput, 'finding_id') ||
    str(toolInput, 'q');
  if (subject !== '') return `${toolName} · ${firstLine(subject)}`;

  const description = str(toolInput, 'description') || str(toolInput, 'title');
  if (description !== '') return `${toolName} · ${firstLine(description)}`;
  return toolName;
}

/**
 * 성공했나 — **지금은 성패조차 몰랐다**. 실패가 눈에 띄어야 그 타임라인이 쓸모를 갖는다.
 *
 * 훅 응답의 모양이 도구마다 다르므로 아는 것만 읽고, 모르면 `null` 이다(모르는 것을
 * "성공" 으로 적으면 그 표시를 믿을 수 없게 된다).
 */
export function outcomeOf(toolResponse: unknown): { ok: boolean; detail: string | null } | null {
  if (typeof toolResponse !== 'object' || toolResponse === null) return null;
  const response = toolResponse as Record<string, unknown>;

  const interrupted = response['interrupted'];
  if (interrupted === true) return { ok: false, detail: 'interrupted' };

  const code = response['exit_code'] ?? response['exitCode'] ?? response['code'];
  if (typeof code === 'number') {
    return { ok: code === 0, detail: code === 0 ? null : `exit ${String(code)}` };
  }

  // 훅이 `is_error` 를 주는 도구들 — 도구 실행 실패는 도구가 안다
  if (response['is_error'] === true || response['isError'] === true) {
    return { ok: false, detail: null };
  }

  const stderr = response['stderr'];
  if (typeof stderr === 'string' && stderr.trim() !== '') return { ok: false, detail: 'stderr' };
  return { ok: true, detail: null };
}
