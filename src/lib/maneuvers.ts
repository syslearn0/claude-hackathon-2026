// 経路の形から、曲がり角ごとの案内（「7m 先を右方向」「エスカレーターで B3 → B1」）を作る。
// 歩く目線の 3D（/lab/3d の「歩く」）で使う。距離は経路に沿った長さ（m）。上り下りの高さも足す（1階 5m とみなす）。
import type { GuideStep, KindName, Network, Route } from "./route";

export const FLOOR_M = 5; // 1階ぶんの高さ（m）。歩く目線では実際に近い高さで描く

export type PathPoint = { x: number; y: number; z: number; floor: number }; // x：東、z：南、y：上（m）
// 階が変わるところは、乗り口（at）と降り口（end）、手段（via）、行き先の階も持つ
export type Maneuver = { at: number; kind: "left" | "right" | "floor" | "arrive"; text: string; end?: number; via?: KindName; toFloor?: number; up?: boolean };

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
  for (const s of steps) if (s.fromFloor !== s.toFloor) out.push({ at: cum[s.from], kind: "floor", text: s.text, end: cum[s.to], via: s.kind, toFloor: s.toFloor, up: s.toFloor > s.fromFloor });
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

// 点 q にいちばん近い、経路の上の位置（始まりからの m）。yk は高さの縮尺（3D の描き方が違うとき）
export function nearestOnPath(pts: PathPoint[], cum: number[], q: { x: number; y: number; z: number }, yk = 1): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = { x: pts[i - 1].x, y: pts[i - 1].y * yk, z: pts[i - 1].z };
    const b = { x: pts[i].x, y: pts[i].y * yk, z: pts[i].z };
    const v = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const len2 = v.x * v.x + v.y * v.y + v.z * v.z;
    const t = len2 ? Math.max(0, Math.min(1, ((q.x - a.x) * v.x + (q.y - a.y) * v.y + (q.z - a.z) * v.z) / len2)) : 0;
    const d = Math.hypot(a.x + v.x * t - q.x, a.y + v.y * t - q.y, a.z + v.z * t - q.z);
    if (d < bestD) {
      bestD = d;
      best = cum[i - 1] + (cum[i] - cum[i - 1]) * t;
    }
  }
  return best;
}

// 歩く目線で見せる道：1m ごとに区切り、同じ高さの続くところだけ前後 win m で横ぶれをならす。
// 区切りの位置は元の道の距離（cum）のままなので、位置（道順の上の m）はそのまま使える。
// 階の変わり目（エレベーター・エスカレーターの乗り口と降り口）はずらさない
export function smoothPath(pts: PathPoint[], cum: number[], step = 1, win = 4): { pts: PathPoint[]; cum: number[] } {
  const total = cum.at(-1) ?? 0;
  const at: number[] = [];
  for (let d = 0; d < total; d += step) at.push(d);
  pts.forEach((p, i) => {
    if (i === 0 || i === pts.length - 1 || p.y !== pts[i - 1].y || p.y !== pts[i + 1].y) at.push(cum[i]);
  });
  at.push(total);
  at.sort((a, b) => a - b);
  const s = at.filter((d, i) => i === 0 || d - at[i - 1] > 1e-6);
  const raw = s.map((d) => pointAt(pts, cum, d));
  // 同じ高さが続くまとまり
  const run: number[] = [];
  raw.forEach((p, i) => run.push(i > 0 && p.y === raw[i - 1].y ? run[i - 1] : i));
  const runEnd: number[] = [];
  for (let i = raw.length - 1; i >= 0; i--) runEnd[i] = i < raw.length - 1 && run[i + 1] === run[i] ? runEnd[i + 1] : i;
  const out = raw.map((p, i) => {
    const k = Math.min(win, s[i] - s[run[i]], s[runEnd[i]] - s[i]);
    if (k < 0.5) return p;
    let x = 0;
    let z = 0;
    let n = 0;
    for (let j = run[i]; j <= runEnd[i]; j++) {
      if (Math.abs(s[j] - s[i]) > k) continue;
      x += raw[j].x;
      z += raw[j].z;
      n++;
    }
    return { ...p, x: x / n, z: z / n };
  });
  return { pts: out, cum: s };
}
