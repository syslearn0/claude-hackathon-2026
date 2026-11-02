// エージェントの土台：Claude が道具を呼び、返答に出た場所を根拠チェックしてから返す。
import Anthropic from "@anthropic-ai/sdk";
import { checkGrounding, stripUnknown } from "./grounding";
import { runTool, TOOLS, type ToolContext } from "./tools";

export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";

// 共通の約束ごと。場面ごとの指示（③トイレの後、①出かける前など）は modeInstruction で足す
export const BASE_SYSTEM = `あなたは、急なトイレの不安がある人（腸の病気など）の外出を、事実の情報で支える案内役です。

守ること：
- トイレ・店・駅についての事実は、道具（tools）の結果だけを使う。道具に出てこない場所や設備を、推測で書かない。
- 場所を挙げるときは、必ずその場所の id を [[place:ID]] の形で書く（例：「[[place:osm-node-1]] が北へ約2分」）。id を書かない場所の案内はしない。
- [[place:ID]] は画面で「場所の名前＋信頼度の札」に置き換わる。だから文中で、その場所の名前や信頼度をもう一度書かない。
- 道具の結果に無い項目は「不明」。「ない」と言い換えない。
- 確認日は分かるときだけ書き、「確認日は不明」とは書かない。同じ注意（品ぞろえは未確認など）を何度も繰り返さず、まとめて一度だけ書く。
- 結論を先に、短く。次に何をすればよいかが一目で分かる順に並べる。
- 体調や症状の判断、受診・食事・薬の助言はしない。「大丈夫」など保証する言い方や、「深呼吸して」など体についての声かけもしない。
- ただし、大量の出血・高い熱・強い腹痛が続く・めまいや意識がもうろうとする、と書かれたときだけ、ほかの案内より先に次の一文を出す：「その症状は、すぐに医療機関に連絡するか、119番に電話してください。」そのときは買い物や着替えの案内はせず、近くの駅員の窓口や座れる場所（分かれば）と、お願いカードで周りの人に助けを頼めることだけを添える。
- 病名を繰り返さない。
- 位置や駅が分からず道具を使えないときは、推測せず、駅名を一度だけ尋ねる。`;

export type AgentInput = {
  userText: string;
  modeInstruction?: string;
  context?: ToolContext;
  history?: Anthropic.Beta.BetaMessageParam[];
};

export type AgentResult = {
  text: string; // 根拠チェック後の返答（[[place:ID]] を含む）
  citedIds: string[];
  seenIds: string[];
  grounded: boolean; // 根拠チェックを通ったか（false なら根拠のない場所を伏せた）
  corrected: boolean; // 根拠チェックで1回直させたか
  toolCalls: { name: string; input: unknown; isError?: boolean }[];
  stopReason: string | null;
  usage: { input: number; output: number; cacheRead: number; requests: number };
  messages: Anthropic.Beta.BetaMessageParam[];
};

// テストで差し替えられるよう、必要な部分だけを型にする
export type MessagesClient = {
  beta: { messages: { create: (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage> } };
};

const MAX_TURNS = 8;

export async function runAgent(input: AgentInput, client: MessagesClient = new Anthropic()): Promise<AgentResult> {
  const ctx = input.context ?? {};
  const system = [BASE_SYSTEM, input.modeInstruction].filter(Boolean).join("\n\n");
  const situation = ctx.position
    ? `（利用者の現在地：緯度 ${ctx.position.lat.toFixed(5)}、経度 ${ctx.position.lon.toFixed(5)}。現在時刻：${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}）`
    : `（利用者の現在地は不明。現在時刻：${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}）`;
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...(input.history ?? []),
    { role: "user", content: `${input.userText}\n\n${situation}` },
  ];
  const seen = new Set<string>();
  const toolCalls: AgentResult["toolCalls"] = [];
  let corrected = false;
  let stopReason: string | null = null;
  const usage = { input: 0, output: 0, cacheRead: 0, requests: 0 };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system,
      tools: TOOLS,
      messages,
      output_config: { effort: "medium" },
      // 安全のための判定で断られたとき、別のモデルで続ける
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
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

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
      return finish("すみません、案内を作れませんでした。駅員や店員に聞いてください（お願いカードを見せられます）。", false);
    }

    const check = checkGrounding(text, seen);
    if (check.ok) return finish(text, true);
    if (!corrected) {
      // 1回だけ直させる
      corrected = true;
      messages.push({
        role: "user",
        content: `（システムの確認）次の id は、今回の道具の結果にありません：${check.unknown.join("、")}。道具で確かめ直すか、その場所を削って、返答を書き直してください。`,
      });
      continue;
    }
    return finish(stripUnknown(text, seen), false);
  }
  return finish("すみません、時間内に案内をまとめられませんでした。", false);

  function finish(text: string, grounded: boolean): AgentResult {
    const cited = checkGrounding(text, seen).cited;
    return { text, citedIds: cited, seenIds: [...seen], grounded, corrected, toolCalls, stopReason, usage, messages };
  }
}
