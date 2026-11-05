import type Anthropic from "@anthropic-ai/sdk";
import assert from "node:assert/strict";
import { test } from "node:test";
import { answerSchema, dropUnseen, parseAnswer } from "../src/lib/agent/answer";
import { runAgent, type MessagesClient } from "../src/lib/agent/run";
import type { Place } from "../src/lib/places";

type Schema = {
  properties: { steps: { items: { properties: { place_ids?: { items: { enum: string[] } } }; required: string[] } } };
};

test("返答の形：place_ids に書けるのは、渡した id だけ", () => {
  const s = answerSchema(["a", "b"]) as Schema;
  assert.deepEqual(s.properties.steps.items.properties.place_ids?.items.enum, ["a", "b"]);
  // まだ道具が何も返していなければ、場所はそもそも書けない
  const empty = answerSchema([]) as Schema;
  assert.equal(empty.properties.steps.items.properties.place_ids, undefined);
  assert.deepEqual(empty.properties.steps.items.required, ["text"]);
});

test("返答の読み取り：形が違えば null", () => {
  assert.deepEqual(parseAnswer('{"summary":"s","steps":[{"text":"t","place_ids":["a"]}],"notes":[]}'), {
    summary: "s",
    steps: [{ text: "t", placeIds: ["a"] }],
    notes: [],
  });
  assert.equal(parseAnswer("ふつうの文"), null);
  assert.equal(parseAnswer('{"summary":"s"}'), null);
});

test("念のための確認：道具が返していない id は落とす", () => {
  const r = dropUnseen({ summary: "", steps: [{ text: "t", placeIds: ["a", "x"] }], notes: [] }, new Set(["a"]));
  assert.deepEqual(r.answer.steps[0].placeIds, ["a"]);
  assert.deepEqual(r.dropped, ["x"]);
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
const answer = (ids: string[]) => say(JSON.stringify({ summary: "近くにあります", steps: [{ text: "行く", place_ids: ids }], notes: [] }));
const near = { lat: null, lon: null, kind: "toilet", accessible_only: false, limit: 3 };
const enumOf = (p: Anthropic.Beta.MessageCreateParamsNonStreaming) =>
  (p.output_config?.format?.schema as Schema).properties.steps.items.properties.place_ids?.items.enum;

test("道具が返した場所は、次の送信から選べるようになる", async () => {
  const { client, sent } = fakeClient([toolUse("find_nearby_places", near), answer(["t1"])]);
  const r = await runAgent({ userText: "トイレ", context: { position: { lat: 35, lon: 135 }, places } }, client);
  assert.equal(r.ok, true);
  assert.deepEqual(r.citedIds, ["t1"]);
  assert.equal(enumOf(sent[0]), undefined); // 最初はまだ何も選べない
  assert.ok(enumOf(sent[1])?.includes("t1"));
  // 2回目の送信に、道具の結果が tool_result として入っている
  const last = sent[1].messages.at(-1)!;
  const block = (last.content as Anthropic.Beta.BetaToolResultBlockParam[])[0];
  assert.equal(block.type, "tool_result");
  assert.match(String(block.content), /"id":"t1"/);
});

test("プロンプトキャッシュ：system は毎回同じ文で印つき、時刻は system に入れず、会話にも自動の印", async () => {
  const { client, sent } = fakeClient([toolUse("find_nearby_places", near), answer(["t1"])]);
  await runAgent({ userText: "トイレ", modeInstruction: "場面の指示", context: { position: { lat: 35, lon: 135 }, places } }, client);
  for (const p of sent) {
    assert.deepEqual(p.cache_control, { type: "ephemeral" });
    const sys = p.system as Anthropic.Beta.BetaTextBlockParam[];
    assert.deepEqual(sys.at(-1)!.cache_control, { type: "ephemeral" });
    assert.doesNotMatch(sys.map((b) => b.text).join(""), /現在時刻/);
  }
  assert.deepEqual(sent[0].system, sent[1].system);
});

test("形が違う返事は1回だけ直させる", async () => {
  const { client, sent } = fakeClient([toolUse("find_nearby_places", near), say("ふつうの文"), answer(["t1"])]);
  const r = await runAgent({ userText: "トイレ", context: { position: { lat: 35, lon: 135 }, places } }, client);
  assert.equal(r.ok, true);
  assert.match(String(sent[2].messages.at(-1)!.content), /JSON/);
});

test("直しても形が違えば、決まった文に差し替える", async () => {
  const { client } = fakeClient([say("ふつうの文"), say("まだふつうの文")]);
  const r = await runAgent({ userText: "トイレ", context: { places } }, client);
  assert.equal(r.ok, false);
  assert.match(r.answer.steps[0].text, /駅員や店員/);
});

test("スキーマを抜けて道具にない id が来ても、画面には出さない", async () => {
  const { client } = fakeClient([toolUse("find_nearby_places", near), answer(["t1", "made-up"])]);
  const r = await runAgent({ userText: "トイレ", context: { position: { lat: 35, lon: 135 }, places } }, client);
  assert.deepEqual(r.citedIds, ["t1"]);
  assert.deepEqual(r.dropped, ["made-up"]);
});

test("位置がなく駅も分からなければ、道具はエラーを返す", async () => {
  const { client } = fakeClient([toolUse("find_nearby_places", near), say(JSON.stringify({ summary: "どの駅にいますか？", steps: [], notes: [] }))]);
  const r = await runAgent({ userText: "トイレ", context: { places } }, client);
  assert.equal(r.toolCalls[0].isError, true);
  assert.equal(r.answer.summary, "どの駅にいますか？");
});

test("断られたときは決まった文を返す", async () => {
  const { client } = fakeClient([{ stop_reason: "refusal", content: [] }]);
  const r = await runAgent({ userText: "トイレ", context: { places } }, client);
  assert.equal(r.ok, false);
  assert.match(r.answer.steps[0].text, /駅員や店員/);
});

test("文の中に書かれた場所の印は消し、道具が返した場所なら place_ids に移す", () => {
  const r = dropUnseen(
    { summary: "[[place:x]] 近い", steps: [{ text: "公衆トイレへ [[place:a]] 向かう [[place:x]]", placeIds: [] }], notes: [] },
    new Set(["a"]),
  );
  assert.equal(r.answer.steps[0].text, "公衆トイレへ 向かう");
  assert.deepEqual(r.answer.steps[0].placeIds, ["a"]);
  assert.equal(r.answer.summary, "近い");
  assert.deepEqual(r.dropped, ["x"]);
});
