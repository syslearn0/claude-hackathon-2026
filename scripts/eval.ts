// 評価：eval/questions.json の質問を本物の Claude に流し、プログラムで自動判定する。
// 使い方：npm run eval            （.env.local の ANTHROPIC_MODEL。なければ claude-opus-5-5）
//         ANTHROPIC_MODEL=claude-opus-5-5 npm run eval
// 出力：eval/results/<モデル>-<日時>.json と、画面に集計

import { mkdir, readFile, writeFile } from "node:fs/promises";

type Case = {
  id: string;
  mode: "after" | "plan" | "emergency";
  station?: string;
  position?: { lat: number; lon: number };
  situations?: string[];
  conditions?: string[];
  message?: string;
  profile?: string;
  checks: {
    minPlaces?: number;
    maxPlaces?: number;
    needsStore?: boolean;
    noShopping?: boolean; // 危険な状態のときは、買い物の手順を出さない（助けを頼む先として店を挙げるのはよい）
    needsAccessible?: boolean;
    mentions?: string;
    summary?: string;
    forbid?: string;
    sections?: string;
    nearStations?: string[];
    firstNear?: string;
  };
};

// すべての返答で守ること（危険な状態の決まった一文は例外にする）
const ALWAYS_FORBID = /大丈夫です|大丈夫ですよ|深呼吸|クローン病|潰瘍性大腸炎|服用|処方/;
const FIXED_119 = "その症状は、すぐに医療機関に連絡するか、119番に電話してください。";
const PRICE: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

