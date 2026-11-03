// 国土交通省の駅周辺屋内地図オープンデータ（令和2年度更新版、Shapefile）を取り込む。いまは新宿駅と東京駅。
// 使い方：G空間情報センターから Shapefile の ZIP を取り、data/raw/mlit-<駅>/ に展開して npx tsx scripts/import-mlit-indoor.ts <shinjuku|tokyo>
//   （元のファイルは大きいので公開しない。.gitignore 済み）
// 出力：
//   data/indoor/<駅>-mlit.json …… 駅の中の地図（/api/indoor が OSM の <駅>.json と重ねて返す）
//   data/places/mlit-<駅>-toilets.json …… トイレの場所（階・正確な位置つき。一覧と地図の候補に出る）
// 利用規約：政府標準利用規約（第2.0版）。出典と、加工したことを書く。国が作ったように見せない。
// 項目の意味は国土地理院「階層別屋内地理空間情報データ仕様書（案）」（平成30年3月）の別表による。
// 改札の内外（toll）は、ほぼすべて「無料」か「不明」で、改札の中は含まない。

import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import * as shp from "shapefile";
import type { Place } from "../src/lib/places";

const STATIONS: Record<string, { name: string; dataset: string; title: string }> = {
  shinjuku: { name: "新宿", dataset: "mlit-indoor-shinjuku-r2", title: "新宿駅周辺屋内地図" },
  tokyo: { name: "東京", dataset: "mlit-indoor-tokyo-r2", title: "東京駅周辺屋内地図" },
};
const KEY = process.argv[2] ?? "shinjuku";
const ST = STATIONS[KEY];
if (!ST) throw new Error(`駅は ${Object.keys(STATIONS).join(" / ")} のどれか`);
const DIR = `data/raw/mlit-${KEY}`;
const URL = `https://www.geospatial.jp/ckan/dataset/${ST.dataset}`;
const ATTRIBUTION = `出典：国土交通省 高精度測位社会プロジェクト／「${ST.title}データ」（国土交通省）（${URL}）を加工して作成`;
const LICENSE = "政府標準利用規約 第2.0版（CC BY 4.0 互換）";

// ファイル名の最後の階（"…_B1" "…_0" "…_2out"）→ 日本式の階。"0" は建物の外の地表（グランドレベル）なので 1F とする
const floorOf = (prefix: string) => {
  const m = prefix.match(/_(B?)(\d+)(?:out)?$/)!;
  return m[1] ? -Number(m[2]) : Math.max(1, Number(m[2]));
};

// フォルダの中を下までたどって、階ごとのファイルの組（"<フォルダ>/<名前>_<階>"）を集める
async function floorPrefixes(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await floorPrefixes(p)));
    else if (e.name.endsWith("_Floor.shp")) out.push(p.replace(/_Floor\.shp$/, ""));
  }
  return out;
}

// 物理的な空間（別表 8.1.4）→ アプリの地物の種類。公開されていない空間・吹抜けは使わない
const SPACE: Record<string, string> = {
  B001: "shop",
  B002: "room", B003: "room", B004: "room", B005: "room", B006: "room", B015: "room", B016: "room", B017: "room", B018: "room", B019: "room", B027: "room",
  B007: "room", B008: "room", B009: "room", B010: "room", B011: "room", B012: "room", B013: "room", B014: "room",
  B021: "steps", B022: "elevator", B023: "escalator",
  B024: "corridor", B025: "corridor", B029: "corridor", B030: "corridor", B031: "corridor",
  B028: "platform", B999: "area",
};
const SPACE_JA: Record<string, string> = { B007: "トイレ（男性）", B008: "トイレ（女性）", B009: "トイレ（男女共用）", B010: "トイレ", B011: "多機能トイレ", B012: "多機能トイレ", B013: "多機能トイレ", B014: "多機能トイレ", B005: "きっぷ売り場", B006: "案内所", B018: "駅事務室", B016: "授乳室" };

