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
