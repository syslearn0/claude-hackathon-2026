// OpenStreetMap からトイレ・コンビニ・ドラッグストアを取り込み、Place の形で保存する。
// 使い方：npx tsx scripts/fetch-osm.ts [地域名...]
// 出力：data/places/osm-<地域名>.json と data/stations/osm-<地域名>.json（ODbL 1.0。表示時は「© OpenStreetMap contributors」）
// STATION_AREAS は駅の位置だけを広く取る（トイレ・店のデータがない駅も「駅はある」と分かるように）

import { mkdir, writeFile } from "node:fs/promises";
import type { Place, StoreType } from "../src/lib/places";

type Area = { label: string; bbox: [number, number, number, number] }; // 南, 西, 北, 東

const AREAS: Record<string, Area> = {
  shinjuku: { label: "新宿駅周辺", bbox: [35.682, 139.69, 35.6975, 139.7085] },
  "keihan-tambabashi-demachiyanagi": {
    label: "京阪 丹波橋〜出町柳 沿線",
    bbox: [34.932, 135.76, 35.035, 135.785],
  },
  "tokyo-station": { label: "東京駅周辺", bbox: [35.6735, 139.757, 35.6885, 139.7755] },
  "kyoto-station": { label: "京都駅周辺", bbox: [34.979, 135.75, 34.992, 135.767] },
};

const STATION_AREAS: Record<string, Area> = {
  "stations-tokyo-23ku": { label: "東京23区の駅", bbox: [35.53, 139.56, 35.82, 139.92] },
  "stations-kyoto-city": { label: "京都市の駅", bbox: [34.88, 135.62, 35.08, 135.85] },
};

// 公開サーバーは混むことがあるので、順に試して間をあけて繰り返す
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

function query([s, w, n, e]: Area["bbox"], stationsOnly = false): string {
  const b = `${s},${w},${n},${e}`;
  if (stationsOnly) return `[out:json][timeout:90];nwr["railway"="station"](${b});out center tags;`;
  return `[out:json][timeout:90];
(
  nwr["amenity"="toilets"](${b});
  nwr["shop"="convenience"](${b});
  nwr["shop"="chemist"](${b});
  nwr["shop"="drugstore"](${b});
  nwr["amenity"="pharmacy"]["shop"!="chemist"](${b});
  nwr["railway"="station"](${b});
);
out center tags;`;
}

function yesNo(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  if (["yes", "designated", "limited", "customers"].includes(v)) return true;
  if (v === "no") return false;
  return undefined;
}

function storeTypeOf(t: Record<string, string>): StoreType | null {
  if (t.shop === "convenience") return "convenience";
  if (t.shop === "chemist" || t.shop === "drugstore") return "drugstore";
  // 調剤だけの薬局は、替えの用品が置いていないことが多いので除く
  if (t.amenity === "pharmacy" && t.dispensing !== "yes") return "drugstore";
  return null;
}

// OSM でコンビニとして登録されていても、下着などの替えを売っていない店（駅弁の店など）は外す
const NOT_FOR_SPARES = /駅弁|弁当|ベーカリー|パン屋|キヨスク菓子/;
export function notForSpares(t: Record<string, string>): boolean {
  return NOT_FOR_SPARES.test(`${t.name ?? ""} ${t["name:ja"] ?? ""} ${t.brand ?? ""}`);
}

function toPlace(el: OsmElement): Place | null {
  const t = el.tags ?? {};
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat === undefined || lon === undefined) return null;

  const base = {
    id: `osm-${el.type}-${el.id}`,
    name: t["name:ja"] ?? t.name,
    lat,
    lon,
    tier: "osm" as const,
    source: {
      name: "OpenStreetMap",
      license: "ODbL-1.0",
      url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      ref: `${el.type}/${el.id}`,
    },
    openingHours: t.opening_hours,
  };

  if (t.amenity === "toilets") {
    return {
      ...base,
      kind: "toilet",
      toilet: {
        accessible: yesNo(t.wheelchair),
        changingTable: yesNo(t.changing_table),
        fee: yesNo(t.fee),
        level: t.level,
      },
    };
  }

  const storeType = storeTypeOf(t);
  if (!storeType || notForSpares(t)) return null;
  return {
    ...base,
    kind: "store",
    store: {
      storeType,
      brand: t["brand:ja"] ?? t.brand,
      customerToilet: yesNo(t.toilets),
    },
  };
}

