// zip 을 읽어 항목을 꺼낸다 — 테스트 전용. 중앙 디렉터리를 따라 읽고, CRC 가 맞는지까지 본다
// (2026-09-28 · REQ-API-251). 받는 쪽이 하는 일을 의존성 없이 되풀이한다.

import { inflateRawSync } from 'node:zlib';
import { crc32 } from '../../src/common/zip-stream.js';

export interface ZipEntry {
  path: string;
  data: Buffer;
  method: number;
  mode: number;
}

export function zipEntries(zip: Buffer): ZipEntry[] {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('끝 레코드가 없다');
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error(`중앙 디렉터리가 깨졌다 (${i})`);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const compressed = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extra = zip.readUInt16LE(at + 30);
    const comment = zip.readUInt16LE(at + 32);
    const mode = zip.readUInt32LE(at + 38) >>> 16;
    const local = zip.readUInt32LE(at + 42);
    const path = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error(`로컬 머리가 깨졌다: ${path}`);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const body = zip.subarray(start, start + compressed);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    if (crc32(data) !== crc) throw new Error(`CRC 가 맞지 않는다: ${path}`);
    out.push({ path, data, method, mode });
    at += 46 + nameLength + extra + comment;
  }
  return out;
}
