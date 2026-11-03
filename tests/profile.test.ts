import assert from "node:assert/strict";
import { test } from "node:test";
import { findNearby } from "../src/lib/nearby";
import type { Place } from "../src/lib/places";
import { describeProfile } from "../src/lib/profile";

test("AI に送る条件：場面に要るものだけで、よく使う駅などは入れない", () => {
  const p = {
    toiletSide: "male" as const,
    needAccessible: true,
    carriesSpare: false,
    homeStations: ["丹波橋"],
  };
  const after = describeProfile(p, "after");
  assert.match(after, /多機能トイレ/);
  assert.match(after, /替えは持ち歩いていない/);
  assert.match(after, /男性側/);
  assert.doesNotMatch(after, /丹波橋/);
  // 計画にはトイレの側は要らない、緊急時には替えの有無は要らない
  assert.doesNotMatch(describeProfile(p, "plan"), /男性側/);
  assert.doesNotMatch(describeProfile(p, "emergency"), /持ち歩/);
  assert.equal(describeProfile({}, "after"), "");
});

const src = { name: "test", license: "test" };
const t = (id: string, lat: number, toilet: Place["toilet"] = {}): Place => ({ id, kind: "toilet", lat, lon: 135, tier: "osm", source: src, toilet });

test("多機能トイレを優先：少し遠くても先に出す（ずっと遠ければ近いほう）", () => {
  const near = t("near", 35.001); // 約2分
  const acc = t("acc", 35.002, { accessible: true }); // 約4分
  const far = t("far", 35.008, { accessible: true }); // 約15分
  const from = { lat: 35, lon: 135 };
  assert.deepEqual(findNearby([near, acc], { from, kind: "toilet", preferAccessible: true }).map((x) => x.place.id), ["acc", "near"]);
  assert.equal(findNearby([near, far], { from, kind: "toilet", preferAccessible: true })[0].place.id, "near");
  assert.equal(findNearby([near, acc], { from, kind: "toilet" })[0].place.id, "near");
});
