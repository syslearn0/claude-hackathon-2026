// 試験用の作りもの：駅の実際の座標をつないで、電車が走った記録（.gpslog.json と同じ形）を作る
import { distanceM } from "../../src/lib/geo";
import type { RouteStation } from "../../src/lib/situation";

export type TraceFix = { t: number; rx?: number; lat: number; lon: number; acc: number; speed: number | null; heading: number | null };
export type Trace = { note?: string; fixes: TraceFix[] };

export const T0 = Date.UTC(2026, 10, 3, 23, 0, 0); // 2026-11-04 08:00 JST

// 経路を時速 kmh で走り、中間の駅で stopSec 止まる。gap（開始秒, 長さ秒）の間は位置を出さない（地下）
export function makeTrace(route: RouteStation[], opts: { kmh?: number; stopSec?: number; gap?: [number, number]; acc?: number } = {}): Trace {
  const v = (opts.kmh ?? 50) / 3.6;
  const stopSec = opts.stopSec ?? 30;
  const acc = opts.acc ?? 15;
  const fixes: TraceFix[] = [];
  let sec = 0;
  const push = (lat: number, lon: number, speed: number) => {
    const inGap = opts.gap && sec >= opts.gap[0] && sec < opts.gap[0] + opts.gap[1];
    if (!inGap) fixes.push({ t: T0 + sec * 1000, rx: T0 + sec * 1000, lat, lon, acc, speed, heading: null });
    sec++;
  };
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i];
    const b = route[i + 1];
    const len = distanceM(a, b);
    for (let k = 0; k < (i === 0 ? 5 : stopSec); k++) push(a.lat, a.lon, 0); // 駅で止まる
    const steps = Math.ceil(len / v);
    for (let k = 1; k < steps; k++) {
      const f = (k * v) / len;
      push(a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f, v);
    }
  }
  const end = route[route.length - 1];
  for (let k = 0; k < 10; k++) push(end.lat, end.lon, 0);
  return { note: "synthetic", fixes };
}
