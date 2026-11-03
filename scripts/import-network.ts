// 歩行空間ネットワークデータ（国交省「歩行空間ネットワークデータ整備仕様」）を、経路の案内に使う小さな形にする。
// 入力（どれも公開しない。.gitignore 済み）：
//   data/raw/mlit-shinjuku/nw, data/raw/mlit-tokyo/nw …… 国交省の屋内地図に付いているネットワーク（Shapefile、2020年）
//   data/raw/hokonavi-oedo-nw/<駅>/{node,link}.geojson …… 都営大江戸線の各駅（ほこナビ、2026年9月。チャレンジ期間中の限定公開）
// 出力：data/network/<駅>.json（駅ごとに1つ。新宿は国交省と大江戸線をつないで1つにする）
// 使い方：npx tsx scripts/import-network.ts
//
// 項目の読み方（整備仕様 2024年7月の表3.2・表3.8）
//   route_type：1 通常、2 動く歩道、3 踏切、4 エレベーター、5 エスカレーター、6 階段、7 スロープ
//   direction：1 両方向、2 起点→終点、3 終点→起点（仕様ではエスカレーターと動く歩道だけに使う）
//   lev_diff：1 0cm、2 2cm 以下、3 5cm 以下、4 10cm 以下、5 10cm より大きい
//   node の floor（ordinal）：階層数。0 は屋外の地上（1F として扱う）。中間階は "-0.5" のような小数

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import * as shp from "shapefile";

type RawNode = { id: string; lat: number; lon: number; floor: number; inOut: number };
type RawLink = { a: string; b: string; len: number; type: number; dir: number; levDiff: number; coords: [number, number][] };
type Source = { name: string; attribution: string; nodes: RawNode[]; links: RawLink[] };

// 出力の地物の種類（数字で持つ。src/lib/route.ts と同じ）
export const KIND = { walk: 0, stairs: 1, escalator: 2, elevator: 3, slope: 4, movingWalk: 5, crossing: 6 } as const;
const KIND_OF: Record<number, number> = { 1: KIND.walk, 2: KIND.movingWalk, 3: KIND.crossing, 4: KIND.elevator, 5: KIND.escalator, 6: KIND.stairs, 7: KIND.slope };

const num = (v: unknown, d = 0) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? d : Number(v));
// 階：0（屋外の地上）は 1F。それ以外は日本式のまま（-1 = B1、-0.5 = B1 と 1F の間）
const floorOf = (v: unknown) => {
  const n = num(v);
  return n === 0 ? 1 : n;
};
const ll = (c: number[]): [number, number] => [Math.round(c[1] * 1e6) / 1e6, Math.round(c[0] * 1e6) / 1e6];
const meters = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 111_000, (a[1] - b[1]) * 91_000);

type ShpRecord = { geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> };
async function readShp(base: string): Promise<ShpRecord[]> {
  const src = await shp.open(`${base}.shp`, `${base}.dbf`, { encoding: "utf-8" });
  const out: ShpRecord[] = [];
  for (;;) {
    const r = await src.read();
    if (r.done) return out;
    out.push(r.value as ShpRecord);
  }
}

function toLink(p: Record<string, unknown>, coords: [number, number][]): RawLink {
  return {
    a: String(p.start_id),
    b: String(p.end_id),
    len: num(p.distance),
    type: num(p.route_type, 1),
    dir: num(p.direction, 1),
    levDiff: num(p.lev_diff, 1),
    coords,
  };
}

async function mlitSource(dir: string, nodeFile: string, linkFile: string, name: string, attribution: string): Promise<Source> {
  const nodes = (await readShp(path.join(dir, nodeFile))).map(({ properties: p }) => ({
    id: String(p.node_id),
    lat: num(p.lat),
    lon: num(p.lon),
    floor: floorOf(p.ordinal ?? p.floor),
    inOut: num(p.in_out, 3),
  }));
  const links = (await readShp(path.join(dir, linkFile))).map(({ geometry, properties }) =>
    toLink(properties, geometry.type === "LineString" ? (geometry.coordinates as number[][]).map(ll) : []),
  );
  return { name, attribution, nodes, links };
}

async function oedoSource(dir: string, name: string, url: string): Promise<Source> {
  const nodes = (JSON.parse(await readFile(path.join(dir, "node.geojson"), "utf8")) as { features: { properties: Record<string, unknown> }[] }).features.map(
    ({ properties: p }) => ({ id: String(p.node_id), lat: num(p.lat), lon: num(p.lon), floor: floorOf(p.floor), inOut: num(p.in_out, 3) }),
  );
  const links = (
    JSON.parse(await readFile(path.join(dir, "link.geojson"), "utf8")) as { features: { geometry: { coordinates: number[][] }; properties: Record<string, unknown> }[] }
  ).features.map(({ geometry, properties }) => toLink(properties, geometry.coordinates.map(ll)));
  return {
    name: `都営大江戸線 ${name}駅`,
    attribution: `出典：「歩行空間ネットワークデータ（都営地下鉄大江戸線 ${name}駅）」（国土交通省）（${url}）を加工して作成`,
    nodes,
    links,
  };
}

// 出力：nodes [緯度, 経度, 階]、links [起点, 終点, 長さ(m), 種類, 一方通行(1 = 起点→終点だけ), 段差あり(1 = 2cm より大きい)]
type Out = { station: string; sources: string[]; attribution: string[]; nodes: [number, number, number][]; links: [number, number, number, number, number, number][] };

