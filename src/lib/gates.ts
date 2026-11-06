// 道順が改札を通るところ。改札を出る（運賃がかかる・戻れない）と入るは、トイレの案内でいちばん大事な分かれ目なので、
// 手順と確認ポイントにはっきり出す。
// 改札の形は駅によって違う（大江戸線のデータは名前のない点、国交省のデータは名前のある線）ので、
// 道順が同じ階で改札の点か線の WITHIN_M 以内を通ったら「改札を通る」とみなす。
// 出るか入るか：行き先のトイレが改札の内か外か分かれば、そこから逆にたどって決める。分からなければ出発から
// （ホームなら中）。どちらも分からなければ、出る・入るは言わない（out が undefined）。
import { pointAt, type PathPoint } from "./maneuvers";

export type GateShape = { name?: string; floor: number; pts: { x: number; z: number }[] };
export type GatePass = { at: number; out?: boolean; name?: string };
export type GateSides = { startInside?: boolean; endInside?: boolean; skipStartM?: number }; // skipStartM：改札から出発するとき、その改札は数えない

const WITHIN_M = 5;
const MERGE_M = 15; // 改札がいくつか並んでいるところは 1 回とみなす

function distToShape(p: { x: number; z: number }, g: GateShape): number {
  if (g.pts.length === 1) return Math.hypot(p.x - g.pts[0].x, p.z - g.pts[0].z);
  let best = Infinity;
  for (let i = 1; i < g.pts.length; i++) {
    const a = g.pts[i - 1];
    const b = g.pts[i];
    const l = (b.x - a.x) ** 2 + (b.z - a.z) ** 2;
    const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / l)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.z - (a.z + t * (b.z - a.z))));
  }
  return best;
}

export function gatePasses(pts: PathPoint[], cum: number[], gates: GateShape[], sides: GateSides): GatePass[] {
  const total = cum.at(-1) ?? 0;
  const hits: { at: number; name?: string }[] = [];
  for (const g of gates) {
    // 道順を 1m ごとにたどり、この改札にいちばん近づいたところ
    let best: { at: number; d: number } | undefined;
    for (let d = 0; d <= total; d += 1) {
      const p = pointAt(pts, cum, d);
      if (Math.abs(p.floor - g.floor) > 0.01) continue;
      const dist = distToShape(p, g);
      if (dist <= WITHIN_M && (!best || dist < best.d)) best = { at: d, d: dist };
    }
    if (best && best.at >= (sides.skipStartM ?? 0)) hits.push({ at: best.at, name: g.name });
  }
  hits.sort((a, b) => a.at - b.at);
  const merged: { at: number; name?: string }[] = [];
  for (const h of hits) {
    const last = merged.at(-1);
    if (last && h.at - last.at < MERGE_M) last.name ??= h.name;
    else merged.push({ ...h });
  }
  if (sides.endInside !== undefined) {
    // 行き先から逆にたどる：通ったあとが外なら「出る」
    let after = sides.endInside;
    const out = merged.map(() => false);
    for (let i = merged.length - 1; i >= 0; i--) {
      out[i] = !after;
      after = !after;
    }
    return merged.map((h, i) => ({ at: h.at, out: out[i], name: h.name }));
  }
  if (sides.startInside === undefined) return merged.map((h) => ({ at: h.at, name: h.name }));
  let inside = sides.startInside;
  return merged.map((h) => {
    const pass = { at: h.at, out: inside, name: h.name };
    inside = !inside;
    return pass;
  });
}

// ---------- 改札機の列を立てる位置（3D で、本物のような改札機を並べるため） ----------
// x・z は m（駅の中心から。z は南が +）。dx・dz は通る向き（単位ベクトル）。left・right は、列のまんなかから
// 通る向きの左・右に、改札機を並べてよい幅（m）。fence：壁までの柵を描く（点の改札。線の改札は線の長さだけ並べる）
// wallLeft・wallRight：柵をのばす長さ（通路の床の端まで。呼ぶ側が floorReach で入れる）
export type GateFrame = {
  x: number;
  z: number;
  floor: number;
  dx: number;
  dz: number;
  left: number;
  right: number;
  name?: string;
  out?: boolean;
  onRoute: boolean;
  fence: boolean;
  board: boolean;
  wallLeft?: number;
  wallRight?: number;
};
export type WalkLink = { floor: number; ax: number; az: number; bx: number; bz: number };

