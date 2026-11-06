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

test("大門駅：階の途中の高さの通路は踊り場（平らな階段）になる。まっすぐ続く踊り場は延ばさない", () => {
  const net = JSON.parse(readFileSync("data/network/daimon.json", "utf8")) as Network;
  const { flights } = liftParts(net, (i) => {
    const [lat, lon, floor] = net.nodes[i];
    return { x: lon * 90_000, y: floor * 5, z: -lat * 110_540, floor };
  });
  assert.ok(flights.some((f) => f.kind === "stairs" && f.a.y === f.b.y && !Number.isInteger(f.a.floor)));
  // 麻布十番 B6→B5 のような、段・踊り場・段がまっすぐ並ぶところでは延ばさない（延ばすと下の段の上に板が浮く）
  const az = JSON.parse(readFileSync("data/network/azabu-juban.json", "utf8")) as Network;
  const { flights: af } = liftParts(az, (i) => {
    const [lat, lon, floor] = az.nodes[i];
    return { x: lon * 90_000, y: floor * 5, z: -lat * 110_540, floor };
  });
  const straight = af.filter((f) => f.kind === "stairs" && f.a.y === f.b.y && f.a.floor === -5.5);
  assert.ok(straight.length > 0);
  assert.ok(straight.some((f) => !f.ext));
});

test("吹き抜けの一覧：駅ごとに、階（整数）と 4 つの角。駅の近くにある", () => {
  const voids = JSON.parse(readFileSync("data/station-voids.json", "utf8")) as Record<string, { floor: number; pts: [number, number][]; note: string }[]>;
  const nets = new Map(
    ["tochomae", "shinjuku-nishiguchi", "higashi-shinjuku", "yoyogi", "kokuritsu-kyogijo", "aoyama-itchome", "roppongi", "azabu-juban", "akabanebashi", "daimon", "ueno-okachimachi"].map((f) => {
      const n = JSON.parse(readFileSync(`data/network/${f}.json`, "utf8")) as Network;
      return [n.station, n] as const;
    }),
  );
  assert.ok(Object.keys(voids).length >= 10);
  for (const [name, vs] of Object.entries(voids)) {
    const net = nets.get(name);
    assert.ok(net, name);
    const [lat0, lon0] = net.nodes[0];
    for (const v of vs) {
      assert.ok(Number.isInteger(v.floor) && v.floor !== 0, `${name} ${v.note}`);
      assert.equal(v.pts.length, 4);
      for (const [lat, lon] of v.pts) assert.ok(Math.abs(lat - lat0) < 0.005 && Math.abs(lon - lon0) < 0.005, `${name} ${v.note}`);
    }
  }
});
