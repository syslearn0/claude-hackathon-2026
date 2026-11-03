import assert from "node:assert/strict";
import { test } from "node:test";
import type { Maneuver } from "../src/lib/maneuvers";
import { advanceBySteps, checkpoints, HeadingCheck, nextCheckpoint, snapFloor, snapTurn, StepCounter, TurnWatcher, yawRate } from "../src/lib/tracking";

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

test("向き：道順と同じ向きなら進め、逆向きが続けば止めて知らせる。曲がる手前で先に曲がっても止めない", () => {
  const hc = new HeadingCheck();
  hc.calibrate(0);
  hc.turn(0, 0);
  assert.deepEqual(hc.step(0), { advance: true, drift: undefined });
  // その場で 180 度回る（左回り 90 度/秒 × 2 秒）
  for (let t = 20; t <= 2000; t += 20) hc.turn(t, 90);
  let last = hc.step(0);
  for (let i = 0; i < 3; i++) last = hc.step(0);
  assert.deepEqual(last, { advance: false, drift: "back" });
  // 合わせ直すと、また進む
  hc.calibrate(180);
  assert.equal(hc.step(180).advance, true);
  // 右へ 90 度回ったが、道順は数 m 先で右（90 度）に曲がる
  const c = new HeadingCheck();
  c.calibrate(0);
  c.turn(0, 0);
  for (let t = 20; t <= 1000; t += 20) c.turn(t, -90);
  assert.equal(c.step(0, 90).advance, true);
  // ジャイロが届かない端末では、何も言わずに進める
  const none = new HeadingCheck();
  none.calibrate(0);
  assert.deepEqual(none.step(90), { advance: true });
});