const POINT_HALF = 2.8; // 点の改札：まんなかから左右 2.8m まで（多くても 6 台）

function nearestOnSeg(p: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }) {
  const l = (b.x - a.x) ** 2 + (b.z - a.z) ** 2;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / l)) : 0;
  const q = { x: a.x + t * (b.x - a.x), z: a.z + t * (b.z - a.z) };
  return { t, q, d: Math.hypot(p.x - q.x, p.z - q.z) };
}

// 線の改札の 1 区間を、通る向き（区間に直角）の列にする。c：列のまんなか（区間の上の点）
function segFrame(g: GateShape, i: number, c: { x: number; z: number }, toward?: { dx: number; dz: number }) {
  const a = g.pts[i - 1];
  const b = g.pts[i];
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const [ux, uz] = [(b.x - a.x) / len, (b.z - a.z) / len];
  // 通る向きは区間に直角。道順があれば、その向きにそろえる
  let [dx, dz] = [uz, -ux];
  if (toward && dx * toward.dx + dz * toward.dz < 0) [dx, dz] = [-dx, -dz];
  // 列の中で +x は通る向きの左（dz, -dx）。区間の両端までの幅を、左右に分ける
  const along = (p: { x: number; z: number }) => (p.x - c.x) * dz + (p.z - c.z) * -dx;
  const ea = along(a);
  const eb = along(b);
  return { x: c.x, z: c.z, floor: g.floor, dx, dz, left: -Math.min(ea, eb), right: Math.max(ea, eb), len };
}

