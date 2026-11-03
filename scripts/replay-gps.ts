// /tools/gps-log で書き出した .gpslog.json を、緊急画面と同じ推定器（estimateSituation）に流し直して、
// いつ「乗り物」と判断し、どの駅を「次の駅」に出すかを時系列で見る。
// 使い方：npx tsx scripts/replay-gps.ts trace.gpslog.json [--route 駅,駅,...] [--line 京阪本線] [--every 5] [--csv out.csv]
import { readFile, writeFile } from "node:fs/promises";
import { loadStations } from "../src/lib/data";
import { distanceM } from "../src/lib/geo";
import { estimateSituation, type Fix, type RouteStation, type Situation } from "../src/lib/situation";
import type { Station } from "../src/lib/station-mode";

export type TraceIn = { fixes: { t: number; rx?: number; lat: number; lon: number; acc: number; speed: number | null }[] };

export const DEFAULT_ROUTE = "丹波橋,墨染,藤森,龍谷大前深草,伏見稲荷,鳥羽街道,東福寺,七条,清水五条,祇園四条,三条,神宮丸太町,出町柳";
const WINDOW_KEEP_MS = 240_000; // /now が保つ位置の窓
const JUMP_KMH = 150;
const BAD_ACC_M = 200;
const GAP_SEC = 60;

// src/app/now/Client.tsx の経路の作り方と同じ（駅名で最初に見つかった駅の位置を使う。同名の駅があっても最初のもの）。
// src/app は触らない約束なので、ここに最小限で書き直している
export function resolveRoute(names: string[], stations: Station[], line?: string): RouteStation[] {
  return names
    .map((n) => {
      const s = stations.find((x) => x.name === n);
      return s && { name: s.name, lat: s.lat, lon: s.lon, line };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
}

export type Row = { t: number; elapsed: number; fix: Fix; sit: Situation; flags: string[]; changed: boolean };
export type Summary = {
  durationSec: number;
  stateSec: Record<string, number>;
  nextOrder: { name: string; at: number }[]; // 次の駅の変わり目（最初に見た経過秒）
  flagged: number;
  rows: Row[];
};

export function replay(trace: TraceIn, stations: Station[], route: RouteStation[]): Summary {
  // /now は位置が届いた時刻（Date.now()）を t に使うので、rx があればそれを時刻にする
  const raw: Fix[] = trace.fixes.map((f) => ({ t: f.rx ?? f.t, lat: f.lat, lon: f.lon, acc: f.acc, speed: f.speed })).sort((a, b) => a.t - b.t);
  const idx = new Map(route.map((r, i) => [r.name, i]));
  const key = (s: Situation) => [s.state, s.nextStation?.name, s.betweenStations, s.segment?.from, s.segment?.to].join("|");
  const rows: Row[] = [];
  let win: Fix[] = [];
  let prev: Row | undefined;
  const t0 = raw[0]?.t ?? 0;
  for (const f of raw) {
    win = [...win.filter((x) => f.t - x.t < WINDOW_KEEP_MS), f];
    const sit = estimateSituation(win, stations, f.t, route);
    const flags: string[] = [];
    if (prev) {
      const dt = (f.t - prev.fix.t) / 1000;
      const kmh = dt > 0 ? (distanceM(prev.fix, f) / dt) * 3.6 : 0;
      if (dt > GAP_SEC) flags.push(`空白${Math.round(dt)}秒（地下か）`);
      if (kmh > JUMP_KMH) flags.push(`飛び${Math.round(kmh)}km/h`);
      const a = idx.get(prev.sit.nextStation?.name ?? "");
      const b = idx.get(sit.nextStation?.name ?? "");
      if (a !== undefined && b !== undefined && b < a) flags.push(`次の駅が戻る ${prev.sit.nextStation!.name}→${sit.nextStation!.name}`);
    }
    if (f.acc > BAD_ACC_M) flags.push(`誤差${Math.round(f.acc)}m`);
    const row: Row = { t: f.t, elapsed: (f.t - t0) / 1000, fix: f, sit, flags, changed: !prev || key(prev.sit) !== key(sit) };
    rows.push(row);
    prev = row;
  }
  // 次の位置が届くまでの時間を、その時の状態に数える（空白の間は直前の表示のまま）
  const stateSec: Record<string, number> = {};
  rows.forEach((r, i) => {
    const dt = i + 1 < rows.length ? (rows[i + 1].t - r.t) / 1000 : 0;
    stateSec[r.sit.state] = (stateSec[r.sit.state] ?? 0) + dt;
  });
  const nextOrder: Summary["nextOrder"] = [];
  for (const r of rows) {
    const n = r.sit.nextStation?.name;
    if (n && nextOrder.at(-1)?.name !== n) nextOrder.push({ name: n, at: r.elapsed });
  }
  return { durationSec: rows.at(-1)?.elapsed ?? 0, stateSec, nextOrder, flagged: rows.filter((r) => r.flags.length).length, rows };
}

const hms = (ms: number) => new Date(ms).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false });
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function formatTimeline(s: Summary, everyMin: number): string[] {
  const out: string[] = [];
  let lastBeat = -Infinity;
  for (const r of s.rows) {
    const { sit } = r;
    const beat = everyMin > 0 && r.elapsed - lastBeat >= everyMin * 60;
    if (!r.changed && !beat && !r.flags.length) continue;
    if (beat) lastBeat = r.elapsed;
    const next = sit.nextStation ? `${sit.nextStation.name} ${sit.nextStation.meters}m` : "-";
    const seg = sit.segment ? ` ${sit.segment.from}→${sit.segment.to}` : "";
    const mark = r.flags.length ? `  !! ${r.flags.join(" / ")}` : "";
    out.push(
      `${hms(r.t)} +${mmss(r.elapsed)} ${r.changed ? "*" : beat ? "." : " "} ${sit.state.padEnd(7)} ${String(sit.speedKmh ?? "-").padStart(3)}km/h acc${Math.round(r.fix.acc)}m 次:${next}${sit.betweenStations ? " [駅間]" : ""}${seg} | ${sit.reason}${mark}`,
    );
  }
  return out;
}

