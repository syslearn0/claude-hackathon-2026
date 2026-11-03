// 駅の中の経路を探す（歩行空間ネットワークデータ。data/network/<駅>.json、scripts/import-network.ts が作る）。
// 画面はまだ使っていない。「階段を使わない」「エスカレーターも使わない（車いす・ベビーカー）」を選べる。
// 時間は目安：歩く 1.0m/秒、階段 0.4m/秒（上り下り・踊り場）、エスカレーター 0.5m/秒、エレベーターは待ち 45秒＋1階 5秒。

import { distanceM, type LatLon } from "./geo";

export const KIND = { walk: 0, stairs: 1, escalator: 2, elevator: 3, slope: 4, movingWalk: 5, crossing: 6 } as const;
export type KindName = keyof typeof KIND;
const KIND_NAME = Object.keys(KIND) as KindName[];

export type Network = {
  station: string;
  sources: string[];
  attribution: string[];
  nodes: [number, number, number][]; // [緯度, 経度, 階]
  links: [number, number, number, number, number, number][]; // [起点, 終点, 長さm, 種類, 一方通行, 段差あり]
};

export type RouteOptions = {
  noStairs?: boolean; // 階段を使わない（エスカレーター・エレベーター・スロープは使う。数cm の段差は気にしない）
  stepFree?: boolean; // 階段・エスカレーター・2cm より大きい段差を使わない（車いす・ベビーカー）
};

export type RouteStep = { kind: KindName; meters: number; seconds: number; fromFloor: number; toFloor: number };
export type Route = { seconds: number; meters: number; nodes: number[]; steps: RouteStep[] };

type Edge = { to: number; len: number; kind: number; step: boolean };

// 隣り合う点の一覧（一方通行は向きの通りだけ）
function adjacency(g: Network): Edge[][] {
  const adj: Edge[][] = g.nodes.map(() => []);
  for (const [a, b, len, kind, oneway, step] of g.links) {
    adj[a].push({ to: b, len, kind, step: step === 1 });
    if (!oneway) adj[b].push({ to: a, len, kind, step: step === 1 });
  }
  return adj;
}

function edgeSeconds(e: Edge, floors: number): number {
  switch (e.kind) {
    case KIND.stairs:
      return e.len / 0.4;
    case KIND.escalator:
      return e.len / 0.5;
    case KIND.elevator:
      // データでは、エレベーターの前の同じ階の短い線にも「エレベーター」が付いている。階が変わらなければ歩きとみなす
      return floors === 0 ? e.len / 1.0 : 45 + 5 * floors;
    default:
      return e.len / 1.0;
  }
}

function allowed(e: Edge, o: RouteOptions): boolean {
  if ((o.noStairs || o.stepFree) && e.kind === KIND.stairs) return false;
  if (o.stepFree && (e.kind === KIND.escalator || e.step)) return false;
  return true;
}

// 一番近い点。階を渡せば、その階の点から選ぶ（近くになければ全部から）
export function nearestNode(g: Network, at: LatLon, floor?: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let pass = 0; pass < 2 && best < 0; pass++) {
    g.nodes.forEach(([lat, lon, f], i) => {
      if (pass === 0 && floor !== undefined && f !== floor) return;
      const d = distanceM(at, { lat, lon });
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (floor === undefined) break;
  }
  return best;
}

// 最短時間の経路（ダイクストラ法）。見つからなければ undefined
export function findRoute(g: Network, from: number, to: number, o: RouteOptions = {}): Route | undefined {
  const adj = adjacency(g);
  const n = g.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const prevEdge: (Edge | undefined)[] = new Array(n);
  dist[from] = 0;
  // 小さな二分ヒープ
  const heap: [number, number][] = [[0, from]];
  const push = (x: [number, number]) => {
    heap.push(x);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, u] = pop();
    if (d > dist[u]) continue;
    if (u === to) break;
    for (const e of adj[u]) {
      if (!allowed(e, o)) continue;
      const floors = Math.abs(g.nodes[e.to][2] - g.nodes[u][2]);
      const nd = d + edgeSeconds(e, floors);
      if (nd < dist[e.to]) {
        dist[e.to] = nd;
        prev[e.to] = u;
        prevEdge[e.to] = e;
        push([nd, e.to]);
      }
    }
  }
  if (!Number.isFinite(dist[to])) return undefined;

  const nodes: number[] = [];
  for (let v = to; v !== -1; v = prev[v]) nodes.unshift(v);
  // 同じ種類が続くところは1つの手順にまとめる
  const steps: RouteStep[] = [];
  let meters = 0;
  for (let i = 1; i < nodes.length; i++) {
    const e = prevEdge[nodes[i]]!;
    const a = g.nodes[nodes[i - 1]][2];
    const b = g.nodes[nodes[i]][2];
    const kind = e.kind === KIND.elevator && a === b ? "walk" : (KIND_NAME[e.kind] ?? "walk");
    const sec = edgeSeconds(e, Math.abs(b - a));
    const len = kind === "elevator" ? 0 : e.len;
    meters += len;
    const last = steps.at(-1);
    if (last && last.kind === kind) {
      last.meters += len;
      last.seconds += kind === "elevator" ? 5 * Math.abs(b - a) : sec;
      last.toFloor = b;
    } else steps.push({ kind, meters: len, seconds: sec, fromFloor: a, toFloor: b });
  }
  for (const s of steps) {
    s.meters = Math.round(s.meters);
    s.seconds = Math.round(s.seconds);
  }
  return { seconds: Math.round(dist[to]), meters: Math.round(meters), nodes, steps };
}

const fl = (f: number) => (Number.isInteger(f) ? (f < 0 ? `B${-f}` : `${f}F`) : `${f < 0 ? `B${Math.ceil(-f)}` : `${Math.floor(f)}F`}と${f < 0 ? (Math.floor(-f) === 0 ? "1F" : `B${Math.floor(-f)}`) : `${Math.ceil(f)}F`}の間`);
const KIND_JA: Record<KindName, string> = { walk: "歩く", stairs: "階段", escalator: "エスカレーター", elevator: "エレベーター", slope: "スロープ", movingWalk: "動く歩道", crossing: "横断" };

// 人が読む手順（例：「歩く 約80m」「エスカレーターで B1 → 1F」）。
// 短い歩き（10m 未満。踊り場など）は出さず、そのせいで並んだ同じ種類（階段・階段）は1つにまとめる
export function describeSteps(r: Route): string[] {
  const merged: RouteStep[] = [];
  for (const s of r.steps.filter((s) => !(s.kind === "walk" && s.meters < 10))) {
    const last = merged.at(-1);
    if (last && last.kind === s.kind) {
      last.meters += s.meters;
      last.toFloor = s.toFloor;
    } else merged.push({ ...s });
  }
  return merged
    .map((s) =>
      s.fromFloor !== s.toFloor
        ? `${KIND_JA[s.kind]}で ${fl(s.fromFloor)} → ${fl(s.toFloor)}`
        : `${KIND_JA[s.kind]} 約${Math.max(10, Math.round(s.meters / 10) * 10)}m`,
    );
}
