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