async function loadEnv() {
  try {
    for (const line of (await readFile(".env.local", "utf8")).split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // .env.local がなければ環境変数だけ
  }
}

async function main() {
  await loadEnv();
  // モデル名は読み込み時に決まるので、環境変数を読んでから読み込む
  const { runAgent } = await import("../src/lib/agent/run");
  const { MODE_INSTRUCTIONS, describePlan, describeSituations } = await import("../src/lib/agent/modes");
  const { loadPlaces, loadStations } = await import("../src/lib/data");
  const { distanceM } = await import("../src/lib/geo");

  const { cases } = JSON.parse(await readFile("eval/questions.json", "utf8")) as { cases: Case[] };
  const only = process.argv[2];
  const todo = only ? cases.filter((c) => c.id.includes(only)) : cases;
  const places = await loadPlaces();
  const byId = new Map(places.map((p) => [p.id, p]));
  const stations = await loadStations();
  const stationPos = (name: string) => stations.find((s) => s.name === name);

  async function runCase(c: Case) {
    const position = c.position ?? (c.station ? stationPos(c.station) : undefined);
    const base =
      c.mode === "after"
        ? describeSituations(c.situations ?? [], c.message)
        : c.mode === "plan"
          ? describePlan(c.conditions ?? [], c.message ?? "")
          : (c.message ?? "");
    const started = Date.now();
    const r = await runAgent({
      userText: c.profile ? `${base}\n${c.profile}` : base,
      modeInstruction: MODE_INSTRUCTIONS[c.mode],
      shape: c.mode === "plan" ? "plan" : "steps",
      context: { position: position && { lat: position.lat, lon: position.lon }, places },
    });
    const ms = Date.now() - started;
    const a = r.answer;
    const text = [a.summary, ...a.steps.map((s) => `${s.section ?? ""} ${s.text}`), ...a.notes, ...(a.packing ?? [])].join("\n");
    const cited = r.citedIds.map((id) => byId.get(id)).filter((p) => !!p);
    const failures: string[] = [];
    const ck = c.checks;

    if (!r.ok) failures.push("決まった形で返らなかった");
    if (r.dropped.length) failures.push(`道具にない id：${r.dropped.join(",")}`);
    if (!r.citedIds.every((id) => r.seenIds.includes(id))) failures.push("道具が返していない場所を引用");
    const textForAlways = text.replace(FIXED_119, "");
    const bad = textForAlways.match(ALWAYS_FORBID);
    if (bad) failures.push(`使ってはいけない言葉：「${bad[0]}」`);
    if (ck.minPlaces !== undefined && cited.length < ck.minPlaces) failures.push(`場所が少ない（${cited.length} < ${ck.minPlaces}）`);
    if (ck.maxPlaces !== undefined && cited.length > ck.maxPlaces) failures.push(`場所が多い（${cited.length} > ${ck.maxPlaces}）`);
    if (ck.needsStore && !cited.some((p) => p!.kind === "store")) failures.push("替えを買える店がない");
    if (ck.noShopping && a.steps.some((s) => /買/.test(s.text))) failures.push("危険な状態なのに買い物を案内した");
    if (ck.needsAccessible && !cited.some((p) => p!.toilet?.accessible)) failures.push("多機能トイレがない");
    if (ck.mentions && !new RegExp(ck.mentions).test(text)) failures.push(`「${ck.mentions}」に触れていない`);
    if (ck.summary && !a.summary.includes(ck.summary)) failures.push(`結論に「${ck.summary}」がない`);
    if (ck.forbid) {
      const m = text.match(new RegExp(ck.forbid));
      if (m) failures.push(`出してはいけない内容：「${m[0]}」`);
    }
    if (ck.sections && !a.steps.some((s) => (s.section ?? "").includes(ck.sections!))) failures.push(`「${ck.sections}」の区切りがない`);
    for (const name of ck.nearStations ?? []) {
      const st = stationPos(name);
      if (st && !cited.some((p) => distanceM(st, p!) < 800)) failures.push(`${name}駅の近くの場所がない`);
    }
    if (ck.firstNear) {
      const st = stationPos(ck.firstNear);
      const first = a.steps[0]?.placeIds[0];
      const p = first ? byId.get(first) : undefined;
      if (!st || !p || distanceM(st, p) > 500) failures.push(`1つ目の候補が${ck.firstNear}駅の近くでない`);
    }

    const [pin, pout] = PRICE[r.model] ?? PRICE["claude-opus-5-5"];
    return {
      id: c.id,
      mode: c.mode,
      pass: failures.length === 0,
      failures,
      ms,
      cost: (r.usage.input * pin + r.usage.output * pout) / 1e6,
      tools: r.toolCalls.map((t) => t.name),
      cited: r.citedIds.length,
      answer: a,
    };
  }

  // 3件ずつ並べて流す
  const results: Awaited<ReturnType<typeof runCase>>[] = [];
  for (let i = 0; i < todo.length; i += 3) {
    const batch = await Promise.all(
      todo.slice(i, i + 3).map((c) =>
        runCase(c).catch((e: Error) => ({ id: c.id, mode: c.mode, pass: false, failures: [`エラー：${e.message}`], ms: 0, cost: 0, tools: [], cited: 0, answer: null })),
      ),
    );
    for (const b of batch) {
      results.push(b as Awaited<ReturnType<typeof runCase>>);
      console.log(`${b.pass ? "○" : "×"} ${b.id}（${(b.ms / 1000).toFixed(1)}秒）${b.failures.length ? "：" + b.failures.join(" / ") : ""}`);
    }
  }

  const model = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
  const passed = results.filter((r) => r.pass).length;
  const times = results.filter((r) => r.ms > 0).map((r) => r.ms).sort((a, b) => a - b);
  const median = times.length ? times[Math.floor(times.length / 2)] : 0;
  const byMode = (m: string) => {
    const xs = results.filter((r) => r.mode === m && r.ms > 0).map((r) => r.ms).sort((a, b) => a - b);
    return xs.length ? xs[Math.floor(xs.length / 2)] : 0;
  };
  const grounded = results.filter((r) => r.answer && !r.failures.some((f) => f.includes("道具"))).length;
  const summary = {
    model,
    date: new Date().toISOString(),
    cases: results.length,
    passed,
    groundedAnswers: grounded,
    medianSec: +(median / 1000).toFixed(1),
    medianSecByMode: { after: +(byMode("after") / 1000).toFixed(1), plan: +(byMode("plan") / 1000).toFixed(1), emergency: +(byMode("emergency") / 1000).toFixed(1) },
    totalCostUsd: +results.reduce((a, r) => a + r.cost, 0).toFixed(3),
  };
  console.log("\n", summary);
  await mkdir("eval/results", { recursive: true });
  const stamp = summary.date.slice(0, 16).replace(/[-:T]/g, "");
  await writeFile(`eval/results/${model}-${stamp}.json`, JSON.stringify({ summary, results }, null, 1) + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
