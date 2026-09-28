// 흘려보내는 zip — 받는 쪽이 읽을 수 있고, 같은 입력이면 같은 바이트다 (2026-09-28 · REQ-API-251)

import { describe, expect, it } from 'vitest';
import { zipEntries } from '../../test/integration/zip-entries.js';
import { ZipStream } from './zip-stream.js';

async function build(): Promise<Buffer> {
  const zip = new ZipStream();
  const chunks: Buffer[] = [];
  zip.stream.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise((resolve) => zip.stream.on('end', resolve));
  await zip.add('manifest.json', Buffer.from('{"a":1}\n'.repeat(200)));
  await zip.add('specs/한글-키.md', Buffer.from('# 제목\n\n본문'));
  await zip.add('attachments/x/pic.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), false);
  await zip.finish();
  await done;
  return Buffer.concat(chunks);
}

describe('ZipStream', () => {
  it('항목을 순서대로 담고, 압축한 것 · 그대로 담은 것 모두 원래 바이트로 풀린다', async () => {
    const entries = zipEntries(await build());
    expect(entries.map((e) => e.path)).toEqual([
      'manifest.json',
      'specs/한글-키.md',
      'attachments/x/pic.png',
    ]);
    expect(entries[0]?.method).toBe(8);
    expect(entries[0]?.data.toString()).toBe('{"a":1}\n'.repeat(200));
    expect(entries[1]?.data.toString()).toBe('# 제목\n\n본문');
    // 그림은 다시 압축하지 않는다
    expect(entries[2]?.method).toBe(0);
    // 풀었을 때 실행 비트가 붙지 않는다
    expect(entries[2]?.mode).toBe(0o100644);
  });

  it('같은 입력이면 같은 바이트다 — 시각을 고정했다', async () => {
    expect((await build()).equals(await build())).toBe(true);
  });
});
