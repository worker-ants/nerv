// CI 레시피 — 저장소의 필수 상태 체크가 NERV 게이트 판정(EP-REV-08)을 부른다
// (2026-10-17 · 사람 결정 D3 · docs/04-mvp/plugin.md §8 · REQ-PLG-042 ~ 045 · 백로그 E16-S02)
//
// **정본은 이 파일이다.** 화면(S8 「연동」 탭)이 프로젝트 값으로 채워 보여 주고, L2(`ci-recipe.spec.ts`)가 같은 글에서
// 스크립트를 꺼내 실제 서버에 돌린다. 문서(4.6 §8)는 이 파일을 가리키기만 한다 — 글을 두 군데 두면 한쪽이 낡는다.
//
// **형태는 YAML 하나다**(D3 = A). 스크립트를 워크플로에 넣어 두면 저장소에 파일 하나만 더하면 되고, CI 에 따로
// 설치할 것이 없다 — curl · jq · git 은 GitHub 호스트 러너에 이미 있다. 서버는 forge 에 상태를 게시하지 않는다.
// CI 가 판정을 묻고 그 답으로 체크를 끝낸다(4.1 §5 · 4.5 §2.8).
//
// **자리표시자 넷**(`<서버 주소>` · `<slug>` · `<조직>` · `<종류>`)을 렌더가 한 번에 바꾼다. 값은 YAML 작은따옴표
// 안에 들어가므로 작은따옴표를 두 번 써서 넣는다.

/** 필수 체크로 켤 이름 — 잡 이름이자 워크플로 이름이다 */
export const CI_GATE_CHECK_NAME = 'nerv-gate';

/** 저장소에 둘 자리 */
export const CI_GATE_WORKFLOW_PATH = '.github/workflows/nerv-gate.yml';

/** 기본으로 묻는 리뷰 종류 — 화면은 프로젝트의 done 게이트 정책이 요구하는 종류가 있으면 그것을 넣는다 */
export const CI_GATE_DEFAULT_KINDS = 'code';

