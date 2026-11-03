// 「いまどこ？」：看板の写真から読んだ名前と GPS で、駅の中の「いそうな場所」の候補を2〜4か所に絞る。
// どの候補が写真と合うか（矢印・配置・向き）の判断は AI に任せるが、候補そのものはここで地図のデータから作る
// （AI が地図にない場所を答えないように）。AI には、それぞれの候補から見たまわりの様子を文で渡す。
import { bearingDeg, directionJa, distanceM, type LatLon } from "./geo";
import { floorLabel, type IndoorFeature } from "./indoor";
import { nearestNode, type Network } from "./route";

export type Landmark = LatLon & { name: string; kind: string; floor: number };
export type Candidate = LatLon & { id: string; node: number; floor: number; names: string[]; score: number; gpsM?: number; byGps?: boolean };
export type Gps = LatLon & { accuracy: number };

const KIND_JA: Record<string, string> = { gate: "改札", entrance: "出入口", shop: "店", room: "部屋", elevator: "エレベーター", escalator: "エスカレーター", steps: "階段", toilet: "トイレ" };
const UNNAMED_OK = new Set(["elevator", "escalator", "steps"]); // 名前がなくても、まわりの様子として役に立つもの

// 名前のある目印（と、名前がなくても目立つ上り下りの手段）。形の中心を位置にする
export function landmarks(features: IndoorFeature[]): Landmark[] {
  const out: Landmark[] = [];
  for (const f of features) {
    if (!(f.kind in KIND_JA) || !f.coords.length) continue;
    // 「不明」や管理用の番号（ESC_K-16-1 など）は、看板に出ない名前なので使わない
    const named = f.name && f.name !== "不明" && !/^[A-Za-z]+_[A-Za-z0-9_-]+$/.test(f.name) ? f.name : undefined;
    if (!named && !UNNAMED_OK.has(f.kind)) continue;
    // 階が分からない出入口は地上（1F）とみなす。ほかの階の分からないものは使わない
    const floor = f.floors[0] ?? (f.kind === "entrance" ? 1 : undefined);
    if (floor === undefined) continue;
    const lat = f.coords.reduce((a, p) => a + p[0], 0) / f.coords.length;
    const lon = f.coords.reduce((a, p) => a + p[1], 0) / f.coords.length;
    const name = named ?? KIND_JA[f.kind];
    if (out.some((x) => x.name === name && x.floor === floor && distanceM(x, { lat, lon }) < 10)) continue;
    out.push({ name, kind: f.kind, floor, lat, lon });
  }
  return out;
}

// 表記ゆれをならす（「新南口改札」「新南改札」→「新南」、「新宿駅A1出入口」→「a1」）
export function norm(s: string, station = ""): string {
  let t = s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s・()（）「」『』\-ー―]/g, "");
  if (station) t = t.replace(new RegExp(`^${station}(駅)?`), "");
  t = t.replace(/(出入口|出口|入口|exit)/g, ""); // 「出口 A10」も「A10出入口」も「a10」
  for (let i = 0; i < 3; i++) t = t.replace(/(改札口|改札|のりば|乗り場|方面|口|駅|gate)$/, "");
  return t;
}

// 読めた文字と目印の名前が合うか（0〜1）。「A1」と「A10」のような短い英数字は、ぴったりのときだけ
export function nameScore(text: string, name: string, station = ""): number {
  const a = norm(text, station);
  const b = norm(name, station);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const short = [a, b].find((x) => x.length === Math.min(a.length, b.length))!;
  if (short.length < 2 || (/^[a-z0-9]+$/.test(short) && short.length <= 4)) return 0;
  return a.includes(b) || b.includes(a) ? 0.6 : 0;
}

