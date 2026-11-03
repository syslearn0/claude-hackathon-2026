// 何号車に乗っていたか → 降りたホームのどのあたりか（経路の出発点にする）。
// ホームは、その駅のネットワークでいちばん深い階の点（大江戸線の駅はホームがいちばん下）。
// 1号車がどちらの端かは路線ごとに決まっている。大江戸線は「都庁前寄りが1号車」（非公式の情報。目安）で、
// 環状部では 都庁前 → 新宿西口 → … → 大門 → 六本木 → … → 新宿 → 都庁前 の向きの前が1号車になる。
import type { LatLon } from "./geo";
import type { Network } from "./route";

// 大江戸線の環状部（1号車が前になる向き）。光が丘方面の放射部は、ここでは使わない
const OEDO_LOOP = [
  "都庁前", "新宿西口", "東新宿", "若松河田", "牛込柳町", "牛込神楽坂", "飯田橋", "春日", "本郷三丁目", "上野御徒町", "新御徒町",
  "蔵前", "両国", "森下", "清澄白河", "門前仲町", "月島", "勝どき", "築地市場", "汐留", "大門", "赤羽橋", "麻布十番", "六本木",
  "青山一丁目", "国立競技場", "代々木", "新宿",
];

export const LINE_CARS: Record<string, { cars: number; note: string }> = {
  大江戸線: { cars: 8, note: "1号車は都庁前寄り（非公式の情報。目安）" },
};

// 1号車の側にある隣の駅と、反対側の隣の駅（大江戸線の駅だけ）
export function carEnds(station: string): { car1Side: string; otherSide: string } | undefined {
  const i = OEDO_LOOP.indexOf(station);
  if (i < 0) return undefined;
  return { car1Side: OEDO_LOOP[(i + 1) % OEDO_LOOP.length], otherSide: OEDO_LOOP[(i - 1 + OEDO_LOOP.length) % OEDO_LOOP.length] };
}

// ホームの、その号車のあたりの点。stationsAt は駅名 → 位置（隣の駅の向きを知るため）
export function carStartNode(net: Network, station: string, car: number, stationsAt: (name: string) => LatLon | undefined, cars = 8): number | undefined {
  const ends = carEnds(station);
  if (!ends) return undefined;
  const a = stationsAt(ends.otherSide);
  const b = stationsAt(ends.car1Side);
  if (!a || !b) return undefined;
  const minFloor = Math.min(...net.nodes.map((n) => n[2]));
  const platform = net.nodes.map((n, i) => ({ n, i })).filter(({ n }) => n[2] === minFloor);
  if (!platform.length) return undefined;
  // 反対側の駅 → 1号車側の駅 の向き（m 単位の平面）に、ホームの点を並べる
  const kx = 111_320 * Math.cos((a.lat * Math.PI) / 180);
  const dx = (b.lon - a.lon) * kx;
  const dy = (b.lat - a.lat) * 110_540;
  const len = Math.hypot(dx, dy) || 1;
  const proj = platform.map(({ n, i }) => ({ i, t: ((n[1] - a.lon) * kx * dx + (n[0] - a.lat) * 110_540 * dy) / len }));
  const tMin = Math.min(...proj.map((p) => p.t));
  const tMax = Math.max(...proj.map((p) => p.t));
  // 1号車は tMax の端。k 号車の真ん中は、端から (k - 0.5) / 両数 のところ
  const target = tMax - ((Math.min(cars, Math.max(1, car)) - 0.5) / cars) * (tMax - tMin);
  return proj.reduce((best, p) => (Math.abs(p.t - target) < Math.abs(best.t - target) ? p : best)).i;
}
