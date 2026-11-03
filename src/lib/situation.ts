// ② 緊急時の状況の推定（プログラム側）。直近の GPS から「止まっている／歩いている／乗り物の中」を推定し、
// 乗り物なら次の駅を推定する。保存した経路があれば、いまどの区間かを求めて、その区間の先の駅を選ぶ。
// 数値の計算はここでやり、AI には結果と材料だけを渡す。
import { bearingDeg, distanceM, type LatLon } from "./geo";
import type { Station } from "./station-mode";

export type Fix = { t: number; lat: number; lon: number; acc: number; speed: number | null };

// 保存した経路の駅（位置が分かったものだけ）。arr・dep は着く・出る時刻（"08:02"、書かれていれば）
export type RouteStation = { name: string; lat: number; lon: number; line?: string; arr?: string; dep?: string };

export type Situation = {
  state: "unknown" | "stopped" | "walking" | "vehicle";
  speedKmh?: number;
  headingDeg?: number;
  nextStation?: { name: string; meters: number; lat: number; lon: number };
  segment?: { from: string; to: string; line?: string }; // 保存した経路のどの区間か
  betweenStations?: boolean; // 乗り物で、駅と駅の間で止まっている
  prevStation?: string; // 通り過ぎた駅（いまはこの駅と nextStation の間）
  where?: string; // 人が読む「いまどこ」（例：七条〜祇園四条の間）
  basis?: "gps" | "schedule"; // GPS から出したか、予定の時刻から出したか
  plan?: string; // 予定の時刻から分かること（例：祇園四条着 08:21 の予定）
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
    .sort((x, y) => x.d - y.d);
  // 並行する別の路線の駅（京阪の伏見稲荷に対する JR の稲荷など）が少しだけ近いときは、経路の駅を選ぶ。
  // 貼られた経路は乗り換え駅だけのことが多いので、ずっと先の経路の駅を選んで途中の駅を飛ばすことはしない
  const pick = (xs: typeof ahead) => xs.find((x) => route.some((r) => r.name === x.s.name) && x.d - (xs[0]?.d ?? 0) <= 300) ?? xs[0];
  const onRoute = pick(ahead);
  // 通り過ぎた駅：向きの後ろ側で、区間の線の近くの、いちばん近い駅（なければ区間の始まりの駅）
  const behind = stations
    .map((s) => ({ s, d: distanceM(at, s), ang: angleDiff(bearingDeg(at, s), heading) }))
    .filter((x) => x.d <= distanceM(at, from) + 200 && (x.d < 80 || x.ang >= 130) && toSegmentM(x.s, from, to) <= ON_LINE_M)
    .sort((x, y) => x.d - y.d);
  const prev = pick(behind)?.s ?? from;
  const next = onRoute ? onRoute.s : { name: to.name, lat: to.lat, lon: to.lon };
  return { next, prev, segment: { from: from.name, to: to.name, line: forward ? a.line : b.line } };
}