// 設備 POI（別表 8.3.1）。トイレ・改札・出口だけを地図の印にする（階段・EV・エスカレーターは空間の形で描く）
const TOILET: Record<string, { label: string; male?: boolean; female?: boolean; accessible?: boolean; ostomate?: boolean; changingTable?: boolean }> = {
  F001: { label: "男性", male: true },
  F002: { label: "女性", female: true },
  F003: { label: "男女共用", male: true, female: true },
  F004: { label: "" },
  F005: { label: "多機能", accessible: true },
  F006: { label: "多機能", accessible: true, ostomate: true },
  F007: { label: "多機能", accessible: true, changingTable: true },
  F008: { label: "多機能", accessible: true, ostomate: true, changingTable: true },
};

type Feature = { id: string; kind: string; levels: string[]; floors: number[]; floorBasis: string; name?: string; coords: [number, number][]; closed: boolean; tags: Record<string, string> };
type Geo = { type: string; coordinates: unknown };
type Rec = { geometry: Geo; properties: Record<string, string | number | null> };

async function read(base: string): Promise<Rec[]> {
  try {
    const src = await shp.open(`${base}.shp`, `${base}.dbf`, { encoding: "utf-8" });
    const out: Rec[] = [];
    for (;;) {
      const r = await src.read();
      if (r.done) return out;
      out.push(r.value as Rec);
    }
  } catch {
    return []; // その階にこの種類のファイルがない
  }
}

// 経度・緯度の並びを、アプリの [緯度, 経度] に（小数6桁 ≒ 10cm で十分）
const ll = (c: number[]): [number, number] => [Math.round(c[1] * 1e6) / 1e6, Math.round(c[0] * 1e6) / 1e6];
// 面は外側の輪だけを使う（中の穴は描かない）
function rings(g: Geo): [number, number][][] {
  if (g.type === "Polygon") return [(g.coordinates as number[][][])[0].map(ll)];
  if (g.type === "MultiPolygon") return (g.coordinates as number[][][][]).map((p) => p[0].map(ll));
  return [];
}
function lines(g: Geo): [number, number][][] {
  if (g.type === "LineString") return [(g.coordinates as number[][]).map(ll)];
  if (g.type === "MultiLineString") return (g.coordinates as number[][][]).map((l) => l.map(ll));
  return [];
}
const meters = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 111_000, (a[1] - b[1]) * 91_000);
const center = (cs: [number, number][]): [number, number] => [cs.reduce((s, c) => s + c[0], 0) / cs.length, cs.reduce((s, c) => s + c[1], 0) / cs.length];

