// 하네스가 MCP 요청에 실어 준 자기 세션 id — api.md §1.4c · REQ-API-324
//
// MCP 요청의 `_meta` 는 클라이언트가 채운다. NERV 는 그 값을 세션 id 로 믿지 않는다 — external id 로 **사람과 함께**
// 찾을 뿐이라(SessionService.findByExternalId) 이 값으로 남의 세션을 고를 수는 없다.

/**
 * 하네스가 `_meta` 에 실어 준 자기 세션 id — 지금은 Codex 의 `x-codex-turn-metadata.session_id` 하나다(2026-10-15 실측:
 * 훅 입력의 `session_id` · notify 의 `thread-id` 와 같은 값이다). 모양이 틀리면 없는 것으로 본다 — 받은 값을 세션 id 로
 * 믿지 않고 external id 로 **사람과 함께** 찾을 뿐이라, 이 값으로 남의 세션을 고를 수는 없다.
 */
export function harnessSessionOf(meta: unknown): string | null {
  if (meta === null || typeof meta !== 'object') return null;
  const turn = (meta as Record<string, unknown>)['x-codex-turn-metadata'];
  if (turn === null || typeof turn !== 'object') return null;
  const id = (turn as Record<string, unknown>)['session_id'];
  return typeof id === 'string' && /^[0-9A-Za-z._:-]{1,128}$/.test(id) ? id : null;
}
