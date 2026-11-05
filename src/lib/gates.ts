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
export type GateFrame = { x: number; z: number; floor: number; dx: number; dz: number; left: number; right: number; name?: string; out?: boolean; onRoute: boolean; fence: boolean; board: boolean };
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

export function gateFrames(shapes: GateShape[], links: WalkLink[], route?: { pts: PathPoint[]; cum: number[]; passes: GatePass[] }): GateFrame[] {
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