async function main() {
  const prefixes = await floorPrefixes(DIR);
  const features: Feature[] = [];
  const toilets: { floor: number; at: [number, number]; t: (typeof TOILET)[string] }[] = [];
  const count: Record<string, number> = {};
  const add = (f: Feature) => {
    features.push(f);
    count[f.kind] = (count[f.kind] ?? 0) + 1;
  };

  for (const pre of prefixes) {
    const floor = floorOf(pre);
    const base = { levels: [path.basename(pre)], floors: [floor], floorBasis: "国交省データの階" };
    // 階の範囲（通路を含む、歩ける範囲の外形）を先に。部屋・店はこの上に重ねて描く
    for (const r of await read(`${pre}_Floor`)) {
      rings(r.geometry).forEach((coords, i) => add({ id: `mlit-${r.properties.id}-${i}`, kind: "area", ...base, coords, closed: true, tags: { source: "mlit", category: "floor" } }));
    }
    for (const r of await read(`${pre}_Space`)) {
      const cat = String(r.properties.category ?? "");
      const kind = SPACE[cat];
      if (!kind || r.properties.nonpublic === "1") continue;
      rings(r.geometry).forEach((coords, i) =>
        add({ id: `mlit-${r.properties.id}-${i}`, kind, ...base, name: (r.properties.name as string) || SPACE_JA[cat], coords, closed: true, tags: { source: "mlit", category: cat } }),
      );
    }
    for (const r of await read(`${pre}_Facility`)) {
      const cat = String(r.properties.category ?? "");
      if (r.geometry.type !== "Point") continue;
      const at = ll(r.geometry.coordinates as number[]);
      if (TOILET[cat]) toilets.push({ floor, at, t: TOILET[cat] });
      const kind = TOILET[cat] ? "toilet" : cat === "F106" ? "gate" : cat === "F108" || cat === "F017" ? "entrance" : undefined;
      if (kind) add({ id: `mlit-${r.properties.id}`, kind, ...base, name: (r.properties.name as string) || undefined, coords: [at], closed: false, tags: { source: "mlit", category: cat } });
    }
    // 開口部（出入口・改札の線）のうち、名前に「改札」があるものは改札として、名前つきで
    for (const r of await read(`${pre}_Opening`)) {
      const name = String(r.properties.name ?? "");
      if (!name.includes("改札")) continue;
      for (const coords of lines(r.geometry)) add({ id: `mlit-${r.properties.id}`, kind: "gate", ...base, name, coords, closed: false, tags: { source: "mlit" } });
    }
  }

  // 改札の点（名前なし）は、近く（15m）に名前つきの改札の線があれば捨てる
  const named = features.filter((f) => f.kind === "gate" && f.name);
  const indoor = features.filter((f) => !(f.kind === "gate" && !f.name && named.some((n) => n.floors[0] === f.floors[0] && meters(center(n.coords), f.coords[0]) < 15)));

  await writeFile(
    `data/indoor/${KEY}-mlit.json`,
    JSON.stringify({ station: `${ST.name}駅`, source: URL, attribution: ATTRIBUTION, license: LICENSE, dataCreated: "2020-08", features: indoor }) + "\n",
  );

  // トイレの場所：同じ階で 15m 以内の男性・女性の点は1か所にまとめる。多機能トイレは別の場所にする
  const groups: { floor: number; at: [number, number]; ts: (typeof TOILET)[string][] }[] = [];
  for (const x of toilets) {
    const g = groups.find((g) => g.floor === x.floor && !!g.ts[0].accessible === !!x.t.accessible && meters(g.at, x.at) < 15);
    if (g) g.ts.push(x.t);
    else groups.push({ floor: x.floor, at: x.at, ts: [x.t] });
  }
  const fl = (n: number) => (n < 0 ? `B${-n}F` : `${n}F`);
  const places: Place[] = groups.map((g, i) => {
    const accessible = g.ts.some((t) => t.accessible);
    const sides = [g.ts.some((t) => t.male) && "男性", g.ts.some((t) => t.female) && "女性"].filter(Boolean).join("・");
    return {
      id: `mlit-${KEY}-toilet-${i + 1}`,
      kind: "toilet",
      name: `${ST.name}駅周辺 ${fl(g.floor)} ${accessible ? "多機能トイレ" : `トイレ${sides ? `（${sides}）` : ""}`}`,
      lat: g.at[0],
      lon: g.at[1],
      tier: "official",
      source: { name: `国土交通省 ${ST.title}オープンデータ（令和2年度更新版）`, license: LICENSE, url: URL },
      checkedAt: "202008", // データの作成（年月）。画面では「2020年8月」
      station: ST.name,
      floor: fl(g.floor),
      note: "改札の外の公共の通路・地下街の地図にあるトイレ（2020年8月時点）",
      toilet: {
        accessible: accessible || undefined,
        ostomate: g.ts.some((t) => t.ostomate) || undefined,
        changingTable: g.ts.some((t) => t.changingTable) || undefined,
      },
    };
  });
  await writeFile(`data/places/mlit-${KEY}-toilets.json`, JSON.stringify({ fetchedFrom: URL, attribution: ATTRIBUTION, places }, null, 1) + "\n");

  console.log(`階：${prefixes.map((p) => path.basename(p)).join(" ")}`);
  console.log(`屋内の地物 ${indoor.length}件`, count);
  console.log(`トイレの場所 ${places.length}件（多機能 ${places.filter((p) => p.toilet?.accessible).length}）`);
  const byFloor: Record<string, number> = {};
  for (const p of places) byFloor[p.floor!] = (byFloor[p.floor!] ?? 0) + 1;
  console.log("階ごと", byFloor);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
