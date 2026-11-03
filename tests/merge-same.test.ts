import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeSame } from "../src/lib/data";
import type { Place } from "../src/lib/places";

const src = (name: string) => ({ name, license: "test" });

test("別の出典の同じトイレは1件にし、相手にない改札の内外だけを足す", () => {
  const official: Place = { id: "tokyo-st-1", kind: "toilet", name: "東京駅 多機能トイレ", lat: 35.68, lon: 139.76, tier: "official", source: src("東京都"), floor: "B1F", gate: "unknown" };
  const mlit: Place = { id: "mlit-tokyo-toilet-1", kind: "toilet", lat: 35.68001, lon: 139.76, tier: "official", source: src("国交省"), floor: "B1F", gate: "inside", sameAs: "tokyo-st-1" };
  const other: Place = { id: "mlit-tokyo-toilet-2", kind: "toilet", lat: 35.7, lon: 139.7, tier: "official", source: src("国交省") };
  const out = mergeSame([official, mlit, other]);
  assert.deepEqual(out.map((p) => p.id), ["tokyo-st-1", "mlit-tokyo-toilet-2"]);
  assert.equal(out[0].name, "東京駅 多機能トイレ");
  assert.equal(out[0].gate, "inside");
  assert.match(out[0].note ?? "", /国交省の屋内地図にも同じトイレ/);
});
