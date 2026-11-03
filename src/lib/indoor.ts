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

// 屋内データのある駅（駅名 → ファイル名と範囲）。範囲は「駅の中に入った」の判定にも使う
export const INDOOR_STATIONS: Record<string, { key: string; bbox: [number, number, number, number] }> = {
  新宿: { key: "shinjuku", bbox: [35.6855, 139.696, 35.6935, 139.704] },
};

export function indoorAt(at: { lat: number; lon: number }): string | undefined {
  for (const [name, { bbox }] of Object.entries(INDOOR_STATIONS)) {
    const [s, w, n, e] = bbox;
    if (at.lat >= s && at.lat <= n && at.lon >= w && at.lon <= e) return name;
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
