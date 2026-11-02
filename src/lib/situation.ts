// ② 緊急時の状況の推定（プログラム側）。直近の GPS から「止まっている／歩いている／乗り物の中」を推定し、
// 乗り物なら進む向きから次の駅を推定する。数値の計算はここでやり、AI には結果と材料だけを渡す。
import { bearingDeg, distanceM, type LatLon } from "./geo";
import type { Station } from "./station-mode";

export type Fix = { t: number; lat: number; lon: number; acc: number; speed: number | null };

export type Situation = {
  state: "unknown" | "stopped" | "walking" | "vehicle";
  speedKmh?: number;
  headingDeg?: number;
  nextStation?: { name: string; meters: number; lat: number; lon: number };
  fixAgeSec?: number; // 最後に位置が取れてから
  accuracyM?: number;
  reason: string; // 人が読む根拠
};

const WINDOW_MS = 60_000; // 直近1分で判断する
const VEHICLE_MS = 6; // 秒速6m（時速約22km）を超えたら乗り物とみなす
const WALK_MS = 0.7;

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function estimateSituation(fixes: Fix[], stations: Station[], now = Date.now()): Situation {
  const recent = fixes.filter((f) => now - f.t <= WINDOW_MS && f.acc <= 200);
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
  const a = recent[0];
  const b = recent.at(-1)!;
  const dt = (b.t - a.t) / 1000;
  const moved = distanceM(a, b);
  // 端末が出す速さがあれば、その中央値も見る（ぶれに強い）
  const speeds = recent.map((f) => f.speed).filter((s): s is number => s !== null && s >= 0).sort((x, y) => x - y);
  const reported = speeds.length ? speeds[Math.floor(speeds.length / 2)] : undefined;
  const fromMove = dt > 0 ? moved / dt : 0;
  const speed = reported !== undefined ? Math.max(reported, fromMove * 0.8) : fromMove;
  const speedKmh = Math.round(speed * 3.6);
  const base = { speedKmh, fixAgeSec, accuracyM: Math.round(b.acc) };

  if (speed < WALK_MS) return { state: "stopped", ...base, reason: `ほぼ止まっている（時速約${speedKmh}km）` };
  if (speed < VEHICLE_MS) return { state: "walking", ...base, reason: `歩いている速さ（時速約${speedKmh}km）` };

  const headingDeg = Math.round(bearingDeg(a, b));
  // 進む向き（±40度）の前方、3km 以内でいちばん近い駅を「次の駅」と推定する
  const ahead = stations
    .map((s) => ({ s, d: distanceM(b, s), ang: angleDiff(bearingDeg(b, s), headingDeg) }))
    .filter((x) => x.d <= 3000 && x.d >= 80 && x.ang <= 40)
    .sort((x, y) => x.d - y.d)[0];
  return {
    state: "vehicle",
    ...base,
    headingDeg,
    nextStation: ahead && { name: ahead.s.name, meters: Math.round(ahead.d), lat: ahead.s.lat, lon: ahead.s.lon },
    reason: ahead
      ? `乗り物で移動中（時速約${speedKmh}km）。進む向きの先、約${Math.round(ahead.d / 100) / 10}kmに${ahead.s.name}駅`
      : `乗り物で移動中（時速約${speedKmh}km）。進む向きの先に、データのある駅が見つからない`,
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
