import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_ROUTE, replay, resolveRoute } from "../scripts/replay-gps";
import { loadStations } from "../src/lib/data";
import { makeTrace } from "./fixtures/synthetic-trace";

const GAP: [number, number] = [420, 180]; // 開始から7分後に3分間、位置が出ない

async function run() {
  const stations = await loadStations();
  const names = DEFAULT_ROUTE.split(",");
  const route = resolveRoute(names, stations, "京阪本線");
  assert.equal(route.length, names.length);
  return { route, s: replay(makeTrace(route, { gap: GAP }), stations, route) };
}

test("走っているあいだは乗り物と判断する", async () => {
  const { s } = await run();
  const moving = s.rows.filter((r) => (r.fix.speed ?? 0) > 10 && r.elapsed > 90 && !r.flags.length);
  assert.ok(moving.length > 100);
  const vehicle = moving.filter((r) => r.sit.state === "vehicle").length;
  assert.ok(vehicle / moving.length > 0.9, `vehicle ${vehicle}/${moving.length}`);
});

test("次の駅は経路に沿って戻らずに進む", async () => {
  const { route, s } = await run();
  const order = s.nextOrder.map((n) => route.findIndex((r) => r.name === n.name)).filter((i) => i >= 0);
  assert.ok(order.length >= 5);
  for (let i = 1; i < order.length; i++) assert.ok(order[i] >= order[i - 1], `戻った：${s.nextOrder.map((n) => n.name).join(">")}`);
  assert.ok(!s.rows.some((r) => r.flags.some((f) => f.startsWith("次の駅が戻る"))));
});

test("位置が途切れた区間を印にする", async () => {
  const { s } = await run();
  const gapRows = s.rows.filter((r) => r.flags.some((f) => f.startsWith("空白")));
  assert.equal(gapRows.length, 1);
  assert.ok(gapRows[0].elapsed >= GAP[0] + GAP[1] - 1);
});
