// 現地確認の記録（/tools/survey の書き出し）を「現地確認済み」の場所データにする。
// 使い方：書き出したファイルを data/private/survey/ に置いて npx tsx scripts/import-survey.ts
// 入力の生ファイルは公開しない（調査した人の呼び名などを含む）。出力には呼び名を入れない。
// 出力：data/places/verified-survey.json

import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Gate, Place, StoreType } from "../src/lib/places";
import { STORE_ITEMS } from "../src/lib/survey-fields";

const IN_DIR = "data/private/survey";
const STATION_DIR = "data/stations";
const OUT = "data/places/verified-survey.json";

type Pos = { lat: number; lon: number; accuracy: number };
type SurveyRecord = {
  id: string;
  kind: "toilet" | "store";
  checkedAt: string;
  values: Record<string, unknown>;
};
type Station = { name: string; operator?: string; lat: number; lon: number };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (typeof v === "number" ? v : undefined);
const yn = (v: unknown) => (v === "あり" ? true : v === "なし" ? false : undefined);

const GATE: Record<string, Gate> = { 改札内: "inside", 改札外: "outside", "駅の外（街中）": "street" };
const STORE_TYPE: Record<string, StoreType> = {
  コンビニ: "convenience",
  ドラッグストア: "drugstore",
  駅ナカの売店: "station_kiosk",
};

export async function loadStations(): Promise<Station[]> {
  const all: Station[] = [];
  for (const f of await readdir(STATION_DIR)) {
    const json = JSON.parse(await readFile(path.join(STATION_DIR, f), "utf8")) as { stations: Station[] };
    all.push(...json.stations);
  }
  return all;
}

// 位置が取れなかった記録は、駅の位置で代用する（事業者名が合う駅を優先）
export function stationPos(stations: Station[], name?: string, operator?: string): Pos | undefined {
  if (!name) return undefined;
  const key = name.replace(/駅$/, "");
  const same = stations.filter((s) => s.name === key);
  if (same.length === 0) return undefined;
  const op = operator?.trim();
  const matched = op ? same.filter((s) => s.operator?.includes(op) || (s.operator && op.includes(s.operator))) : [];
  const pick = matched.length ? matched : same;
  const lat = pick.reduce((a, s) => a + s.lat, 0) / pick.length;
  const lon = pick.reduce((a, s) => a + s.lon, 0) / pick.length;
  return { lat, lon, accuracy: Infinity };
}

export function toPlace(r: SurveyRecord, stations: Station[]): Place | { skip: string } {
  const v = r.values;
  const own = v.pos as Pos | undefined;
  const fallback = own ? undefined : stationPos(stations, str(v.station), str(v.operator));
  const pos = own ?? fallback;
  if (!pos) return { skip: `${r.id}：位置も駅名からの位置も分からない（駅名「${str(v.station) ?? ""}」）` };

  const base = {
    id: `verified-${r.id}`,
    lat: pos.lat,
    lon: pos.lon,
    approxLocation: !own || undefined,
    tier: "verified" as const,
    source: { name: "現地確認（協力者）", license: "CC-BY-4.0", ref: r.id },
    checkedAt: r.checkedAt.slice(0, 10),
    station: str(v.station),
    gate: GATE[str(v.gate) ?? ""] ?? ("unknown" as Gate),
    minFromGate: num(v.minFromGate),
    note: str(v.note),
  };

  if (r.kind === "toilet") {
    const types = (v.types as string[] | undefined) ?? [];
    return {
      ...base,
      kind: "toilet",
      name: [str(v.operator), str(v.station) && `${str(v.station)}駅`, str(v.nearGate)].filter(Boolean).join(" ") || undefined,
      where: str(v.where),
      platform: str(v.platform),
      minFromPlatform: num(v.minFromPlatform),
      note: [str(v.note), str(v.mismatch) && `公式情報との食い違い：${str(v.mismatch)}`].filter(Boolean).join(" / ") || undefined,
      toilet: {
        // 種類は「入口で見えたもの」なので、書かれていないものは「なし」ではなく不明にする
        accessible: types.includes("多機能（だれでも）") || undefined,
        ostomate: types.includes("オストメイト対応") || undefined,
        sanitaryBoxMale: yn(v.sanitaryBoxMale),
        sanitaryBoxFemale: yn(v.sanitaryBoxFemale),
        soap: yn(v.soap),
        queue: str(v.queue) !== "見ていない" ? str(v.queue) : undefined,
        bench: str(v.bench),
        staffDesk: str(v.staff),
      },
    };
  }

  const stockIn = (v.stock as Record<string, string> | undefined) ?? {};
  const stock: Record<string, boolean> = {};
  for (const item of STORE_ITEMS) {
    const b = yn(stockIn[item]);
    if (b !== undefined) stock[item] = b;
  }
  const toiletAns = str(v.storeToilet);
  return {
    ...base,
    kind: "store",
    name: str(v.name),
    hoursText: str(v.hours),
    where: str(v.nearToilet) && `着替えられる場所：${str(v.nearToilet)}`,
    store: {
      storeType: STORE_TYPE[str(v.storeType) ?? ""] ?? "other",
      customerToilet: toiletAns === "お客が使える" ? true : toiletAns?.startsWith("使えない") || toiletAns === "ない" ? false : undefined,
      stock,
      aisle: str(v.aisle),
    },
  };
}

async function main() {
  const stations = await loadStations();
  let files: string[] = [];
  try {
    files = (await readdir(IN_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    // まだ記録が届いていない
  }
  // 同じ記録を何度書き出しても1件になるよう、元の ID でまとめる（新しいほうを残す）
  const byId = new Map<string, SurveyRecord>();
  for (const f of files) {
    const json = JSON.parse(await readFile(path.join(IN_DIR, f), "utf8")) as { records: SurveyRecord[] };
    for (const r of json.records) {
      const prev = byId.get(r.id);
      if (!prev || prev.checkedAt <= r.checkedAt) byId.set(r.id, r);
    }
  }
  const places: Place[] = [];
  for (const r of byId.values()) {
    const p = toPlace(r, stations);
    if ("skip" in p) console.warn("飛ばした：", p.skip);
    else places.push(p);
  }
  await writeFile(OUT, JSON.stringify({ attribution: "現地確認（協力者）", places }, null, 1) + "\n");
  console.log(`${files.length}ファイル → ${places.length}件（トイレ ${places.filter((p) => p.kind === "toilet").length}・店 ${places.filter((p) => p.kind === "store").length}）`);
}

if (process.argv[1]?.endsWith("import-survey.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
