import assert from "node:assert/strict";
import { test } from "node:test";
import type { IndoorFeature } from "../src/lib/indoor";
import { candidates, describe, landmarks, nameScore, norm } from "../src/lib/locate";
import { KIND, type Network } from "../src/lib/route";

const c = { lat: 35.69, lon: 139.7 };
const m = (dx: number, dy: number) => ({ lat: c.lat + dy / 110_540, lon: c.lon + dx / (111_320 * Math.cos((35.69 * Math.PI) / 180)) });
const feat = (kind: string, name: string | undefined, at: { lat: number; lon: number }, floors: number[]): IndoorFeature => ({
  id: `${kind}-${name}`,
  kind,
  levels: [],
  floors,
  floorBasis: "data",
  name,
  coords: [[at.lat, at.lon]],
  closed: false,
  tags: {},
});

// B1 に中央東改札（原点）とエスカレーター（北 15m）、1F に出入口 A10（東 200m）
const lms = landmarks([
  feat("gate", "中央東改札", m(0, 0), [-1]),
  feat("escalator", undefined, m(0, 15), [-1]),
  feat("entrance", "新宿駅A10出入口", m(200, 0), []),
  feat("shop", "不明", m(5, 5), [-1]),
]);
const net: Network = {
  station: "テスト",
  sources: [],
  attribution: [],
  nodes: [
    [m(2, 0).lat, m(2, 0).lon, -1],
    [m(200, 3).lat, m(200, 3).lon, 1],
  ],
  links: [[0, 1, 210, KIND.stairs, 0, 0]],
};

test("名前の表記ゆれ：口・改札・駅名を落として比べる。短い番号はぴったりのときだけ", () => {
  assert.equal(norm("新南口改札"), norm("新南改札"));
  assert.equal(norm("新宿駅A10出入口", "新宿"), "a10");
  assert.equal(nameScore("出口 A10", "新宿駅A10出入口", "新宿"), 1);
  assert.equal(nameScore("A1", "新宿駅A10出入口", "新宿"), 0);
  assert.ok(nameScore("中央東改札 Central East Gate", "中央東改札") > 0);
});

test("目印：名前のない店は使わず、名前のないエスカレーターは使う。階のない出入口は地上", () => {
  assert.deepEqual(
    lms.map((l) => [l.name, l.floor]),
    [
      ["中央東改札", -1],
      ["エスカレーター", -1],
      ["新宿駅A10出入口", 1],
    ],
  );
});

test("候補：読めた名前のそば。GPS が良ければ GPS のそばの地上も候補になり、点が足される", () => {
  const only = candidates(net, lms, ["中央東改札"], "新宿");
  assert.deepEqual(
    only.map((x) => [x.id, x.floor, x.names]),
    [["A", -1, ["中央東改札"]]],
  );
  const gps = { ...m(205, 5), accuracy: 15 };
  const both = candidates(net, lms, ["中央東改札", "A10"], "新宿", gps);
  assert.equal(both[0].names[0], "新宿駅A10出入口");
  const noSign = candidates(net, lms, [], "新宿", gps);
  assert.equal(noSign.length, 1);
  assert.equal(noSign[0].byGps, true);
  assert.equal(candidates(net, lms, [], "新宿", { ...gps, accuracy: 120 }).length, 0);
});

test("まわりの様子：同じ階の目印を方角と距離で", () => {
  const [a] = candidates(net, lms, ["中央東改札"], "新宿");
  const text = describe(a, lms);
  assert.match(text, /候補A（B1・中央東改札のそば）/);
  assert.match(text, /北 15m：エスカレーター（エスカレーター）/);
  assert.doesNotMatch(text, /A10/);
});
