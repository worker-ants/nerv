// 훅 페이로드 마스킹 — 정본: docs/04-mvp/api.md §2.9 (REQ-API-065)
//
// **원문을 보관한다**(2026-09-01 — 사람 결정). 예전에는 `tool_name` 만 남겨서 세션 타임라인이
// "Bash / Bash" 를 383번 반복했다(실측) — 무엇을 했는지도, 성공했는지도 알 수 없었다.
//
// **비밀만 예외다.** 그리고 그 예외는 **적재 시점**에 적용한다: 저장한 뒤 화면에서만 가리면
// 백업·복제본·파티션에 이미 들어간 값을 되돌리지 못한다. 예외가 뜻을 가지려면 DB 에 안
// 들어가야 한다.
//
// **완벽하지 않다.** 이름도 모양도 없는 비밀(`curl -d "$(cat secret.txt)"`)은 못 잡는다.
// 이 규칙은 노출을 **줄이는** 것이지 없애는 것이 아니라서, 원문 열람 권한이 함께 필요하다
// (세션 본인 + admin — REQ-API-066).
//
// 원칙 둘:
//   ① **애매하면 가린다** — 가려서 잃는 것은 재현 한 번이고, 새서 잃는 것은 토큰 회전이다.
//   ② **가렸다고 말한다** — 조용히 지우면 사람은 "도구가 그 인자를 안 받았나" 로 읽는다.

/** 가린 자리에 남기는 표시 — 무엇 때문에 가렸는지까지 적는다 */
export function masked(reason: string): string {
  return `···(masked: ${reason})`;
}

/** 열쇠 **이름**이 비밀이라고 말하는 것 — 값 전체를 가린다 */
const SECRET_KEY =
  /(^|[_.-])(token|secret|password|passwd|pwd|api[_-]?key|apikey|credential|private[_-]?key|auth|authorization|session[_-]?key|access[_-]?key)([_.-]|$)/i;

/** 값의 **모양**이 비밀이라고 말하는 것 — 이름이 없어도 잡힌다 */
const SECRET_SHAPES: { re: RegExp; reason: string }[] = [
  {
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    reason: 'private_key',
  },
  { re: /\bsk-[A-Za-z0-9_-]{16,}/g, reason: 'api_key' },
  { re: /\bghp_[A-Za-z0-9]{20,}/g, reason: 'github_token' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, reason: 'github_token' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, reason: 'slack_token' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, reason: 'aws_key' },
  // JWT — 세 마디가 점으로 이어진 base64url. 앞머리 `eyJ` 가 헤더의 `{"` 다
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, reason: 'jwt' },
];

/** `KEY=값` · `--api-key 값` · `Authorization: …` — 이름이 앞에 붙은 대입 형태 */
const ASSIGNMENTS: { re: RegExp; reason: string; keepTail?: boolean }[] = [
  {
    re: /\b([A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|KEY|CREDENTIAL)[A-Za-z0-9_]*\s*=\s*)("[^"]*"|'[^']*'|\S+)/gi,
    reason: 'env',
  },
  {
    re: /(--(?:token|secret|password|api[_-]?key|credential)(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi,
    reason: 'arg',
  },
  { re: /\b(Authorization\s*:\s*)(Bearer\s+\S+|Basic\s+\S+|\S+)/gi, reason: 'authorization' },
  // 주소에 박힌 자격 — postgres://user:pw@host. `@` 뒤는 호스트라 남긴다
  {
    re: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]+)(@)/gi,
    reason: 'url_credential',
    keepTail: true,
  },
];

/**
 * **파일 자체가 비밀인 것** — 내용에는 열쇠 이름이 없어서 패턴으로는 절대 못 잡는다.
 * 그 도구 호출의 **응답 전체**를 가리고 경로는 남긴다(무엇을 읽었는지는 사실이다).
 */
const SECRET_PATHS =
  /(^|[/\\])(\.env(\.[\w-]+)?|\.npmrc|\.netrc|id_[a-z]+|credentials|\.pgpass)$|\.(pem|key|p12|pfx)$/i;

