// ② 緊急時の状況の推定（プログラム側）。直近の GPS から「止まっている／歩いている／乗り物の中」を推定し、
// 乗り物なら次の駅を推定する。保存した経路があれば、いまどの区間かを求めて、その区間の先の駅を選ぶ。
// 数値の計算はここでやり、AI には結果と材料だけを渡す。
import { bearingDeg, distanceM, type LatLon } from "./geo";
import type { Station } from "./station-mode";

export type Fix = { t: number; lat: number; lon: number; acc: number; speed: number | null };

// 保存した経路の駅（位置が分かったものだけ）
export type RouteStation = { name: string; lat: number; lon: number; line?: string };

export type Situation = {
  state: "unknown" | "stopped" | "walking" | "vehicle";
  speedKmh?: number;
  headingDeg?: number;
  nextStation?: { name: string; meters: number; lat: number; lon: number };
  segment?: { from: string; to: string; line?: string }; // 保存した経路のどの区間か
  betweenStations?: boolean; // 乗り物で、駅と駅の間で止まっている
  fixAgeSec?: number; // 最後に位置が取れてから
  accuracyM?: number;
  reason: string; // 人が読む根拠
};

const WINDOW_MS = 60_000; // 直近1分で判断する
const HOLD_MS = 180_000; // 3分以内に乗り物の速さだったら、止まっていても乗り物の中とみなす（駅の間で止まったとき）
const VEHICLE_MS = 6; // 秒速6m（時速約22km）を超えたら乗り物とみなす
const WALK_MS = 0.7;
const STATION_NEAR_M = 250; // これより駅に近ければ「駅にいる」
const SEGMENT_NEAR_M = 3000; // 経路の区間からこれ以上離れていたら、経路は使わない
const ON_LINE_M = 1500; // 区間の直線からこの範囲の駅だけを「次の停車駅」の候補にする（並行する別の路線の駅を避ける）

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// 点と線分の距離（狭い範囲なので平面で近似）
function toSegmentM(p: LatLon, a: LatLon, b: LatLon): number {
  const kx = 111_320 * Math.cos((p.lat * Math.PI) / 180);
  const ky = 110_540;
  const ax = (a.lon - p.lon) * kx;
  const ay = (a.lat - p.lat) * ky;
  const bx = (b.lon - p.lon) * kx;
  const by = (b.lat - p.lat) * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function speedOf(fs: Fix[]): number {
  if (fs.length < 2) return 0;
  const a = fs[0];
  const b = fs.at(-1)!;
  const dt = (b.t - a.t) / 1000;
  const fromMove = dt > 0 ? distanceM(a, b) / dt : 0;
  // 端末が出す速さがあれば、その中央値も見る（ぶれに強い）
  const speeds = fs.map((f) => f.speed).filter((s): s is number => s !== null && s >= 0).sort((x, y) => x - y);
  const reported = speeds.length ? speeds[Math.floor(speeds.length / 2)] : undefined;
  return reported !== undefined ? Math.max(reported, fromMove * 0.8) : fromMove;
}

// 保存した経路から、いまの区間と進む向きの先の駅を求める
function alongRoute(at: LatLon, heading: number, route: RouteStation[], stations: Station[]) {
  let best: { i: number; d: number } | undefined;
  for (let i = 0; i + 1 < route.length; i++) {
    const d = toSegmentM(at, route[i], route[i + 1]);
    if (!best || d < best.d) best = { i, d };
  }
  if (!best || best.d > SEGMENT_NEAR_M) return undefined;
  const a = route[best.i];
  const b = route[best.i + 1];
  // 区間の向きと進む向きが逆なら、帰り道として扱う
  const forward = angleDiff(bearingDeg(a, b), heading) <= 90;
  const [from, to] = forward ? [a, b] : [b, a];
  const ahead = stations
    .map((s) => ({ s, d: distanceM(at, s), ang: angleDiff(bearingDeg(at, s), heading) }))
    .filter((x) => x.d >= 80 && x.d <= distanceM(at, to) + 200 && x.ang <= 50 && toSegmentM(x.s, from, to) <= ON_LINE_M)
    .sort((x, y) => x.d - y.d)[0];
  const next = ahead ? ahead.s : { name: to.name, lat: to.lat, lon: to.lon };
  return { next, segment: { from: from.name, to: to.name, line: forward ? a.line : b.line } };
}

export function estimateSituation(fixes: Fix[], stations: Station[], now = Date.now(), route: RouteStation[] = []): Situation {
  const good = fixes.filter((f) => f.acc <= 200);
  const recent = good.filter((f) => now - f.t <= WINDOW_MS);
  const last = fixes.at(-1);
  const fixAgeSec = last ? Math.round((now - last.t) / 1000) : undefined;
  if (recent.length < 2) {
    return {
      state: "unknown",
      fixAgeSec,
      accuracyM: last ? Math.round(last.acc) : undefined,
      reason: last ? `直近1分の位置が足りない（最後に取れてから${fixAgeSec}秒）` : "位置がまだ取れていない",
    };
  }
  const b = recent.at(-1)!;
  const speed = speedOf(recent);
  const speedKmh = Math.round(speed * 3.6);
  const base = { speedKmh, fixAgeSec, accuracyM: Math.round(b.acc) };
  const nearStation = stations.some((s) => distanceM(b, s) <= STATION_NEAR_M);

  // 直近3分のうちに乗り物の速さだった区間（駅の間で止まったときに使う）
  const held = good.filter((f) => now - f.t <= HOLD_MS);
  let moving: { a: Fix; b: Fix; speed: number } | undefined;
  for (let i = 1; i < held.length; i++) {
    const s = speedOf([held[i - 1], held[i]]);
    if (s >= VEHICLE_MS) moving = { a: held[i - 1], b: held[i], speed: s };
  }

  let state: Situation["state"];
  let heading: number | undefined;
  let between = false;
  if (speed >= VEHICLE_MS) {
    state = "vehicle";
    heading = bearingDeg(recent[0], b);
  } else if (moving && !nearStation) {
    state = "vehicle";
    between = true;
    heading = bearingDeg(moving.a, moving.b);
  } else if (speed >= WALK_MS) {
    return { state: "walking", ...base, reason: `歩いている速さ（時速約${speedKmh}km）` };
  } else {
    return { state: "stopped", ...base, reason: `ほぼ止まっている（時速約${speedKmh}km）` };
  }

  const h = heading!;
  const onRoute = route.length >= 2 ? alongRoute(b, h, route, stations) : undefined;
  let next: { name: string; lat: number; lon: number } | undefined = onRoute?.next;
  if (!next) {
    // 経路がなければ、進む向き（±40度）の前方、3km 以内でいちばん近い駅
    const ahead = stations
      .map((s) => ({ s, d: distanceM(b, s), ang: angleDiff(bearingDeg(b, s), h) }))
      .filter((x) => x.d <= 3000 && x.d >= 80 && x.ang <= 40)
      .sort((x, y) => x.d - y.d)[0];
    next = ahead?.s;
  }
  const meters = next ? Math.round(distanceM(b, next)) : undefined;
  const how = between
    ? `駅と駅の間で止まっているようです（さっきまで時速約${Math.round(moving!.speed * 3.6)}km）`
    : `乗り物で移動中（時速約${speedKmh}km）`;
  const where = onRoute
    ? `。保存した経路の「${onRoute.segment.from}→${onRoute.segment.to}」の区間${onRoute.segment.line ? `（${onRoute.segment.line}）` : ""}`
    : "";
  return {
    state,
    ...base,
    headingDeg: Math.round(h),
    betweenStations: between || undefined,
    segment: onRoute?.segment,
    nextStation: next && meters !== undefined ? { name: next.name, meters, lat: next.lat, lon: next.lon } : undefined,
    reason: next
      ? `${how}${where}。進む向きの先、約${Math.round(meters! / 100) / 10}kmに${next.name}駅`
      : `${how}${where}。進む向きの先に、データのある駅が見つからない`,
  };
}

// AI に渡す説明文（位置の細かい履歴は渡さず、推定と根拠だけ）
export function describeSituation(s: Situation, at: LatLon | undefined, firstToilet?: string, planSummary?: string): string {
  const lines = [
    `プログラムの推定：${s.reason}`,
    s.accuracyM !== undefined ? `位置の誤差：約${s.accuracyM}m` : "",
    at ? "" : "現在地：不明",
    firstToilet ? `画面に出している一番の候補：${firstToilet}` : "",
    planSummary ? `今日の計画：${planSummary}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}
