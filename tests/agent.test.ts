import type Anthropic from "@anthropic-ai/sdk";
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkGrounding, placeIdsIn, stripUnknown } from "../src/lib/agent/grounding";
import { runAgent, type MessagesClient } from "../src/lib/agent/run";
import type { Place } from "../src/lib/places";

test("根拠チェック：引用した id を取り出し、道具の結果にないものを見つける", () => {
  const text = "[[place:a]] 北へ2分。混んでいたら [[place:b]]。もう一度 [[place:a]]";
  assert.deepEqual(placeIdsIn(text), ["a", "b"]);
  const r = checkGrounding(text, new Set(["a"]));
  assert.equal(r.ok, false);
  assert.deepEqual(r.unknown, ["b"]);
  assert.equal(stripUnknown(text, new Set(["a"])), "[[place:a]] 北へ2分。混んでいたら （確認できない場所）。もう一度 [[place:a]]");
});

const places: Place[] = [
  { id: "t1", kind: "toilet", lat: 35.001, lon: 135, tier: "verified", source: { name: "test", license: "test" }, gate: "inside" },
  { id: "s1", kind: "store", lat: 35.0005, lon: 135, tier: "osm", source: { name: "test", license: "test" }, store: { storeType: "convenience" } },
];

// 決めた順に返答を返す偽のクライアント。送られた内容も記録する
function fakeClient(replies: Partial<Anthropic.Beta.BetaMessage>[]) {
  const sent: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const client: MessagesClient = {
    beta: {
      messages: {
        create: async (params) => {
          sent.push(structuredClone(params));
          const r = replies.shift();
          if (!r) throw new Error("返答が足りない");
          return r as Anthropic.Beta.BetaMessage;
        },
      },
    },
  };
  return { client, sent };
}

const toolUse = (name: string, input: unknown): Partial<Anthropic.Beta.BetaMessage> => ({
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id: `tu-${name}`, name, input } as Anthropic.Beta.BetaToolUseBlock],
});
const say = (text: string): Partial<Anthropic.Beta.BetaMessage> => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text } as Anthropic.Beta.BetaTextBlock],
});
const near = { lat: null, lon: null, kind: "toilet", accessible_only: false, limit: 3 };

test("道具の結果にある場所だけを引用すれば、そのまま返る", async () => {
  const { client, sent } = fakeClient([toolUse("find_nearby_places", near), say("[[place:t1]] 北へ約2分（改札内）")]);
  const r = await runAgent({ userText: "トイレ", context: { position: { lat: 35, lon: 135 }, places } }, client);
  assert.equal(r.grounded, true);
  assert.equal(r.corrected, false);
  assert.deepEqual(r.citedIds, ["t1"]);
  // 2回目の送信に、道具の結果が tool_result として入っている
  const last = sent[1].messages.at(-1)!;
  assert.equal(last.role, "user");
  assert.equal((last.content as Anthropic.Beta.BetaToolResultBlockParam[])[0].type, "tool_result");
  assert.match(String((last.content as Anthropic.Beta.BetaToolResultBlockParam[])[0].content), /"id":"t1"/);
});

test("根拠のない場所を出したら1回だけ直させる", async () => {
  const { client, sent } = fakeClient([
    toolUse("find_nearby_places", near),
    say("[[place:made-up]] すぐそこ"),
    say("[[place:t1]] 北へ約2分"),
  ]);
  const r = await runAgent({ userText: "トイレ", context: { position: { lat: 35, lon: 135 }, places } }, client);
  assert.equal(r.grounded, true);
  assert.equal(r.corrected, true);
  assert.match(String(sent[2].messages.at(-1)!.content), /made-up/);
});

test("直しても根拠がなければ、その場所を伏せる", async () => {
  const { client } = fakeClient([say("[[place:made-up]] すぐそこ"), say("[[place:made-up2]] こちら")]);
  const r = await runAgent({ userText: "トイレ", context: { position: { lat: 35, lon: 135 }, places } }, client);
  assert.equal(r.grounded, false);
  assert.equal(r.text, "（確認できない場所） こちら");
  assert.deepEqual(r.citedIds, []);
});

test("位置がなく駅も分からなければ、道具はエラーを返す", async () => {
  const { client } = fakeClient([toolUse("find_nearby_places", near), say("どの駅にいますか？")]);
  const r = await runAgent({ userText: "トイレ", context: { places } }, client);
  assert.equal(r.toolCalls[0].isError, true);
  assert.equal(r.text, "どの駅にいますか？");
});

test("断られたときは決まった文を返す", async () => {
  const { client } = fakeClient([{ stop_reason: "refusal", content: [] }]);
  const r = await runAgent({ userText: "トイレ", context: { places } }, client);
  assert.equal(r.grounded, false);
  assert.match(r.text, /駅員や店員/);
});