// dirs：点の改札を通る向き（gateDirs）。なければ近くの通路の向き
export function gateFrames(shapes: GateShape[], links: WalkLink[], route?: { pts: PathPoint[]; cum: number[]; passes: GatePass[] }, dirs?: ({ dx: number; dz: number } | undefined)[]): GateFrame[] {
  const out: GateFrame[] = [];
  const used = new Set<string>(); // 道順で使った改札（線は区間ごと）
  // 道順が通る改札：通るところを列のまんなかにし、道順の通路が改札機のあいだになるように
  for (const ps of route?.passes ?? []) {
    const { pts, cum } = route!;
    const total = cum.at(-1) ?? 0;
    const p = pointAt(pts, cum, ps.at);
    const a = pointAt(pts, cum, Math.max(0, ps.at - 1.5));
    const b = pointAt(pts, cum, Math.min(total, ps.at + 1.5));
    const h = Math.hypot(b.x - a.x, b.z - a.z);
    if (h < 0.3) continue;
    const toward = { dx: (b.x - a.x) / h, dz: (b.z - a.z) / h };
    let best: { gi: number; si: number; d: number; q: { x: number; z: number } } | undefined;
    shapes.forEach((g, gi) => {
      if (Math.abs(g.floor - p.floor) > 0.01) return;
      if (g.pts.length === 1) {
        const d = Math.hypot(p.x - g.pts[0].x, p.z - g.pts[0].z);
        if (d <= WITHIN_M && (!best || d < best.d)) best = { gi, si: 0, d, q: p };
        return;
      }
      for (let si = 1; si < g.pts.length; si++) {
        const r = nearestOnSeg(p, g.pts[si - 1], g.pts[si]);
        if (r.d <= WITHIN_M && (!best || r.d < best.d)) best = { gi, si, d: r.d, q: r.q };
      }
    });
    if (!best) continue;
    const g = shapes[best.gi];
    used.add(`${best.gi}:${best.si}`);
    // 点の改札か、線の改札でも道順が線をまたがない（線の端の近くを通る）ときは、道順の上に、道順に直角に並べる
    if (best.si === 0 || best.d > 0.75) {
      out.push({ x: p.x, z: p.z, floor: p.floor, ...toward, left: POINT_HALF, right: POINT_HALF, name: ps.name, out: ps.out, onRoute: true, fence: true, board: true });
    } else {
      // 線の改札：道順と線の交わるところを、通路のまんなかに
      const f = segFrame(g, best.si, best.q, toward);
      out.push({ ...f, name: ps.name, out: ps.out, onRoute: true, fence: false, board: true });
    }
  }
  // ほかの改札：線は区間ごとに、その線の上に並べる。点は、近くの通路の向きに通るとみなす
  shapes.forEach((g, gi) => {
    if (g.pts.length === 1) {
      if (used.has(`${gi}:0`)) return;
      const p = g.pts[0];
      const d = dirs?.[gi];
      if (d) {
        out.push({ x: p.x, z: p.z, floor: g.floor, ...d, left: POINT_HALF, right: POINT_HALF, name: g.name, onRoute: false, fence: true, board: true });
        return;
      }
      let best: { d: number; l: WalkLink } | undefined;
      for (const l of links) {
        if (Math.abs(l.floor - g.floor) > 0.01) continue;
        const len = Math.hypot(l.bx - l.ax, l.bz - l.az);
        if (len < 0.5) continue;
        const r = nearestOnSeg(p, { x: l.ax, z: l.az }, { x: l.bx, z: l.bz });
        if (r.d <= 10 && (!best || r.d < best.d)) best = { d: r.d, l };
      }
      if (!best) return;
      const len = Math.hypot(best.l.bx - best.l.ax, best.l.bz - best.l.az);
      out.push({
        x: p.x,
        z: p.z,
        floor: g.floor,
        dx: (best.l.bx - best.l.ax) / len,
        dz: (best.l.bz - best.l.az) / len,
        left: POINT_HALF,
        right: POINT_HALF,
        name: g.name,
        onRoute: false,
        fence: true,
        board: true,
      });
      return;
    }
    // 案内板は、その線でいちばん長い区間にだけ
    let longest = 0;
    for (let si = 1; si < g.pts.length; si++) longest = Math.max(longest, Math.hypot(g.pts[si].x - g.pts[si - 1].x, g.pts[si].z - g.pts[si - 1].z));
    let boarded = used.has(`${gi}:any`);
    for (let si = 1; si < g.pts.length; si++) {
      if (used.has(`${gi}:${si}`)) {
        boarded = true;
        continue;
      }
      const a = g.pts[si - 1];
      const b = g.pts[si];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.8) continue;
      const f = segFrame(g, si, { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
      const board = !boarded && len >= longest - 0.01;
      if (board) boarded = true;
      out.push({ ...f, name: g.name, onRoute: false, fence: false, board });
    }
  });
  return out;
}

// 改札の列の左右に、通路の床（その階の歩ける所の形）がどこまで続くか（m）。列を床の端まで柵でふさぐため
// （改札のデータは点 1 つなので、通路が広いと、列の横が開いて外とつながって見える）。left は列の -x 側（通る向きの右）
export type FloorPoly = { floor: number; pts: { x: number; z: number }[] };
export function floorReach(f: { x: number; z: number; floor: number; dx: number; dz: number }, floors: FloorPoly[], max = 40): { left: number; right: number } {
  const polys = floors.filter((p) => Math.abs(p.floor - f.floor) < 0.01);
  const inside = (x: number, z: number) =>
    polys.some(({ pts }) => {
      let hit = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [a, b] = [pts[i], pts[j]];
        if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) hit = !hit;
      }
      return hit;
    });
  const march = (ux: number, uz: number) => {
    let was = false;
    for (let t = 0; t <= max; t += 0.2) {
      const now = inside(f.x + ux * t, f.z + uz * t);
      if (now) was = true;
      else if (was || t > 3) return was ? t : 0;
    }
    return max;
  };
  return { left: march(-f.dz, f.dx), right: march(f.dz, -f.dx) };
}

