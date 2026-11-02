import { LatLon, bearingDeg, directionJa, distanceM, walkMinutes } from "./geo";
import type { Place, PlaceKind, Tier } from "./places";

export type NearbyItem = {
  place: Place;
  meters: number;
  walkMin: number;
  direction: string;
};

export type NearbyQuery = {
  from: LatLon;
  kind: PlaceKind;
  limit?: number;
  maxMeters?: number;
  // 多機能トイレ（着替えられる）だけ
  accessibleOnly?: boolean;
  // 登録した条件に合うトイレを優先する（合わないものは並べるときだけ「分」を足す。外しはしない）
  preferAccessible?: boolean;
  preferOstomate?: boolean;
};

const PREFER_PENALTY_MIN = 4;

// 確かな情報ほど前に出す。改札の内外も分からない OSM のトイレが数十m近いだけで、
// 現地確認したトイレより上に来ないよう、並べるときだけ「分」を足して比べる（表示する分数はそのまま）
const TIER_PENALTY_MIN: Record<Tier, number> = { verified: 0, official: 1, osm: 3, report: 3 };

export function findNearby(places: Place[], q: NearbyQuery): NearbyItem[] {
  const limit = q.limit ?? 3;
  const maxMeters = q.maxMeters ?? 1500;
  return places
    .filter((p) => p.kind === q.kind)
    .filter((p) => !q.accessibleOnly || p.toilet?.accessible === true)
    .map((place) => {
      const meters = distanceM(q.from, place);
      return {
        place,
        meters: Math.round(meters),
        walkMin: walkMinutes(meters),
        direction: directionJa(bearingDeg(q.from, place)),
      };
    })
    .filter((x) => x.meters <= maxMeters)
    .sort((a, b) => rankMin(a, q) - rankMin(b, q) || a.meters - b.meters)
    .slice(0, limit);
}

function rankMin(x: NearbyItem, q: NearbyQuery): number {
  const t = x.place.toilet;
  const miss = (q.preferAccessible && t?.accessible !== true) || (q.preferOstomate && t?.ostomate !== true);
  return x.walkMin + TIER_PENALTY_MIN[x.place.tier] + (miss ? PREFER_PENALTY_MIN : 0);
}

export function displayName(p: Place): string {
  if (p.name) return p.name;
  if (p.kind === "toilet") return "公衆トイレ（名前の登録なし）";
  return p.store?.brand ?? "店（名前の登録なし）";
}
