// 何号車に乗っていたか → 降りたホームのどのあたりか（経路の出発点にする）。
// ホームは、その駅のネットワークでいちばん深い階の点（大江戸線の駅はホームがいちばん下）。
// 1号車がどちらの端かは路線ごとに決まっている。大江戸線は「光が丘→都庁前、大門・月島・両国行きの先頭が1号車」
// （号車案内の個人サイト https://wadattsu261.com/content/azabujuban-toeioedohome-info/ 。公式資料では未確認）。
// 電車は 光が丘 → 都庁前 → 新宿 → 六本木 → 大門 → 両国 → 飯田橋 → 都庁前 と向きを変えずに走るので、環状部ではこの向きの前が1号車。
import type { LatLon } from "./geo";
import type { Network } from "./route";

// 大江戸線の環状部（1号車が前になる向き：都庁前 → 新宿 → 六本木 → 大門 → 両国 → 飯田橋 → 新宿西口）。光が丘方面の放射部は、ここでは使わない
const OEDO_LOOP = [
  "都庁前",
  "新宿",
  "代々木",
  "国立競技場",
  "青山一丁目",
  "六本木",
  "麻布十番",
  "赤羽橋",
  "大門",
  "汐留",
  "築地市場",
  "勝どき",
  "月島",
  "門前仲町",
  "清澄白河",
  "森下",
  "両国",
  "蔵前",
  "新御徒町",
  "上野御徒町",
  "本郷三丁目",
  "春日",
  "飯田橋",
  "牛込神楽坂",
  "牛込柳町",
  "若松河田",
  "東新宿",
  "新宿西口",
];

export const LINE_CARS: Record<string, { cars: number; note: string }> = {
  大江戸線: { cars: 8, note: "1号車は大門・両国行きの先頭（非公式の情報。目安）" },
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
  // 階段・エスカレーター・エレベーターの乗り口の点は、出発点にしない（降りたところが乗り口の上に重ならないように）
  const lift = new Set(net.links.filter((l) => l[3] === 1 || l[3] === 2 || l[3] === 3).flatMap((l) => [l[0], l[1]]));
  const onFloor = net.nodes.map((n, i) => ({ n, i })).filter(({ n }) => n[2] === minFloor);
  const flat = onFloor.filter(({ i }) => !lift.has(i));
  const platform = flat.length ? flat : onFloor;
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
