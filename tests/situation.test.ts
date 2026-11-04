import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateSituation, scheduleAt, type Fix } from "../src/lib/situation";

// 京阪の出町柳あたりを北へ進む想定の駅（実際の位置とは関係ない、試験用の値）
const stations = [
  { name: "南の駅", lat: 34.99, lon: 135.77 },
  { name: "北の駅", lat: 35.01, lon: 135.77 },
  { name: "東の駅", lat: 35.0, lon: 135.79 },
];
const now = 1_000_000;
// 北へ、秒速 v メートルで 30 秒進む位置の列
function trace(v: number, speed: number | null = null): Fix[] {
  return Array.from({ length: 31 }, (_, i) => ({
    t: now - (30 - i) * 1000,
    lat: 35.0 + (v * i) / 111_000,
    lon: 135.77,
    acc: 15,
    speed,
  }));
}

test("位置が足りなければ不明", () => {
  assert.equal(estimateSituation([], stations, now).state, "unknown");
  assert.equal(estimateSituation(trace(10).slice(-1), stations, now).state, "unknown");
});

test("止まっている・歩いている", () => {
  assert.equal(estimateSituation(trace(0), stations, now).state, "stopped");
  assert.equal(estimateSituation(trace(1.3), stations, now).state, "walking");
});

test("電車の速さなら、進む向きの先の駅を次の駅と推定する", () => {
  const s = estimateSituation(trace(15), stations, now);
  assert.equal(s.state, "vehicle");
  assert.equal(s.speedKmh, 54);
  assert.equal(s.nextStation?.name, "北の駅"); // 後ろの「南の駅」や横の「東の駅」は選ばない
});

test("端末が出す速さも使う（位置がほとんど動いていないように見えても）", () => {
  const s = estimateSituation(trace(0.5, 12), stations, now);
  assert.equal(s.state, "vehicle");
});

test("精度の悪い位置（200m より悪い）は使わない", () => {
  const bad = trace(15).map((f) => ({ ...f, acc: 500 }));
  assert.equal(estimateSituation(bad, stations, now).state, "unknown");
});

// 経路：南の駅 → 北の駅（真北へ約2.2km）。北東に、経路から外れた「並行線の駅」がある
const routeStations = [
  { name: "南の駅", lat: 34.99, lon: 135.77 },
  { name: "中の駅", lat: 35.006, lon: 135.7705 },
  { name: "北の駅", lat: 35.01, lon: 135.77 },
  { name: "並行線の駅", lat: 35.0035, lon: 135.785 },
];
const route = [
  { name: "南の駅", lat: 34.99, lon: 135.77, line: "テスト線" },
  { name: "北の駅", lat: 35.01, lon: 135.77 },
];

test("保存した経路があれば、その区間の上の駅を次の駅にする（並行線の駅は選ばない）", () => {
  const s = estimateSituation(trace(15), routeStations, now, route);
  assert.equal(s.state, "vehicle");
  assert.equal(s.nextStation?.name, "中の駅");
  assert.deepEqual(s.segment, { from: "南の駅", to: "北の駅", line: "テスト線" });
});

test("経路を逆向きに進んでいれば、帰り道として向きの先の駅を選ぶ", () => {
  const back = trace(15).map((f, i, all) => ({ ...f, lat: all[all.length - 1 - i].lat }));
  const s = estimateSituation(back, routeStations, now, route);
  assert.equal(s.segment?.to, "南の駅");
  assert.equal(s.nextStation?.name, "南の駅");
});

// 2分前まで北へ時速54kmで動き、そのあと70秒止まっている
function stopAfterMoving(lat0: number): Fix[] {
  const moving = Array.from({ length: 30 }, (_, i) => ({ t: now - 120_000 + i * 1000, lat: lat0 + (15 * i) / 111_000, lon: 135.77, acc: 15, speed: 15 }));
  const end = moving.at(-1)!;
  const stopped = Array.from({ length: 70 }, (_, i) => ({ t: now - 70_000 + i * 1000, lat: end.lat, lon: 135.77, acc: 15, speed: 0 }));
  return [...moving, ...stopped];
}

test("駅と駅の間で止まったら、乗り物の中のまま（線路わきのトイレに切り替えない）", () => {
  const s = estimateSituation(stopAfterMoving(34.992), routeStations, now, route);
  assert.equal(s.state, "vehicle");
  assert.equal(s.betweenStations, true);
  assert.match(s.reason, /駅と駅の間/);
});

test("駅で止まったときは、止まっている扱い（その駅のトイレを出せばよい）", () => {
  // 止まった位置が「中の駅」のすぐそばになるように始める
  const s = estimateSituation(stopAfterMoving(35.006 - (15 * 29) / 111_000), routeStations, now, route);
  assert.equal(s.state, "stopped");
});