export function formatSummary(s: Summary): string[] {
  const tot = Object.values(s.stateSec).reduce((a, b) => a + b, 0) || 1;
  return [
    "",
    "--- まとめ ---",
    `長さ ${mmss(s.durationSec)}（位置 ${s.rows.length}件）`,
    "状態の割合：" + Object.entries(s.stateSec).map(([k, v]) => `${k} ${Math.round((v / tot) * 100)}%`).join("  "),
    "次の駅の移り変わり：" + (s.nextOrder.map((n) => `${n.name}(+${mmss(n.at)})`).join(" → ") || "なし"),
    `気になる点：${s.flagged}件`,
  ];
}

export function toCsv(s: Summary): string {
  const head = "time,elapsed_s,lat,lon,acc_m,speed_ms,state,speed_kmh,next,next_m,between,segment,flags";
  const lines = s.rows.map((r) =>
    [
      new Date(r.t).toISOString(), r.elapsed.toFixed(1), r.fix.lat, r.fix.lon, Math.round(r.fix.acc), r.fix.speed ?? "",
      r.sit.state, r.sit.speedKmh ?? "", r.sit.nextStation?.name ?? "", r.sit.nextStation?.meters ?? "", r.sit.betweenStations ? 1 : 0,
      r.sit.segment ? `${r.sit.segment.from}>${r.sit.segment.to}` : "", `"${r.flags.join(" / ")}"`,
    ].join(","),
  );
  return [head, ...lines].join("\n") + "\n";
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const file = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
  if (!file) {
    console.error("使い方：npx tsx scripts/replay-gps.ts <trace.gpslog.json> [--route 駅,駅,...] [--line 京阪本線] [--every 5] [--csv out.csv]");
    process.exit(1);
  }
  const trace = JSON.parse(await readFile(file, "utf8")) as TraceIn;
  const stations = await loadStations();
  const names = (opt("--route") ?? DEFAULT_ROUTE).split(",").map((x) => x.trim()).filter(Boolean);
  const route = resolveRoute(names, stations, opt("--line") ?? "京阪本線");
  const missing = names.filter((n) => !route.some((r) => r.name === n));
  if (missing.length) console.warn("位置が分からない駅（経路から外した）：", missing.join("、"));
  const s = replay(trace, stations, route);
  console.log(`経路：${route.map((r) => r.name).join(" → ")}`);
  for (const l of [...formatTimeline(s, Number(opt("--every") ?? 5)), ...formatSummary(s)]) console.log(l);
  const csv = opt("--csv");
  if (csv) await writeFile(csv, toCsv(s));
}

if (process.argv[1]?.endsWith("replay-gps.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
