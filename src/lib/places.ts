// トイレも店も同じ形で持つ：場所＋属性＋出典＋確認日。
// どの段（tier）から来た情報かを必ず残し、画面に出す。

export type Tier =
  | "osm" // 全国：OpenStreetMap
  | "official" // 公式のオープンデータ（東京都・区の CSV、ODPT など）
  | "verified" // 現地で確認した
  | "report"; // 利用者の報告（未確認・将来）

export type PlaceKind = "toilet" | "store";

export type StoreType = "convenience" | "drugstore" | "station_kiosk" | "other";

export type Gate = "inside" | "outside" | "street" | "unknown";

export type Source = {
  name: string; // 例："OpenStreetMap"
  license: string; // 例："ODbL-1.0"
  url?: string;
  ref?: string; // 元データでの ID（例："node/123"）
};

// 分からない項目は undefined のままにする（false と「不明」を混ぜない）
export type ToiletAttrs = {
  accessible?: boolean; // 多機能（車椅子対応）
  ostomate?: boolean;
  changingTable?: boolean;
  fee?: boolean;
  sanitaryBoxMale?: boolean;
  sanitaryBoxFemale?: boolean;
  soap?: boolean;
  level?: string; // 公式データの階（例："B1F"）。OSM の level は書き方が混ざるので画面には出さない
  queue?: string; // 見たときの行列（現地確認）
  bench?: string; // 近くで座れる場所
  staffDesk?: string; // 近い駅事務室・窓口
};

export type StoreAttrs = {
  storeType: StoreType;
  brand?: string;
  customerToilet?: boolean; // 客が使えるトイレ
  stock?: Record<string, boolean>; // 品目 → あり/なし（確認したものだけ）
  aisle?: string; // 売り場の場所
};

export type Place = {
  id: string;
  kind: PlaceKind;
  name?: string;
  lat: number;
  lon: number;
  tier: Tier;
  source: Source;
  checkedAt?: string; // ISO 日付。OSM は取り込み日ではなく不明扱い
  openingHours?: string; // OSM の opening_hours 形式のまま
  hoursText?: string; // 公式データ・現地確認の営業時間（人が読む文）
  approxLocation?: boolean; // 位置が取れず、駅の中心などで代用している
  station?: string;
  gate?: Gate;
  where?: string; // 場所の説明
  platform?: string; // 近いホーム・号車・階段
  minFromPlatform?: number; // 秒
  minFromGate?: number; // 秒
  note?: string;
  toilet?: ToiletAttrs;
  store?: StoreAttrs;
};
