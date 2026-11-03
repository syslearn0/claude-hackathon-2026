// OpenStreetMap の通路（歩道・通路・階段・エスカレーター・エレベーター・ホーム）から、経路の案内に使う歩行ネットワークを作る。
// 国交省の歩行空間ネットワークがない駅（京都駅など）のため。出力は scripts/import-network.ts と同じ形。
// 使い方：npx tsx scripts/fetch-osm-network.ts kyoto
// 出力：data/network/<駅>.json（OSM から作ったデータベースなので ODbL 1.0。「© OpenStreetMap contributors」を出す）
//
// 階の決め方：通路の level（0 = 1F、-1 = B1 と読む。src/lib/indoor.ts の osmLevelFloor と同じ）。
// 階段・エスカレーターは level が "0;1" のように両方の階を持つので、端の点がつながる通路の階から、どちらの端がどの階かを決める。
// エレベーター（highway=elevator の点）は、level の階ごとに点を分け、エレベーターの線でつなぐ。

import { writeFile } from "node:fs/promises";
import { osmLevelFloor } from "../src/lib/indoor";

const AREAS: Record<string, { station: string; bbox: [number, number, number, number] }> = {
  kyoto: { station: "京都", bbox: [34.9835, 135.754, 34.9895, 135.763] },
  ochanomizu: { station: "御茶ノ水", bbox: [35.6955, 139.76, 35.7035, 139.77] },
};
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const KIND = { walk: 0, stairs: 1, escalator: 2, elevator: 3, slope: 4 } as const;

type OsmNode = { type: "node"; id: number; lat: number; lon: number; tags?: Record<string, string> };
type OsmWay = { type: "way"; id: number; nodes: number[]; tags?: Record<string, string> };

async function overpass(q: string): Promise<(OsmNode | OsmWay)[]> {
  let wait = 5000;
  for (let attempt = 0; attempt < 8; attempt++) {
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
        signal: AbortSignal.timeout(200_000),
      });
      if (res.ok) return ((await res.json()) as { elements: (OsmNode | OsmWay)[] }).elements;
      console.warn(`${endpoint} → ${res.status}。${wait / 1000}秒後に再試行`);
    } catch (e) {
      console.warn(`${endpoint} → ${(e as Error).message}。${wait / 1000}秒後に再試行`);
    }
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 2, 60_000);
  }
  throw new Error("Overpass に繋がりませんでした");
}

const levelsOf = (t: Record<string, string> = {}): number[] =>
  (t.level ?? t.repeat_on ?? "")
    .split(";")
    .flatMap((p) => {
      const r = p.trim().match(/^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/);
      if (r) {
        const out: number[] = [];
        for (let i = Number(r[1]); i <= Number(r[2]); i++) out.push(i);
        return out;
      }
      return p.trim() ? [Number(p.trim())] : [];
    })
    .filter((n) => Number.isFinite(n))
    .map((n) => osmLevelFloor(String(n))!)
    .filter((n) => n !== undefined);

const meters = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => Math.hypot((a.lat - b.lat) * 111_000, (a.lon - b.lon) * 91_000);

