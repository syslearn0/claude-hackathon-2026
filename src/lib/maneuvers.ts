// 経路の形から、曲がり角ごとの案内（「7m 先を右方向」「エスカレーターで B3 → B1」）を作る。
// 歩く目線の 3D（/lab/3d の「歩く」）で使う。距離は経路に沿った長さ（m）。上り下りの高さも足す（1階 5m とみなす）。
import type { GuideStep, Network, Route } from "./route";

export const FLOOR_M = 5; // 1階ぶんの高さ（m）。歩く目線では実際に近い高さで描く

export type PathPoint = { x: number; y: number; z: number; floor: number }; // x：東、z：南、y：上（m）
export type Maneuver = { at: number; kind: "left" | "right" | "floor" | "arrive"; text: string };

// 経路の点を、駅の中心からの m の座標に
export function routePath(net: Network, route: Route, center: { lat: number; lon: number }): { pts: PathPoint[]; cum: number[] } {
  const kx = 111_320 * Math.cos((center.lat * Math.PI) / 180);
  const pts = route.nodes.map((i) => {
    const [lat, lon, floor] = net.nodes[i];
    return { x: (lon - center.lon) * kx, y: floor * FLOOR_M, z: -(lat - center.lat) * 110_540, floor };
  });
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z));
  return { pts, cum };
}

// 経路の上で、始まりから d m のところ（点の間はまっすぐつなぐ）
export function pointAt(pts: PathPoint[], cum: number[], d: number): PathPoint {
  if (d <= 0) return pts[0];
  const total = cum.at(-1)!;
  if (d >= total) return pts.at(-1)!;
  let i = 1;
  while (cum[i] < d) i++;
  const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  const a = pts[i - 1];
  const b = pts[i];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, floor: t < 0.5 ? a.floor : b.floor };
}

// 細かいぶれをならす（ダグラス・ポーカー法。平面で tol m より小さい曲がりは無視）。返すのは残した点の番号
function simplify(pts: PathPoint[], from: number, to: number, tol: number): number[] {
  if (to - from < 2) return [from, to];
  const a = pts[from];
  const b = pts[to];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  let worst = -1;
  let worstD = tol;
  for (let i = from + 1; i < to; i++) {
    const d = Math.abs((pts[i].x - a.x) * dz - (pts[i].z - a.z) * dx) / len;
    if (d > worstD) {
      worst = i;
      worstD = d;
    }
  }
  if (worst < 0) return [from, to];
  return [...simplify(pts, from, worst, tol).slice(0, -1), ...simplify(pts, worst, to, tol)];
}

// 北を 0 度、時計回りの向き
const heading = (a: PathPoint, b: PathPoint) => (Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI;

export function maneuvers(pts: PathPoint[], cum: number[], steps: GuideStep[]): Maneuver[] {
  const out: Maneuver[] = [];
  // 階が変わるところ（エスカレーター・階段・エレベーター）
  for (const s of steps) if (s.fromFloor !== s.toFloor) out.push({ at: cum[s.from], kind: "floor", text: s.text });
  // 同じ階の続くところごとに、ならしてから 40 度より大きく曲がるところ
  let start = 0;
  for (let i = 1; i <= pts.length; i++) {
    if (i < pts.length && pts[i].floor === pts[start].floor) continue;
    const keep = simplify(pts, start, i - 1, 1.5);
    for (let k = 1; k + 1 < keep.length; k++) {
      const [p, q, r] = [pts[keep[k - 1]], pts[keep[k]], pts[keep[k + 1]]];
      if (Math.hypot(q.x - p.x, q.z - p.z) < 2 || Math.hypot(r.x - q.x, r.z - q.z) < 2) continue;
      let turn = heading(q, r) - heading(p, q);
      turn = ((turn + 540) % 360) - 180;
      if (Math.abs(turn) < 40) continue;
      out.push({ at: cum[keep[k]], kind: turn > 0 ? "right" : "left", text: turn > 0 ? "右方向" : "左方向" });
    }
    start = i;
  }
  out.sort((a, b) => a.at - b.at);
  out.push({ at: cum.at(-1)!, kind: "arrive", text: "到着" });
  return out;
}