test("すぐ近くに並ぶ別の路線の駅より、経路の駅を次の駅にする（伏見稲荷と稲荷のような並び）", () => {
  const ss = [
    { name: "南の駅", lat: 34.99, lon: 135.77 },
    { name: "経路の駅", lat: 35.0075, lon: 135.7702 },
    { name: "隣の路線の駅", lat: 35.0071, lon: 135.7712 },
    { name: "北の駅", lat: 35.01, lon: 135.77 },
  ];
  const r = [
    { name: "南の駅", lat: 34.99, lon: 135.77 },
    { name: "経路の駅", lat: 35.0075, lon: 135.7702 },
    { name: "北の駅", lat: 35.01, lon: 135.77 },
  ];
  assert.equal(estimateSituation(trace(15), ss, now, r).nextStation?.name, "経路の駅");
});

// 予定の時刻：丹波橋 8:10 発 → 出町柳 8:30 着（途中駅は時刻なし）
const keihan = [
  { name: "丹波橋", lat: 34.937, lon: 135.7737, line: "京阪本線", dep: "08:10" },
  { name: "出町柳", lat: 35.0303, lon: 135.7727, arr: "08:30" },
];
const keihanStations = [
  { name: "丹波橋", lat: 34.937, lon: 135.7737 },
  { name: "七条", lat: 34.9897, lon: 135.7727 },
  { name: "祇園四条", lat: 35.0037, lon: 135.7722 },
  { name: "出町柳", lat: 35.0303, lon: 135.7727 },
];
const at = (h: number, m: number) => new Date(2026, 10, 4, h, m).getTime();

test("予定の時刻から、乗っているはずの区間を出す（時刻の外では出さない）", () => {
  assert.equal(scheduleAt(keihan, at(8, 5)), undefined);
  const r = scheduleAt(keihan, at(8, 20));
  assert.equal(r?.kind, "riding");
  assert.equal(r?.kind === "riding" && r.to.name, "出町柳");
  assert.equal(scheduleAt(keihan, at(8, 31)), undefined);
  const transfer = [
    { name: "京都", lat: 0, lon: 0, dep: "08:00" },
    { name: "東京", lat: 1, lon: 1, arr: "10:15", dep: "10:30" },
    { name: "新宿", lat: 1.01, lon: 1, arr: "10:45" },
  ];
  const w = scheduleAt(transfer, at(10, 20));
  assert.equal(w?.kind === "at" && w.station.name, "東京");
});

test("位置が取れなくても、予定の時刻から「いま何駅と何駅の間か」を出す", () => {
  // 8:20 は 20分のうち半分：丹波橋と出町柳の真ん中は、七条の少し南
  const s = estimateSituation([], keihanStations, at(8, 20), keihan);
  assert.equal(s.state, "vehicle");
  assert.equal(s.basis, "schedule");
  assert.equal(s.where, "丹波橋〜七条の間");
  assert.equal(s.nextStation?.name, "七条");
  assert.match(s.plan ?? "", /出町柳着 08:30 の予定（あと約10分）/);
});

test("GPS で乗り物と分かれば、GPS の位置から前後の駅を出す（予定の着く時刻も添える）", () => {
  const t0 = at(8, 15);
  // 七条の少し北から北へ時速54km
  const fixes = Array.from({ length: 31 }, (_, i) => ({ t: t0 - (30 - i) * 1000, lat: 34.992 + (15 * i) / 111_000, lon: 135.7726, acc: 15, speed: null }));
  const s = estimateSituation(fixes, keihanStations, t0, keihan);
  assert.equal(s.basis, "gps");
  assert.equal(s.where, "七条〜祇園四条の間");
  assert.match(s.plan ?? "", /出町柳着 08:30/);
});

test("予定の時刻から出すとき、直線のそばの別の会社の駅（乃木坂）を次の駅にしない", () => {
  const route = [
    { name: "青山一丁目", lat: 35.6727, lon: 139.724, line: "都営大江戸線", dep: "08:10" },
    { name: "六本木", lat: 35.6629, lon: 139.7315, arr: "08:14" },
  ];
  const stations = [
    { name: "青山一丁目", operator: "東京都交通局", lat: 35.6727, lon: 139.724 },
    { name: "乃木坂", operator: "東京地下鉄", lat: 35.6666, lon: 139.7263 },
    { name: "六本木", operator: "東京都交通局", lat: 35.6629, lon: 139.7315 },
  ];
  assert.equal(estimateSituation([], stations, at(8, 12), route).nextStation?.name, "六本木");
});
