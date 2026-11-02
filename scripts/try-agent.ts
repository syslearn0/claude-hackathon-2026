// エージェントを手元で試す。.env.local の ANTHROPIC_API_KEY を使う。
// 使い方：npx tsx scripts/try-agent.ts "質問" [駅名]
//   例：npx tsx scripts/try-agent.ts "下着を汚してしまった。着替えたい" 祇園四条

import { readFile } from "node:fs/promises";
import { MODE_INSTRUCTIONS } from "../src/lib/agent/modes";
import { runAgent } from "../src/lib/agent/run";
import { loadPlaces } from "../src/lib/data";
import { displayName } from "../src/lib/nearby";

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

async function main() {
  await loadEnv();
  const [question, station] = process.argv.slice(2);
  if (!question) throw new Error('質問を渡してください：npx tsx scripts/try-agent.ts "質問" [駅名]');
  const text = station ? `${question}（いま${station}駅にいます）` : question;
  const started = Date.now();
  const after = process.env.MODE === "after";
  const r = await runAgent({ userText: text, modeInstruction: after ? MODE_INSTRUCTIONS.after : undefined });
  // 画面と同じように、[[place:ID]] を【名前・信頼度】に置き換えて見せる
  const places = await loadPlaces();
  const byId = new Map(places.map((p) => [p.id, p]));
  const tier = { verified: "現地確認済み", official: "公式データ", osm: "OSM・未確認", report: "利用者の報告" } as const;
  console.log(
    r.text.replace(/\[\[place:([^\]\s]+)\]\]/g, (_m, id: string) => {
      const p = byId.get(id);
      return p ? `【${displayName(p)}・${tier[p.tier]}】` : "（確認できない場所）";
    }),
  );
  console.log("\n---");
  console.log(`道具：${r.toolCalls.map((t) => t.name).join(" → ") || "なし"}`);
  console.log(`根拠チェック：${r.grounded ? "通過" : "根拠のない場所を伏せた"}${r.corrected ? "（1回直させた）" : ""}`);
  console.log(`引用した場所：${r.citedIds.length}件 / 道具が返した場所：${r.seenIds.length}件`);
  console.log(`時間：${((Date.now() - started) / 1000).toFixed(1)}秒`);
  // Claude Opus 5.5：入力 $4 / 出力 $20（100万トークンあたり）
  const cost = (r.usage.input * 4 + r.usage.output * 20) / 1e6;
  console.log(`トークン：入力 ${r.usage.input}・出力 ${r.usage.output}（${r.usage.requests}回）・約 $${cost.toFixed(4)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
