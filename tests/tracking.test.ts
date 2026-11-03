import assert from "node:assert/strict";
import { test } from "node:test";
import type { Maneuver } from "../src/lib/maneuvers";
import { advanceBySteps, checkpoints, nextCheckpoint, snapFloor, snapTurn, StepCounter, TurnWatcher, yawRate } from "../src/lib/tracking";

// 30m で右、40m でエレベーター（B6→B3、降り口 55m）、80m でトイレ
const list: Maneuver[] = [
  { at: 30, kind: "right", text: "右方向" },
  { at: 40, kind: "floor", text: "", end: 55, via: "elevator", toFloor: -3, up: true },
  { at: 80, kind: "arrive", text: "到着" },
];
const cps = checkpoints(list);

test("確認ポイント：角・乗り口・降り口・トイレの順", () => {
  assert.deepEqual(
    cps.map((c) => c.kind),
    ["turn", "board", "alight", "arrive"],
  );
  assert.equal(nextCheckpoint(cps, 30)?.kind, "board");
});

test("歩数では乗り口より先へ進まない。降りたあとはトイレまで", () => {
  assert.equal(advanceBySteps(cps, 39, 5), 40);
  assert.equal(advanceBySteps(cps, 40, 5), 40);
  assert.equal(advanceBySteps(cps, 56, 50), 80);
});

test("曲がったら近くの同じ向きの角に、上がったら近くの上りの降り口に合わせる", () => {
  assert.equal(snapTurn(cps, 22, "right"), 30);
  assert.equal(snapTurn(cps, 22, "left"), undefined);
  assert.equal(snapTurn(cps, 70, "right"), undefined);
  assert.equal(snapFloor(cps, 40, true), 55);
  assert.equal(snapFloor(cps, 40, false), undefined);
});

test("歩数：1秒に2回の揺れを 2 秒で 4 歩と数える", () => {
  const sc = new StepCounter();
  let n = 0;
  for (let t = 0; t < 2000; t += 20) if (sc.push(t, 9.8 + 3 * Math.max(0, Math.sin((2 * Math.PI * 2 * t) / 1000)))) n++;
  assert.equal(n, 4);
});

test("曲がり：画面を上にして持ち、1 秒で 90 度右へ回ると「右」。左右の揺れだけなら何もない", () => {
  const flat = { x: 0, y: 0, z: 9.8 };
  const tw = new TurnWatcher();
  let got: string | undefined;
  for (let t = 0; t <= 1000; t += 20) got ??= tw.push(t, yawRate({ alpha: -90, beta: 0, gamma: 0 }, flat));
  assert.equal(got, "right");
  const sway = new TurnWatcher();
  let any: string | undefined;
  for (let t = 0; t <= 5000; t += 20) any ??= sway.push(t, yawRate({ alpha: 40 * Math.sin((2 * Math.PI * t) / 1000), beta: 0, gamma: 0 }, flat));
  assert.equal(any, undefined);
});
