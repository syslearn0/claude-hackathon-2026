import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { distanceM } from "../src/lib/geo";
import { carEnds, carStartNode } from "../src/lib/platform";
import type { Network } from "../src/lib/route";

const stations = readdirSync("data/stations").flatMap(
  (f) => (JSON.parse(readFileSync(`data/stations/${f}`, "utf8")) as { stations: { name: string; lat: number; lon: number; operator?: string }[] }).stations,
);
const at = (name: string) => stations.find((s) => s.name === name && /交通局/.test(s.operator ?? "")) ?? stations.find((s) => s.name === name);

test("大江戸線の環状部：1号車の側の隣の駅", () => {
  assert.deepEqual(carEnds("大門"), { car1Side: "汐留", otherSide: "赤羽橋" });
  assert.deepEqual(carEnds("新宿"), { car1Side: "代々木", otherSide: "都庁前" });
  assert.equal(carEnds("丹波橋"), undefined);
  assert.deepEqual(carEnds("麻布十番"), { car1Side: "赤羽橋", otherSide: "六本木" });
});

test("大門駅：1号車のあたりは汐留寄り、8号車のあたりは赤羽橋寄りのホームの端", () => {
  const net = JSON.parse(readFileSync("data/network/daimon.json", "utf8")) as Network;
  const one = net.nodes[carStartNode(net, "大門", 1, at)!];
  const eight = net.nodes[carStartNode(net, "大門", 8, at)!];
  const minFloor = Math.min(...net.nodes.map((n) => n[2]));
  assert.equal(one[2], minFloor);
  const toAka = (n: [number, number, number]) => distanceM({ lat: n[0], lon: n[1] }, at("赤羽橋")!);
  assert.ok(toAka(one) > toAka(eight));
  // ホームの長さ（8両 約130m）くらい離れている
  assert.ok(distanceM({ lat: one[0], lon: one[1] }, { lat: eight[0], lon: eight[1] }) > 60);
});

test("号車の出発点は、階段・エスカレーター・エレベーターの乗り口の点にしない", () => {
  for (const [file, name] of [
    ["azabu-juban", "麻布十番"],
    ["daimon", "大門"],
    ["roppongi", "六本木"],
  ]) {
    const net = JSON.parse(readFileSync(`data/network/${file}.json`, "utf8")) as Network;
    const lift = new Set(net.links.filter((l) => l[3] === 1 || l[3] === 2 || l[3] === 3).flatMap((l) => [l[0], l[1]]));
    for (let car = 1; car <= 8; car++) assert.ok(!lift.has(carStartNode(net, name, car, at)!), `${name} ${car}号車`);
  }
});