/** 템플릿 원문 — 끝 줄바꿈 없이. 렌더 결과는 끝에 줄바꿈 하나를 붙인다 */
export const CI_GATE_WORKFLOW_TEMPLATE = [
  '# NERV 리뷰 게이트 — PR head 커밋의 리뷰 판정이 passed · waived 가 아니면 이 체크가 실패해 머지를 막는다.',
  '# NERV <서버 주소> 의 프로젝트 <slug> 에서 받은 파일이다(설정 → 연동). 저장소의 .github/workflows/nerv-gate.yml 로 둔다.',
  '#',
  '# 설정 셋',
  '#   1. Settings → Secrets and variables → Actions 에 비밀 NERV_TOKEN 을 넣는다. 값은 spec:read 권한만 가진',
  '#      전용 계정의 에이전트 토큰이다 — 사람의 토큰은 그 사람이 조직을 떠나면 폐기되어 체크가 함께 멈춘다.',
  '#   2. 기본 브랜치의 보호 규칙(또는 ruleset)에서 상태 체크 nerv-gate 를 필수로 켠다.',
  '#   3. 머지 큐를 쓰면 같은 체크를 머지 큐에도 필수로 둔다. 큐 커밋에는 리뷰가 없으므로 그 PR 의 head 로 판정한다.',
  '#',
  '# NERV 가 답하지 않으면(네트워크 · 5xx · 429) 경고를 남기고 통과시킨다(D-14 fail-open). 그때도 막으려면',
  "# NERV_GATE_FAIL_CLOSED 를 '1' 로 바꾼다. 토큰 · 주소가 틀려 거절되면(4xx) 늘 막는다.",
  'name: nerv-gate',
  'on:',
  '  pull_request:',
  '  merge_group:',
  'permissions:',
  '  contents: read',
  '  pull-requests: read',
  'jobs:',
  '  nerv-gate:',
  '    runs-on: ubuntu-latest',
  '    timeout-minutes: 5',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '        with:',
  '          fetch-depth: 0',
  '      - name: NERV 리뷰 판정',
  '        shell: bash',
  '        env:',
  "          NERV_URL: '<서버 주소>'",
  "          NERV_PROJECT: '<slug>'",
  "          NERV_ORG: '<조직>'",
  "          NERV_GATE_KINDS: '<종류>'",
  "          NERV_GATE_FAIL_CLOSED: '0'",
  '          NERV_TOKEN: ${{ secrets.NERV_TOKEN }}',
  '          EVENT_NAME: ${{ github.event_name }}',
  '          PR_BRANCH: ${{ github.event.pull_request.head.ref }}',
  '          PR_HEAD: ${{ github.event.pull_request.head.sha }}',
  '          QUEUE_REF: ${{ github.event.merge_group.head_ref }}',
  '          GH_TOKEN: ${{ github.token }}',
  '          GH_API: ${{ github.api_url }}',
  '          GH_REPO: ${{ github.repository }}',
  '        run: |',
  '          set -euo pipefail',
  '          fail=0',
  '          summary() { printf \'%s\\n\' "$*" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"; }',
  '          deny() { echo "::error title=NERV 리뷰 게이트::$1"; summary "- 막음: $1"; fail=1; }',
  '          summary "### NERV 리뷰 게이트"',
  '',
  '          # 머지 큐 커밋에는 리뷰 라운드가 없다 — ref 의 PR 번호로 그 PR 의 브랜치와 head 를 찾는다',
  '          if [ "$EVENT_NAME" = merge_group ]; then',
  "            number=$(printf '%s' \"$QUEUE_REF\" | sed -nE 's#.*/pr-([0-9]+)-[0-9a-f]+$#\\1#p')",
  '            if [ -z "$number" ]; then deny "머지 큐 ref 에서 PR 번호를 찾지 못했다: $QUEUE_REF"; exit 1; fi',
  '            pr=$(curl -fsS --max-time 20 -H "authorization: Bearer $GH_TOKEN" \\',
  '              -H \'accept: application/vnd.github+json\' "$GH_API/repos/$GH_REPO/pulls/$number")',
  '            PR_BRANCH=$(jq -r \'.head.ref\' <<<"$pr")',
  '            PR_HEAD=$(jq -r \'.head.sha\' <<<"$pr")',
  '          fi',
  '          summary "- 대상: $PR_BRANCH @ ${PR_HEAD:0:7}"',
  '',
  '          org=()',
  '          if [ -n "${NERV_ORG:-}" ]; then org=(-H "x-nerv-org: $NERV_ORG"); fi',
  '          body=$(mktemp)',
  '          code=000',
  '          for attempt in 1 2 3; do',
  '            code=$(curl -sS -o "$body" -w \'%{http_code}\' --max-time 20 -G \\',
  '              --data-urlencode "branch=$PR_BRANCH" --data-urlencode "head_sha=$PR_HEAD" \\',
  '              --data-urlencode "kind=$NERV_GATE_KINDS" -H "authorization: Bearer $NERV_TOKEN" \\',
  '              ${org[@]+"${org[@]}"} "$NERV_URL/api/v1/projects/$NERV_PROJECT/gates/reviews/check") || code=000',
  '            case "$code" in',
  '              000 | 429 | 5??) if [ "$attempt" -lt 3 ]; then sleep $((attempt * 5)); fi ;;',
  '              *) break ;;',
  '            esac',
  '          done',
  '',
  '          case "$code" in',
  '            200) ;;',
  '            000 | 429 | 5??)',
  '              reason="NERV 판정을 받지 못했다(HTTP $code)"',
  '              if [ "$NERV_GATE_FAIL_CLOSED" = 1 ]; then deny "$reason — NERV_GATE_FAIL_CLOSED=1 이라 막는다"; exit 1; fi',
  '              echo "::warning title=NERV 리뷰 게이트::$reason — 판정 불가라 통과시킨다(D-14 fail-open)"',
  '              summary "- 판정 불가: $reason — 통과시켰다(D-14 fail-open)"',
  '              exit 0 ;;',
  '            *)',
  '              detail=$(jq -r \'.message // empty\' "$body" 2>/dev/null || true)',
  '              deny "NERV 가 요청을 거절했다(HTTP $code) $detail — 주소 · 프로젝트 · 토큰을 확인한다"',
  '              exit 1 ;;',
  '          esac',
  '',
  '          if [ "$(jq \'.items | length\' "$body")" -eq 0 ]; then deny "판정할 리뷰가 없다"; fi',
  "          while IFS=$'\\t' read -r kind state reasons; do",
  '            case "$state" in',
  '              passed | waived) summary "- $kind: $state" ;;',
  '              *) deny "$kind: $state${reasons:+ — $reasons}" ;;',
  '            esac',
  '          done < <(jq -r \'.items[] | [.kind, .state, ((.reasons // []) | join(", "))] | @tsv\' "$body")',
  '',
  '          # 고쳤다고 적은 커밋이 이 PR 에 들어 있는가 — 서버는 git 을 모르므로 여기서 본다',
  "          while IFS=$'\\t' read -r kind sha title; do",
  '            if ! git merge-base --is-ancestor "$sha" "$PR_HEAD" 2>/dev/null; then',
  '              deny "$kind: 고친 커밋(${sha:0:7})이 이 PR 에 없다 — $title"',
  '            fi',
  "          done < <(jq -r '.items[] | .kind as $k | (.findings // [])[]",
  '            | select(.resolution.kind == "fixed" and (.resolution.commit_sha // "") != "")',
  '            | [$k, .resolution.commit_sha, .title] | @tsv\' "$body")',
  '',
  '          if [ "$fail" -ne 0 ]; then exit 1; fi',
  '          summary "- 통과"',
].join('\n');

export interface CiGateWorkflowValues {
  /** NERV 의 공개 주소 — 끝의 `/` 는 뗀다 */
  serverUrl: string;
  projectSlug: string;
  /** 같은 slug 가 여러 조직에 있을 때의 한정자(REQ-API-152). 늘 넣어도 된다 */
  orgSlug: string;
  /** 쉼표 목록 — 비우면 `CI_GATE_DEFAULT_KINDS` */
  kinds?: string;
}

const yamlQuoted = (value: string): string => value.replaceAll("'", "''");

/** 템플릿을 프로젝트 값으로 채운다 — 자리표시자는 한 번에 바꾸고 넣은 값을 다시 훑지 않는다 */
export function renderCiGateWorkflow(values: CiGateWorkflowValues): string {
  const kinds = values.kinds?.trim() ? values.kinds.trim() : CI_GATE_DEFAULT_KINDS;
  const table: Record<string, string> = {
    '<서버 주소>': yamlQuoted(values.serverUrl.replace(/\/+$/, '')),
    '<slug>': yamlQuoted(values.projectSlug),
    '<조직>': yamlQuoted(values.orgSlug),
    '<종류>': yamlQuoted(kinds),
  };
  return `${CI_GATE_WORKFLOW_TEMPLATE.replace(/<서버 주소>|<slug>|<조직>|<종류>/g, (hit) => table[hit] ?? hit)}\n`;
}
