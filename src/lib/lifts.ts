// 上り下りの手段（階段・エスカレーター・エレベーター）を、3D で本物のような形に描くために、駅のネットワークから取り出す。
// 階段・エスカレーター：線 1 本ずつ（両端の位置と高さ）。踊り場をはさんでつながる線はひとまとまりにして、そのまとまりが
// 通る階を持たせる（今いる階を見せるときに、まとまりごと見せる）。上りと下りが同じ 2 点を結ぶときは 1 本にする。
// エレベーター：上り下りの線（ほぼ真上・真下）でつながる点を 1 つのかご道（シャフト）にまとめ、止まる階と、
// その階で乗り降りする向き（かご道のまんなかから、乗り場の点へ）を持たせる。
import { KIND, type Network } from "./route";

export type LiftPoint = { x: number; y: number; z: number; floor: number };
export type Flight = { kind: "stairs" | "escalator"; a: LiftPoint; b: LiftPoint; floors: number[] };
export type ShaftStop = { floor: number; y: number; dx: number; dz: number };
export type Shaft = { x: number; z: number; stops: ShaftStop[] };
export type LiftParts = { flights: Flight[]; shafts: Shaft[] };

function unionFind(n: number) {
  const p = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (p[i] === i ? i : (p[i] = find(p[i])));
  return { find, join: (a: number, b: number) => void (p[find(a)] = find(b)) };
}

// at：点の番号 → 3D の位置（呼ぶ側の座標。y は高さ）
export function liftParts(net: Network, at: (i: number) => LiftPoint): LiftParts {
  const n = net.nodes.length;
  const flightLinks = net.links.filter((l) => l[3] === KIND.stairs || l[3] === KIND.escalator);
  const uf = unionFind(n);
  for (const l of flightLinks) uf.join(l[0], l[1]);
  const floorsOf = new Map<number, Set<number>>();
  for (const l of flightLinks)
    for (const i of [l[0], l[1]]) {
      const r = uf.find(i);
      floorsOf.set(r, (floorsOf.get(r) ?? new Set()).add(net.nodes[i][2]));
    }
  const seen = new Set<string>();
  const flights: Flight[] = [];
  for (const l of flightLinks) {
    const key = `${Math.min(l[0], l[1])}-${Math.max(l[0], l[1])}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = at(l[0]);
    const b = at(l[1]);
    if (Math.hypot(b.x - a.x, b.z - a.z) < 0.3) continue; // 真上・真下の線は描けない（データの誤り）
    flights.push({ kind: l[3] === KIND.stairs ? "stairs" : "escalator", a, b, floors: [...floorsOf.get(uf.find(l[0]))!].sort((x, y) => x - y) });
  }

  // エレベーター
  const liftLinks = net.links.filter((l) => l[3] === KIND.elevator);
  const ue = unionFind(n);
  for (const l of liftLinks) ue.join(l[0], l[1]);
  const groups = new Map<number, { vertical: Set<number>; all: Set<number> }>();
  for (const l of liftLinks) {
    const r = ue.find(l[0]);
    const g = groups.get(r) ?? { vertical: new Set(), all: new Set() };
    g.all.add(l[0]).add(l[1]);
    if (net.nodes[l[0]][2] !== net.nodes[l[1]][2]) g.vertical.add(l[0]).add(l[1]);
    groups.set(r, g);
  }
  const shafts: Shaft[] = [];
  for (const g of groups.values()) {
    if (!g.vertical.size) continue;
    const vs = [...g.vertical].map(at);
    const x = vs.reduce((s, p) => s + p.x, 0) / vs.length;
    const z = vs.reduce((s, p) => s + p.z, 0) / vs.length;
    const stops: ShaftStop[] = [];
    for (const floor of [...new Set(vs.map((p) => p.floor))].sort((a, b) => a - b)) {
      const y = vs.find((p) => p.floor === floor)!.y;
      // 乗り場：この階で、かご道からいちばん離れた点（乗り口の線の先）
      let hall: LiftPoint | undefined;
      for (const i of g.all) {
        const p = at(i);
        if (p.floor === floor && Math.hypot(p.x - x, p.z - z) > 0.3 && (!hall || Math.hypot(p.x - x, p.z - z) > Math.hypot(hall.x - x, hall.z - z))) hall = p;
      }
      const d = hall ? Math.hypot(hall.x - x, hall.z - z) : 0;
      stops.push({ floor, y, dx: hall ? (hall.x - x) / d : 0, dz: hall ? (hall.z - z) / d : 1 });
    }
    shafts.push({ x, z, stops });
  }
  return { flights, shafts };
}
