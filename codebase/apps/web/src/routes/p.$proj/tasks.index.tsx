// /p/:proj/tasks/ — 보드 **만** 보는 주소. 보드는 레이아웃(`tasks.tsx`)이 그리므로 여기에는 그릴 것이
// 없다 — 시트가 닫힌 상태가 이 라우트다(REQ-WEB-213).

import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/p/$proj/tasks/')({ component: () => null });
