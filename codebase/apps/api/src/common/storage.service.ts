// 오브젝트 스토리지 — 정본: api.md §2.10 (REQ-API-069)
//
// **스토리지는 처음부터 있었다.** MinIO 가 compose·k8s 스택에 서 있고 `NERV_S3_*` 환경
// 변수까지 준비돼 있었는데, 이 저장소의 어떤 코드도 그것을 부르지 않았다(2026-09-01 실측).
// 첨부 기능이 그 배선의 첫 소비자다.
//
// **S3 호환 계약 하나만 본다** — 임베딩 제공자를 OpenAI 호환 하나로 묶은 것과 같은 이유다
// (REQ-CB-020). 개발은 MinIO, 운영은 무엇이든 그 계약을 지키면 된다.

import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';

/** presigned URL 유효 시간 — 올리는 데 충분하고, 주워도 오래 못 쓸 만큼 짧다 */
export const PRESIGN_TTL_SECONDS = 600;

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket = process.env['NERV_S3_BUCKET'] ?? 'nerv-blobs';
  private readonly client: S3Client | null;

  /**
   * presigned URL 을 만드는 클라이언트. **서명 주소는 밖에서 열려야 한다.**
   *
   * 서버가 S3 에 붙는 주소(`NERV_S3_ENDPOINT`)는 대개 내부 이름이다(compose 의
   * `http://minio:9000`, k8s 의 클러스터 내부 서비스). 그 주소로 서명하면 `upload_url` 의
   * 호스트가 그것이 되고, 개발자 장비의 에이전트는 그 이름을 해소하지 못한다 — 에이전트
   * 업로드 경로가 **모든 배치에서** 불통이었다(2026-09-02). `NERV_S3_PUBLIC_ENDPOINT` 가
   * 있으면 서명은 그 주소로 한다. 없으면 예전대로다(단일 주소인 배치가 그렇다).
   */
  private readonly signer: S3Client | null;

  constructor() {
    const endpoint = process.env['NERV_S3_ENDPOINT'];
    const accessKeyId = process.env['NERV_S3_ACCESS_KEY'];
    const secretAccessKey = process.env['NERV_S3_SECRET_KEY'];
    // **설정이 없으면 조용히 죽지 않는다.** 스토리지가 없는 배치에서도 나머지는 돌아야
    // 하므로 여기서 던지지 않고, 부르는 쪽이 `available` 로 판정해 사람에게 말한다.
    if (endpoint === undefined || accessKeyId === undefined || secretAccessKey === undefined) {
      // eslint-disable-next-line no-restricted-syntax -- 운영자용 설정 경고다(REQ-CB-022 예외)
      this.logger.warn('NERV_S3_* 가 없다 — 첨부 기능이 꺼진다(ENDPOINT·ACCESS_KEY·SECRET_KEY)');
      this.client = null;
      this.signer = null;
      return;
    }
    const options = {
      region: process.env['NERV_S3_REGION'] ?? 'us-east-1',
      credentials: { accessKeyId, secretAccessKey },
      // MinIO 는 가상 호스트 방식을 기본으로 못 쓴다 — compose 가 이미 true 를 준다
      forcePathStyle: process.env['NERV_S3_FORCE_PATH_STYLE'] !== 'false',
    };
    this.client = new S3Client({ ...options, endpoint });
    const publicEndpoint = process.env['NERV_S3_PUBLIC_ENDPOINT'];
    this.signer =
      publicEndpoint === undefined || publicEndpoint === ''
        ? this.client
        : new S3Client({ ...options, endpoint: publicEndpoint });
  }

  /**
   * 버킷이 없으면 만든다 — §5.2 전표가 "api 가 기동 시 없으면 생성" 이라 적은 그 자리다.
   *
   * 코드는 없었다(2026-09-02 실측: `CreateBucket` 참조 0건). compose 에도 `mc mb` 류
   * 초기화가 없어, 새 배치의 첫 첨부는 사람 경로가 `NoSuchBucket` 500, 에이전트 경로가
   * PUT 404 였다 — 그리고 문서는 만들어 준다고 말하고 있었다.
   */
  async onModuleInit(): Promise<void> {
    const client = this.client;
    if (client === null) return;
    try {
      await client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`버킷을 만들었다 — ${this.bucket}`);
      } catch (error) {
        // 만들 권한이 없는 배치도 있다(운영은 대개 미리 만들어 둔다) — 죽이지 않고 알린다
        this.logger.warn(`버킷 ${this.bucket} 을 확인하지 못했다 — ${String(error)}`);
      }
    }
  }

  get available(): boolean {
    return this.client !== null;
  }

  /** 에이전트가 직접 올릴 자리 — 서버를 거치지 않는다(MCP 응답에 파일을 싣지 않는다) */
  async presignPut(key: string, contentType: string): Promise<string> {
    // `require()` 가 스토리지 설정을 확인한다 — 서명 클라이언트는 그것과 함께 만들어지므로
    // 여기서는 그 결과를 그대로 쓴다(둘은 같은 조건에서 null 이다).
    const signer = this.signer ?? this.require();
    return getSignedUrl(
      signer,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: PRESIGN_TTL_SECONDS },
    );
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.require().send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  /**
   * 읽기는 **서버를 거친다**(REQ-API-070). presigned GET 을 주면 그 URL 이 권한 밖으로
   * 새고, 첨부 URL 이 공개면 스펙 권한이 무의미해진다.
   */
  async get(key: string): Promise<{ body: Readable; contentType: string; bytes: number } | null> {
    const out = await this.require().send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (out.Body === undefined) return null;
    return {
      body: out.Body as Readable,
      contentType: out.ContentType ?? 'application/octet-stream',
      bytes: out.ContentLength ?? 0,
    };
  }

  /** 올린 것이 실제로 있는지 — presigned 2단계의 확정이 이것으로 판정한다 */
  async head(key: string): Promise<{ bytes: number; contentType: string } | null> {
    try {
      const out = await this.require().send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: 'bytes=0-0' }),
      );
      return {
        // Range 응답의 전체 크기는 `content-range: bytes 0-0/12345` 의 끝이다
        bytes: Number(String(out.ContentRange ?? '').split('/')[1] ?? out.ContentLength ?? 0),
        contentType: out.ContentType ?? 'application/octet-stream',
      };
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    await this.require().send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  private require(): S3Client {
    if (this.client === null) {
      // eslint-disable-next-line no-restricted-syntax -- 부르는 쪽이 available 로 먼저 막는다
      throw new Error('스토리지가 설정되지 않았습니다');
    }
    return this.client;
  }
}
