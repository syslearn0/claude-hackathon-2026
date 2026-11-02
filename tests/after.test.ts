import assert from "node:assert/strict";
import { test } from "node:test";
import { describeSituations } from "../src/lib/agent/modes";
import { buildAfterFallback } from "../src/lib/after-fallback";
import type { Place } from "../src/lib/places";
import { RateLimiter } from "../src/lib/rate-limit";

const src = { name: "test", license: "test" };
const places: Place[] = [
  { id: "room", kind: "toilet", lat: 35.001, lon: 135, tier: "official", source: src, toilet: { accessible: true } },
  {
    id: "shop",
    kind: "store",
    lat: 35.0005,
    lon: 135,
    tier: "verified",
    source: src,
    store: { storeType: "station_kiosk", stock: { 男性用下着: true, 防臭袋・ビニール袋: false }, aisle: "レジ横" },
  },
];
const from = { lat: 35, lon: 135 };

test("簡易版：下着を汚した → 替えを買う店と、着替える場所", () => {
  const r = buildAfterFallback(places, from, ["soiled_underwear"]);
  assert.equal(r.steps[0].text, "替えの下着を買う");
  assert.deepEqual(r.steps[0].placeIds, ["shop"]);
  assert.deepEqual(r.steps[1].placeIds, ["room"]);
});

test("簡易版：帰るか続けるかは選択肢として並べるだけ", () => {
  const r = buildAfterFallback(places, from, ["soiled_clothes", "dispose", "not_yet", "go_home"]);
  assert.match(r.steps.at(-1)!.text, /あなたが決めて.*準備中/);
  assert.equal(r.steps[0].text, "替えの下着や防臭袋を買う");
});

test("状況の説明：選んだものと一言をまとめる", () => {
  assert.equal(describeSituations(["change", "go_home", "unknown"], " 寒い "), "状況：着替えたい、帰りたい\n一言：寒い");
});

test("回数制限：1人の上限を超えたら断り、時間がたてば戻る", () => {
  let t = 0;
  const rl = new RateLimiter({ max: 2, windowMs: 1000 }, { max: 100, windowMs: 10_000 }, () => t);
  assert.equal(rl.check("a"), null);
  assert.equal(rl.check("a"), null);
  assert.deepEqual(rl.check("a"), { retryAfterSec: 1 });
  assert.equal(rl.check("b"), null); // 別の人は使える
  t = 1001;
  assert.equal(rl.check("a"), null);
});

test("回数制限：全体の上限", () => {
  const rl = new RateLimiter({ max: 10, windowMs: 1000 }, { max: 2, windowMs: 1000 }, () => 0);
  assert.equal(rl.check("a"), null);
  assert.equal(rl.check("b"), null);
  assert.notEqual(rl.check("c"), null);
});

test("簡易版：替えを持ち歩いている人には、下着だけなら買う手順を出さない", () => {
  const spare = { carriesSpare: true };
  const r = buildAfterFallback(places, from, ["soiled_underwear"], spare);
  assert.equal(r.steps[0].text, "個室で着替えられる多機能トイレで着替える");
  assert.equal(buildAfterFallback(places, from, ["soiled_underwear", "dispose"], spare).steps[0].text, "防臭袋を買う");
});
