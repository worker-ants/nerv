// zip 을 흘려보내며 쓴다 — 의존성 없이 node:zlib 만 (2026-09-28 · clemvion 요청 N5 · REQ-API-251)
//
// 규칙은 플러그인 아카이브(`scripts/pack-plugin.mjs`)와 같다: 시각을 고정해 같은 입력이 같은 바이트를 내고,
// 압축이 원본보다 크면 그대로 담는다. 다른 점은 **응답으로 흘려보낸다**는 것이다 — 항목을 하나씩 써서 내보내고
// 끝에 중앙 디렉터리를 붙인다. 전체를 메모리에 모으지 않는다.
//
// **zip32 다.** 오프셋 · 크기가 4GB(2^32 - 1)를 넘으면 표현할 수 없다. 부르는 쪽이 총 크기를 먼저 세어 넘으면
// 시작하지 않는다(413) — 흘려보내기 시작한 뒤에는 상태 코드를 바꿀 수 없기 때문이다. zip64 는 필요해지면 더한다.

import { PassThrough } from 'node:stream';
import type { Readable } from 'node:stream';
import { deflateRawSync } from 'node:zlib';

/** zip32 가 표현하는 가장 큰 오프셋 · 크기 */
export const ZIP32_LIMIT = 0xffffffff;

/** 항목 하나가 zip 안에서 차지하는 머리 크기 — 총 크기를 미리 셀 때 쓴다(로컬 30 + 중앙 46 + 이름 두 번) */
export function zipOverhead(path: string): number {
  return 30 + 46 + 2 * Buffer.byteLength(path, 'utf8');
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let c = -1;
  for (const byte of buf) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** 1980-01-01 00:00 — zip 이 표현하는 가장 이른 시각. 고정해서 같은 입력이 같은 바이트를 낸다 */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;
/** 일반 목적 비트 11 — 이름이 UTF-8 이다 */
const UTF8_NAMES = 0x0800;

export class ZipStream {
  private readonly out = new PassThrough();
  private readonly central: Buffer[] = [];
  private offset = 0;
  private count = 0;

  get stream(): Readable {
    return this.out;
  }

  /**
   * 항목 하나를 쓴다. `compress` 가 거짓이면 그대로 담는다 — 이미 압축된 그림 · PDF 를 다시 압축하면 시간만 든다.
   * 참이어도 압축이 원본보다 크면 그대로 담는다.
   */
  async add(path: string, data: Buffer, compress = true): Promise<void> {
    const name = Buffer.from(path, 'utf8');
    const deflated = compress ? deflateRawSync(data, { level: 6 }) : null;
    const stored = deflated === null || deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = crc32(data);
    const method = stored ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(0x031e, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(UTF8_NAMES, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(0, 30);
    dir.writeUInt16LE(0, 32);
    dir.writeUInt16LE(0, 34);
    dir.writeUInt16LE(0, 36);
    // 일반 파일 · 0644 — 풀었을 때 실행 비트가 붙지 않게
    dir.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    dir.writeUInt32LE(this.offset, 42);
    this.central.push(dir, name);

    await this.write(Buffer.concat([local, name, body]));
    this.offset += local.length + name.length + body.length;
    this.count += 1;
  }

  /** 중앙 디렉터리와 끝 레코드를 쓰고 닫는다 */
  async finish(): Promise<void> {
    const centralBuf = Buffer.concat(this.central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(this.count, 8);
    end.writeUInt16LE(this.count, 10);
    end.writeUInt32LE(centralBuf.length, 12);
    end.writeUInt32LE(this.offset, 16);
    end.writeUInt16LE(0, 20);
    await this.write(Buffer.concat([centralBuf, end]));
    this.out.end();
  }

  /** 쓰다 실패하면 받는 쪽이 끝난 zip 으로 착각하지 않게 스트림을 오류로 닫는다 */
  fail(error: Error): void {
    this.out.destroy(error);
  }

  /** 받는 쪽이 느리면 기다린다 — 버퍼에 쌓아 두지 않는다 */
  private async write(buf: Buffer): Promise<void> {
    if (this.out.write(buf)) return;
    // 받는 쪽이 연결을 끊으면 drain 은 오지 않는다 — close 도 기다려서 멈춘다
    await new Promise<void>((resolve, reject) => {
      const done = (fn: () => void): void => {
        this.out.off('drain', onDrain);
        this.out.off('error', onError);
        this.out.off('close', onClose);
        fn();
      };
      const onDrain = (): void => done(resolve);
      const onError = (e: Error): void => done(() => reject(e));
      const onClose = (): void => done(() => reject(new Error('zip stream closed')));
      this.out.once('drain', onDrain);
      this.out.once('error', onError);
      this.out.once('close', onClose);
    });
  }
}
