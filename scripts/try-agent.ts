// エージェントを手元で試す。.env.local の ANTHROPIC_API_KEY を使う。
// 使い方：npx tsx scripts/try-agent.ts "質問" [駅名]
//   例：npx tsx scripts/try-agent.ts "下着を汚してしまった。着替えたい" 祇園四条

import { readFile } from "node:fs/promises";
import { runAgent } from "../src/lib/agent/run";

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
  const r = await runAgent({ userText: text });
  console.log(r.text);
  console.log("\n---");
  console.log(`道具：${r.toolCalls.map((t) => t.name).join(" → ") || "なし"}`);
  console.log(`根拠チェック：${r.grounded ? "通過" : "根拠のない場所を伏せた"}${r.corrected ? "（1回直させた）" : ""}`);
  console.log(`引用した場所：${r.citedIds.length}件 / 道具が返した場所：${r.seenIds.length}件`);
  console.log(`時間：${((Date.now() - started) / 1000).toFixed(1)}秒`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
