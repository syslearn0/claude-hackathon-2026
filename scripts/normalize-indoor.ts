// 屋内データの level を、日本式の階（1 = 1F、2 = 2F、-1 = B1。0 は無い）にそろえて floors / floorBasis を足す。
// 使い方：npx tsx scripts/normalize-indoor.ts [駅]（fetch-indoor のあとに実行。何度やっても同じ結果）
// 元の levels は触らない。

import { readFile, writeFile } from "node:fs/promises";

type F = {
  id: string;
  kind: string;
  levels: string[];
  name?: string;
  coords: [number, number][];
  closed: boolean;
  tags: Record<string, string>;
  floors?: number[];
  floorBasis?: string;
};

// 1) level:ref / addr:floor / level:name の階表記 → 日本式の階（読めなければ null）
// 例 "B1" "B1F" "地下1階" "1F" "2階" "1"（数字だけは日本式）。"1-9" は展開、"B1;1;2" は ; で区切る
function parseRef(s: string): number[] | null {
  const out: number[] = [];
  for (const p of s.split(/[;,]/).map((x) => x.trim()).filter(Boolean)) {
    const range = p.match(/^(\d+)\s*-\s*(\d+)$/);
    const b = p.match(/^(?:B|地下)\s*(\d+)\s*(?:F|階)?$/i);
    const n = p.match(/^(\d+)\s*(?:F|階)?$/i);
    if (range) for (let i = Number(range[1]); i <= Number(range[2]); i++) out.push(i);
    else if (b) out.push(-Number(b[1]));
    else if (n && Number(n[1]) > 0) out.push(Number(n[1]));
    else return null;
  }
  return out.length ? out : null;
}
const REF_KEYS = ["level:ref", "addr:floor", "level:name"];

// 2) OSM の level の数字 → 階。off はその建物の「ずれ」（0 = 既定：level 0 が 1F）
// 小数（0.5 = 踊り場など）は低いほうの階に寄せる。地下（負）には off をかけない
function levelNum(l: string): number | null {
  const b = l.match(/^B(\d+)F?$/i); // level に "B1" と書かれたもの
  if (b) return -Number(b[1]);
  const n = Number(l);
  return l.trim() !== "" && Number.isFinite(n) ? n : null;
}
function toFloor(n: number, off: number): number {
  const m = Math.floor(n);
  return m < 0 ? m : Math.max(1, m + 1 + off);
}

// 3) 建物ごとの「ずれ」。建物タグは取り込んでいないので、level と level:ref の両方を持つ地物（アンカー）を基準に、
//    RADIUS_M 以内で最も近いアンカーの off を、その周りの地物に当てる。
//    近くに off=0 のアンカーがあればそちらが優先されるので、隣の別ビルへ ずれ が漏れにくい。
const RADIUS_M = 80;
type Anchor = { f: F; at: [number, number]; off: number };
const center = (f: F): [number, number] => [
  f.coords.reduce((a, c) => a + c[0], 0) / f.coords.length,
  f.coords.reduce((a, c) => a + c[1], 0) / f.coords.length,
];
const meters = (a: [number, number], b: [number, number]) =>
  Math.hypot((a[0] - b[0]) * 111000, (a[1] - b[1]) * 111000 * Math.cos((a[0] * Math.PI) / 180));
function refOf(f: F): number[] | null {
  for (const k of REF_KEYS) if (f.tags[k]) return parseRef(f.tags[k]);
  return null;
}
function anchorOf(f: F): Anchor | null {
  const ref = refOf(f);
  if (!ref) return null;
  const lv = f.levels.map(levelNum);
  // level と level:ref が同じ並びで対応づくものだけ使う（"-1;0;1" と "B1;1;2" など）
  if (lv.length !== ref.length || lv.some((x) => x === null)) return null;
  for (let i = 0; i < lv.length; i++) {
    const n = lv[i]!;
    if (n >= 0 && Number.isInteger(n)) return { f, at: center(f), off: ref[i] - (n + 1) };
  }
  return null;
}

