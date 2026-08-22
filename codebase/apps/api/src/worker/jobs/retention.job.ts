// blob TTL 30일 · Activity 보존 정책 집행 (REVIEW_PROMPT_BLOB_TTL_DAYS)
import { Injectable } from '@nestjs/common';
import { REVIEW_PROMPT_BLOB_TTL_DAYS } from '@nerv/schema';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';

@Injectable()
export class RetentionJob {
  readonly name = 'retention';
  readonly blobTtlDays = REVIEW_PROMPT_BLOB_TTL_DAYS;

  run(): never {
    throw new NotImplementedYetError('E14-S02', '보존 정책 집행');
  }
}
