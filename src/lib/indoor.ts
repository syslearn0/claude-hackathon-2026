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
// sources：国交省などの屋内地図の出典（題名とページ）。地図の下の出典の表示に使う
type IndoorSource = { title: string; url: string };
const mlit = (title: string, dataset: string): IndoorSource => ({ title: `「${title}」（国土交通省）`, url: `https://www.geospatial.jp/ckan/dataset/${dataset}` });
// 都営大江戸線の構内地図（ほこナビ。公共交通オープンデータチャレンジ2026 の期間中の限定公開。公共データ利用規約 第1.0版）
const oedo = (name: string, url: string): IndoorSource => ({ title: `「歩行空間ネットワークデータ（都営地下鉄大江戸線 ${name}駅）」構内地図データ（国土交通省）`, url });

export const INDOOR_STATIONS: Record<
  string,
  { key: string; bbox: [number, number, number, number]; center: { lat: number; lon: number }; radiusM: number; sources: IndoorSource[] }
> = {
  新宿: {
    key: "shinjuku",
    bbox: [35.6855, 139.696, 35.6935, 139.704],
    center: { lat: 35.6898, lon: 139.7004 },
    radiusM: 250,
    sources: [mlit("新宿駅周辺屋内地図データ", "mlit-indoor-shinjuku-r2"), oedo("新宿", "https://ckan.hokonavi.go.jp/dataset/2d8ff84b-f110-41ad-b5e5-7b8ec9c6cb45")],
  },
  東京: {
    key: "tokyo",
    bbox: [35.6765, 139.7615, 35.6855, 139.7725],
    center: { lat: 35.6812, lon: 139.7671 },
    radiusM: 300,
    sources: [mlit("東京駅周辺屋内地図データ", "mlit-indoor-tokyo-r2")],
  },
  赤羽橋: {
    key: "akabanebashi",
    bbox: [35.6530, 139.7415, 35.6570, 139.7465],
    center: { lat: 35.65504, lon: 139.74398 },
    radiusM: 150,
    sources: [oedo("赤羽橋", "https://ckan.hokonavi.go.jp/dataset/b544bc33-b4bf-416c-949e-edc257989db0")],
  },
  都庁前: {
    key: "tochomae",
    bbox: [35.6886, 139.6903, 35.6926, 139.6953],
    center: { lat: 35.69061, lon: 139.69281 },
    radiusM: 150,
    sources: [oedo("都庁前", "https://ckan.hokonavi.go.jp/dataset/0497448d-15ca-44be-b27b-89d99f83c85d")],
  },
  麻布十番: {
    key: "azabu-juban",
    bbox: [35.6545, 139.7337, 35.6585, 139.7387],
    center: { lat: 35.65650, lon: 139.73616 },
    radiusM: 150,
    sources: [oedo("麻布十番", "https://ckan.hokonavi.go.jp/dataset/c12b859f-d53a-440c-99f7-7309ff851a8d")],
  },
  代々木: {
    key: "yoyogi",
    bbox: [35.6816, 139.6991, 35.6856, 139.7041],
    center: { lat: 35.68357, lon: 139.70160 },
    radiusM: 150,
    sources: [oedo("代々木", "https://ckan.hokonavi.go.jp/dataset/573faa86-9665-43e9-8435-4940f1749cd5")],
  },
  上野御徒町: {
    key: "ueno-okachimachi",
    bbox: [35.7060, 139.7708, 35.7100, 139.7758],
    center: { lat: 35.70798, lon: 139.77330 },
    radiusM: 150,
    sources: [oedo("上野御徒町", "https://ckan.hokonavi.go.jp/dataset/2e382ada-db20-4aa8-a48c-3cb8673c7db2")],
  },
  六本木: {
    key: "roppongi",
    bbox: [35.6616, 139.7295, 35.6656, 139.7345],
    center: { lat: 35.66358, lon: 139.73197 },
    radiusM: 150,
    sources: [oedo("六本木", "https://ckan.hokonavi.go.jp/dataset/dab17927-f6d9-4410-aaec-c5918860324c")],
  },
  東新宿: {
    key: "higashi-shinjuku",
    bbox: [35.6959, 139.7050, 35.6999, 139.7100],
    center: { lat: 35.69790, lon: 139.70754 },
    radiusM: 150,
    sources: [oedo("東新宿", "https://ckan.hokonavi.go.jp/dataset/e45cf561-c947-4d0c-95b5-b4c31207dc08")],
  },
  国立競技場: {
    key: "kokuritsu-kyogijo",
    bbox: [35.6781, 139.7114, 35.6821, 139.7164],
    center: { lat: 35.68010, lon: 139.71394 },
    radiusM: 150,
    sources: [oedo("国立競技場", "https://ckan.hokonavi.go.jp/dataset/1108976a-8642-452e-8d2e-ed2ca6a71f71")],
  },
  青山一丁目: {
    key: "aoyama-itchome",
    bbox: [35.6708, 139.7215, 35.6748, 139.7265],
    center: { lat: 35.67278, lon: 139.72402 },
    radiusM: 150,
    sources: [oedo("青山一丁目", "https://ckan.hokonavi.go.jp/dataset/ea3daead-46e4-41f8-a18e-e1f65f8835a6")],
  },
  大門: {
    key: "daimon",
    bbox: [35.6549, 139.7522, 35.6589, 139.7572],
    center: { lat: 35.65693, lon: 139.75471 },
    radiusM: 150,
    sources: [oedo("大門", "https://ckan.hokonavi.go.jp/dataset/a00afe74-d687-42d0-9ca3-65b111249063")],
  },
  // OSM だけの駅（国交省の屋内地図がない）。屋内の地図もネットワークも OSM の有志が描いた分だけ
  京都: {
    key: "kyoto",
    bbox: [34.9835, 135.754, 34.9895, 135.763],
    center: { lat: 34.9855, lon: 135.7588 },
    radiusM: 250,
    sources: [],
  },
  御茶ノ水: {
    key: "ochanomizu",
    bbox: [35.6955, 139.76, 35.7035, 139.77],
    center: { lat: 35.6996, lon: 139.765 },
    radiusM: 200,
    sources: [],
  },
  新宿西口: {
    key: "shinjuku-nishiguchi",
    bbox: [35.6911, 139.6967, 35.6951, 139.7017],
    center: { lat: 35.69314, lon: 139.69918 },
    radiusM: 150,
    sources: [oedo("新宿西口", "https://ckan.hokonavi.go.jp/dataset/4200135e-9754-4974-a371-bd47bdb6a530")],
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
