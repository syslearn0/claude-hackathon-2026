// 駅の中での案内。巨大な駅の中では「方角と直線距離」が当てにならないので、
// 分かっている事実（改札の内外・階・現地で測った分数）を見出しにする。
// 屋内の位置は取れないので、「いまどこ？」を利用者に1タップで選んでもらい、そこからの実測の分数で並べ替える。
import { distanceM, type LatLon } from "./geo";
import type { NearbyItem } from "./nearby";
import type { Place } from "./places";

export type Station = { name: string; operator?: string; lat: number; lon: number };

// この距離より駅に近ければ「駅の中か、すぐそば」とみなす
export const STATION_RADIUS_M = 250;

export function stationAt(stations: Station[], at: LatLon): string | undefined {
  let best: { name: string; d: number } | undefined;
  for (const s of stations) {
    const d = distanceM(at, s);
    if (d <= STATION_RADIUS_M && (!best || d < best.d)) best = { name: s.name, d };
  }
  return best?.name;
}

export type StationRef = { kind: "platform" | "gate"; label: string };

// 現地確認のデータに出てくるホームと改札を、「いまどこ？」の選択肢にする
export function stationRefs(places: Place[], station: string): StationRef[] {
  const refs = new Map<string, StationRef>();
  for (const p of places) {
    if (p.station !== station) continue;
    if (p.platform && p.minFromPlatform !== undefined) refs.set(`platform:${p.platform}`, { kind: "platform", label: p.platform });
    if (p.nearGate && p.minFromGate !== undefined) refs.set(`gate:${p.nearGate}`, { kind: "gate", label: p.nearGate });
  }
  return [...refs.values()];
}

// 選んだ場所からの実測の分数（秒）。測っていなければ undefined
export function measuredSec(p: Place, ref: StationRef): number | undefined {
  if (ref.kind === "platform") return p.platform === ref.label ? p.minFromPlatform : undefined;
  return p.nearGate === ref.label ? p.minFromGate : undefined;
}

// 実測の分数があるものを先に、短い順。ないものは元の順のまま後ろへ
export function rankFromRef(items: NearbyItem[], ref: StationRef): NearbyItem[] {
  const timed = items.filter((x) => measuredSec(x.place, ref) !== undefined);
  const rest = items.filter((x) => measuredSec(x.place, ref) === undefined);
  timed.sort((a, b) => measuredSec(a.place, ref)! - measuredSec(b.place, ref)!);
  return [...timed, ...rest];
}

const GATE_JA = { inside: "改札内", outside: "改札外", street: "駅の外" } as const;

const fmtSec = (s: number) => (s < 60 ? `約${s}秒` : `約${Math.round(s / 60)}分`);

// 見出し。駅の中なら事実の組み合わせ、駅の外なら方角と分数
export function headline(item: NearbyItem, station: string | undefined, ref?: StationRef): { main: string; sub?: string } {
  const p = item.place;
  // 駅の中の場所として扱うのは、その駅のデータか、位置が駅の代表点しかないものだけ。
  // 自分の座標を持つ駅の外の場所（路上の公衆トイレなど）は、駅のそばでも方角と分数で出す
  const inside = station !== undefined && (p.station === station || p.approxLocation === true);
  if (!inside) return { main: `${item.direction}へ 約${item.walkMin}分` };

  const parts: string[] = [];
  if (p.gate && p.gate !== "unknown") parts.push(GATE_JA[p.gate]);
  if (p.floor) parts.push(p.floor);
  const sec = ref ? measuredSec(p, ref) : undefined;
  if (sec !== undefined) parts.push(`${ref!.label}から${fmtSec(sec)}`);
  else if (p.minFromPlatform !== undefined) parts.push(`ホームの階段から${fmtSec(p.minFromPlatform)}`);
  else if (p.minFromGate !== undefined) parts.push(`改札から${fmtSec(p.minFromGate)}`);

  if (parts.length === 0) return { main: "駅の中（場所は下の説明を見て）", sub: "改札の内外・階はまだ分かりません" };
  return { main: parts.join("・"), sub: p.nearGate ? `${p.nearGate}の近く` : undefined };
}
