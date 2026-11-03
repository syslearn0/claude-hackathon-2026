import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { describeSteps, findRoute, KIND, nearestNode, type Network } from "../src/lib/route";

// B1 の改札（0）から 1F のトイレ（3）へ：階段（近い）・エスカレーター（少し遠い）・エレベーター（遠い）の3通り
const g: Network = {
  station: "テスト",
  sources: [],
  attribution: [],
  nodes: [
    [35.0, 139.0, -1], // 0 改札
    [35.0001, 139.0, -1], // 1 階段の下
    [35.0001, 139.0, 1], // 2 階段の上
    [35.0002, 139.0, 1], // 3 トイレ
    [35.0, 139.0003, -1], // 4 エスカレーターの下
    [35.0, 139.0003, 1], // 5 エスカレーターの上
    [35.0, 139.0006, -1], // 6 エレベーター B1
    [35.0, 139.0006, 1], // 7 エレベーター 1F
  ],
  links: [
    [0, 1, 11, KIND.walk, 0, 0],
    [1, 2, 8, KIND.stairs, 0, 0],
    [2, 3, 11, KIND.walk, 0, 0],
    [0, 4, 27, KIND.walk, 0, 0],
    [4, 5, 12, KIND.escalator, 1, 0], // 上りだけ
    [5, 3, 35, KIND.walk, 0, 0],
    [0, 6, 55, KIND.walk, 0, 0],
    [6, 7, 0, KIND.elevator, 0, 0],
    [7, 3, 60, KIND.walk, 0, 0],
  ],
};

test("一番早い経路：階段を使う", () => {
  const r = findRoute(g, 0, 3)!;
  assert.deepEqual(r.nodes, [0, 1, 2, 3]);
  assert.deepEqual(describeSteps(r), ["歩く 約10m", "階段で B1 → 1F", "歩く 約10m"]);
});

test("階段を使わない：エスカレーター（上りだけなので、帰り道には使わない）", () => {
  assert.deepEqual(findRoute(g, 0, 3, { noStairs: true })!.nodes, [0, 4, 5, 3]);
  // 下り（1F → B1）はエスカレーターが上りだけなのでエレベーター
  assert.deepEqual(findRoute(g, 3, 0, { noStairs: true })!.nodes, [3, 7, 6, 0]);
});

test("段差なし（車いす・ベビーカー）：エレベーター", () => {
  const r = findRoute(g, 0, 3, { stepFree: true })!;
  assert.deepEqual(r.nodes, [0, 6, 7, 3]);
  assert.ok(describeSteps(r).includes("エレベーターで B1 → 1F"));
});

test("近い点は、階を指定すればその階から選ぶ", () => {
  assert.equal(nearestNode(g, { lat: 35.0001, lon: 139.0 }, 1), 2);
  assert.equal(nearestNode(g, { lat: 35.0001, lon: 139.0 }, -1), 1);
});

test("本物のデータ：大門駅の改札内のトイレから地上（エレベーターの出口）まで、段差なしで行ける", () => {
  const net = JSON.parse(readFileSync("data/network/daimon.json", "utf8")) as Network;
  const toilets = (JSON.parse(readFileSync("data/places/oedo-daimon-toilets.json", "utf8")) as { places: { lat: number; lon: number; floor: string }[] }).places;
  const t = toilets.find((p) => p.floor === "B3F")!;
  const from = nearestNode(net, t, -3);
  // 地上に着くエレベーター
  const lift = net.links.find((l) => l[3] === KIND.elevator && (net.nodes[l[0]][2] === 1 || net.nodes[l[1]][2] === 1))!;
  const exit = net.nodes[lift[0]][2] === 1 ? lift[0] : lift[1];
  const r = findRoute(net, from, exit, { stepFree: true });
  assert.ok(r, "経路が見つかる");
  assert.ok(r!.steps.some((s) => s.kind === "elevator"));
  assert.ok(r!.steps.every((s) => s.kind !== "stairs" && s.kind !== "escalator"));
});
