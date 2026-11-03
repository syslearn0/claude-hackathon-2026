// 駅の屋内データ（OpenStreetMap の indoor / level）を取り込む。試作：まず新宿駅。
// 使い方：npx tsx scripts/fetch-indoor.ts
// 取り込んだあとは npm run normalize:indoor で階（floors）をそろえる
// 出力：data/indoor/<駅>.json（ODbL 1.0。表示時は「© OpenStreetMap contributors」）

import { mkdir, writeFile } from "node:fs/promises";

const AREAS: Record<string, { label: string; bbox: [number, number, number, number] }> = {
  shinjuku: { label: "新宿駅", bbox: [35.6855, 139.696, 35.6935, 139.704] },
};

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

type El = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  geometry?: { lat: number; lon: number }[];
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
  tags?: Record<string, string>;
};

export type IndoorFeature = {
  id: string;
  kind: "room" | "corridor" | "area" | "toilet" | "steps" | "elevator" | "escalator" | "gate" | "entrance" | "shop" | "platform";
  levels: string[]; // OSM の level の値（"0"、"-1"、"1;2" は ["1","2"]）
  name?: string;
  coords: [number, number][]; // [lat, lon]。点なら1つ
  closed: boolean; // 面か
  tags: Record<string, string>;
};

// 公開サーバーが混んでいても通るよう、範囲を小分けにし、面（部屋・通路）と点（トイレ・階段など）を別々に問い合わせる
function queries([s, w, n, e]: [number, number, number, number]): string[] {
  const tiles: string[] = [];
  const midLat = (s + n) / 2;
  const midLon = (w + e) / 2;
  for (const [a, b, c, d] of [
    [s, w, midLat, midLon],
    [s, midLon, midLat, e],
    [midLat, w, n, midLon],
    [midLat, midLon, n, e],
  ]) {
    const box = `${a},${b},${c},${d}`;
    tiles.push(`[out:json][timeout:120];(way["indoor"](${box});relation["indoor"](${box}););out geom;`);
    tiles.push(query(box));
  }
  return tiles;
}

function query(b: string): string {
  return `[out:json][timeout:120];
(
  nwr["amenity"="toilets"](${b});
  nwr["highway"="steps"]["level"](${b});
  nwr["highway"="elevator"](${b});
  way["highway"="footway"]["conveying"](${b});
  nwr["barrier"="turnstile"](${b});
  node["railway"="subway_entrance"](${b});
  node["entrance"](${b});
  way["railway"="platform"]["level"](${b});
  nwr["shop"]["level"](${b});
);
out geom;`;
}

function levelsOf(t: Record<string, string>): string[] {
  const raw = t.level ?? t["repeat_on"] ?? "";
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(";")) {
    const range = part.match(/^(-?\d+)-(-?\d+)$/);
    if (range) {
      for (let i = Number(range[1]); i <= Number(range[2]); i++) out.push(String(i));
    } else if (part.trim()) out.push(part.trim());
  }
  return out;
}

function kindOf(t: Record<string, string>): IndoorFeature["kind"] | null {
  if (t.amenity === "toilets") return "toilet";
  if (t.highway === "steps") return "steps";
  if (t.highway === "elevator") return "elevator";
  if (t.conveying) return "escalator";
  if (t.barrier === "turnstile") return "gate";
  if (t.railway === "subway_entrance" || t.entrance) return "entrance";
  if (t.railway === "platform") return "platform";
  if (t.shop) return "shop";
  if (t.indoor === "room") return "room";
  if (t.indoor === "corridor") return "corridor";
  if (t.indoor === "area" || t.indoor === "level") return "area";
  return null;
}

function toFeature(el: El): IndoorFeature | null {
  const t = el.tags ?? {};
  const kind = kindOf(t);
  if (!kind) return null;
  let coords: [number, number][] = [];
  if (el.type === "node" && el.lat !== undefined && el.lon !== undefined) coords = [[el.lat, el.lon]];
  else if (el.geometry) coords = el.geometry.map((g) => [g.lat, g.lon]);
  else if (el.members) {
    // 多角形の関係は、いちばん長い外側の線だけ使う（試作なので穴は無視）
    const outer = el.members.filter((m) => m.role === "outer" && m.geometry).sort((a, b) => b.geometry!.length - a.geometry!.length)[0];
    if (outer) coords = outer.geometry!.map((g) => [g.lat, g.lon]);
  }
  if (coords.length === 0) return null;
  const closed = coords.length > 3 && coords[0][0] === coords.at(-1)![0] && coords[0][1] === coords.at(-1)![1];
  return {
    id: `osm-${el.type}-${el.id}`,
    kind,
    levels: levelsOf(t),
    name: t["name:ja"] ?? t.name ?? t.ref,
    coords: coords.map(([a, b]) => [Math.round(a * 1e7) / 1e7, Math.round(b * 1e7) / 1e7]),
    closed,
    tags: Object.fromEntries(
      Object.entries(t).filter(([k]) => /^(level|level:ref|indoor|amenity|wheelchair|toilets:|operator|ref|name|highway|shop|railway|barrier|access|conveying|unisex|male|female|changing_table)/.test(k)),
    ),
  };
}

async function fetchJson(q: string): Promise<{ elements: El[] }> {
  let wait = 5000;
  for (let attempt = 0; attempt < 6; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": "toilet-companion-hackathon/0.1 (+https://github.com/syslearn0/claude-hackathon-2026)",
        },
        body: new URLSearchParams({ data: q }),
        signal: AbortSignal.timeout(150_000),
      });
      if (res.ok) return (await res.json()) as { elements: El[] };
      console.warn(`${endpoint} → ${res.status}。${wait / 1000}秒後に再試行`);
    } catch (e) {
      console.warn(`${endpoint} → ${(e as Error).message}。${wait / 1000}秒後に再試行`);
    }
    await new Promise((r) => setTimeout(r, wait));
    wait *= 2;
  }
  throw new Error("Overpass に繋がりませんでした");
}

async function main() {
  await mkdir("data/indoor", { recursive: true });
  for (const [key, area] of Object.entries(AREAS)) {
    // 小分けの結果をまとめる（タイルの境目で同じ要素が2回入るので、id で重ねない）
    const byId = new Map<string, IndoorFeature>();
    const qs = queries(area.bbox);
    for (const [i, q] of qs.entries()) {
      const json = await fetchJson(q);
      for (const el of json.elements) {
        const f = toFeature(el);
        if (f) byId.set(f.id, f);
      }
      console.log(`${i + 1}/${qs.length} 件目まで：${byId.size}件`);
    }
    const features = [...byId.values()];
    await writeFile(
      `data/indoor/${key}.json`,
      JSON.stringify({ station: area.label, bbox: area.bbox, fetchedAt: new Date().toISOString(), attribution: "© OpenStreetMap contributors (ODbL 1.0)", features }) + "\n",
    );
    const byKind: Record<string, number> = {};
    const byLevel: Record<string, number> = {};
    for (const f of features) {
      byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
      for (const l of f.levels.length ? f.levels : ["(なし)"]) byLevel[l] = (byLevel[l] ?? 0) + 1;
    }
    console.log(key, features.length, byKind);
    console.log("階ごと", Object.entries(byLevel).sort((a, b) => Number(a[0]) - Number(b[0])));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
