// サーバー側でだけ使う。data/places/*.json と data/stations/*.json をまとめて読む
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Place } from "./places";
import type { Station } from "./station-mode";

let cache: Place[] | null = null;

export async function loadPlaces(): Promise<Place[]> {
  if (cache) return cache;
  const dir = path.join(process.cwd(), "data", "places");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  const all: Place[] = [];
  for (const f of files) {
    const json = JSON.parse(await readFile(path.join(dir, f), "utf8")) as { places: Place[] };
    all.push(...json.places);
  }
  cache = mergeSame(all);
  return cache;
}

// 別の出典で同じ場所（sameAs）は1件にする。名前・営業時間・確認日は相手（東京都の公式データなど）を残し、
// こちらにしかない改札の内外を足す。位置はどちらも実際の位置なので、相手のまま
export function mergeSame(all: Place[]): Place[] {
  const byId = new Map(all.map((p) => [p.id, p]));
  const out: Place[] = [];
  for (const p of all) {
    const target = p.sameAs ? byId.get(p.sameAs) : undefined;
    if (!target) {
      out.push(p);
      continue;
    }
    if ((!target.gate || target.gate === "unknown") && p.gate && p.gate !== "unknown") target.gate = p.gate;
    target.note = [target.note, `国交省の屋内地図にも同じトイレ（${p.source.name}）`].filter(Boolean).join(" / ");
  }
  return out;
}

let stationCache: Station[] | null = null;

export async function loadStations(): Promise<Station[]> {
  if (stationCache) return stationCache;
  const dir = path.join(process.cwd(), "data", "stations");
  const all: Station[] = [];
  const seen = new Set<string>();
  for (const f of (await readdir(dir)).filter((x) => x.endsWith(".json"))) {
    for (const s of (JSON.parse(await readFile(path.join(dir, f), "utf8")) as { stations: (Station & { ref?: string })[] }).stations) {
      // 地域の重なりで同じ駅が2回入らないように
      const key = s.ref ?? `${s.name}|${s.lat},${s.lon}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(s);
    }
  }
  stationCache = all;
  return all;
}
