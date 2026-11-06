import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { liftParts } from "../src/lib/lifts";
import type { Network } from "../src/lib/route";

test("麻布十番駅：階段・エスカレーターの線と、エレベーターのかご道（止まる階と扉の向き）", () => {
  const net = JSON.parse(readFileSync("data/network/azabu-juban.json", "utf8")) as Network;
  const lat0 = net.nodes[0][0];
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const parts = liftParts(net, (i) => {
    const [lat, lon, floor] = net.nodes[i];
    return { x: lon * kx, y: floor * 5, z: -lat * 110_540, floor };
  });
  assert.ok(parts.flights.some((f) => f.kind === "escalator"));
  assert.ok(parts.flights.some((f) => f.kind === "stairs"));
  // 同じ 2 点を結ぶ線は 1 本だけ
  const keys = parts.flights.map((f) =>
    [f.a, f.b]
      .map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)},${p.y}`)
      .sort()
      .join("|"),
  );
  assert.equal(new Set(keys).size, keys.length);
  // まとまりの階には、その線の両端の階が入っている
  for (const f of parts.flights) assert.ok(f.floors.includes(f.a.floor) && f.floors.includes(f.b.floor));
  // ホーム（いちばん下の階）に止まるエレベーターがあり、止まる階は 2 つ以上、扉の向きは長さ 1
  const minFloor = Math.min(...net.nodes.map((n) => n[2]));
  const sh = parts.shafts.find((s) => s.stops.some((t) => t.floor === minFloor));
  assert.ok(sh);
  assert.ok(sh.stops.length >= 2);
  for (const t of sh.stops) assert.ok(Math.abs(Math.hypot(t.dx, t.dz) - 1) < 1e-6);
});

test("大門駅：横に並ぶ階段・エスカレーターには、となりとの間隔（room）が入り、描く幅がそれに収まる", () => {
  const net = JSON.parse(readFileSync("data/network/daimon.json", "utf8")) as Network;
  const kx = 111_320 * Math.cos((35.656 * Math.PI) / 180);
  const { flights } = liftParts(net, (i) => {
    const [lat, lon, floor] = net.nodes[i];
    return { x: lon * kx, y: floor * 5, z: -lat * 110_540, floor };
  });
  const side = flights.filter((f) => f.room < Infinity);
  assert.ok(side.length > 0);
  // 描く幅（lift-model.ts と同じ決め方）が、となりとの間隔を超えない
  for (const f of side) {
    const w = f.kind === "stairs" ? Math.max(0.6, Math.min(2.4, f.room - 0.15)) : 2 * Math.max(0.3, Math.min(0.62, (f.room - 0.1) / 2));
    assert.ok(w <= f.room, `${f.kind} room ${f.room}`);
  }
});

test("大門駅：階の途中の高さの通路は踊り場（平らな階段）になり、つなぎ目の板がある", () => {
  const net = JSON.parse(readFileSync("data/network/daimon.json", "utf8")) as Network;
  const { flights, pads } = liftParts(net, (i) => {
    const [lat, lon, floor] = net.nodes[i];
    return { x: lon * 90_000, y: floor * 5, z: -lat * 110_540, floor };
  });
  assert.ok(flights.some((f) => f.kind === "stairs" && f.a.y === f.b.y && !Number.isInteger(f.a.floor)));
  assert.ok(pads.length > 0);
  for (const p of pads) assert.ok(!Number.isInteger(p.floor));
});
