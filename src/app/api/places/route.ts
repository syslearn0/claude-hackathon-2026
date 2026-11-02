import { NextResponse } from "next/server";
import { loadPlaces, loadStations } from "@/lib/data";

// 場所データを丸ごと返す。利用者の位置は受け取らず、近くを探す計算は端末の中で行う
export async function GET() {
  const [places, stations] = await Promise.all([loadPlaces(), loadStations()]);
  return NextResponse.json(
    { places, stations },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
