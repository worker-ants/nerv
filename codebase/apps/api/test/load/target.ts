// 부하 시험이 상대하는 NERV — HTTP 하나로만 붙는다(DB 에 직접 붙지 않는다)
//
// 로컬 e2e 스택과 스테이징을 **같은 코드**로 재려면 준비도 표면으로만 해야 한다. 스테이징의 DB 에는
// 시험 도구가 접속하지 않는다 — 사람 계정 하나로 로그인해 조직 · 프로젝트 · 토큰을 만들고, 데이터는
// 임포트 API(EP-IMP-02)와 작업 API 로 넣는다.

export interface Timed<T> {
  status: number;
  body: T;
  ms: number;
}

export interface RequestOptions {
  /** 에이전트 토큰 — 없으면 사람 세션 쿠키로 부른다 */
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly detail: unknown,
  ) {
    super(`${path} → ${status} ${JSON.stringify(detail).slice(0, 300)}`);
  }
}

export class Target {
  private cookie = '';
  /**
   * 경로의 `{proj}` 는 slug 다. 같은 slug 가 다른 조직에도 있으면(앞선 실행이 남긴 `load-01` 등) 409 가 나므로
   * 조직 한정자를 늘 싣는다(api.md REQ-API-152).
   */
  org: string | null = null;

  constructor(readonly base: string) {}

  /** 사람 세션 쿠키 — WS 핸드셰이크가 이것으로 검증된다(PAT 는 받지 않는다) */
  get sessionCookie(): string {
    return this.cookie;
  }

  async request<T = unknown>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<Timed<T>> {
    // 쿠키 인증 요청은 오리진을 본다(교차 출처 쓰기 방어) — 같은 오리진에서 온 것으로 보낸다
    const headers: Record<string, string> = { origin: this.base, ...options.headers };
    if (this.org !== null) headers['x-nerv-org'] = this.org;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.token !== undefined) headers['authorization'] = `Bearer ${options.token}`;
    else if (this.cookie !== '') headers['cookie'] = this.cookie;

    const started = performance.now();
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await res.text();
    const ms = performance.now() - started;
    let body: unknown = null;
    if (text !== '') {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { status: res.status, body: body as T, ms };
  }

  /** 2xx 가 아니면 던진다 — 준비 단계용. 부하 단계는 실패도 세야 하므로 `request` 를 쓴다. */
  async ok<T = Record<string, unknown>>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const res = await this.request<T>(method, path, options);
    if (res.status < 200 || res.status >= 300)
      throw new HttpError(res.status, `${method} ${path}`, res.body);
    return res.body;
  }

  /** 이메일 · 비밀번호 로그인 — 응답의 쿠키를 그대로 들고 다닌다(https 면 이름에 `__Secure-` 가 붙는다) */
  async signIn(email: string, password: string): Promise<void> {
    const res = await fetch(`${this.base}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: this.base },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new HttpError(res.status, 'POST /api/auth/sign-in/email', await res.text());
    const pairs = res.headers
      .getSetCookie()
      .map((line) => line.split(';')[0] ?? '')
      .filter((pair) => pair.includes('='));
    if (!pairs.some((pair) => pair.includes('session_token='))) {
      throw new Error('로그인 응답에 세션 쿠키가 없습니다');
    }
    this.cookie = pairs.join('; ');
  }
}
