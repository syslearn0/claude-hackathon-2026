import { NextResponse } from "next/server";
import { loadPlaces } from "@/lib/data";

// 場所データを丸ごと返す。利用者の位置は受け取らず、近くを探す計算は端末の中で行う
export async function GET() {
  const places = await loadPlaces();
  return NextResponse.json(
    { places, attribution: "© OpenStreetMap contributors (ODbL 1.0)" },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
