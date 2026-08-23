// fcose 는 타입 선언을 함께 내지 않는다(@types 도 없다). 레이아웃 등록 한 줄만 쓰므로
// 최소 선언으로 막는다 — `any` 를 코드에 흩뿌리는 것보다 경계를 한 곳에 두는 편이 낫다.
declare module 'cytoscape-fcose' {
  import type cytoscape from 'cytoscape';
  const extension: cytoscape.Ext;
  export default extension;
}
