// 距離・方角・歩く時間。AI ではなく計算で出す部分

export type LatLon = { lat: number; lon: number };

const R = 6371000;
const rad = Math.PI / 180;

export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 北を 0 として時計回りの角度
export function bearingDeg(a: LatLon, b: LatLon): number {
  const y = Math.sin((b.lon - a.lon) * rad) * Math.cos(b.lat * rad);
  const x =
    Math.cos(a.lat * rad) * Math.sin(b.lat * rad) -
    Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lon - a.lon) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

const DIRS = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];

export function directionJa(deg: number): string {
  return DIRS[Math.round(deg / 45) % 8];
}

// 直線距離からの目安。道は曲がっているので 1.3 倍し、分速 70m（急いでいない人の速さ）で割る
export function walkMinutes(meters: number): number {
  return Math.max(1, Math.round((meters * 1.3) / 70));
}
