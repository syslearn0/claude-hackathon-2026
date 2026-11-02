import { NextRequest, NextResponse } from "next/server";
import { loadPlaces } from "@/lib/data";
import { findNearby } from "@/lib/nearby";

// 位置は計算にだけ使い、記録しない
export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lon = Number(req.nextUrl.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "lat と lon が必要です" }, { status: 400 });
  }
  const places = await loadPlaces();
  const from = { lat, lon };
  return NextResponse.json(
    {
      toilets: findNearby(places, { from, kind: "toilet", limit: 3 }),
      changeRooms: findNearby(places, { from, kind: "toilet", accessibleOnly: true, limit: 1 }),
      stores: findNearby(places, { from, kind: "store", limit: 3 }),
      attribution: "© OpenStreetMap contributors (ODbL 1.0)",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
