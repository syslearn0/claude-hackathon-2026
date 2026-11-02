import assert from "node:assert/strict";
import { test } from "node:test";
import { checkGrounding } from "../src/lib/agent/grounding";
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
  assert.match(r.text, /^1\. 替えを買う：\[\[place:shop\]\].*置いてあった：男性用下着（売り場：レジ横）/);
  assert.match(r.text, /2\. 着替える：.*\[\[place:room\]\]/);
  // 確認済みで「なし」だった品目は「置いてあった」に入れない
  assert.doesNotMatch(r.text, /防臭袋/);
});

test("簡易版の引用は、返す場所とすべて一致する（根拠チェックを通る）", () => {
  const r = buildAfterFallback(places, from, ["soiled_clothes", "dispose", "not_yet", "go_home"]);
  const check = checkGrounding(r.text, new Set(r.places.map((p) => p.id)));
  assert.equal(check.ok, true);
  assert.match(r.text, /帰り道の案内は準備中/);
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
