// 트리 가지치기 — `nerv_spec_tree` 의 `root`·`depth`·`around`·`hops` 가 실제로 하는 일
//
// **인자를 받아 두고 쓰지 않으면 거짓말이 된다.** 이 넷은 2026-09-05 실사용 보고까지
// 스키마에만 있고 핸들러에는 없었다 — 무엇을 주든 프로젝트 전체가 돌아왔다. 그중에서도
// **없는 문서를 `root` 로 줘도 `ok:true` + 전체 트리**였던 것이 가장 나쁘다: 부르는 쪽은
// 그 응답을 "그 문서 밑에 18개가 있다"로 읽는다. 걸러 달라고 한 요청이 걸러지지 않은 채
// 성공하면, 틀렸다는 사실을 알아챌 자리가 어디에도 없다(REQ-API-082 와 같은 규율:
// **조용한 무시가 500 보다 나쁘다**).
//
// `status` 는 그 넷과 **다른 축**이다(2026-09-05 사람 결정 · REQ-API-092). 계층은 자리를
// 말하고 상태는 성질을 말한다 — 그래서 `root`·`depth` 와는 함께 쓰고, 관계 축인 `around`
// 와는 쓰지 않는다.
//
// 판정은 순수 함수로 둔다 — 트리 모양은 DB 없이 판별할 수 있고, 그래야 L1 이 본다.

/** 가지치기가 보는 최소한의 노드 — 구체 타입(SpecTreeNode)은 부르는 쪽 것을 그대로 돌려준다 */
interface TreeNodeRef {
  id: string;
  key: string;
  parent_id: string | null;
}

/** 상태로 거를 때만 보는 것 — 현재 버전이 없는 스펙은 `null` 이라 어느 상태에도 안 든다 */
type StatusNode = TreeNodeRef & { doc_status?: string | null };

interface EdgeRef {
  from_id: string;
  to_id: string;
}

/** 안정 키(`SPC-…`)와 UUID 를 **둘 다** 받는다 — §1.4b 의 참조 규약이다 */
function findRef<T extends TreeNodeRef>(nodes: readonly T[], ref: string): T | undefined {
  return nodes.find((node) => node.id === ref || node.key === ref);
}

/**
 * 뿌리 — 부모가 없거나 **부모가 이 목록에 없는** 노드다.
 *
 * 후자가 중요하다: 보관된 부모는 목록에서 빠지므로, 부모 유무만 보면 그 아래 살아 있는
 * 문서가 어느 깊이에도 들지 못하고 사라진다. 깊이 제한이 문서를 감추는 장치가 되면 안 된다.
 */
function rootsOf<T extends TreeNodeRef>(nodes: readonly T[]): Set<string> {
  const present = new Set(nodes.map((node) => node.id));
  return new Set(
    nodes
      .filter((node) => node.parent_id === null || !present.has(node.parent_id))
      .map((node) => node.id),
  );
}

/** 그 노드와 그 아래 전부 — 부모 링크를 타고 내려간다 */
function withDescendants<T extends TreeNodeRef>(nodes: readonly T[], start: T): Set<string> {
  const kept = new Set([start.id]);
  // 자식이 부모보다 앞에 놓일 수 있으므로 더 붙일 것이 없을 때까지 훑는다
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of nodes) {
      if (node.parent_id === null || kept.has(node.id) || !kept.has(node.parent_id)) continue;
      kept.add(node.id);
      grew = true;
    }
  }
  return kept;
}

/**
 * 상태로 거르되 **조상을 함께 남긴다**(2026-09-05 사람 결정 — 안 B).
 *
 * 매칭된 것만 남기면 트리가 끊어진다. 실측(clemvion 141노드): `status=draft` 26건 중
 * **17건의 부모가 draft 가 아니다** — 부모를 빼면 그 17건의 `parent_id` 가 결과에 없는
 * 것을 가리킨다. `graph()` 가 이미 "허공을 가리키는 선을 만들지 않는다" 며 끝점 없는
 * 간선을 걷어내는데, 트리에서 부모 없는 노드를 만드는 것은 같은 종류의 결함이다.
 *
 * 조상을 채우는 값은 **노드 3개**다(26 → 29 · 전체 141). 대신 조상은 걸러낸 결과가
 * 아니므로 `matched` 로 가른다 — 그러지 않으면 "draft 29건" 으로 읽힌다.
 */
