// 上り下りの手段（階段・エスカレーター・エレベーター）を、3D で本物のような形に描くために、駅のネットワークから取り出す。
// 階段・エスカレーター：線 1 本ずつ（両端の位置と高さ）。踊り場をはさんでつながる線はひとまとまりにして、そのまとまりが
// 通る階を持たせる（今いる階を見せるときに、まとまりごと見せる）。上りと下りが同じ 2 点を結ぶときは 1 本にする。
// エレベーター：上り下りの線（ほぼ真上・真下）でつながる点を 1 つのかご道（シャフト）にまとめ、止まる階と、
// その階で乗り降りする向き（かご道のまんなかから、乗り場の点へ）を持たせる。
import { KIND, type Network } from "./route";

export type LiftPoint = { x: number; y: number; z: number; floor: number };
// room：横に使える幅（m）。すぐ横に並ぶ階段・エスカレーター（上りと下りのエスカレーター、そのあいだの階段など）との間隔。重ならないように、これより細く描く
// ext：踊り場（平らなもの）を a の端・b の端から延ばす長さ（m）。向きを変えて段につながる角では、段の幅の半分だけ延ばして角のすき間をふさぐ
// （まっすぐ続くところでは延ばさない。延ばすと、下の段の上に板がかぶさって浮いて見える）
export type Flight = { kind: "stairs" | "escalator"; a: LiftPoint; b: LiftPoint; floors: number[]; room: number; ext?: [number, number] };
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
  // 踊り場：データでは、階の途中の高さ（B4.5 など）を通る、ふつうの通路の線になっている。床の面がないので、ここで踊り場として描く
  const landing = (l: Network["links"][number]) => l[3] === KIND.walk && net.nodes[l[0]][2] === net.nodes[l[1]][2] && !Number.isInteger(net.nodes[l[0]][2]);
  const flightLinks = net.links.filter((l) => l[3] === KIND.stairs || l[3] === KIND.escalator || landing(l));
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
  const ends = new Map<Flight, [number, number]>(); // 線の両端の点の番号
  for (const l of flightLinks) {
    const key = `${Math.min(l[0], l[1])}-${Math.max(l[0], l[1])}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = at(l[0]);
    const b = at(l[1]);
    if (Math.hypot(b.x - a.x, b.z - a.z) < 0.3) continue; // 真上・真下の線は描けない（データの誤り）。短い踊り場は、下の板でふさがる
    const f: Flight = { kind: l[3] === KIND.escalator ? "escalator" : "stairs", a, b, floors: [...floorsOf.get(uf.find(l[0]))!].sort((x, y) => x - y), room: Infinity };
    flights.push(f);
    ends.set(f, [l[0], l[1]]);
  }
  // 横に並ぶもの：向きがほぼ同じ（または逆）で、高さが重なり、前後にも重なるもの。2 本の線の真ん中どうしの横の間隔を、幅の上限にする
  for (const f of flights) {
    const L = Math.hypot(f.b.x - f.a.x, f.b.z - f.a.z);
    const [ux, uz] = [(f.b.x - f.a.x) / L, (f.b.z - f.a.z) / L];
    for (const g of flights) {
      if (g === f) continue;
      const M = Math.hypot(g.b.x - g.a.x, g.b.z - g.a.z);
      if (Math.abs(ux * ((g.b.x - g.a.x) / M) + uz * ((g.b.z - g.a.z) / M)) < 0.94) continue;
      if (Math.max(g.a.y, g.b.y) < Math.min(f.a.y, f.b.y) - 0.1 || Math.min(g.a.y, g.b.y) > Math.max(f.a.y, f.b.y) + 0.1) continue;
      const along = (p: { x: number; z: number }) => (p.x - f.a.x) * ux + (p.z - f.a.z) * uz;
      const [g0, g1] = [along(g.a), along(g.b)].sort((x, y) => x - y);
      if (g1 < 0.5 || g0 > L - 0.5) continue;
      const mx = (g.a.x + g.b.x) / 2 - f.a.x;
      const mz = (g.a.z + g.b.z) / 2 - f.a.z;
      const side = Math.abs(mx * -uz + mz * ux);
      if (side > 0.05) f.room = Math.min(f.room, side);
    }
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
  // 踊り場の角：端の点で、向きのちがう（30 度より大きく曲がる）段・踊り場につながるなら、そちらへ延ばす
  const dir = (f: Flight) => {
    const L = Math.hypot(f.b.x - f.a.x, f.b.z - f.a.z);
    return [(f.b.x - f.a.x) / L, (f.b.z - f.a.z) / L];
  };
  for (const f of flights) {
    if (Math.abs(f.a.y - f.b.y) > 0.05) continue;
    const [u, w] = dir(f);
    const ext = ends.get(f)!.map((i) => {
      const turn = flights.some((g) => {
        if (g === f || !ends.get(g)!.includes(i)) return false;
        const [p, q] = dir(g);
        return Math.abs(u * p + w * q) < 0.87;
      });
      return turn ? 1.2 : 0;
    }) as [number, number];
    if (ext[0] || ext[1]) f.ext = ext;
  }
  return { flights, shafts };
}
