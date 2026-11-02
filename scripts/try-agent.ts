// エージェントを手元で試す。.env.local の ANTHROPIC_API_KEY（と ANTHROPIC_MODEL）を使う。
// 使い方：npx tsx scripts/try-agent.ts "質問" [駅名]
//   ③の場面で試す：MODE=after npx tsx scripts/try-agent.ts "状況：下着を汚した" 祇園四条

import { readFile } from "node:fs/promises";

async function loadEnv() {
  try {
    for (const line of (await readFile(".env.local", "utf8")).split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // .env.local がなければ、環境変数だけで動かす
  }
}

// 100万トークンあたりの料金（入力, 出力）
const PRICE: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

const TIER = { verified: "現地確認済み", official: "公式データ", osm: "OSM・未確認", report: "利用者の報告" } as const;

async function main() {
  // モデルの名前は読み込み時に決まるので、.env.local を読んでから読み込む
  await loadEnv();
  const { runAgent } = await import("../src/lib/agent/run");
  const { MODE_INSTRUCTIONS } = await import("../src/lib/agent/modes");
  const { loadPlaces } = await import("../src/lib/data");
  const { displayName } = await import("../src/lib/nearby");

  const [question, station] = process.argv.slice(2);
  if (!question) throw new Error('質問を渡してください：npx tsx scripts/try-agent.ts "質問" [駅名]');
  const text = station ? `${question}（いま${station}駅にいます）` : question;
  const started = Date.now();
  const after = process.env.MODE === "after";
  const r = await runAgent({ userText: text, modeInstruction: after ? MODE_INSTRUCTIONS.after : undefined });

  // 画面と同じように、place_ids を【名前・信頼度】にして見せる
  const byId = new Map((await loadPlaces()).map((p) => [p.id, p]));
  console.log(r.answer.summary);
  r.answer.steps.forEach((step, i) => {
    const names = step.placeIds.map((id) => {
      const p = byId.get(id);
      return p ? `【${displayName(p)}・${TIER[p.tier]}】` : "（不明な場所）";
    });
    console.log(`${i + 1}. ${step.text}${names.length ? `　${names.join(" ")}` : ""}`);
  });
  r.answer.notes.forEach((n) => console.log(`※ ${n}`));

  console.log("\n---");
  console.log(`モデル：${r.model}`);
  console.log(`道具：${r.toolCalls.map((t) => t.name).join(" → ") || "なし"}`);
  console.log(`形：${r.ok ? "決まった JSON で返った" : "決まった文に差し替えた"}${r.dropped.length ? `・道具にない id を落とした：${r.dropped.join(",")}` : ""}`);
  console.log(`引用した場所：${r.citedIds.length}件 / 道具が返した場所：${r.seenIds.length}件`);
  console.log(`時間：${((Date.now() - started) / 1000).toFixed(1)}秒`);
  const [pin, pout] = PRICE[r.model] ?? PRICE["claude-opus-5-5"];
  const cost = (r.usage.input * pin + r.usage.output * pout) / 1e6;
  console.log(`トークン：入力 ${r.usage.input}・出力 ${r.usage.output}（${r.usage.requests}回）・約 $${cost.toFixed(4)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