/** `env`·`printenv` 처럼 **출력 전체가 환경**인 명령 */
const ENV_DUMP = /(^|[;&|]\s*)(env|printenv|set)\s*(\||$|;|&)/;

/** 이 경로를 읽거나 이 명령을 돌렸으면 응답을 통째로 가린다 */
export function responseIsSecret(toolName: string, input: unknown): boolean {
  const path = pick(input, 'file_path') ?? pick(input, 'path') ?? '';
  if (path !== '' && SECRET_PATHS.test(path)) return true;
  const command = pick(input, 'command') ?? '';
  if (command === '') return false;
  if (ENV_DUMP.test(command)) return true;
  return command.split(/\s+/).some((word) => SECRET_PATHS.test(word.replace(/^["']|["']$/g, '')));
}

function pick(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === 'string' ? found : null;
}

/** 문자열 하나에서 비밀을 가린다 — 모양과 대입 두 축을 함께 본다 */
export function redactText(text: string): string {
  let out = text;
  for (const { re, reason } of SECRET_SHAPES) out = out.replace(re, masked(reason));
  for (const { re, reason, keepTail } of ASSIGNMENTS) {
    // 대입은 **이름을 남기고 값만** 가린다 — 무엇이 넘어갔는지는 알아야 재현이 된다
    out = out.replace(re, (_m, head: string, _value: string, tail?: string) =>
      keepTail === true ? `${head}${masked(reason)}${tail ?? ''}` : `${head}${masked(reason)}`,
    );
  }
  return out;
}

/**
 * 값 하나를 재귀로 훑어 비밀을 가린다.
 *
 * 객체의 **열쇠 이름**이 비밀을 말하면 값 전체를, 문자열이면 그 안의 모양·대입을 가린다.
 */
export function redact(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SECRET_KEY.test(key) ? masked(key) : redact(item);
    }
    return out;
  }
  return value;
}

/** 필드 상한 — 64KB(정본: api.md §2.9) */
export const FIELD_LIMIT = 64 * 1024;
/** 행 상한 — 256KB */
export const ROW_LIMIT = 256 * 1024;

/**
 * 상한을 넘으면 자른다 — **앞 8KB + 뒤 나머지**다.
 *
 * 뒤를 남기는 이유: 실패한 명령의 값어치는 **끝**에 있다. 앞에서만 자르면 오류 메시지가
 * 사라지고, 그러면 원문을 보관하는 의미의 절반이 없어진다.
 */
export function truncate(text: string, limit = FIELD_LIMIT): string {
  if (text.length <= limit) return text;
  const head = Math.min(8 * 1024, Math.floor(limit / 8));
  const tail = limit - head;
  const dropped = text.length - head - tail;
  return `${text.slice(0, head)}\n…(${String(dropped)}자 생략)…\n${text.slice(-tail)}`;
}

/** 재귀로 잘라 넣는다 — 문자열만 자르고 구조는 건드리지 않는다 */
export function truncateDeep(value: unknown, limit = FIELD_LIMIT): unknown {
  if (typeof value === 'string') return truncate(value, limit);
  if (Array.isArray(value)) return value.map((item) => truncateDeep(item, limit));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, truncateDeep(item, limit)]),
    );
  }
  return value;
}

/**
 * 훅 페이로드 한 건을 저장 가능한 모양으로 — 가리고, 자르고, 행 상한을 지킨다.
 *
 * 행 상한을 넘으면 **응답부터 버린다**: 무엇을 했는가(`tool_input`)가 무엇이 나왔는가보다
 * 먼저 남아야 한다.
 */
export function prepareHookPayload(input: {
  toolName: string;
  toolInput: unknown;
  toolResponse: unknown;
}): Record<string, unknown> {
  const toolInput = truncateDeep(redact(input.toolInput));
  const toolResponse = responseIsSecret(input.toolName, input.toolInput)
    ? masked('secret_file')
    : truncateDeep(redact(input.toolResponse));

  const payload: Record<string, unknown> = { tool_input: toolInput, tool_response: toolResponse };
  if (JSON.stringify(payload).length <= ROW_LIMIT) return payload;
  return { tool_input: toolInput, tool_response: masked('row_limit') };
}
