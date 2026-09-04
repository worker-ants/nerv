-- 어휘에 없는 스코프를 토큰에서 걷어낸다 (2026-09-04 · 실측)
--
-- 개발 씨앗이 `spec:write`·`review:write`·`session:write` 를 심고 있었다. 셋 다 어휘에
-- 없어서 `verifyPat` 이 사용 시점에 조용히 버렸다 — 권한은 새지 않았다. 새는 것은 **설명**
-- 이었다: 설정 화면의 토큰 표가 그 값을 그대로 보여줘, 사람은 그 토큰이 쓰기 권한을
-- 가졌다고 읽었다. 발급 경로는 이미 `isAgentScope` 로 거르므로 남은 것은 과거의 잔재다.
--
-- 지우는 것은 값이 아니라 **거짓말**이다. 실제로 할 수 있는 일은 달라지지 않는다.
UPDATE api_token
   SET scopes = coalesce(
     (SELECT array_agg(s ORDER BY ord)
        FROM unnest(scopes) WITH ORDINALITY AS u(s, ord)
       WHERE s = ANY (ARRAY[
         'spec:read', 'spec:draft', 'spec:meta', 'spec:evidence',
         'task:claim', 'task:update',
         'review:submit', 'review:resolve',
         'agent-session:launch', 'import:write'
       ])),
     ARRAY[]::text[]
   )
 WHERE NOT (scopes <@ ARRAY[
   'spec:read', 'spec:draft', 'spec:meta', 'spec:evidence',
   'task:claim', 'task:update',
   'review:submit', 'review:resolve',
   'agent-session:launch', 'import:write'
 ]);
