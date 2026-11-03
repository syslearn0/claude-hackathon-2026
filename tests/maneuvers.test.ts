import assert from "node:assert/strict";
import { test } from "node:test";
import { maneuvers, pointAt, routePath, smoothPath } from "../src/lib/maneuvers";
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

test("歩く目線の道：ジグザグをならし、端と階の変わり目はずらさない", () => {
  // 東へ 40m（1m おきに左右 0.8m のジグザグ）→ その場でエレベーター（高さ 5m）
  const zig = Array.from({ length: 41 }, (_, i) => ({ x: i, y: 0, z: i % 2 ? 0.8 : -0.8, floor: -1 }));
  const path = [...zig, { x: 40, y: 5, z: -0.8, floor: 0 }];
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y, path[i].z - path[i - 1].z));
  const sm = smoothPath(path, cum);
  const mid = sm.pts.filter((p, i) => sm.cum[i] > 8 && sm.cum[i] < cum[40] - 8);
  assert.ok(Math.max(...mid.map((p) => Math.abs(p.z))) < 0.3, "横ぶれが小さくなる");
  assert.deepEqual(sm.pts[0], path[0]);
  assert.deepEqual(sm.pts.at(-1), path.at(-1));
  const lift = sm.cum.indexOf(cum[40]);
  assert.equal(sm.pts[lift].x, 40);
  assert.ok(sm.cum.every((d, i) => i === 0 || d > sm.cum[i - 1]));
});
