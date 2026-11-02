import assert from "node:assert/strict";
import { test } from "node:test";
import type { NearbyItem } from "../src/lib/nearby";
import type { Place } from "../src/lib/places";
import { headline, rankFromRef, stationAt, stationRefs } from "../src/lib/station-mode";

const src = { name: "test", license: "test" };
const p = (id: string, extra: Partial<Place>): Place => ({ id, kind: "toilet", lat: 35, lon: 135, tier: "verified", source: src, ...extra });
const item = (place: Place, meters = 50): NearbyItem => ({ place, meters, walkMin: 1, direction: "北" });

test("駅の近く（250m 以内）なら駅の名前を返す", () => {
  const stations = [{ name: "新宿", lat: 35.6896, lon: 139.7006 }];
  assert.equal(stationAt(stations, { lat: 35.6905, lon: 139.7006 }), "新宿"); // 約100m
  assert.equal(stationAt(stations, { lat: 35.6996, lon: 139.7006 }), undefined); // 約1.1km
});

test("「いまどこ？」の選択肢は、実測のあるホームと改札だけ", () => {
  const places = [
    p("a", { station: "新宿", platform: "中央線ホーム", minFromPlatform: 90, nearGate: "南改札" }),
    p("b", { station: "新宿", nearGate: "東改札", minFromGate: 30 }),
    p("c", { station: "渋谷", platform: "山手線ホーム", minFromPlatform: 60 }),
  ];
  assert.deepEqual(stationRefs(places, "新宿"), [
    { kind: "platform", label: "中央線ホーム" },
    { kind: "gate", label: "東改札" },
  ]);
});

test("選んだ場所からの実測の分数で並べ替える", () => {
  const ref = { kind: "platform" as const, label: "中央線ホーム" };
  const items = [
    item(p("far", { platform: "中央線ホーム", minFromPlatform: 180 })),
    item(p("none", {})),
    item(p("near", { platform: "中央線ホーム", minFromPlatform: 60 })),
  ];
  assert.deepEqual(rankFromRef(items, ref).map((x) => x.place.id), ["near", "far", "none"]);
});

test("見出し：駅の中では方角ではなく、改札の内外・階・実測の分数", () => {
  const place = p("a", { station: "新宿", gate: "inside", floor: "2F", platform: "中央線ホーム", minFromPlatform: 95, nearGate: "南改札" });
  assert.deepEqual(headline(item(place), "新宿"), { main: "改札内・2F・ホームの階段から約2分", sub: "南改札の近く" });
  assert.deepEqual(headline(item(place), "新宿", { kind: "platform", label: "中央線ホーム" }), {
    main: "改札内・2F・中央線ホームから約2分",
    sub: "南改札の近く",
  });
});

test("見出し：駅の中で何も分からなければ、そう言う", () => {
  assert.equal(headline(item(p("a", { station: "新宿" })), "新宿").main, "駅の中（場所は下の説明を見て）");
});

test("見出し：駅の外なら方角と分数", () => {
  assert.equal(headline(item(p("a", {}), 600), undefined).main, "北へ 約1分");
  assert.equal(headline(item(p("a", { station: "渋谷" }), 600), "新宿").main, "北へ 約1分");
});
