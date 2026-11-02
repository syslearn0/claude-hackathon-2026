import assert from "node:assert/strict";
import { test } from "node:test";
import { bearingDeg, directionJa, distanceM, walkMinutes } from "../src/lib/geo";
import { findNearby } from "../src/lib/nearby";
import type { Place } from "../src/lib/places";

const src = { name: "test", license: "test" };
const at = (id: string, lat: number, lon: number, extra: Partial<Place> = {}): Place => ({
  id,
  kind: "toilet",
  lat,
  lon,
  tier: "osm",
  source: src,
  ...extra,
});

test("距離：緯度0.001度はおよそ111m", () => {
  const d = distanceM({ lat: 35, lon: 135 }, { lat: 35.001, lon: 135 });
  assert.ok(Math.abs(d - 111) < 1, String(d));
});

test("方角：北と東", () => {
  assert.equal(directionJa(bearingDeg({ lat: 35, lon: 135 }, { lat: 35.01, lon: 135 })), "北");
  assert.equal(directionJa(bearingDeg({ lat: 35, lon: 135 }, { lat: 35, lon: 135.01 })), "東");
});

test("歩く時間は最低1分", () => {
  assert.equal(walkMinutes(5), 1);
  assert.equal(walkMinutes(700), 13);
});

test("近い順に、種類と距離の上限で絞る", () => {
  const places = [
    at("far", 35.02, 135),
    at("near", 35.001, 135),
    at("mid", 35.003, 135),
    at("store", 35.0005, 135, { kind: "store", store: { storeType: "convenience" } }),
  ];
  const r = findNearby(places, { from: { lat: 35, lon: 135 }, kind: "toilet", maxMeters: 1000 });
  assert.deepEqual(r.map((x) => x.place.id), ["near", "mid"]);
});

test("確認済みは、少し遠くても OSM より先に出す", () => {
  // OSM：約2分、確認済み：約4分
  const places = [at("osm", 35.001, 135), at("verified", 35.002, 135, { tier: "verified" })];
  const r = findNearby(places, { from: { lat: 35, lon: 135 }, kind: "toilet" });
  assert.deepEqual(r.map((x) => x.place.id), ["verified", "osm"]);
});

test("ずっと遠い確認済みより、近い OSM を先に出す", () => {
  // OSM：約2分、確認済み：約11分
  const places = [at("osm", 35.001, 135), at("verified", 35.005, 135, { tier: "verified" })];
  const r = findNearby(places, { from: { lat: 35, lon: 135 }, kind: "toilet" });
  assert.equal(r[0].place.id, "osm");
});

test("多機能だけ：分からないもの（undefined）は含めない", () => {
  const places = [
    at("unknown", 35.001, 135),
    at("no", 35.001, 135, { toilet: { accessible: false } }),
    at("yes", 35.002, 135, { toilet: { accessible: true } }),
  ];
  const r = findNearby(places, { from: { lat: 35, lon: 135 }, kind: "toilet", accessibleOnly: true });
  assert.deepEqual(r.map((x) => x.place.id), ["yes"]);
});
