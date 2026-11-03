import assert from "node:assert/strict";
import { test } from "node:test";
import { maneuvers, pointAt, routePath } from "../src/lib/maneuvers";
import { findRoute, guideSteps, KIND, type Network } from "../src/lib/route";

// B1：北へ 30m → 東（右）へ 20m → 階段で 1F へ → 北へ 15m
const c = { lat: 35.0, lon: 139.0 };
const dLat = (m: number) => m / 110_540;
const dLon = (m: number) => m / (111_320 * Math.cos((35 * Math.PI) / 180));
const g: Network = {
  station: "テスト",
  sources: [],
  attribution: [],
  nodes: [
    [c.lat, c.lon, -1],
    [c.lat + dLat(30), c.lon, -1],
    [c.lat + dLat(30), c.lon + dLon(20), -1],
    [c.lat + dLat(34), c.lon + dLon(20), 1],
    [c.lat + dLat(49), c.lon + dLon(20), 1],
  ],
  links: [
    [0, 1, 30, KIND.walk, 0, 0],
    [1, 2, 20, KIND.walk, 0, 0],
    [2, 3, 6, KIND.stairs, 0, 0],
    [3, 4, 15, KIND.walk, 0, 0],
  ],
};

test("曲がり角と階の変わり目と到着を、経路に沿った距離の順に出す", () => {
  const r = findRoute(g, 0, 4)!;
  const { pts, cum } = routePath(g, r, c);
  const m = maneuvers(pts, cum, guideSteps(r));
  assert.deepEqual(
    m.map((x) => x.kind),
    ["right", "floor", "arrive"],
  );
  assert.ok(Math.abs(m[0].at - 30) < 1, "30m 先で右");
  assert.equal(m[1].text, "階段で B1 → 1F");
});

test("経路の上の位置：始まり・途中・終わり", () => {
  const r = findRoute(g, 0, 4)!;
  const { pts, cum } = routePath(g, r, c);
  assert.equal(pointAt(pts, cum, -5), pts[0]);
  const mid = pointAt(pts, cum, 15);
  assert.ok(Math.abs(mid.z - -15) < 0.5);
  assert.equal(pointAt(pts, cum, 9999), pts.at(-1));
});
