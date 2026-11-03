import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

// 駅の屋内データ（試作）。位置は受け取らない
export async function GET(req: NextRequest) {
  const station = req.nextUrl.searchParams.get("station") ?? "";
  if (!/^[a-z-]+$/.test(station)) return NextResponse.json({ error: "station が不正です" }, { status: 400 });
  try {
    const dir = path.join(process.cwd(), "data", "indoor");
    const main = JSON.parse(await readFile(path.join(dir, `${station}.json`), "utf8"));
    // ほかの出典の屋内データ（<駅>-<出典>.json。例：国交省の shinjuku-mlit.json）があれば重ねる
    const extras = [];
    for (const f of await readdir(dir)) {
      if (f.startsWith(`${station}-`) && f.endsWith(".json")) extras.push(JSON.parse(await readFile(path.join(dir, f), "utf8")));
    }
    const body = {
      ...main,
      features: [...extras.flatMap((e) => e.features), ...main.features],
      attribution: [main.attribution, ...extras.map((e) => e.attribution)].join("／"),
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch {
    return NextResponse.json({ error: "この駅の屋内データはありません" }, { status: 404 });
  }
}
