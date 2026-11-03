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
export const INDOOR_STATIONS: Record<string, { key: string; bbox: [number, number, number, number]; center: { lat: number; lon: number }; radiusM: number }> = {
  新宿: { key: "shinjuku", bbox: [35.6855, 139.696, 35.6935, 139.704], center: { lat: 35.6898, lon: 139.7004 }, radiusM: 250 },
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
