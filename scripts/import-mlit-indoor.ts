// 国土地理院「階層別屋内地理空間情報データ仕様書」の形の屋内地図（Shapefile）を取り込む。
//   shinjuku / tokyo：国交省の駅周辺屋内地図オープンデータ（令和2年度更新版、G空間情報センター）。data/raw/mlit-<駅>/ に展開
//   oedo：都営大江戸線12駅の構内地図データ（国交省、ほこナビ。公共交通オープンデータチャレンジ2026 の期間中の限定公開）。
//         data/raw/hokonavi-oedo/<駅>/ に展開し、list.txt（駅の英字・駅名・ZIP の URL）を置く
// 使い方：npx tsx scripts/import-mlit-indoor.ts <shinjuku|tokyo|oedo>（元のファイルは公開しない。.gitignore 済み）
// 出力：
//   data/indoor/<駅>-<出典>.json …… 駅の中の地図（/api/indoor が OSM の <駅>.json と重ねて返す）
//   data/places/<出典>-<駅>-toilets.json …… トイレの場所（階・正確な位置つき。一覧と地図の候補に出る）
// 利用規約：政府標準利用規約（第2.0版）／公共データ利用規約（第1.0版）。出典と、加工したことを書く。国が作ったように見せない。
// 項目の意味は国土地理院「階層別屋内地理空間情報データ仕様書（案）」（平成30年3月）の別表による。
// 改札の内外（toll）は、ほぼすべて「無料」か「不明」で、改札の中は含まない。

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as shp from "shapefile";
import type { Gate, Place } from "../src/lib/places";

// 取り込む1つの単位（駅とデータの出典の組）
type Job = {
  dir: string;
  station: string; // アプリの駅名（station-mode・屋内地図の駅名）
  indoorOut: string;
  placesOut: string;
  idPrefix: string;
  placeName: string; // トイレの名前の頭（例：「東京駅周辺」「都営大江戸線 新宿駅」）
  url: string;
  sourceName: string;
  attribution: string;
  license: string;
  checkedAt: string; // データの作成（年月、"202008"）。画面では「2020年8月」
  noteFrom: string;
  allStation: boolean; // データ全体が駅の構内か（「有料」= 改札の中とみなせるか）
};
const GOV = "政府標準利用規約 第2.0版（CC BY 4.0 互換）";
const PDL = "公共データ利用規約 第1.0版（PDL1.0、CC BY 4.0 互換）";

function mlitJob(key: string, name: string, dataset: string, title: string): Job {
  const url = `https://www.geospatial.jp/ckan/dataset/${dataset}`;
  return {
    dir: `data/raw/mlit-${key}`,
    station: name,
    indoorOut: `data/indoor/${key}-mlit.json`,
    placesOut: `data/places/mlit-${key}-toilets.json`,
    idPrefix: `mlit-${key}`,
    placeName: `${name}駅周辺`,
    url,
    sourceName: `国土交通省 ${title}オープンデータ（令和2年度更新版）`,
    attribution: `出典：国土交通省 高精度測位社会プロジェクト／「${title}データ」（国土交通省）（${url}）を加工して作成`,
    license: GOV,
    checkedAt: "202008",
    noteFrom: "国交省の屋内地図（2020年8月時点）",
    allStation: false,
  };
}

// 大江戸線：list.txt の駅（英字 駅名 ZIP の URL）。屋内地図の駅のキーは、新宿だけ OSM・国交省の新宿と同じ "shinjuku" にして重ねる
async function oedoJobs(): Promise<Job[]> {
  const dir = "data/raw/hokonavi-oedo";
  const lines = (await readFile(`${dir}/list.txt`, "utf8")).trim().split("\n");
  return lines.map((l) => {
    const [slug, nameEki, zip] = l.trim().split(/\s+/);
    const name = nameEki.replace(/駅$/, "");
    const url = zip.replace(/\/resource\/.*$/, "");
    const key = slug === "shinjuku" ? "shinjuku" : slug;
    const title = `歩行空間ネットワークデータ（都営地下鉄大江戸線 ${name}駅）構内地図データ`;
    return {
      dir: `${dir}/${slug}`,
      station: name,
      indoorOut: `data/indoor/${key}-oedo.json`,
      placesOut: `data/places/oedo-${slug}-toilets.json`,
      idPrefix: `oedo-${slug}`,
      placeName: `都営大江戸線 ${name}駅`,
      url,
      sourceName: `国土交通省「${title}」`,
      attribution: `出典：国土交通省「${title}」（${url}）を加工して作成`,
      license: PDL,
      checkedAt: "202609",
      noteFrom: "大江戸線の構内地図（国交省、2026年9月）",
      allStation: true,
    };
  });
}