function normalize(features: F[]) {
  // 既定と違う ずれ は、近くの別のアンカーも同じ ずれ のときだけ使う。
  // 店1軒の書き方を周りに広げると、新南改札が南口（同じコンコース）と別の階になってしまったため
  const all = features.map(anchorOf).filter((a): a is Anchor => !!a);
  const anchors = all.filter(
    (a) => a.off === 0 || all.some((o) => o !== a && o.off === a.off && meters(o.at, a.at) <= RADIUS_M),
  );
  for (const f of features) {
    // 優先1：自分の level:ref
    const ref = refOf(f);
    if (ref) {
      f.floors = [...new Set(ref)].sort((a, b) => a - b);
      f.floorBasis = REF_KEYS.find((k) => f.tags[k])!;
      continue;
    }
    const lv = f.levels.map(levelNum);
    if (!lv.length || lv.some((x) => x === null)) {
      f.floors = [];
      f.floorBasis = "unknown";
      continue;
    }
    // 優先2：近くのアンカーのずれ
    const c = center(f);
    let best: Anchor | null = null;
    let bd = RADIUS_M;
    for (const a of anchors) {
      const d = meters(c, a.at);
      if (d <= bd) {
        best = a;
        bd = d;
      }
    }
    const off = best?.off ?? 0;
    f.floors = [...new Set(lv.map((n) => toFloor(n!, off)))].sort((a, b) => a - b);
    const half = lv.some((n) => !Number.isInteger(n!));
    const base = off === 0 ? "level 0=1F default" : `building rule: ${best!.f.name ?? best!.f.id} (${off === -1 ? "level n=nF, Japanese numbering" : `level 0=${1 + off}F`})`;
    f.floorBasis = half ? `${base}, half level rounded down` : base;
  }
}

const fl = (n: number) => (n < 0 ? `B${-n}` : `${n}F`);
const dist = (xs: string[]): [string, number][] => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => (Number(a[0]) || 999) - (Number(b[0]) || 999));
};
const line = (xs: [string, number][]) => xs.map(([k, n]) => `${k}:${n}`).join("  ");

async function main() {
  const station = process.argv[2] ?? "shinjuku";
  const file = `data/indoor/${station}.json`;
  const data = JSON.parse(await readFile(file, "utf8")) as { features: F[] };
  const fs = data.features;
  normalize(fs);
  await writeFile(file, JSON.stringify(data));

  const floorLabels = (f: F) => (f.floors!.length ? f.floors!.map(fl) : ["階不明"]);
  console.log("== 前（OSM level）\n" + line(dist(fs.flatMap((f) => (f.levels.length ? f.levels : ["なし"])))));
  const after = new Map<number, number>();
  let unknown = 0;
  for (const f of fs) {
    if (!f.floors!.length) unknown++;
    for (const n of f.floors!) after.set(n, (after.get(n) ?? 0) + 1);
  }
  console.log("== 後（階）\n" + [...after.entries()].sort((a, b) => a[0] - b[0]).map(([n, c]) => `${fl(n)}:${c}`).join("  ") + `  階不明:${unknown}`);
  console.log("== floorBasis");
  for (const [k, n] of dist(fs.map((f) => f.floorBasis!))) console.log(`  ${n}\t${k}`);
  console.log("== 既定以外のずれを当てたまとまり");
  const groups = new Map<string, F[]>();
  for (const f of fs) if (f.floorBasis!.startsWith("building rule")) groups.set(f.floorBasis!, [...(groups.get(f.floorBasis!) ?? []), f]);
  for (const [k, g] of groups) console.log(`  ${k}: ${g.length}件 例 ${g.filter((f) => f.name).slice(0, 4).map((f) => f.name).join("、")}`);
  console.log("== 改札・トイレの階");
  for (const kind of ["gate", "toilet"]) console.log(`  ${kind}: ` + line(dist(fs.filter((f) => f.kind === kind).map((f) => floorLabels(f).join("/")))));
  // JR 駅の中心部（改札・ホームのあたり）で、level 0 / 1 に分かれていた地物の行き先
  const jr = fs.filter((f) => {
    const [a, b] = center(f);
    return a > 35.6878 && a < 35.69 && b > 139.6995 && b < 139.7018 && f.levels.some((l) => l === "0" || l === "1");
  });
  console.log("== JR 駅中心部で level 0/1 だった地物の行き先（元 level → 階）");
  console.log("  " + line(dist(jr.map((f) => `${f.levels.join("|")}→${floorLabels(f).join("/")}`))));
}

main();