// 候補：読めた名前に合う目印のそば（同じ階で 30m 以内はひとつにまとめる）と、GPS が良ければ GPS のそばの地上
// floor：看板に出ていた今の階（「B1F」など）。分かればその階の候補に点を足す
export function candidates(net: Network, lms: Landmark[], texts: string[], station: string, gps?: Gps, floor?: number): Candidate[] {
  const spots: Omit<Candidate, "id">[] = [];
  const add = (lm: Landmark, score: number, name: string) => {
    const same = spots.find((c) => c.floor === lm.floor && distanceM(c, lm) < 30);
    if (same) {
      if (!same.names.includes(name)) {
        same.names.push(name);
        same.score += score;
      }
      return;
    }
    const node = nearestNode(net, lm, lm.floor);
    const n = net.nodes[node];
    if (n[2] !== lm.floor || distanceM(lm, { lat: n[0], lon: n[1] }) > 40) return; // 通路のデータから遠い目印は、そこまでの道が分からない
    spots.push({ lat: n[0], lon: n[1], node, floor: lm.floor, names: [name], score });
  };
  for (const t of texts) {
    for (const lm of lms) {
      if (lm.kind !== "elevator" && lm.kind !== "escalator" && lm.kind !== "steps") {
        const s = nameScore(t, lm.name, station);
        if (s > 0) add(lm, s, lm.name);
      }
    }
  }
  // GPS：地上なら精度 ±50m 以内のときだけ手がかりにする（地下では GPS はほぼ届かない）
  if (floor !== undefined) for (const c of spots) if (c.floor === floor) c.score += 0.5;
  const good = gps && gps.accuracy <= 50 ? gps : undefined;
  if (good) {
    const reach = Math.max(good.accuracy, 20) + 30;
    for (const c of spots) {
      c.gpsM = Math.round(distanceM(c, good));
      if (c.floor >= 0 && c.gpsM <= reach) c.score += 0.5;
    }
    // GPS のそばの地上の通路も候補に（看板が読めなかったとき・地上にいるとき）
    const node = nearestNode(net, good, 1);
    const n = net.nodes[node];
    const d = distanceM(good, { lat: n[0], lon: n[1] });
    if (n[2] === 1 && d <= reach && !spots.some((c) => c.floor === 1 && distanceM(c, { lat: n[0], lon: n[1] }) < 30)) {
      spots.push({ lat: n[0], lon: n[1], node, floor: 1, names: [], score: 0.4, gpsM: Math.round(d), byGps: true });
    }
  }
  return spots
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((c, i) => ({ ...c, id: "ABCD"[i] }));
}

// 候補から見たまわりの様子（AI に渡す文）。同じ階の 50m 以内の目印を、方角と距離で近い順に
export function describe(c: Candidate, lms: Landmark[], gps?: Gps): string {
  const near = lms
    .filter((l) => l.floor === c.floor)
    .map((l) => ({ l, d: distanceM(c, l) }))
    .filter((x) => x.d <= 50)
    .sort((a, b) => a.d - b.d)
    .slice(0, 12)
    .map(({ l, d }) => `${directionJa(bearingDeg(c, l))} ${Math.max(1, Math.round(d))}m：${l.name}（${KIND_JA[l.kind]}）`);
  const head = `候補${c.id}（${floorLabel(c.floor)}${c.byGps ? "・GPS の位置のそばの地上" : c.names.length ? `・${c.names.join("、")}のそば` : ""}）`;
  const g = c.gpsM !== undefined && gps ? `\n  GPS の位置から ${c.gpsM}m（GPS の精度 ±${Math.round(gps.accuracy)}m）` : "";
  return `${head}${g}\n${near.length ? near.map((s) => `  ${s}`).join("\n") : "  （まわりの目印のデータなし）"}`;
}

// 候補の短い呼び方（画面と「出発」の名前）
export const candidateLabel = (c: Candidate) => `${floorLabel(c.floor)}・${c.byGps ? "GPS の位置のそば（地上）" : c.names.length ? `${c.names.slice(0, 2).join("・")}のそば` : "このあたり"}`;