function markMatches<T extends StatusNode>(
  scoped: readonly T[],
  statuses: readonly string[],
): (T & { matched: boolean })[] {
  const matched = new Set(
    scoped
      .filter((node) => node.doc_status != null && statuses.includes(node.doc_status))
      .map((node) => node.id),
  );
  const byId = new Map(scoped.map((node) => [node.id, node]));
  const kept = new Set(matched);
  for (const id of matched) {
    let parent = byId.get(id)?.parent_id ?? null;
    // 이미 남기기로 한 조상에 닿으면 멈춘다 — 그 위쪽은 그것을 넣은 걸음이 이미 채웠다
    while (parent !== null && !kept.has(parent)) {
      kept.add(parent);
      parent = byId.get(parent)?.parent_id ?? null;
    }
  }
  return scoped
    .filter((node) => kept.has(node.id))
    .map((node) => ({ ...node, matched: matched.has(node.id) }));
}

/**
 * `root` 아래로 좁히고 `depth` 까지만 남긴다. 순서는 건드리지 않는다(질의의 sort_key·key).
 *
 * `depth` 는 **뿌리에서 내려온 간선 수**다 — `0` 이면 뿌리만, `1` 이면 뿌리와 그 자식.
 * `root` 를 주면 그 문서가 유일한 뿌리다.
 *
 * 순서는 **자리 → 깊이 → 상태**다. 계층으로 잘라낸 범위 안에서 상태를 거르고, 조상도
 * 그 범위 안에서만 채운다 — 잘라낸 밖에서 조상을 끌어오면 `depth` 가 뜻을 잃는다.
 *
 * @returns 걸러낸 노드(`statuses` 를 주면 노드마다 `matched`). `root` 가 이 프로젝트에
 *          없으면 `null`(부르는 쪽이 not_found 로 만든다)
 */
export function pruneTree<T extends StatusNode>(
  nodes: readonly T[],
  options: { root?: string | null; depth?: number | null; statuses?: readonly string[] | null },
): (T & { matched?: boolean })[] | null {
  const root = options.root ?? null;
  const depth = options.depth ?? null;
  const statuses = options.statuses ?? null;

  let scoped: readonly T[] = nodes;
  let level: Set<string>;
  if (root === null) {
    level = rootsOf(nodes);
  } else {
    const start = findRef(nodes, root);
    if (start === undefined) return null;
    const kept = withDescendants(nodes, start);
    scoped = nodes.filter((node) => kept.has(node.id));
    level = new Set([start.id]);
  }

  if (depth !== null) {
    const kept = new Set(level);
    for (let step = 0; step < depth; step += 1) {
      const next = scoped.filter(
        (node) => node.parent_id !== null && level.has(node.parent_id) && !kept.has(node.id),
      );
      if (next.length === 0) break;
      level = new Set(next.map((node) => node.id));
      for (const node of next) kept.add(node.id);
    }
    scoped = scoped.filter((node) => kept.has(node.id));
  }

  // 빈 목록은 "거르지 않는다" 다 — 아무것도 고르지 않은 필터는 필터가 아니다
  if (statuses === null || statuses.length === 0) return [...scoped];
  return markMatches(scoped, statuses);
}

/**
 * 중심에서 hop 이내의 부분 그래프 — 에이전트에게 전역을 통째로 주지 않기 위한 것이다.
 * 141노드·1,253간선을 매번 실어 보내면 컨텍스트 예산이 그것으로 찬다.
 *
 * `hops: 0` 은 중심 하나다. 중심을 찾지 못하면 **빈 그래프가 아니라 `null`** 이다 —
 * 빈 결과는 "이웃이 없다"로 읽히고, 그것은 오타를 사실로 만든다.
 */
export function neighborhood<N extends TreeNodeRef, E extends EdgeRef>(
  graph: { nodes: readonly N[]; edges: readonly E[] },
  around: string,
  hops: number,
): { nodes: N[]; edges: E[] } | null {
  const start = findRef(graph.nodes, around);
  if (start === undefined) return null;
  const near = new Set([start.id]);
  for (let step = 0; step < hops; step += 1) {
    const next: string[] = [];
    for (const edge of graph.edges) {
      if (near.has(edge.from_id) && !near.has(edge.to_id)) next.push(edge.to_id);
      if (near.has(edge.to_id) && !near.has(edge.from_id)) next.push(edge.from_id);
    }
    if (next.length === 0) break;
    for (const id of next) near.add(id);
  }
  return {
    nodes: graph.nodes.filter((node) => near.has(node.id)),
    edges: graph.edges.filter((edge) => near.has(edge.from_id) && near.has(edge.to_id)),
  };
}
