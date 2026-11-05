import assert from "node:assert/strict";
import { test } from "node:test";
import type { PathPoint } from "../src/lib/maneuvers";
import { gateFrames, gatePasses } from "../src/lib/gates";

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

test("改札機の列：道順が通る線の改札は、交わるところを通路のまんなかに。ほかの線・点の改札にも列を立てる", () => {
  // 道順は北へ（z が減る）。z=-20 に東西 10m の線の改札（交わるのは西端から 4m）、z=-40 に点の改札
  const line = {
    floor: -4,
    pts: [
      { x: -4, z: -20 },
      { x: 6, z: -20 },
    ],
  };
  const point = { floor: -4, pts: [{ x: 0.5, z: -40 }] };
  const other = {
    floor: -4,
    pts: [
      { x: 30, z: 0 },
      { x: 30, z: -8 },
    ],
  }; // 道順から離れた線
  const lonely = { floor: -4, pts: [{ x: 50, z: 50 }] }; // 近くに通路のない点（列は立てない）
  const links = [{ floor: -4, ax: 20, az: 5, bx: 20, bz: 15 }];
  const passes = gatePasses(pts, cum, [line, point, other, lonely], {});
  const fs = gateFrames([line, point, other, lonely], links, { pts, cum, passes });
  const onRoute = fs.filter((f) => f.onRoute);
  assert.equal(onRoute.length, 2);
  const l = onRoute.find((f) => !f.fence)!;
  assert.ok(Math.abs(l.x) < 1e-6 && Math.abs(l.z + 20) < 1e-6);
  assert.ok(Math.abs(l.dz + 1) < 1e-6); // 道順の向き（北）にそろえる
  assert.ok(Math.abs(l.left + l.right - 10) < 1e-6);
  const p = onRoute.find((f) => f.fence)!;
  assert.ok(Math.abs(p.z + 40) < 1.1);
  const rest = fs.filter((f) => !f.onRoute);
  assert.equal(rest.length, 1); // 離れた線の 1 区間だけ（点 lonely は通路がないので立てない）
  assert.ok(Math.abs(rest[0].x - 30) < 1e-6 && Math.abs(rest[0].left + rest[0].right - 8) < 1e-6);
});
