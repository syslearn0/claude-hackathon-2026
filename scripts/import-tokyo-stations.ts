// 東京都「都内鉄道駅における車椅子使用者対応トイレのバリアフリー設備情報（令和7年度更新版）」を取り込む。
// 使い方：npx tsx scripts/import-tokyo-stations.ts
// 入力：data/raw/tokyo-station-bf-toilets-r07.csv（Shift_JIS）
// 出力：data/places/official-tokyo-station-toilets.json（CC BY 4.0、出典：東京都）

import { readFile, writeFile } from "node:fs/promises";
import type { Gate, Place } from "../src/lib/places";
import { parseCsv } from "./lib/csv";

const SRC = "data/raw/tokyo-station-bf-toilets-r07.csv";
const URL = "https://www.opendata.metro.tokyo.lg.jp/fukushi/R07/01/4_tonaitetsudoueki_barrier-free-wc.csv";

const mark = (v: string): boolean | undefined => (v === "○" ? true : v === "×" ? false : undefined);

// 改札の内外の列はない。備考やトイレ名に書かれているものだけ拾う
function gateOf(text: string): Gate {
  if (/改札外|ラチ外/.test(text)) return "outside";
  if (/改札内|ラチ内/.test(text)) return "inside";
  return "unknown";
}

function hoursOf(r: Record<string, string>): string | undefined {
  const days = ["月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日", "日曜日", "祝日"].map((d) => r[d]);
  const uniq = [...new Set(days.filter(Boolean))];
  if (uniq.length === 0) return undefined;
  const fmt = (v: string) =>
    v
      .replace("始発", "始発")
      .replace("終車", "終電")
      .replace(/(\d{2})(\d{2})/g, "$1:$2")
      .replace("_", "〜");
  return uniq.length === 1 ? fmt(uniq[0]) : `曜日により異なる（平日 ${fmt(days[0])}）`;
}

async function main() {
  const text = new TextDecoder("shift_jis").decode(await readFile(SRC));
  const rows = parseCsv(text);
  const places: Place[] = [];
  for (const r of rows) {
    const lat = Number(r["緯度"]);
    const lon = Number(r["経度"]);
    if (!r["鉄道駅名"] || !Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0) continue;
    if (/撤去|廃止/.test(r["備考"])) continue;
    const id = `tokyo-st-${r["管理者種別番号"]}-${r["鉄道駅通し番号"]}-${r["鉄道駅内トイレ通し番号"]}`;
    places.push({
      id,
      kind: "toilet",
      name: `${r["鉄道会社名"]} ${r["鉄道駅名"]}駅 ${r["トイレ名"]}`.trim(),
      lat,
      lon,
      tier: "official",
      source: {
        name: "東京都「都内鉄道駅における車椅子使用者対応トイレのバリアフリー設備情報（令和7年度更新版）」",
        license: "CC-BY-4.0",
        url: URL,
        ref: id,
      },
      checkedAt: r["データの変更年月"] || r["データの作成年月"] || undefined,
      station: r["鉄道駅名"],
      floor: r["設置フロア"] || undefined,
      gate: gateOf(`${r["備考"]} ${r["トイレ名"]}`),
      hoursText: hoursOf(r),
      note: r["備考"] || undefined,
      toilet: {
        accessible: true,
        ostomate: mark(r["オストメイト用設備がある"]),
        changingTable: mark(r["乳幼児用おむつ交換台等を備えている"]),
        level: r["設置フロア"] || undefined,
      },
    });
  }
  // 同じ駅の別のトイレと座標がまったく同じなら、トイレごとの位置ではなく駅の代表点とみなす
  const key = (p: Place) => `${p.station}|${p.lat},${p.lon}`;
  const shared = new Map<string, number>();
  places.forEach((p) => shared.set(key(p), (shared.get(key(p)) ?? 0) + 1));
  places.forEach((p) => {
    if ((shared.get(key(p)) ?? 0) > 1) p.approxLocation = true;
  });

  const out = {
    fetchedFrom: URL,
    attribution: "出典：東京都「車椅子使用者対応トイレのバリアフリー情報」（CC BY 4.0）を加工して作成",
    places,
  };
  await writeFile("data/places/official-tokyo-station-toilets.json", JSON.stringify(out, null, 1) + "\n");
  const count = (g: Gate) => places.filter((p) => p.gate === g).length;
  console.log(`${places.length}件（改札内 ${count("inside")}・改札外 ${count("outside")}・不明 ${count("unknown")}）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
