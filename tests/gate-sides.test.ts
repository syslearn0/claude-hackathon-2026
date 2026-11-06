import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { floorReach, gateDirs, paidWalls, type GateShape } from "../src/lib/gates";
import type { Network } from "../src/lib/route";

// 駅のデータ（ネットワークと、屋内データ <駅>-*.json の改札）を、駅の最初の点を原点にした m に
function load(key: string) {
  const net = JSON.parse(readFileSync(`data/network/${key}.json`, "utf8")) as Network;
  const feats = readdirSync("data/indoor")
    .filter((f) => f.startsWith(`${key}-`))
    .flatMap((f) => JSON.parse(readFileSync(`data/indoor/${f}`, "utf8")).features as { kind: string; floors: number[]; coords: [number, number][]; closed?: boolean }[]);
  const [lat0, lon0] = net.nodes[0];
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const xz = (lat: number, lon: number) => ({ x: (lon - lon0) * kx, z: -(lat - lat0) * 110_540 });
  const nodes = net.nodes.map(([lat, lon, floor]) => ({ ...xz(lat, lon), floor }));
  const gates: GateShape[] = feats.filter((f) => f.kind === "gate").flatMap((f) => f.floors.map((floor) => ({ floor, pts: f.coords.map(([a, b]) => xz(a, b)) })));
  const floors = feats.filter((f) => f.closed && ["corridor", "area", "platform"].includes(f.kind)).flatMap((f) => f.floors.map((floor) => ({ floor, pts: f.coords.map(([a, b]) => xz(a, b)) })));
  return { net, nodes, gates, floors };
}

test("都庁前：改札（手で足した地下2階の1か所）があり、ホームから改札を通らずに地上へは出られない", () => {
  const { net, nodes, gates } = load("tochomae");
  assert.equal(gates.length, 1);
  assert.equal(gates[0].floor, -2);
  // 改札の 6m 以内を通る線を切ると、ホームの点から地上の点へは行けない
  const g = gates[0].pts[0];
  const adj = new Map<number, number[]>();
  for (const [a, b] of net.links) {
    const [p, q] = [nodes[a], nodes[b]];
    const l = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
    const t = l ? Math.max(0, Math.min(1, ((g.x - p.x) * (q.x - p.x) + (g.z - p.z) * (q.z - p.z)) / l)) : 0;
    const d = Math.hypot(g.x - p.x - t * (q.x - p.x), g.z - p.z - t * (q.z - p.z));
    if ((p.floor === -2 || q.floor === -2) && d < 6) continue;
    adj.set(a, [...(adj.get(a) ?? []), b]);
    adj.set(b, [...(adj.get(b) ?? []), a]);
  }
  const minF = Math.min(...nodes.map((n) => n.floor));
  const seen = new Set(nodes.flatMap((n, i) => (n.floor === minF ? [i] : [])));
  const q = [...seen];
  while (q.length)
    for (const j of adj.get(q.shift()!) ?? []) {
      if (seen.has(j)) continue;
      seen.add(j);
      q.push(j);
    }
  assert.ok(![...seen].some((i) => nodes[i].floor >= 1));
});

test("改札を通る向き：麻布十番の改札は、内（ホーム側）から外へ向き、列の横は通路の床の端まで 6〜12m", () => {
  const { net, nodes, gates, floors } = load("azabu-juban");
  const dirs = gateDirs(
    nodes,
    net.links.map(([a, b]) => [a, b] as [number, number]),
    gates,
  );
  assert.ok(dirs[0]);
  const f = { ...gates[0].pts[0], floor: gates[0].floor, ...dirs[0]! };
  const r = floorReach(f, floors);
  assert.ok(r.left > 4 && r.left < 15, `left ${r.left}`);
  assert.ok(r.right > 4 && r.right < 15, `right ${r.right}`);
});

test("改札の内と外を分ける壁：麻布十番にあり、どの駅でも道の線（通路）を横切らない", () => {
  const keys = ["tochomae", "shinjuku-nishiguchi", "higashi-shinjuku", "yoyogi", "kokuritsu-kyogijo", "aoyama-itchome", "roppongi", "azabu-juban", "akabanebashi", "daimon", "ueno-okachimachi"];
  const cross = (a: { x: number; z: number }, b: { x: number; z: number }, c: { x: number; z: number }, d: { x: number; z: number }) => {
    const o = (p: typeof a, q: typeof a, r: typeof a) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  for (const key of keys) {
    const { net, nodes, gates, floors } = load(key);
    const links = net.links.map(([a, b]) => [a, b] as [number, number]);
    const walls = paidWalls(nodes, links, gates, floors);
    if (key === "azabu-juban") assert.ok(walls.reduce((s, w) => s + Math.hypot(w.bx - w.ax, w.bz - w.az), 0) > 20);
    for (const w of walls)
      for (const [a, b] of links) {
        const [p, q] = [nodes[a], nodes[b]];
        if (Math.abs(p.floor - w.floor) > 0.01 || Math.abs(q.floor - w.floor) > 0.01) continue;
        assert.ok(!cross(p, q, { x: w.ax, z: w.az }, { x: w.bx, z: w.bz }), `${key} 線 ${a}-${b} が壁を横切る`);
      }
  }
});

test("改札の内と外を分ける壁の書き出し（data/station-walls.json）が、いまの駅のデータと合っている（古ければ npx tsx scripts/build-walls.ts）", async () => {
  const { buildWalls } = await import("../scripts/build-walls");
  const saved = JSON.parse(readFileSync("data/station-walls.json", "utf8"));
  assert.deepEqual(buildWalls(), saved);
});
