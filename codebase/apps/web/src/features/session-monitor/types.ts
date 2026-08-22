// S5 세션 보드의 데이터 모양 — 서버 EP-SES-01 응답과 1:1 (api.md §2.5)
//
// 이 타입은 손으로 쓴 중복이 아니라 **표면 계약의 클라이언트 절반**이다. zod 스키마가
// packages/schema 에 들어오면(E02 후속) 그것에서 파생하도록 바꾼다.

export interface SessionCard {
  id: string;
  user_name: string;
  hostname: string;
  agent_type: string;
  state: string;
  branch: string | null;
  diff_added: number;
  diff_removed: number;
  last_heartbeat_at: string | null;
  started_at: string;
  task_id: string | null;
  task_key: string | null;
  task_title: string | null;
  claim_id: string | null;
  lease_remaining_seconds: number | null;
  scope_spec_ids: string[];
  scope_file_globs: string[];
}

export interface SessionBoardResult {
  items: SessionCard[];
  summary: Record<string, number>;
  next_cursor: string | null;
}