// 改札（点）を通る向き：駅の道を、改札を通らずにホームから行ける「内」と、地上から行ける「外」に分け、
// 改札のまわり（15m、なければ 25m 以内）の内の点の平均から外の点の平均への向き。決まらなければ undefined（近くの通路の向きを使う）
export type NetNode = { x: number; z: number; floor: number };
// 駅の道を、改札を通らずにホームから行ける「内」と、地上から行ける「外」に分ける（改札の点から 6m 以内を通る線は切る）
export function paidSides(nodes: NetNode[], links: [number, number][], shapes: GateShape[]): { inner: Set<number>; outer: Set<number> } {
  const pts = shapes.flatMap((g) => (g.pts.length === 1 ? [{ ...g.pts[0], floor: g.floor }] : []));
  const adj = new Map<number, number[]>();
  for (const [a, b] of links) {
    const [p, q] = [nodes[a], nodes[b]];
    const cut = pts.some((g) => (Math.abs(g.floor - p.floor) < 0.01 || Math.abs(g.floor - q.floor) < 0.01) && nearestOnSeg(g, p, q).d < 6);
    if (cut) continue;
    adj.set(a, [...(adj.get(a) ?? []), b]);
    adj.set(b, [...(adj.get(b) ?? []), a]);
  }
  const bfs = (start: number[]) => {
    const s = new Set(start);
    const q = [...start];
    while (q.length)
      for (const j of adj.get(q.shift()!) ?? []) {
        if (s.has(j)) continue;
        s.add(j);
        q.push(j);
      }
    return s;
  };
  const minF = Math.min(...nodes.map((n) => n.floor));
  return { inner: bfs(nodes.flatMap((n, i) => (n.floor === minF ? [i] : []))), outer: bfs(nodes.flatMap((n, i) => (n.floor >= 1 ? [i] : []))) };
}

export function gateDirs(nodes: NetNode[], links: [number, number][], shapes: GateShape[]): ({ dx: number; dz: number } | undefined)[] {
  const pts = shapes.map((g) => (g.pts.length === 1 ? { ...g.pts[0], floor: g.floor } : undefined));
  const { inner, outer } = paidSides(nodes, links, shapes);
  return pts.map((g) => {
    if (!g) return undefined;
    for (const r of [15, 25]) {
      const near = (s: Set<number>, t: Set<number>) => [...s].filter((i) => !t.has(i) && Math.abs(nodes[i].floor - g.floor) < 0.01 && Math.hypot(nodes[i].x - g.x, nodes[i].z - g.z) < r);
      const ii = near(inner, outer);
      const oo = near(outer, inner);
      if (!ii.length || !oo.length) continue;
      const mean = (ids: number[]) => ({ x: ids.reduce((s, i) => s + nodes[i].x, 0) / ids.length, z: ids.reduce((s, i) => s + nodes[i].z, 0) / ids.length });
      const [a, b] = [mean(ii), mean(oo)];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L > 0.5) return { dx: (b.x - a.x) / L, dz: (b.z - a.z) / L };
    }
    return undefined;
  });
}

// 改札の内と外を分ける壁：改札のある階の床を 0.5m の格子に分け、マスごとに、いちばん近い道の点（20m 以内）が内か外かで塗り分けて、
// 内と外の境目に壁を立てる（改札のデータは点 1 つで、床は内も外も 1 枚の広間になっていることが多く、そのままだと改札の横を通れて見える）。
// 改札の点から 3.3m 以内（改札機の列）は開けておく。返すのは壁の線（同じ向きに続くものはつなぐ）
export type WallSeg = { floor: number; ax: number; az: number; bx: number; bz: number };
export function paidWalls(nodes: NetNode[], links: [number, number][], shapes: GateShape[], floors: FloorPoly[], step = 0.5): WallSeg[] {
  return smoothWalls(gridWalls(nodes, links, shapes, floors, step), 0.6);
}