// "08:02" をその日の時刻（ミリ秒）に。端末の時計の日付で考える
function timeOn(hm: string, now: number): number {
  const [h, m] = hm.split(":").map(Number);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

export type Scheduled =
  | { kind: "riding"; from: RouteStation; to: RouteStation; leave: number; arrive: number; arriveText: string }
  | { kind: "at"; station: RouteStation; leaveText: string };

// 保存した経路の時刻から、いま乗っているはずの区間（または乗り換えで待っているはずの駅）を求める
export function scheduleAt(route: RouteStation[], now: number): Scheduled | undefined {
  for (let i = 0; i + 1 < route.length; i++) {
    const start = route[i].dep;
    const endText = route[i + 1].arr ?? route[i + 1].dep;
    if (!start || !endText) continue;
    const leave = timeOn(start, now);
    let arrive = timeOn(endText, now);
    if (arrive < leave) arrive += 86_400_000; // 日をまたぐ
    if (now >= leave && now < arrive) return { kind: "riding", from: route[i], to: route[i + 1], leave, arrive, arriveText: endText };
  }
  for (const r of route) {
    if (r.arr && r.dep && now >= timeOn(r.arr, now) && now < timeOn(r.dep, now)) return { kind: "at", station: r, leaveText: r.dep };
  }
  return undefined;
}

const whereOf = (prev?: string, next?: string) => (prev && next && prev !== next ? `${prev}〜${next}の間` : next ? `${next}の手前` : undefined);

export function estimateSituation(fixes: Fix[], stations: Station[], now = Date.now(), route: RouteStation[] = []): Situation {
  const good = fixes.filter((f) => f.acc <= 200);
  const recent = good.filter((f) => now - f.t <= WINDOW_MS);
  const last = fixes.at(-1);
  const fixAgeSec = last ? Math.round((now - last.t) / 1000) : undefined;
  const planned = scheduleAt(route, now);
  if (recent.length < 2) {
    const lost = last ? `位置が取れていない（最後に取れてから${fixAgeSec}秒）` : "位置がまだ取れていない";
    if (planned?.kind === "riding") {
      // 予定どおり走っているとして、区間の上の位置を時刻の割合で置き、前後の駅を出す（線路は直線とみなす）
      const k = (now - planned.leave) / (planned.arrive - planned.leave);
      const p = { lat: planned.from.lat + (planned.to.lat - planned.from.lat) * k, lon: planned.from.lon + (planned.to.lon - planned.from.lon) * k };
      const along = alongRoute(p, bearingDeg(planned.from, planned.to), route, stations);
      const next = along?.next ?? planned.to;
      const prev = along?.prev.name ?? planned.from.name;
      const left = Math.max(0, Math.round((planned.arrive - now) / 60_000));
      return {
        state: "vehicle",
        fixAgeSec,
        accuracyM: last ? Math.round(last.acc) : undefined,
        basis: "schedule",
        segment: { from: planned.from.name, to: planned.to.name, line: planned.from.line },
        nextStation: { name: next.name, meters: Math.round(distanceM(p, next)), lat: next.lat, lon: next.lon },
        prevStation: prev,
        where: whereOf(prev, next.name),
        plan: `${planned.to.name}着 ${planned.arriveText} の予定（あと約${left}分）`,
        reason: `${lost}。予定の時刻では「${planned.from.name}→${planned.to.name}」に乗っている途中なので、予定どおり走っているとして推定（途中の駅は直線で見積もり）`,
      };
    }
    if (planned?.kind === "at") {
      return {
        state: "unknown",
        fixAgeSec,
        basis: "schedule",
        where: `${planned.station.name}駅（乗り換え）`,
        plan: `${planned.station.name}発 ${planned.leaveText} の予定`,
        reason: `${lost}。予定の時刻では、いま${planned.station.name}駅で乗り換えのはず`,
      };
    }
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
  const prev = onRoute?.prev.name;
  const sameLeg = planned?.kind === "riding" && onRoute && planned.to.name === onRoute.segment.to;
  return {
    state,
    ...base,
    headingDeg: Math.round(h),
    betweenStations: between || undefined,
    basis: "gps",
    prevStation: prev,
    where: whereOf(prev, next?.name),
    plan: sameLeg ? `${planned.to.name}着 ${planned.arriveText} の予定（あと約${Math.max(0, Math.round((planned.arrive - now) / 60_000))}分）` : undefined,
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
    s.where ? `いまどこ（プログラムの推定）：${s.where}${s.plan ? `、${s.plan}` : ""}` : "",
    s.accuracyM !== undefined ? `位置の誤差：約${s.accuracyM}m` : "",
    at ? "" : "現在地：不明",
    firstToilet ? `画面に出している一番の候補：${firstToilet}` : "",
    planSummary ? `今日の計画：${planSummary}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}
