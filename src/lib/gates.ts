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