// 格子の辺の壁は階段状にぎざぎざなので、つながる辺を 1 本の折れ線にして、まっすぐに近づける（ずれは eps m まで）
function smoothWalls(segs: WallSeg[], eps: number): WallSeg[] {
  const key = (f: number, x: number, z: number) => `${f}:${x.toFixed(2)},${z.toFixed(2)}`;
  const at = new Map<string, number[]>();
  segs.forEach((w, i) => {
    for (const k of [key(w.floor, w.ax, w.az), key(w.floor, w.bx, w.bz)]) at.set(k, [...(at.get(k) ?? []), i]);
  });
  const used = new Set<number>();
  const out: WallSeg[] = [];
  const rdp = (pts: { x: number; z: number }[]): { x: number; z: number }[] => {
    if (pts.length < 3) return pts;
    const [a, b] = [pts[0], pts[pts.length - 1]];
    let [best, bi] = [0, 0];
    for (let i = 1; i < pts.length - 1; i++) {
      const d = nearestOnSeg(pts[i], a, b).d;
      if (d > best) [best, bi] = [d, i];
    }
    return best <= eps ? [a, b] : [...rdp(pts.slice(0, bi + 1)).slice(0, -1), ...rdp(pts.slice(bi))];
  };
  segs.forEach((w0, i0) => {
    if (used.has(i0)) return;
    used.add(i0);
    // 両側へたどる（分かれ道（3 本以上が集まる点）で止める）
    const walk = (x: number, z: number) => {
      const pts: { x: number; z: number }[] = [];
      for (;;) {
        const next = (at.get(key(w0.floor, x, z)) ?? []).filter((j) => !used.has(j));
        if (next.length !== 1 || (at.get(key(w0.floor, x, z)) ?? []).length > 2) return pts;
        const w = segs[next[0]];
        used.add(next[0]);
        const far = key(w.floor, w.ax, w.az) === key(w0.floor, x, z) ? { x: w.bx, z: w.bz } : { x: w.ax, z: w.az };
        pts.push(far);
        [x, z] = [far.x, far.z];
      }
    };
    const back = walk(w0.ax, w0.az);
    const fwd = walk(w0.bx, w0.bz);
    const line = rdp([...back.reverse(), { x: w0.ax, z: w0.az }, { x: w0.bx, z: w0.bz }, ...fwd]);
    for (let i = 1; i < line.length; i++) out.push({ floor: w0.floor, ax: line[i - 1].x, az: line[i - 1].z, bx: line[i].x, bz: line[i].z });
  });
  return out;
}