// ファイル名の階（"B1" "0" "2out" "B0.5"）→ 日本式の階。"0" は建物の外の地表（グランドレベル）なので 1F とする。
// "B0.5"（地下の中2階）は B1 に入れる（階のボタンは整数の階だけ）
const floorOf = (token: string) => {
  const m = token.match(/^(B?)(\d+(?:\.\d+)?)(?:out)?$/)!;
  return m[1] ? -Math.ceil(Number(m[2])) : Math.max(1, Math.floor(Number(m[2])));
};

// 1つの階のファイルの組。名前の付け方が2通りある（"<名前>_<階>_<種類>" と "<名前>_<種類>_<階>"）
type FloorFiles = { label: string; token: string; file: (layer: string) => string };

// フォルダの中を下までたどって、階ごとのファイルの組を集める
async function floorPrefixes(dir: string): Promise<FloorFiles[]> {
  const out: FloorFiles[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await floorPrefixes(p)));
    const a = e.name.match(/^(.*)_([^_]+)_Floor\.shp$/);
    const b = e.name.match(/^(.*)_Floor_([^_]+)\.shp$/);
    if (a) out.push({ label: `${a[1]}_${a[2]}`, token: a[2], file: (layer) => path.join(dir, `${a[1]}_${a[2]}_${layer}`) });
    else if (b) out.push({ label: `${b[1]}_${b[2]}`, token: b[2], file: (layer) => path.join(dir, `${b[1]}_${layer}_${b[2]}`) });
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
// 点が多角形の中か（[緯度, 経度] のまま）
function inside(p: [number, number], poly: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ai, bi] = poly[i];
    const [aj, bj] = poly[j];
    if (bi > p[1] !== bj > p[1] && p[0] < ((aj - ai) * (p[1] - bi)) / (bj - bi) + ai) hit = !hit;
  }
  return hit;
}
// 駅（JR・地下鉄・新宿ターミナル）の区画か。ビルの「有料」は改札ではないので、駅の区画でだけ「改札内」とする
const isStation = (pre: string) => /JRTokyoSta|ShinjukuTerminal|地下鉄/.test(pre);
function gateAt(at: [number, number], tolls: { toll: string; ring: [number, number][] }[], station: boolean): Gate {
  const hits = tolls.filter((t) => inside(at, t.ring)).map((t) => t.toll);
  if (station && hits.includes("2")) return "inside";
  if (hits.includes("3") && !hits.includes("2")) return "outside";
  return "unknown";
}
const meters = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 111_000, (a[1] - b[1]) * 91_000);
const center = (cs: [number, number][]): [number, number] => [cs.reduce((s, c) => s + c[0], 0) / cs.length, cs.reduce((s, c) => s + c[1], 0) / cs.length];

