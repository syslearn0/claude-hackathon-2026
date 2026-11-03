import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateSituation, type Fix } from "../src/lib/situation";

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