function build(station: string, sources: Source[]): Out {
  const index = new Map<string, number>();
  const nodes: [number, number, number][] = [];
  const links: Out["links"] = [];
  const firstOfSource: number[] = [];
  for (const s of sources) {
    firstOfSource.push(nodes.length);
    for (const n of s.nodes) {
      const key = `${s.name}|${n.id}`;
      if (index.has(key)) continue;
      index.set(key, nodes.length);
      nodes.push([Math.round(n.lat * 1e6) / 1e6, Math.round(n.lon * 1e6) / 1e6, n.floor]);
    }
    for (const l of s.links) {
      const a = index.get(`${s.name}|${l.a}`);
      const b = index.get(`${s.name}|${l.b}`);
      if (a === undefined || b === undefined || a === b) continue;
      const kind = KIND_OF[l.type] ?? KIND.walk;
      // 向きはエスカレーターと動く歩道だけ（仕様どおり）。3（終点→起点）は向きを入れ替える
      const oneway = (kind === KIND.escalator || kind === KIND.movingWalk) && (l.dir === 2 || l.dir === 3);
      const [x, y] = l.dir === 3 && oneway ? [b, a] : [a, b];
      // 長さが空（エレベーターなど）のときは、線の形か端の点の距離で補う
      const len =
        l.len > 0
          ? l.len
          : l.coords.length > 1
            ? l.coords.slice(1).reduce((t, c, i) => t + meters(l.coords[i], c), 0)
            : meters([nodes[a][0], nodes[a][1]], [nodes[b][0], nodes[b][1]]);
      links.push([x, y, Math.round(len * 10) / 10, kind, oneway ? 1 : 0, l.levDiff >= 3 ? 1 : 0]);
    }
  }
  // 出典どうしをつなぐ：違う出典の点で、同じ階・4m 以内なら歩く線でつなぐ（新宿の国交省と大江戸線など）
  let stitched = 0;
  for (let si = 1; si < sources.length; si++) {
    const from = firstOfSource[si];
    const to = si + 1 < sources.length ? firstOfSource[si + 1] : nodes.length;
    for (let i = from; i < to; i++) {
      for (let j = 0; j < from; j++) {
        if (nodes[i][2] !== nodes[j][2]) continue;
        const d = meters([nodes[i][0], nodes[i][1]], [nodes[j][0], nodes[j][1]]);
        if (d <= 4) {
          links.push([i, j, Math.round(d * 10) / 10, KIND.walk, 0, 0]);
          stitched++;
        }
      }
    }
  }
  if (sources.length > 1) console.log(`  出典どうしをつないだ線 ${stitched}本`);
  return { station, sources: sources.map((s) => s.name), attribution: sources.map((s) => s.attribution), nodes, links };
}

async function main() {
  await mkdir("data/network", { recursive: true });
  const jobs: { key: string; station: string; sources: Source[] }[] = [];
  const mlitAttr = (title: string, dataset: string) =>
    `出典：国土交通省 高精度測位社会プロジェクト／「${title}」（国土交通省）（https://www.geospatial.jp/ckan/dataset/${dataset}）を加工して作成`;
  const shinjuku = await mlitSource("data/raw/mlit-shinjuku/nw", "Shinjuku_node", "Shinjuku_link", "国交省 新宿駅周辺", mlitAttr("新宿駅周辺屋内地図データ", "mlit-indoor-shinjuku-r2"));
  const tokyo = await mlitSource("data/raw/mlit-tokyo/nw", "Tokyo_node", "Tokyo_Link", "国交省 東京駅周辺", mlitAttr("東京駅周辺屋内地図データ", "mlit-indoor-tokyo-r2"));
  const oedo: Record<string, Source> = {};
  const list = (await readFile("data/raw/hokonavi-oedo-nw/list.txt", "utf8")).trim().split("\n");
  for (const l of list) {
    const [slug, nameEki, zip] = l.trim().split(/\s+/);
    oedo[slug] = await oedoSource(`data/raw/hokonavi-oedo-nw/${slug}`, nameEki.replace(/駅$/, ""), zip.replace(/\/resource\/.*$/, ""));
  }
  jobs.push({ key: "shinjuku", station: "新宿", sources: [shinjuku, oedo.shinjuku] });
  jobs.push({ key: "tokyo", station: "東京", sources: [tokyo] });
  for (const [slug, s] of Object.entries(oedo)) if (slug !== "shinjuku") jobs.push({ key: slug, station: s.name.replace(/^都営大江戸線 |駅$/g, ""), sources: [s] });

  for (const j of jobs) {
    console.log(`== ${j.station}（${j.key}）`);
    const out = build(j.station, j.sources);
    const kinds: Record<string, number> = {};
    const names = Object.keys(KIND);
    for (const l of out.links) kinds[names[l[3]]] = (kinds[names[l[3]]] ?? 0) + 1;
    const floors = [...new Set(out.nodes.map((n) => n[2]))].sort((a, b) => a - b);
    console.log(`  点 ${out.nodes.length}・線 ${out.links.length}`, kinds, "階", floors.join(" "));
    await writeFile(`data/network/${j.key}.json`, JSON.stringify(out) + "\n");
  }
  const files = await readdir("data/network");
  console.log(`書き出し：data/network/ に ${files.length}ファイル`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
