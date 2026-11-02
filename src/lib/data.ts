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
  cache = all;
  return all;
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
