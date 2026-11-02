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
};

// 同じ距離なら、確かな段の情報を先に出す
const TIER_RANK: Record<Tier, number> = { verified: 0, official: 1, osm: 2, report: 3 };

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
    .sort((a, b) => a.walkMin - b.walkMin || TIER_RANK[a.place.tier] - TIER_RANK[b.place.tier] || a.meters - b.meters)
    .slice(0, limit);
}

export function displayName(p: Place): string {
  if (p.name) return p.name;
  if (p.kind === "toilet") return "公衆トイレ（名前の登録なし）";
  return p.store?.brand ?? "店（名前の登録なし）";
}
