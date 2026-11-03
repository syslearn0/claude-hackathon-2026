// エージェントの土台：Claude が道具を呼び、決まった形（JSON）で手順を返す。
// 手順に書ける場所は、その回に道具が返した場所だけ（スキーマで縛る）。
import Anthropic from "@anthropic-ai/sdk";
import { answerSchema, citedIds, dropUnseen, parseAnswer, type Answer, type Shape } from "./answer";
import { runTool, TOOLS, type ToolContext } from "./tools";

// 開発中は .env.local の ANTHROPIC_MODEL で安いモデルに切り替えられる
export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";

// 安全のための判定で断られたとき別のモデルで続ける仕組みは、使えるモデルだけで有効にする
export const SUPPORTS_FALLBACK = /^claude-(opus-5|sonnet-5-5|fable-5)/;

// 共通の約束ごと。場面ごとの指示（③トイレの後、①出かける前など）は modeInstruction で足す
export const BASE_SYSTEM = `あなたは、急なトイレの不安がある人（腸の病気など）の外出を、事実の情報で支える案内役です。

返答の形：
- 最後の返答は、決められた JSON（summary・steps・notes）で返す。
- 場所は steps の place_ids で示す。画面が place_ids から、場所の名前・信頼度・方角・歩く時間・営業時間を自動で出す。
- 1つの手順の place_ids は多くても2件。確かな情報（現地確認済み・公式データ）と近さを優先して選ぶ。
- だから steps の text には、場所の名前・id・距離・方角・営業時間を書かない。「替えの下着と袋を買う」「個室で着替える」のように、やることと理由だけを書く。

守ること：
- トイレ・店・駅についての事実は、道具（tools）の結果だけを使う。道具に出てこない場所や設備を、推測で書かない。
- 道具の結果に無い項目は「不明」。「ない」と言い換えない。品ぞろえ・サニタリーボックスなど、確かめていない項目の注意は notes にまとめて一度だけ書く。
- 結論を先に、短く。summary は40字くらいまでにし、理由は notes に回す。次に何をすればよいかが一目で分かる順に並べる。
- notes は多くても3つ。「不明」の注意は1つにまとめる。
- データで確かめていないこと（使えるか、開いているか、品ぞろえ、改札の内外）は、summary や steps で言い切らない（「買えます」「すぐ使える」「確実」と書かない）。
- 利用者向けの文では「道具」「検索」と言わず、「手元のデータ」と書く。
- 体調や症状の判断、受診・食事・薬の助言はしない。薬や食事を聞かれたら「このアプリでは薬や食事の助言はしません。」の一文だけにし、医師・薬剤師への相談も勧めない。「大丈夫」「〜して大丈夫」「安心して」など保証する言い方や、「深呼吸して」「落ち着いて」など体や気持ちについての声かけもしない。事実と選択肢だけを書く。
- ただし、大量の出血・高い熱・強い腹痛が続く・めまいや意識がもうろうとする、と書かれたときだけ、summary を「その症状は、すぐに医療機関に連絡するか、119番に電話してください。」にする。そのときは買い物や着替えの手順は出さず、近くの駅員の窓口や座れる場所（分かれば）と、駅員や周りの人に助けを頼めることだけを steps にする。
- 病名を繰り返さない。
- 位置や駅が分からず道具を使えないときは、推測せず、summary で「いまいる駅、または近くの駅名を入力してください。」と尋ねる（質問は summary の一か所だけ）。
- データのない駅でも、その section には次にできること（駅の案内表示や駅員の窓口で確かめる）を書く。`;

export type AgentInput = {
  userText: string;
  modeInstruction?: string;
  shape?: Shape;
  context?: ToolContext;
  history?: Anthropic.Beta.BetaMessageParam[];
};

export type AgentResult = {
  answer: Answer;
  citedIds: string[];
  seenIds: string[];
  ok: boolean; // 決まった形で答えられたか（false なら決まった文に差し替えた）
  dropped: string[]; // 念のための確認で落とした id（スキーマがあるので、ふだんは空）
  toolCalls: { name: string; input: unknown; isError?: boolean }[];
  stopReason: string | null;
  model: string;
  usage: { input: number; output: number; cacheRead: number; requests: number };
  messages: Anthropic.Beta.BetaMessageParam[];
};

// テストで差し替えられるよう、必要な部分だけを型にする
export type MessagesClient = {
  beta: { messages: { create: (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage> } };
};

const MAX_TURNS = 8;

const CANNOT: Answer = {
  summary: "すみません、案内を作れませんでした。",
  steps: [{ text: "駅員や店員に聞いてください。", placeIds: [] }],
  notes: [],
};

export async function runAgent(input: AgentInput, client: MessagesClient = new Anthropic()): Promise<AgentResult> {
  const ctx = input.context ?? {};
  const model = MODEL;
  const system = [BASE_SYSTEM, input.modeInstruction].filter(Boolean).join("\n\n");
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const situation = ctx.position
    ? `（利用者の現在地：緯度 ${ctx.position.lat.toFixed(5)}、経度 ${ctx.position.lon.toFixed(5)}。現在時刻：${now}）`
    : `（利用者の現在地は不明。現在時刻：${now}）`;
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...(input.history ?? []),
    { role: "user", content: `${input.userText}\n\n${situation}` },
  ];
  const seen = new Set<string>();
  const toolCalls: AgentResult["toolCalls"] = [];
  const usage = { input: 0, output: 0, cacheRead: 0, requests: 0 };
  let stopReason: string | null = null;
  let retried = false;

  const finish = (answer: Answer, ok: boolean): AgentResult => {
    const { answer: clean, dropped } = dropUnseen(answer, seen);
    return { answer: clean, citedIds: citedIds(clean), seenIds: [...seen], ok, dropped, toolCalls, stopReason, model, usage, messages };
  };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      system,
      tools: TOOLS,
      messages,
      // 返答の形。place_ids に書けるのは、ここまでに道具が返した id だけ
      output_config: { effort: "medium", format: { type: "json_schema", schema: answerSchema([...seen], input.shape) } },
      ...(SUPPORTS_FALLBACK.test(model) && { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
    });
    stopReason = response.stop_reason;
    usage.requests++;
    usage.input += response.usage?.input_tokens ?? 0;
    usage.output += response.usage?.output_tokens ?? 0;
    usage.cacheRead += response.usage?.cache_read_input_tokens ?? 0;
    // 考えた内容のブロックも含めて、そのまま履歴に戻す
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "pause_turn") continue;

    if (response.stop_reason === "tool_use") {
      const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      const results = await Promise.all(
        uses.map(async (u) => {
          const out = await runTool(u.name, (u.input ?? {}) as Record<string, unknown>, ctx);
          out.placeIds.forEach((id) => seen.add(id));
          toolCalls.push({ name: u.name, input: u.input, isError: out.isError });
          return { type: "tool_result" as const, tool_use_id: u.id, content: out.content, is_error: out.isError };
        }),
      );
      messages.push({ role: "user", content: results });
      continue;
    }

    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return finish(CANNOT, false);

    const json = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const answer = parseAnswer(json);
    if (answer) return finish(answer, true);
    if (!retried) {
      retried = true;
      messages.push({ role: "user", content: "（システムの確認）返答が決められた JSON の形になっていません。形どおりに返し直してください。" });
      continue;
    }
    return finish(CANNOT, false);
  }
  return finish({ ...CANNOT, summary: "すみません、時間内に案内をまとめられませんでした。" }, false);
}
