// 저장하는 비밀의 암호화 — AES-256-GCM, 키는 `NERV_ENCRYPTION_KEY` (2026-10-17 · 사람 결정 D2 · codebase.md §5.2)
//
// 첫 소비자는 Slack 웹훅 주소다(database.md §2.18). 주소를 아는 사람은 누구나 그 채널에 글을 쓸 수 있어서 DB 백업이나 덤프에
// 원문이 남으면 안 된다. 키는 DB 밖(env · k8s Secret)에 둔다 — 같은 곳에 두면 암호화한 뜻이 없다.
//
// **키가 없으면 꺼진다.** 키 없이 원문을 저장하는 길을 두지 않는다 — 그런 길이 있으면 키를 넣은 날 이전의 값은 영영 원문이다.
// 키가 있는데 모양이 틀리면 기동을 거부한다(`assertEncryptionKey`) — 조용히 꺼지면 "연결했는데 안 온다" 만 남는다.
//
// 형식은 `v1:<iv>:<tag>:<암호문>`(base64url)이다. 앞의 판 번호가 키를 바꾸는 날의 자리다 — 지금은 키 교체를 하지 않는다
// (바꾸면 저장된 값을 풀 수 없어 다시 연결해야 한다 · §5.2).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;

/** 키 32바이트 — base64(44자) 또는 hex(64자). 그 밖의 모양이면 null 이 아니라 던진다 */
export function encryptionKeyFromEnv(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = env['NERV_ENCRYPTION_KEY']?.trim() ?? '';
  if (raw === '') return null;
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      // eslint-disable-next-line no-restricted-syntax -- 운영자용 기동 거부 사유다(REQ-CB-022 예외 · mail.config.ts 와 같다)
      'NERV_ENCRYPTION_KEY 는 32바이트여야 합니다 — `openssl rand -base64 32` 로 만든 값(base64 44자) 또는 hex 64자를 넣으세요',
    );
  }
  return key;
}

/** 기동 때 한 번 — 모양이 틀린 키로 뜨지 않는다 */
export function assertEncryptionKey(env: NodeJS.ProcessEnv = process.env): void {
  encryptionKeyFromEnv(env);
}

export function seal(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    body.toString('base64url'),
  ].join(':');
}

/** 판 번호 · 태그가 맞지 않으면 던진다 — 키가 바뀌었거나 값이 망가진 것이다 */
export function open(sealed: string, key: Buffer): string {
  const [version, iv, tag, body] = sealed.split(':');
  if (version !== VERSION || iv === undefined || tag === undefined || body === undefined) {
    // eslint-disable-next-line no-restricted-syntax -- 사람에게 나가지 않는 내부 오류다(워커가 로그로만 남긴다 · REQ-CB-022 예외)
    throw new Error('암호문의 형식이 맞지 않습니다');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(body, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
