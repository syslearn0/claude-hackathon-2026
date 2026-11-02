import assert from "node:assert/strict";
import { test } from "node:test";
import { stationPos, toPlace } from "../scripts/import-survey";

const stations = [
  { name: "新宿", operator: "小田急電鉄", lat: 35.69, lon: 139.699 },
  { name: "新宿", operator: "東日本旅客鉄道;JR東日本", lat: 35.6896, lon: 139.7006 },
];

test("駅の位置：事業者が合う駅を選ぶ", () => {
  const p = stationPos(stations, "新宿駅", "小田急");
  assert.equal(p?.lat, 35.69);
});

test("トイレの記録：位置がなければ駅で代用し、印を付ける", () => {
  const p = toPlace(
    {
      id: "toilet-1",
      kind: "toilet",
      checkedAt: "2026-11-03T01:00:00.000Z",
      values: {
        station: "新宿",
        operator: "JR東日本",
        gate: "改札内",
        nearGate: "南改札",
        types: ["男性", "多機能（だれでも）"],
        sanitaryBoxMale: "なし",
        soap: "見ていない",
        minFromPlatform: 95,
      },
    },
    stations,
  );
  assert.ok(!("skip" in p));
  assert.equal(p.tier, "verified");
  assert.equal(p.gate, "inside");
  assert.equal(p.approxLocation, true);
  assert.equal(p.lat, 35.6896);
  assert.equal(p.toilet?.accessible, true);
  assert.equal(p.toilet?.ostomate, undefined); // 書かれていないものは「なし」にしない
  assert.equal(p.toilet?.sanitaryBoxMale, false);
  assert.equal(p.toilet?.soap, undefined);
  assert.equal(p.minFromPlatform, 95);
  assert.equal(p.checkedAt, "2026-11-03");
});

test("店の記録：品ぞろえは確認したものだけ残す", () => {
  const p = toPlace(
    {
      id: "store-1",
      kind: "store",
      checkedAt: "2026-11-03T02:00:00.000Z",
      values: {
        name: "NewDays 新宿南口",
        storeType: "駅ナカの売店",
        station: "新宿",
        gate: "改札内",
        stock: { 大人用紙パンツ: "なし", 男性用下着: "あり", "防臭袋・ビニール袋": "見ていない" },
        storeToilet: "使えない（表示あり）",
        pos: { lat: 35.6885, lon: 139.7, accuracy: 30 },
      },
    },
    stations,
  );
  assert.ok(!("skip" in p));
  assert.equal(p.approxLocation, undefined);
  assert.deepEqual(p.store?.stock, { 大人用紙パンツ: false, 男性用下着: true });
  assert.equal(p.store?.storeType, "station_kiosk");
  assert.equal(p.store?.customerToilet, false);
});

test("位置も駅も分からなければ飛ばす", () => {
  const p = toPlace({ id: "x", kind: "toilet", checkedAt: "2026-11-03", values: { station: "どこか" } }, stations);
  assert.ok("skip" in p);
});
