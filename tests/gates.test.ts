import assert from "node:assert/strict";
import { test } from "node:test";
import type { PathPoint } from "../src/lib/maneuvers";
import { gatePasses } from "../src/lib/gates";

// B4 を北へ 60m
const pts: PathPoint[] = [
  { x: 0, y: -12, z: 0, floor: -4 },
  { x: 0, y: -12, z: -60, floor: -4 },
];
const cum = [0, 60];

test("改札：道順のそばの改札（点）を通ったら、ホームから来たなら「出る」、外から来たなら「入る」", () => {
  const gates = [{ floor: -4, pts: [{ x: 2, z: -20 }] }];
  assert.deepEqual(gatePasses(pts, cum, gates, { startInside: true }), [{ at: 20, out: true, name: undefined }]);
  assert.equal(gatePasses(pts, cum, gates, { startInside: false })[0].out, false);
});

test("改札：行き先のトイレが改札の外なら、出発が分からなくても「出る」。どちらも分からなければ言わない", () => {
  const gates = [{ floor: -4, pts: [{ x: 2, z: -20 }] }];
  assert.equal(gatePasses(pts, cum, gates, { endInside: false })[0].out, true);
  assert.equal(gatePasses(pts, cum, gates, { endInside: true, startInside: false })[0].out, false);
  assert.equal(gatePasses(pts, cum, gates, {})[0].out, undefined);
});

test("改札：別の階・離れた改札・出発した改札は数えない。並んだ改札は1回。線の改札は名前を使う", () => {
  const other = [
    { floor: -5, pts: [{ x: 0, z: -20 }] },
    { floor: -4, pts: [{ x: 20, z: -30 }] },
  ];
  assert.deepEqual(gatePasses(pts, cum, other, { startInside: true }), []);
  assert.deepEqual(gatePasses(pts, cum, [{ floor: -4, pts: [{ x: 0, z: -2 }] }], { skipStartM: 10 }), []);
  const row = [
    { floor: -4, pts: [{ x: -1, z: -40 }] },
    {
      name: "中央東改札",
      floor: -4,
      pts: [
        { x: -6, z: -45 },
        { x: 6, z: -45 },
      ],
    },
  ];
  assert.deepEqual(gatePasses(pts, cum, row, { startInside: true }), [{ at: 40, out: true, name: "中央東改札" }]);
});
