// 吹き抜けの一覧（data/station-voids.json）の下書きを作る。下書きのあと、駅ごとに上から見た画面を見て、手で直す。
// 使い方：npx tsx scripts/draft-voids.ts 大門 麻布十番 …（駅を指定しなければ、大江戸線の駅すべて。すでにある駅は上書きしない。--force で上書き）
// 開けるところ：階段・エスカレーター（と、そのあいだの踊り場）が、上の階の床の下を通るところ。
// 線（段・エスカレーター・踊り場）ごとに、上がってくる階の床に、通り道を囲む四角を 1 つ（同じ線の上で続くものは 1 つに）。
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { KIND, type Network } from "../src/lib/route";

const OUT = "data/station-voids.json";
type Void = { floor: number; pts: [number, number][]; note: string };
const voids: Record<string, Void[]> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const force = process.argv.includes("--force");

const OEDO = ["都庁前", "新宿西口", "東新宿", "代々木", "国立競技場", "青山一丁目", "六本木", "麻布十番", "赤羽橋", "大門", "上野御徒町"];
const files = readdirSync("data/network").map((f) => ({ f, net: JSON.parse(readFileSync(`data/network/${f}`, "utf8")) as Network }));

for (const name of args.length ? args : OEDO) {
  if (voids[name] && !force) {
    console.log(name, "：すでにある（--force で上書き）");
    continue;
  }
  const net = files.find((x) => x.net.station === name)?.net;
  if (!net) {
    console.log(name, "：ネットワークがない");
    continue;
  }
  const lat0 = net.nodes[0][0];
  const lon0 = net.nodes[0][1];
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const P = (i: number) => ({ x: (net.nodes[i][1] - lon0) * kx, z: (net.nodes[i][0] - lat0) * 110_540, f: net.nodes[i][2] });
  const back = (x: number, z: number): [number, number] => [+(lat0 + z / 110_540).toFixed(7), +(lon0 + x / kx).toFixed(7)];
  // 段・エスカレーターと、階の途中の高さの通路（踊り場）
  const links = net.links.filter((l) => l[3] === KIND.stairs || l[3] === KIND.escalator || (l[3] === KIND.walk && net.nodes[l[0]][2] === net.nodes[l[1]][2] && !Number.isInteger(net.nodes[l[0]][2])));
  // 線ごとに、その階に上がってくる部分を細い四角にし（向きは線の向き）、すぐ横・すぐ先に並ぶもの（向きがそろい、1m 以内）だけを合わせる。
  // （まとめて大きな四角で囲むと、深い駅では関係のない線まで巻き込む）
  type Rect = { F: number; ox: number; oz: number; ux: number; uz: number; a0: number; a1: number; c0: number; c1: number; kinds: Set<string>; lo: number; hi: number };
  const fn = (f: number) => (f < 0 ? `B${-f}` : `${f}F`);
  const rects: Rect[] = [];
  const fs = links.flatMap((l) => [P(l[0]).f, P(l[1]).f]);
  for (let F = Math.ceil(Math.min(...fs) + 0.01); F <= Math.max(...fs); F++) {
    if (F === 0) continue;
    // この階の床を開けるのは、すぐ下の階からこの階へ上がってくる部分（高さが F-1 より上で F まで）だけ。
    // それより下の部分の上は、実際の駅でも床がある（下の階の吹き抜けで見える）
    for (const l of links) {
      const [a, b] = [P(l[0]), P(l[1])].sort((m, n) => m.f - n.f);
      const half = l[3] === KIND.escalator ? 0.75 : 1.4;
      let t0 = 0;
      let t1 = 1;
      if (a.f === b.f) {
        if (!(a.f > F - 1 && a.f < F)) continue;
      } else {
        t0 = Math.max(0, (F - 1 - a.f) / (b.f - a.f));
        t1 = Math.min(1, (F - a.f) / (b.f - a.f));
        if (t1 - t0 < 0.02) continue;
      }
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L * (t1 - t0) < 0.5) continue;
      const [ux, uz] = [(b.x - a.x) / L, (b.z - a.z) / L];
      const kind = l[3] === KIND.escalator ? "エスカレーター" : l[3] === KIND.stairs ? "階段" : "踊り場";
      rects.push({ F, ox: a.x, oz: a.z, ux, uz, a0: L * t0, a1: L * t1, c0: -half, c1: half, kinds: new Set([kind]), lo: a.f, hi: b.f });
    }
  }
  // 合わせる：同じ階、向きがそろう（逆向きも）、横と前後のすき間がどちらも 1m 以内
  const corners = (r: Rect) =>
    [
      [r.a0, r.c0],
      [r.a1, r.c0],
      [r.a1, r.c1],
      [r.a0, r.c1],
    ].map(([a, c]) => ({ x: r.ox + r.ux * a - r.uz * c, z: r.oz + r.uz * a + r.ux * c }));
  for (let merged = true; merged;) {
    merged = false;
    outer: for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const [r, q] = [rects[i], rects[j]];
        if (r.F !== q.F || Math.abs(r.ux * q.ux + r.uz * q.uz) < 0.97) continue;
        const cs = corners(q).map((p) => ({ a: (p.x - r.ox) * r.ux + (p.z - r.oz) * r.uz, c: (p.x - r.ox) * -r.uz + (p.z - r.oz) * r.ux }));
        const [qa0, qa1] = [Math.min(...cs.map((p) => p.a)), Math.max(...cs.map((p) => p.a))];
        const [qc0, qc1] = [Math.min(...cs.map((p) => p.c)), Math.max(...cs.map((p) => p.c))];
        const gapA = Math.max(qa0 - r.a1, r.a0 - qa1);
        const gapC = Math.max(qc0 - r.c1, r.c0 - qc1);
        // 合わせるのは、同じ線の上で続くもの（段と踊り場）だけ。横に並ぶ階段とエスカレーターを合わせると、
        // 先に上りきる階段の先まで床が抜けて、階段が床から離れて見える
        const sameLine = Math.abs((r.c0 + r.c1) / 2 - (qc0 + qc1) / 2) < 0.5;
        if (!sameLine || gapA > 1 || gapC > 1) continue;
        rects[i] = {
          ...r,
          a0: Math.min(r.a0, qa0),
          a1: Math.max(r.a1, qa1),
          c0: Math.min(r.c0, qc0),
          c1: Math.max(r.c1, qc1),
          kinds: new Set([...r.kinds, ...q.kinds]),
          lo: Math.min(r.lo, q.lo),
          hi: Math.max(r.hi, q.hi),
        };
        rects.splice(j, 1);
        merged = true;
        break outer;
      }
  }
  // 手で消すもの：新宿西口 B1.5 の広い踊り場は、データでは斜めに交わる通路の線の束（扇形）で、四角がばらばらに並ぶだけで
  // 吹き抜けの形にならない（平面図で確かめた）
  const drop = (r: Rect) => name === "新宿西口" && r.kinds.size === 1 && r.kinds.has("踊り場");
  const out: Void[] = rects
    .filter((r) => !drop(r))
    .filter((r) => r.a1 - r.a0 >= 1)
    .map((r) => ({
      floor: r.F,
      pts: corners(r).map((p) => back(p.x, p.z)),
      note: `${[...r.kinds].filter((k) => k !== "踊り場").join("・") || "踊り場"}（${fn(Math.floor(r.lo))}→${fn(r.F)}）の上`,
    }));
  voids[name] = out;
  console.log(name, out.length, "か所");
}
writeFileSync(OUT, JSON.stringify(voids, null, 1) + "\n");
