import { distanceM } from "./geo";
// 駅の屋内データ（OpenStreetMap の indoor、試作）。data/indoor/<key>.json を /api/indoor から受け取る。
// 階は scripts/normalize-indoor.ts が日本式（1 = 1F、-1 = B1）にそろえた floors を使う。

export type IndoorFeature = {
  id: string;
  kind: string;
  levels: string[];
  floors: number[];
  floorBasis: string;
  name?: string;
  coords: [number, number][];
  closed: boolean;
  tags: Record<string, string>;
};
export type Indoor = { station: string; bbox: [number, number, number, number]; features: IndoorFeature[]; attribution: string };

// 屋内データのある駅（駅名 → ファイル名と、データの範囲）。
// 「駅に入った」は、データの範囲（広め）ではなく、駅の中心から radiusM 以内で決める（範囲の端は屋内データが少ないため）
// mlit：国交省の屋内地図（G空間情報センターのデータセット名と題名）。出典の表示に使う
export const INDOOR_STATIONS: Record<
  string,
  { key: string; bbox: [number, number, number, number]; center: { lat: number; lon: number }; radiusM: number; mlit?: { dataset: string; title: string } }
> = {
  新宿: {
    key: "shinjuku",
    bbox: [35.6855, 139.696, 35.6935, 139.704],
    center: { lat: 35.6898, lon: 139.7004 },
    radiusM: 250,
    mlit: { dataset: "mlit-indoor-shinjuku-r2", title: "新宿駅周辺屋内地図データ" },
  },
  東京: {
    key: "tokyo",
    bbox: [35.6765, 139.7615, 35.6855, 139.7725],
    center: { lat: 35.6812, lon: 139.7671 },
    radiusM: 300,
    mlit: { dataset: "mlit-indoor-tokyo-r2", title: "東京駅周辺屋内地図データ" },
  },
};

export function indoorAt(at: { lat: number; lon: number }): string | undefined {
  for (const [name, { center, radiusM }] of Object.entries(INDOOR_STATIONS)) {
    if (distanceM(at, center) <= radiusM) return name;
  }
  return undefined;
}

export const floorLabel = (n: number) => (n < 0 ? `B${-n}` : `${n}F`);

// 場所データの「階」の書き方（"B1F" "2F" "3F（右）" "2F(北左)" "地下1階" "1階"）を日本式の階の数字に。
// 「ホーム」「改札階」「M2F（中2階）」など、決められないものは undefined
export function parseFloor(s?: string): number | undefined {
  if (!s) return undefined;
  const t = s.replace(/[（(].*?[）)]/g, "").trim();
  const b = t.match(/^(?:B|地下)\s*(\d+)\s*(?:F|階)?$/i);
  if (b) return -Number(b[1]);
  const n = t.match(/^(\d+)\s*(?:F|階)$/i);
  return n ? Number(n[1]) : undefined;
}

// OSM の level（"0" "-1" "0;1" "0.5"）を日本式の階に。駅の地図と同じく「0 = 1F」とみなす（建物によって違うので目安）
export function osmLevelFloor(level?: string): number | undefined {
  const n = Number(level?.split(";")[0]);
  if (!level?.trim() || !Number.isFinite(n)) return undefined;
  const m = Math.floor(n);
  return m < 0 ? m : m + 1;
}

// 点が多角形の中か（狭い範囲なので緯度経度のまま）
function inside(p: { lat: number; lon: number }, poly: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ai, bi] = poly[i];
    const [aj, bj] = poly[j];
    if (bi > p.lon !== bj > p.lon && p.lat < ((aj - ai) * (p.lon - bi)) / (bj - bi) + ai) hit = !hit;
  }
  return hit;
}

export type FloorGuess = { floor: number; basis: "data" | "osm" | "inside" };
export const FLOOR_BASIS_JA: Record<FloorGuess["basis"], string> = { data: "", osm: "OSM の記載から。目安", inside: "駅の地図から推定" };

// 場所の階。① 公式・現地確認の書き方（"B1F" など）② OSM の level（目安）③ 駅の地図の部屋・通路の中にあれば、その階（推定）
type Floored = { lat: number; lon: number; tier: string; floor?: string; toilet?: { level?: string } };
export function placeFloor(p: Floored, features: IndoorFeature[] = []): FloorGuess | undefined {
  const written = parseFloor(p.floor) ?? (p.tier !== "osm" ? parseFloor(p.toilet?.level) : undefined);
  if (written !== undefined) return { floor: written, basis: "data" };
  const osm = p.tier === "osm" ? osmLevelFloor(p.toilet?.level) : undefined;
  if (osm !== undefined) return { floor: osm, basis: "osm" };
  // 囲んでいる部屋・通路の階が1つに決まるときだけ（重なった階どうしで食い違えば決めない）
  const around = features.filter((f) => f.closed && f.floors.length > 0 && ["room", "corridor", "area", "platform", "shop"].includes(f.kind) && inside(p, f.coords));
  const floors = new Set(around.flatMap((f) => f.floors));
  return floors.size === 1 ? { floor: [...floors][0], basis: "inside" } : undefined;
}
