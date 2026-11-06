// 改札の内と外を分ける壁を、駅ごとに前もって計算して data/station-walls.json に書き出す。
// 駅のネットワーク（data/network）や屋内データ（data/indoor）を変えたら、もう一度実行する（tests/gate-sides.test.ts が古いと知らせる）。
// 使い方：npx tsx scripts/build-walls.ts
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { stationPaidWalls, type IndoorFeatureLike, type WallLatLon } from "../src/lib/gates";
import { INDOOR_STATIONS } from "../src/lib/indoor";

// 公開しているファイルだけを使う（手元にだけある、コミットしていない屋内データは混ぜない）
const tracked = () =>
  new Set(
    execFileSync("git", ["ls-files", "data/indoor"], { encoding: "utf8" })
      .split(/\r?\n/)
      .map((f) => f.replace("data/indoor/", "")),
  );
const read = (f: string) => (JSON.parse(readFileSync(`data/indoor/${f}`, "utf8")).features as IndoorFeatureLike[]).filter((x) => Array.isArray(x.floors));

// /api/indoor と同じ重ね方（<駅>.json と <駅>-*.json）
export function stationInputs(key: string, files = tracked()) {
  const net = JSON.parse(readFileSync(`data/network/${key}.json`, "utf8"));
  const main = files.has(`${key}.json`) ? read(`${key}.json`) : [];
  const extras = [...files]
    .filter((f) => f.startsWith(`${key}-`) && f.endsWith(".json"))
    .sort()
    .flatMap(read);
  return { net, features: [...extras, ...main] };
}

export function buildWalls(): Record<string, WallLatLon[]> {
  const out: Record<string, WallLatLon[]> = {};
  for (const [name, s] of Object.entries(INDOOR_STATIONS)) {
    if (!existsSync(`data/network/${s.key}.json`)) continue;
    const { net, features } = stationInputs(s.key);
    out[name] = stationPaidWalls(net, features);
  }
  return out;
}

if (process.argv[1]?.includes("build-walls")) {
  const walls = buildWalls();
  writeFileSync("data/station-walls.json", JSON.stringify(walls) + "\n");
  for (const [k, v] of Object.entries(walls)) console.log(k, v.length);
}