async function main() {
  const key = process.argv[2] ?? "kyoto";
  const area = AREAS[key];
  if (!area) throw new Error(`駅は ${Object.keys(AREAS).join(" / ")} のどれか`);
  const [s, w, n, e] = area.bbox;
  const b = `${s},${w},${n},${e}`;
  const els = await overpass(`[out:json][timeout:180];
(
  way["highway"~"^(footway|corridor|steps|pedestrian|path|elevator)$"](${b});
  way["railway"="platform"](${b});
  way["public_transport"="platform"]["highway"](${b});
  node["highway"="elevator"](${b});
);
out body;
>;
out skel qt;`);
  const nodes = new Map<number, OsmNode>();
  const ways: OsmWay[] = [];
  for (const el of els) {
    if (el.type === "node") nodes.set(el.id, { ...(nodes.get(el.id) ?? {}), ...el, tags: el.tags ?? nodes.get(el.id)?.tags });
    else if (el.type === "way" && el.nodes.length > 1) ways.push(el);
  }

  const isVertical = (t: Record<string, string> = {}) => t.highway === "steps" || !!t.conveying || t.highway === "elevator";
  // 通路（階を1つだけ持つもの）が通る点の階
  const nodeFloors = new Map<number, Set<number>>();
  for (const wy of ways) {
    if (isVertical(wy.tags)) continue;
    const fl = levelsOf(wy.tags);
    const f = fl.length === 1 ? fl[0] : fl.length === 0 ? 1 : undefined; // level がなければ地上（1F）
    if (f === undefined) continue;
    for (const id of wy.nodes) {
      if (!nodeFloors.has(id)) nodeFloors.set(id, new Set());
      nodeFloors.get(id)!.add(f);
    }
  }

  // 出力の点：OSM の点 × 階
  const index = new Map<string, number>();
  const out: { nodes: [number, number, number][]; links: [number, number, number, number, number, number][] } = { nodes: [], links: [] };
  const vertex = (id: number, floor: number) => {
    const k = `${id}@${floor}`;
    let i = index.get(k);
    if (i === undefined) {
      const nd = nodes.get(id)!;
      i = out.nodes.length;
      index.set(k, i);
      out.nodes.push([Math.round(nd.lat * 1e6) / 1e6, Math.round(nd.lon * 1e6) / 1e6, floor]);
    }
    return i;
  };

  let skipped = 0;
  for (const wy of ways) {
    const t = wy.tags ?? {};
    const ids = wy.nodes.filter((id) => nodes.has(id));
    if (ids.length < 2) continue;
    const len = ids.slice(1).reduce((sum, id, i) => sum + meters(nodes.get(ids[i])!, nodes.get(id)!), 0);
    if (isVertical(t)) {
      // 階段・エスカレーター：端の点の階を、つながる通路から決める
      const fl = [...new Set(levelsOf(t))].sort((a, b) => a - b);
      const first = ids[0];
      const last = ids.at(-1)!;
      let fa: number | undefined;
      let fb: number | undefined;
      const fFirst = [...(nodeFloors.get(first) ?? [])];
      const fLast = [...(nodeFloors.get(last) ?? [])];
      if (fl.length >= 2) {
        const lo = fl[0];
        const hi = fl.at(-1)!;
        if (fFirst.includes(lo) || fLast.includes(hi)) [fa, fb] = [lo, hi];
        else if (fFirst.includes(hi) || fLast.includes(lo)) [fa, fb] = [hi, lo];
        else [fa, fb] = [lo, hi]; // 決められないときは、描かれた順に下から上
      } else if (fFirst.length && fLast.length) {
        // level がない階段：つながる通路の階どうしをつなぐ（同じ階なら段差のある通路として）
        fa = fFirst[0];
        fb = fLast[0];
      }
      if (fa === undefined || fb === undefined) {
        skipped++;
        continue;
      }
      const kind = t.highway === "elevator" ? KIND.elevator : t.conveying ? KIND.escalator : KIND.stairs;
      // エスカレーターの向き：forward は描かれた順、backward は逆。reversible は両方
      const oneway = kind === KIND.escalator && (t.conveying === "forward" || t.conveying === "backward" || t.conveying === "yes") ? 1 : 0;
      const [x, y] = t.conveying === "backward" ? [vertex(last, fb), vertex(first, fa)] : [vertex(first, fa), vertex(last, fb)];
      out.links.push([x, y, Math.round(len * 10) / 10, kind, oneway, 0]);
      continue;
    }
    const fl = levelsOf(t);
    const f = fl.length === 1 ? fl[0] : fl.length === 0 ? 1 : undefined;
    if (f === undefined) {
      skipped++;
      continue;
    }
    const kind = t.incline && t.highway !== "steps" ? KIND.slope : KIND.walk;
    for (let i = 1; i < ids.length; i++) {
      const d = meters(nodes.get(ids[i - 1])!, nodes.get(ids[i])!);
      out.links.push([vertex(ids[i - 1], f), vertex(ids[i], f), Math.round(d * 10) / 10, kind, 0, 0]);
    }
  }

  // エレベーターの点：level の階ごとの点を、エレベーターの線でつなぐ
  let elevators = 0;
  for (const nd of nodes.values()) {
    if (nd.tags?.highway !== "elevator") continue;
    const fl = [...new Set([...levelsOf(nd.tags), ...(nodeFloors.get(nd.id) ?? [])])].sort((a, b) => a - b);
    for (let i = 1; i < fl.length; i++) {
      out.links.push([vertex(nd.id, fl[i - 1]), vertex(nd.id, fl[i]), 0, KIND.elevator, 0, 0]);
      elevators++;
    }
  }

  const body = {
    station: area.station,
    sources: ["OpenStreetMap"],
    attribution: ["© OpenStreetMap contributors（ODbL 1.0）。OSM の通路・階段・エスカレーター・エレベーターから作成"],
    ...out,
  };
  await writeFile(`data/network/${key}.json`, JSON.stringify(body) + "\n");
  const kinds: Record<string, number> = {};
  for (const l of out.links) kinds[Object.keys(KIND)[l[3]]] = (kinds[Object.keys(KIND)[l[3]]] ?? 0) + 1;
  const floors: Record<string, number> = {};
  for (const nd of out.nodes) floors[nd[2]] = (floors[nd[2]] ?? 0) + 1;
  console.log(`${area.station}：点 ${out.nodes.length}・線 ${out.links.length}`, kinds, "エレベーターの階のつなぎ", elevators, "階が決まらず飛ばした線", skipped);
  console.log("階ごとの点", floors);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
