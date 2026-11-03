import assert from "node:assert/strict";
import { test } from "node:test";
import { indoorAt, osmLevelFloor, parseFloor, placeFloor, type IndoorFeature } from "../src/lib/indoor";

test("場所データの階の書き方を読む（決められないものは読まない）", () => {
  assert.equal(parseFloor("B1F"), -1);
  assert.equal(parseFloor("2F(北左)"), 2);
  assert.equal(parseFloor("3F（右）"), 3);
  assert.equal(parseFloor("地下2階"), -2);
  assert.equal(parseFloor("ホーム"), undefined);
  assert.equal(parseFloor("M2F"), undefined);
});

test("OSM の level は 0 = 1F で読む", () => {
  assert.equal(osmLevelFloor("0"), 1);
  assert.equal(osmLevelFloor("-1"), -1);
  assert.equal(osmLevelFloor("1;2"), 2);
  assert.equal(osmLevelFloor("0.5"), 1);
  assert.equal(osmLevelFloor(""), undefined);
  assert.equal(osmLevelFloor("roof"), undefined);
});

// 0.001度四方の部屋（B1）と、その上に重なる通路（B1 と 1F）
const sq = (lat: number, lon: number): [number, number][] => [
  [lat, lon],
  [lat + 0.001, lon],
  [lat + 0.001, lon + 0.001],
  [lat, lon + 0.001],
];
const room: IndoorFeature = { id: "r", kind: "room", levels: ["-1"], floors: [-1], floorBasis: "", coords: sq(35.69, 139.7), closed: true, tags: {} };
const twoFloors: IndoorFeature = { ...room, id: "c", kind: "corridor", floors: [-1, 1], coords: sq(35.692, 139.7) };

test("場所の階：書いてある階 → OSM の level（目安）→ 駅の地図の部屋の中なら推定", () => {
  assert.deepEqual(placeFloor({ lat: 0, lon: 0, tier: "official", floor: "2F" }), { floor: 2, basis: "data" });
  assert.deepEqual(placeFloor({ lat: 0, lon: 0, tier: "osm", toilet: { level: "-1" } }), { floor: -1, basis: "osm" });
  assert.deepEqual(placeFloor({ lat: 35.6905, lon: 139.7005, tier: "osm" }, [room]), { floor: -1, basis: "inside" });
  // 囲む部屋がない、または階が1つに決まらなければ、不明のまま
  assert.equal(placeFloor({ lat: 35.6, lon: 139.7, tier: "osm" }, [room]), undefined);
  assert.equal(placeFloor({ lat: 35.6925, lon: 139.7005, tier: "osm" }, [twoFloors]), undefined);
});

test("駅に入った：駅の中心から 250m 以内", () => {
  assert.equal(indoorAt({ lat: 35.6898, lon: 139.7004 }), "新宿");
  assert.equal(indoorAt({ lat: 35.6898, lon: 139.7004 + 300 / 91_000 }), undefined);
});