function gridWalls(nodes: NetNode[], links: [number, number][], shapes: GateShape[], floors: FloorPoly[], step: number): WallSeg[] {
  const { inner, outer } = paidSides(nodes, links, shapes);
  const out: WallSeg[] = [];
  const gatePts = shapes.flatMap((g) => (g.pts.length === 1 ? [{ ...g.pts[0], floor: g.floor }] : []));
  for (const F of [...new Set(gatePts.map((g) => g.floor))]) {
    const side = (i: number) => (inner.has(i) !== outer.has(i) ? (inner.has(i) ? 1 : 2) : 0);
    const ns = nodes.flatMap((n, i) => (Math.abs(n.floor - F) < 0.01 && side(i) ? [{ ...n, inside: side(i) === 1 }] : []));
    // 道の線の上にも 1.5m おきに点を打つ（長い通路の途中に点がないと、通路ぞいの床が反対側に塗られる）
    for (const [a, b] of links) {
      const [p, q] = [nodes[a], nodes[b]];
      // 片方の端が改札のすぐそば（内でも外でもない）なら、もう片方の側とみなす。両端で側がちがう線（改札を通る線）は打たない
      const sd = side(a) && side(b) ? (side(a) === side(b) ? side(a) : 0) : side(a) || side(b);
      if (Math.abs(p.floor - F) > 0.01 || Math.abs(q.floor - F) > 0.01 || !sd) continue;
      const n = Math.floor(Math.hypot(q.x - p.x, q.z - p.z) / 1.5);
      for (let k = 1; k < n; k++) ns.push({ x: p.x + ((q.x - p.x) * k) / n, z: p.z + ((q.z - p.z) * k) / n, floor: F, inside: sd === 1 });
    }
    if (!ns.some((n) => n.inside) || !ns.some((n) => !n.inside)) continue;
    const polys = floors.filter((p) => Math.abs(p.floor - F) < 0.01);
    const inPoly = (x: number, z: number) =>
      polys.some(({ pts }) => {
        let hit = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [a, b] = [pts[i], pts[j]];
          if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) hit = !hit;
        }
        return hit;
      });
    const xs = ns.map((n) => n.x);
    const zs = ns.map((n) => n.z);
    const [x0, x1, z0, z1] = [Math.min(...xs) - 20, Math.max(...xs) + 20, Math.min(...zs) - 20, Math.max(...zs) + 20];
    const W = Math.ceil((x1 - x0) / step);
    const H = Math.ceil((z1 - z0) / step);
    // マスの印：1 = 内、2 = 外、0 = 床でない・遠い
    const lab = new Uint8Array(W * H);
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const x = x0 + (i + 0.5) * step;
        const z = z0 + (j + 0.5) * step;
        let best = 400; // 20m の 2 乗
        let inside = false;
        for (const n of ns) {
          const d = (n.x - x) ** 2 + (n.z - z) ** 2;
          if (d < best) [best, inside] = [d, n.inside];
        }
        if (best < 400 && inPoly(x, z)) lab[j * W + i] = inside ? 1 : 2;
      }
    // 開けておくところ：改札の点から 3.3m 以内と、改札のすぐそばの線（両端とも内でも外でもない、改札の通り道）から 1m 以内
    const lanes = links.filter(([a, b]) => !side(a) && !side(b) && Math.abs(nodes[a].floor - F) < 0.01 && Math.abs(nodes[b].floor - F) < 0.01).map(([a, b]) => [nodes[a], nodes[b]]);
    const open = (x: number, z: number) => gatePts.some((g) => Math.abs(g.floor - F) < 0.01 && Math.hypot(g.x - x, g.z - z) < 3.3) || lanes.some(([p, q]) => nearestOnSeg({ x, z }, p, q).d < 1);
    // 横に並ぶマスの境目（縦の壁）と、縦に並ぶマスの境目（横の壁）。同じ線の上で続くものはつなぐ
    for (let i = 0; i + 1 < W; i++) {
      let run = -1;
      for (let j = 0; j <= H; j++) {
        const a = j < H ? lab[j * W + i] : 0;
        const b = j < H ? lab[j * W + i + 1] : 0;
        const x = x0 + (i + 1) * step;
        const wall = a && b && a !== b && !open(x, z0 + (j + 0.5) * step);
        if (wall && run < 0) run = j;
        if (!wall && run >= 0) {
          out.push({ floor: F, ax: x, az: z0 + run * step, bx: x, bz: z0 + j * step });
          run = -1;
        }
      }
    }
    for (let j = 0; j + 1 < H; j++) {
      let run = -1;
      for (let i = 0; i <= W; i++) {
        const a = i < W ? lab[j * W + i] : 0;
        const b = i < W ? lab[(j + 1) * W + i] : 0;
        const z = z0 + (j + 1) * step;
        const wall = a && b && a !== b && !open(x0 + (i + 0.5) * step, z);
        if (wall && run < 0) run = i;
        if (!wall && run >= 0) {
          out.push({ floor: F, ax: x0 + run * step, az: z, bx: x0 + i * step, bz: z });
          run = -1;
        }
      }
    }
  }
  return out;
}

// その階の歩ける床の上か（r m 以内に床があれば上とみなす）。エレベーターの止まる階に床が描かれているか確かめるため
export function onFloor(floors: FloorPoly[], floor: number, x: number, z: number, r = 2): boolean {
  const polys = floors.filter((p) => Math.abs(p.floor - floor) < 0.01);
  const inside = (px: number, pz: number) =>
    polys.some(({ pts }) => {
      let hit = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [a, b] = [pts[i], pts[j]];
        if (a.z > pz !== b.z > pz && px < ((b.x - a.x) * (pz - a.z)) / (b.z - a.z) + a.x) hit = !hit;
      }
      return hit;
    });
  return [
    [0, 0],
    [r, 0],
    [-r, 0],
    [0, r],
    [0, -r],
  ].some(([dx, dz]) => inside(x + dx, z + dz));
}
