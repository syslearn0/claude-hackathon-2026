// エージェントが使う道具。事実はすべてここから出す。
import type Anthropic from "@anthropic-ai/sdk";
import { loadPlaces, loadStations } from "../data";
import type { LatLon } from "../geo";
import { displayName, findNearby, type NearbyItem } from "../nearby";
import type { Place } from "../places";

export type ToolContext = {
  // 利用者が送った現在地（あれば）。道具の入力で位置が null のときに使う
  position?: LatLon;
  places?: Place[]; // テストで差し替えるため
  fetchImpl?: typeof fetch;
};

export type ToolOutput = { content: string; placeIds: string[]; isError?: boolean };

const TIER_JA = { verified: "現地確認済み", official: "公式データ", osm: "OSM（未確認）", report: "利用者の報告" } as const;
const GATE_JA = { inside: "改札内", outside: "改札外", street: "駅の外", unknown: "改札の内外は不明" } as const;

// AI に渡す形。分からない項目は入れない（「なし」と取り違えないため）
function summarize(p: Place, near?: NearbyItem) {
  const t = p.toilet;
  const s = p.store;
  return {
    id: p.id,
    name: displayName(p),
    kind: p.kind,
    trust: TIER_JA[p.tier],
    checked: p.checkedAt,
    ...(near && { walk_min: near.walkMin, meters: near.meters, direction: near.direction }),
    station: p.station,
    gate: p.gate ? GATE_JA[p.gate] : undefined,
    where: p.where,
    platform: p.platform,
    sec_from_platform: p.minFromPlatform,
    sec_from_gate: p.minFromGate,
    location_is_station_center: p.approxLocation,
    hours: p.hoursText ?? p.openingHours,
    accessible_toilet: t?.accessible,
    ostomate: t?.ostomate,
    sanitary_box_male: t?.sanitaryBoxMale,
    sanitary_box_female: t?.sanitaryBoxFemale,
    soap: t?.soap,
    bench: t?.bench,
    staff_desk: t?.staffDesk,
    store_type: s?.storeType,
    brand: s?.brand,
    customer_toilet: s?.customerToilet,
    stock_checked: s?.stock && Object.keys(s.stock).length ? s.stock : undefined,
    aisle: s?.aisle,
    note: p.note,
  };
}

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "find_station",
    description:
      "駅名から駅の位置（緯度経度）を調べる。利用者が駅名で場所を言ったとき、find_nearby_places の前に使う。駅の位置は東京23区と京都市の駅がある。トイレや店のデータがあるのは、新宿駅・東京駅・京都駅の周りと京阪 丹波橋〜出町柳沿線だけ。",
    input_schema: {
      type: "object",
      properties: { name: { type: "string", description: "駅名（「駅」は付けなくてよい）。例：新宿、祇園四条" } },
      required: ["name"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "find_nearby_places",
    description:
      "ある位置の近くのトイレ、またはコンビニ・ドラッグストア・駅ナカの売店を、近い順（確かな情報を優先）に返す。lat/lon が null なら利用者の現在地を使う。各場所の id は返答で [[place:ID]] として引用する。返ってこなかった項目は「不明」であり「なし」ではない。",
    input_schema: {
      type: "object",
      properties: {
        lat: { type: ["number", "null"], description: "緯度。null なら利用者の現在地" },
        lon: { type: ["number", "null"], description: "経度。null なら利用者の現在地" },
        kind: { type: "string", enum: ["toilet", "store"], description: "toilet＝トイレ、store＝替えを買える店" },
        accessible_only: { type: "boolean", description: "true なら多機能トイレ（個室で着替えられる）だけ。kind=toilet のときだけ意味がある" },
        limit: { type: "integer", description: "最大件数（1〜8）" },
      },
      required: ["lat", "lon", "kind", "accessible_only", "limit"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "get_place",
    description: "場所の id から、その場所の詳しい情報を返す。",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "get_train_status",
    description:
      "鉄道の運行情報（遅延・見合わせ）の文章を返す。いま取れるのは都営（浅草線・三田線・新宿線・大江戸線など）だけ。ほかの事業者は other を指定すると「取得できない」と返る。",
    input_schema: {
      type: "object",
      properties: { operator: { type: "string", enum: ["Toei", "other"] } },
      required: ["operator"],
      additionalProperties: false,
    },
    strict: true,
  },
];

export async function runTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput> {
  switch (name) {
    case "find_station": {
      const key = String(input.name ?? "").replace(/駅$/, "");
      const hits = (await loadStations()).filter((s) => s.name === key);
      if (hits.length === 0) return { content: JSON.stringify({ found: false, note: "この駅のデータはありません" }), placeIds: [] };
      return { content: JSON.stringify({ found: true, stations: hits }), placeIds: [] };
    }
    case "find_nearby_places": {
      const lat = typeof input.lat === "number" ? input.lat : ctx.position?.lat;
      const lon = typeof input.lon === "number" ? input.lon : ctx.position?.lon;
      if (lat === undefined || lon === undefined) {
        return { content: "位置が分かりません。利用者に駅名を聞くか、find_station を使ってください。", placeIds: [], isError: true };
      }
      const places = ctx.places ?? (await loadPlaces());
      const kind = input.kind === "store" ? "store" : "toilet";
      const limit = Math.min(8, Math.max(1, Number(input.limit) || 3));
      const items = findNearby(places, { from: { lat, lon }, kind, accessibleOnly: input.accessible_only === true, limit });
      return {
        content: JSON.stringify({
          results: items.map((x) => summarize(x.place, x)),
          note: items.length ? undefined : "1.5km 以内にデータがありません",
        }),
        placeIds: items.map((x) => x.place.id),
      };
    }
    case "get_place": {
      const places = ctx.places ?? (await loadPlaces());
      const p = places.find((x) => x.id === input.id);
      if (!p) return { content: "その id の場所はありません。", placeIds: [], isError: true };
      return { content: JSON.stringify(summarize(p)), placeIds: [p.id] };
    }
    case "get_train_status": {
      if (input.operator !== "Toei") {
        return { content: JSON.stringify({ available: false, note: "この路線の運行情報は取得できません" }), placeIds: [] };
      }
      try {
        const res = await (ctx.fetchImpl ?? fetch)(
          "https://api-public.odpt.org/api/v4/odpt:TrainInformation?odpt:operator=odpt.Operator:Toei",
          { signal: AbortSignal.timeout(5000) },
        );
        const rows = (await res.json()) as Record<string, unknown>[];
        const lines = rows.map((r) => ({
          railway: String(r["odpt:railway"] ?? "").split(".").pop(),
          text: (r["odpt:trainInformationText"] as Record<string, string> | undefined)?.ja,
          at: r["dc:date"],
        }));
        return { content: JSON.stringify({ source: "公共交通オープンデータセンター（都営）", lines }), placeIds: [] };
      } catch {
        return { content: "運行情報を取得できませんでした。", placeIds: [], isError: true };
      }
    }
    default:
      return { content: `知らない道具：${name}`, placeIds: [], isError: true };
  }
}
