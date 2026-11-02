import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

// 駅の屋内データ（試作）。位置は受け取らない
export async function GET(req: NextRequest) {
  const station = req.nextUrl.searchParams.get("station") ?? "";
  if (!/^[a-z-]+$/.test(station)) return NextResponse.json({ error: "station が不正です" }, { status: 400 });
  try {
    const raw = await readFile(path.join(process.cwd(), "data", "indoor", `${station}.json`), "utf8");
    return new NextResponse(raw, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } });
  } catch {
    return NextResponse.json({ error: "この駅の屋内データはありません" }, { status: 404 });
  }
}