async function run(job: Job) {
  const prefixes = await floorPrefixes(job.dir);
  const features: Feature[] = [];
  const toilets: { floor: number; at: [number, number]; t: (typeof TOILET)[string]; gate: Gate }[] = [];
  const count: Record<string, number> = {};
  const add = (f: Feature) => {
    features.push(f);
    count[f.kind] = (count[f.kind] ?? 0) + 1;
  };

  for (const ff of prefixes) {
    const pre = ff.file("");
    const floor = floorOf(ff.token);
    const base = { levels: [ff.label], floors: [floor], floorBasis: "国交省データの階" };
    // 階の範囲（通路を含む、歩ける範囲の外形）を先に。部屋・店はこの上に重ねて描く
    for (const r of await read(ff.file("Floor"))) {
      rings(r.geometry).forEach((coords, i) => add({ id: `mlit-${r.properties.id}-${i}`, kind: "area", ...base, coords, closed: true, tags: { source: "mlit", category: "floor" } }));
    }
    // 有料施設（toll）：2 = 有料（駅では改札の中）、3 = 無料（改札の外）、1 = 不明。トイレの点がどの空間の中かで改札の内外を決める
    const tolls: { toll: string; ring: [number, number][] }[] = [];
    for (const r of await read(ff.file("Space"))) {
      const cat = String(r.properties.category ?? "");
      for (const ring of rings(r.geometry)) tolls.push({ toll: String(r.properties.toll ?? ""), ring });
      const kind = SPACE[cat];
      if (!kind || r.properties.nonpublic === "1") continue;
      rings(r.geometry).forEach((coords, i) =>
        add({ id: `mlit-${r.properties.id}-${i}`, kind, ...base, name: (r.properties.name as string) || SPACE_JA[cat], coords, closed: true, tags: { source: "mlit", category: cat } }),
      );
    }
    for (const r of await read(ff.file("Facility"))) {
      const cat = String(r.properties.category ?? "");
      if (r.geometry.type !== "Point") continue;
      const at = ll(r.geometry.coordinates as number[]);
      if (TOILET[cat]) toilets.push({ floor, at, t: TOILET[cat], gate: gateAt(at, tolls, job.allStation || isStation(pre)) });
      const kind = TOILET[cat] ? "toilet" : cat === "F106" ? "gate" : cat === "F108" || cat === "F017" ? "entrance" : undefined;
      if (kind) add({ id: `mlit-${r.properties.id}`, kind, ...base, name: (r.properties.name as string) || undefined, coords: [at], closed: false, tags: { source: "mlit", category: cat } });
    }
    // 開口部（出入口・改札の線）のうち、名前に「改札」があるものは改札として、名前つきで
    for (const r of await read(ff.file("Opening"))) {
      const name = String(r.properties.name ?? "");
      if (!name.includes("改札")) continue;
      for (const coords of lines(r.geometry)) add({ id: `mlit-${r.properties.id}`, kind: "gate", ...base, name, coords, closed: false, tags: { source: "mlit" } });
    }
  }

  // 改札の点（名前なし）は、近く（15m）に名前つきの改札の線があれば捨てる
  const named = features.filter((f) => f.kind === "gate" && f.name);
  const indoor = features.filter((f) => !(f.kind === "gate" && !f.name && named.some((n) => n.floors[0] === f.floors[0] && meters(center(n.coords), f.coords[0]) < 15)));

  await writeFile(
    job.indoorOut,
    JSON.stringify({ station: `${job.station}駅`, source: job.url, attribution: job.attribution, license: job.license, features: indoor }) + "\n",
  );

  // トイレの場所：同じ階で 15m 以内の男性・女性の点は1か所にまとめる。多機能トイレは別の場所にする
  // 改札の内と外にまたがってはまとめない
  const groups: { floor: number; at: [number, number]; ts: (typeof TOILET)[string][]; gate: Gate }[] = [];
  for (const x of toilets) {
    const g = groups.find((g) => g.floor === x.floor && g.gate === x.gate && !!g.ts[0].accessible === !!x.t.accessible && meters(g.at, x.at) < 15);
    if (g) g.ts.push(x.t);
    else groups.push({ floor: x.floor, at: x.at, ts: [x.t], gate: x.gate });
  }
  const fl = (n: number) => (n < 0 ? `B${-n}F` : `${n}F`);
  const places: Place[] = groups.map((g, i) => {
    const accessible = g.ts.some((t) => t.accessible);
    // 男女共用の個室（だれでもトイレのことが多いが、データが多機能と言っていないので多機能とは書かない）
    const sides = [g.ts.some((t) => t.male && !t.female) && "男性", g.ts.some((t) => t.female && !t.male) && "女性", g.ts.some((t) => t.male && t.female) && "男女共用"]
      .filter(Boolean)
      .join("・");
    return {
      id: `${job.idPrefix}-toilet-${i + 1}`,
      kind: "toilet",
      name: `${job.placeName} ${fl(g.floor)} ${accessible ? "多機能トイレ" : `トイレ${sides ? `（${sides}）` : ""}`}`,
      lat: g.at[0],
      lon: g.at[1],
      tier: "official",
      source: { name: job.sourceName, license: job.license, url: job.url },
      checkedAt: job.checkedAt,
      station: job.station,
      floor: fl(g.floor),
      gate: g.gate,
      note: `${job.noteFrom}にあるトイレ${g.gate === "unknown" ? "。改札の内外は地図からは分からない" : ""}`,
      toilet: {
        accessible: accessible || undefined,
        ostomate: g.ts.some((t) => t.ostomate) || undefined,
        changingTable: g.ts.some((t) => t.changingTable) || undefined,
      },
    };
  });
  // 東京都の公式データと同じトイレか：公式が多機能で、こちらが多機能か男女共用、階が同じ（片方が不明なら問わない）、20m 以内。
  // 位置が駅の代表の点しかない公式データとは比べない（どれと同じか決められないため）。同じなら sameAs で結び、読み込むときに1件にまとめる
  const official = (JSON.parse(await readFile("data/places/official-tokyo-station-toilets.json", "utf8")) as { places: Place[] }).places.filter(
    (o) => o.toilet?.accessible && !o.approxLocation,
  );
  const floorNum = (s?: string) => (s ? (s.match(/^B(\d+)/i) ? -Number(s.match(/^B(\d+)/i)![1]) : Number(s.match(/^(\d+)F/i)?.[1]) || undefined) : undefined);
  const taken = new Set<string>();
  let same = 0;
  for (const p of places.filter((x) => x.toilet?.accessible || /男女共用/.test(x.name ?? ""))) {
    const hit = official
      .filter((o) => !taken.has(o.id))
      .filter((o) => floorNum(o.floor) === undefined || floorNum(p.floor) === undefined || floorNum(o.floor) === floorNum(p.floor))
      .map((o) => ({ o, d: meters([o.lat, o.lon], [p.lat, p.lon]) }))
      .filter((x) => x.d <= 20)
      .sort((a, b) => a.d - b.d)[0];
    if (hit) {
      p.sameAs = hit.o.id;
      taken.add(hit.o.id);
      same++;
    }
  }
  console.log(`東京都の公式データと同じトイレ：${same}件（読み込むときに1件にまとめる）`);

  await writeFile(job.placesOut, JSON.stringify({ fetchedFrom: job.url, attribution: job.attribution, places }, null, 1) + "\n");

  console.log(`== ${job.placeName}`);
  console.log(`階：${prefixes.map((p) => p.label).join(" ")}`);
  console.log(`屋内の地物 ${indoor.length}件`, count);
  console.log(`トイレの場所 ${places.length}件（多機能 ${places.filter((p) => p.toilet?.accessible).length}）`);
  const byFloor: Record<string, number> = {};
  for (const p of places) byFloor[p.floor!] = (byFloor[p.floor!] ?? 0) + 1;
  console.log("階ごと", byFloor);
  const byGate: Record<string, number> = {};
  for (const p of places) byGate[p.gate!] = (byGate[p.gate!] ?? 0) + 1;
  console.log("改札の内外", byGate);
}

async function main() {
  const which = process.argv[2] ?? "shinjuku";
  const jobs =
    which === "shinjuku"
      ? [mlitJob("shinjuku", "新宿", "mlit-indoor-shinjuku-r2", "新宿駅周辺屋内地図")]
      : which === "tokyo"
        ? [mlitJob("tokyo", "東京", "mlit-indoor-tokyo-r2", "東京駅周辺屋内地図")]
        : which === "oedo"
          ? await oedoJobs()
          : [];
  if (!jobs.length) throw new Error("shinjuku / tokyo / oedo のどれか");
  for (const job of jobs) await run(job);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
