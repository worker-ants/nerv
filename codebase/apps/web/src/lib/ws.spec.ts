// 재연결 — 붙는 것만으로는 부족하다 (2026-09-01 사람 보고 · REQ-WEB-127)
//
// 사람이 본 것은 "서버를 재시작하면 재연결이 안 된다" 였지만, 소켓은 사실 붙고 있었다.
// 붙은 뒤 **어느 룸에도 없었을** 뿐이다 — 룸 join 은 화면 effect 가 했고 그 effect 는
// projectId 가 바뀔 때만 돌기 때문이다. 이벤트가 0건이면 사람 눈에는 끊긴 것과 같다.
//
// 그래서 이 파일이 보는 것은 "connect 가 몇 번 왔나" 가 아니라 **연결이 룸을 기억하는가** 다.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => void>();
const emit = vi.fn();
const socket = {
  on: (name: string, fn: (...args: unknown[]) => void) => handlers.set(name, fn),
  onAny: vi.fn(),
  emit,
};
const ioOptions: Record<string, unknown>[] = [];
/** `io(url, opts)` 의 첫 인자 — 런타임 설정이 정하는 주소다(4.1 §2.3 3단계) */
const ioUrls: (string | undefined)[] = [];

vi.mock('socket.io-client', () => ({
  io: (url: string | undefined, opts: Record<string, unknown>) => {
    ioUrls.push(url);
    ioOptions.push(opts);
    return socket;
  },
}));

const { resetRuntimeConfigForTesting } = await import('./config.js');
const { connectNervSocket, forgetRooms, joinProjectRoom, leaveProjectRoom, joinedRoomsForTesting } =
  await import('./ws.js');

function connect(): void {
  connectNervSocket({ onEvent: () => undefined, onStateChange: () => undefined });
}

beforeEach(() => {
  handlers.clear();
  emit.mockClear();
  ioOptions.length = 0;
  ioUrls.length = 0;
  resetRuntimeConfigForTesting();
  forgetRooms();
});

describe('붙는 주소 — 런타임 설정이 정한다 (4.1 §2.3 3단계)', () => {
  it('설정이 비면 **인자를 넘기지 않는다** — 화면이 뜬 오리진에 붙는 지금까지의 동작이다', () => {
    connect();
    expect(ioUrls[0]).toBeUndefined();
  });

  it('API 주소가 설정되면 그 주소로 붙는다 — 화면과 다른 호스트일 수 있다', () => {
    resetRuntimeConfigForTesting({ apiBase: 'https://api.nerv.example.com' });
    connect();
    expect(ioUrls[0]).toBe('https://api.nerv.example.com');
    // 핸드셰이크는 세션 쿠키로 검증된다 — 오리진이 갈려도 쿠키가 실려야 한다
    expect(ioOptions[0]).toMatchObject({ withCredentials: true });
  });
});

describe('룸 기억 — 소켓보다 먼저 온 join (2026-09-02)', () => {
  it('소켓이 없을 때 부른 join 도 기억된다 — 붙는 순간 되찾는다', async () => {
    forgetRooms();

    // 콜드 로드에서 실제로 일어나는 순서다: 프로젝트 응답이 `/me` 보다 먼저 왔다.
    // 예전에는 여기서 아무것도 하지 않고 돌아갔고, 그래서 소켓이 붙어도 되찾을 룸이 없었다.
    joinProjectRoom(null, 'p-1');
    expect(joinedRoomsForTesting()).toContain('project:p-1');

    leaveProjectRoom(null, 'p-1');
    expect(joinedRoomsForTesting()).not.toContain('project:p-1');
  });
});

describe('재연결 정책', () => {
  it('무제한으로 다시 시도하고 간격은 1분에서 멈춘다 — 사람이 새로고침하지 않아도 된다', () => {
    connect();
    expect(ioOptions[0]).toMatchObject({
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelayMax: 60_000,
    });
    // 지수 재시도에 흔들림이 없으면 서버가 살아난 순간 모든 클라이언트가 동시에 덮친다
    expect(ioOptions[0]?.['randomizationFactor']).toBeGreaterThan(0);
  });
});

describe('룸은 연결이 기억한다', () => {
  it('재연결하면 들어가 있던 룸을 스스로 되찾는다', () => {
    connect();
    joinProjectRoom(socket as never, 'p1');
    joinProjectRoom(socket as never, 'p2');
    emit.mockClear();

    handlers.get('connect')?.(); // 서버가 재기동돼 다시 붙은 순간

    expect(emit.mock.calls).toEqual([
      ['join', { room: 'project:p1' }],
      ['join', { room: 'project:p2' }],
    ]);
  });

  it('나온 룸은 되찾지 않는다 — 기억이 한 방향이면 프로젝트를 옮겨도 옛 룸이 따라온다', () => {
    connect();
    joinProjectRoom(socket as never, 'p1');
    leaveProjectRoom(socket as never, 'p1');
    joinProjectRoom(socket as never, 'p2');
    emit.mockClear();

    handlers.get('connect')?.();

    expect(emit.mock.calls).toEqual([['join', { room: 'project:p2' }]]);
  });

  it('소켓을 새로 만들면 기억도 함께 버린다 — 로그아웃 뒤 남은 룸은 남의 데이터다', () => {
    connect();
    joinProjectRoom(socket as never, 'p1');
    forgetRooms();
    expect(joinedRoomsForTesting()).toEqual([]);

    emit.mockClear();
    handlers.get('connect')?.();
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('처음부터 닿지 않는 것도 끊김이다 (2026-09-26 · REQ-WEB-002)', () => {
  it('한 번도 붙지 못해 connect_error 만 와도 disconnected 로 알린다 — "붙는 중" 에 머물지 않는다', () => {
    const states: string[] = [];
    connectNervSocket({ onEvent: () => undefined, onStateChange: (s) => states.push(s) });
    handlers.get('connect_error')?.(new Error('websocket error'));
    expect(states).toEqual(['disconnected']);
    // 붙으면 붙었다고 알린다
    handlers.get('connect')?.();
    expect(states).toEqual(['disconnected', 'connected']);
  });
});
