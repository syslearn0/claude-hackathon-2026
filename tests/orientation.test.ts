import assert from "node:assert/strict";
import { test } from "node:test";
import { Heading, headingFromEuler } from "../src/lib/orientation";

const near = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180) < 1;

test("向き：寝かせたときは上の端の向き、立てたときも同じ向きになる", () => {
  assert.ok(near(headingFromEuler(0, 0, 0), 0));
  assert.ok(near(headingFromEuler(90, 0, 0), 270)); // 左に 90 度回すと西
  // 上の端を起こして立てても（beta 70 度）、向きは同じ
  assert.ok(near(headingFromEuler(90, 70, 0), 270));
});

test("向き：合わせる前は磁石、線路で合わせたあとは相対の向き＋ずれ。磁石が狂っても変わらない", () => {
  const h = new Heading();
  h.setRel(10);
  assert.equal(h.now(), null); // 磁石もなく、合わせてもいない
  h.setAbs(100);
  assert.equal(h.by, "compass");
  assert.ok(near(h.now()!, 100));
  // ホームで、線路の向き（北から 45 度）を向いて合わせる
  assert.equal(h.calibrate(45), true);
  assert.equal(h.by, "track");
  assert.ok(near(h.now()!, 45));
  // 右に 30 度回る（相対の向きが 30 度増える）。磁石が狂って 200 度と言っても使わない
  h.setRel(40);
  h.setAbs(200);
  assert.ok(near(h.now()!, 75));
  h.nudge(-5);
  assert.ok(near(h.now()!, 70));
});

test("向き：歩きながら道順の向きに少しだけ寄せる。合わせる前と、大きくずれているときは寄せない", () => {
  const h = new Heading();
  h.setRel(0);
  assert.equal(h.pull(10, 0.5), false); // まだ合わせていない
  h.calibrate(100);
  assert.ok(h.pull(110, 0.5));
  assert.ok(near(h.now()!, 105));
  assert.equal(h.pull(200, 0.5), false); // 95 度ずれ：寄せない
  assert.ok(near(h.now()!, 105));
});
