import assert from "node:assert/strict";
import { test } from "node:test";
import { PhoneSteps } from "../src/lib/tracking";

test("歩数と向き：道順の向きなら進む、後ろを向いて 2 歩で戻る、横向きは止まる", () => {
  const s = new PhoneSteps();
  assert.equal(s.step(10, 0).move, 1);
  assert.equal(s.step(180, 0).move, 0); // 1 歩だけ後ろ向き：まだ戻さない
  assert.equal(s.step(185, 0).move, -1);
  const third = s.step(175, 0);
  assert.equal(third.move, -1);
  assert.equal(third.drift, "back");
  assert.equal(s.step(90, 0).move, 0); // 横向き
  assert.equal(s.step(0, 0).move, 1);
  // 角の手前で先の向きに曲がっても進む
  assert.equal(s.step(90, 0, 90).move, 1);
});