export type Station = { name: string; operator?: string; line?: string; lat: number; lon: number; ref: string };

function toStation(el: OsmElement): Station | null {
  const t = el.tags ?? {};
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  const name = t["name:ja"] ?? t.name;
  if (t.railway !== "station" || !name || lat === undefined || lon === undefined) return null;
  return { name: name.replace(/駅$/, ""), operator: t.operator, line: t.line, lat, lon, ref: `${el.type}/${el.id}` };
}

async function fetchArea(key: string, area: Area, stationsOnly = false): Promise<{ places: Place[]; stations: Station[] }> {
  let wait = 5000;
  for (let attempt = 0; attempt < 6; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "toilet-companion-hackathon/0.1 (+https://github.com/syslearn0/claude-hackathon-2026)",
        },
        body: new URLSearchParams({ data: query(area.bbox, stationsOnly) }),
        // 返事が来ないまま待ち続けないよう、2分で次のサーバーへ
        signal: AbortSignal.timeout(120_000),
      });
      if (res.ok) {
        const json = (await res.json()) as { elements: OsmElement[] };
        return {
          places: json.elements.map(toPlace).filter((p): p is Place => p !== null),
          stations: json.elements.map(toStation).filter((s): s is Station => s !== null),
        };
      }
      console.warn(`${key}: ${endpoint} → ${res.status}。${wait / 1000}秒後に再試行`);
    } catch (e) {
      console.warn(`${key}: ${endpoint} → ${(e as Error).message}。${wait / 1000}秒後に再試行`);
    }
    await new Promise((r) => setTimeout(r, wait));
    wait *= 2;
  }
  throw new Error(`${key}: Overpass に繋がりませんでした`);
}

function summary(places: Place[]) {
  const count = (f: (p: Place) => boolean) => places.filter(f).length;
  return {
    toilets: count((p) => p.kind === "toilet"),
    toiletsAccessible: count((p) => p.toilet?.accessible === true),
    convenience: count((p) => p.store?.storeType === "convenience"),
    drugstore: count((p) => p.store?.storeType === "drugstore"),
    storesWithHours: count((p) => p.kind === "store" && !!p.openingHours),
    storesWithToiletTag: count((p) => p.store?.customerToilet !== undefined),
  };
}

async function main() {
  const keys = process.argv.slice(2).length ? process.argv.slice(2) : [...Object.keys(AREAS), ...Object.keys(STATION_AREAS)];
  await mkdir("data/places", { recursive: true });
  await mkdir("data/stations", { recursive: true });
  for (const key of keys) {
    const stationsOnly = key in STATION_AREAS;
    const area = AREAS[key] ?? STATION_AREAS[key];
    if (!area) throw new Error(`知らない地域：${key}`);
    const { places, stations } = await fetchArea(key, area, stationsOnly);
    await writeFile(
      `data/stations/osm-${key}.json`,
      JSON.stringify({ attribution: "© OpenStreetMap contributors (ODbL 1.0)", stations }, null, 1) + "\n",
    );
    if (stationsOnly) {
      console.log(key, area.label, `駅 ${stations.length}`);
      continue;
    }
    const out = {
      area: { key, ...area },
      fetchedAt: new Date().toISOString(),
      attribution: "© OpenStreetMap contributors (ODbL 1.0)",
      places,
    };
    await writeFile(`data/places/osm-${key}.json`, JSON.stringify(out, null, 1) + "\n");
    console.log(key, area.label, summary(places), `駅 ${stations.length}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
