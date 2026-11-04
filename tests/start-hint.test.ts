import assert from "node:assert/strict";
import { test } from "node:test";
import type { PathPoint } from "../src/lib/maneuvers";
import { startHint, turnAdvice } from "../src/lib/start-hint";

// 北（-z）へ 30m 歩いて、そこから東へ 20m
const pts: PathPoint[] = [
  { x: 0, y: 0, z: 0, floor: -5 },
  { x: 0, y: 0, z: -30, floor: -5 },
  { x: 20, y: 0, z: -30, floor: -5 },
];
const cum = [0, 30, 50];

test("最初の向き：北へ歩くなら 0 度。ホームを1号車の側へ歩くなら号車で言う", () => {
  const platform = { floor: -5, toCar1: { x: 0, z: -1 }, cars: 8, car1Side: "赤羽橋", otherSide: "汐留" };
  assert.deepEqual(startHint(pts, cum, 0, [], platform), { bearing: 0, text: "1号車の方（赤羽橋寄り）へ" });
  const back = { ...platform, toCar1: { x: 0, z: 1 } };
  assert.equal(startHint(pts, cum, 0, [], back)?.text, "8号車の方（汐留寄り）へ");
});

test("最初の向き：ホームでなければ、先にある大事な目印の方へ（後ろや離れたものは使わない）", () => {
  const marks = [
    { x: 3, z: -20, floor: -5, name: "エスカレーター", kind: "escalator" },
    { x: -2, z: -25, floor: -5, name: "中央東改札", kind: "gate" },
    { x: 0, z: 10, floor: -5, name: "西改札", kind: "gate" },
    { x: 30, z: -10, floor: -5, name: "店", kind: "shop" },
  ];
  assert.deepEqual(startHint(pts, cum, 0, marks), { bearing: 0, text: "中央東改札の方へ" });
  assert.equal(startHint(pts, cum, 0, [])?.text, undefined);
});

test("向きの差：右・左・後ろ・そのまま", () => {
  assert.equal(turnAdvice(90, 0).text, "右を向く");
  assert.equal(turnAdvice(0, 90).text, "左を向く");
  assert.equal(turnAdvice(180, 10).text, "後ろを向く");
  assert.equal(turnAdvice(350, 10).text, "この向きでOK");
});
