import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { runAgent } from "@/lib/agent/run";
import { loadPlaces } from "@/lib/data";

// エージェントに聞く。現在地は本文（POST）で受け取り、記録しない。
// 場面ごとの指示（③トイレの後など）は、画面を作るときに mode として足す。
export const maxDuration = 60;

type Body = {
  message?: string;
  position?: { lat: number; lon: number } | null;
};

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "サーバーに ANTHROPIC_API_KEY が設定されていません" }, { status: 503 });
  }
  const body = (await req.json().catch(() => ({}))) as Body;
  const message = body.message?.trim();
  if (!message || message.length > 1000) {
    return NextResponse.json({ error: "message（1000文字まで）が必要です" }, { status: 400 });
  }
  const p = body.position;
  const position = p && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? { lat: p.lat, lon: p.lon } : undefined;

  try {
    const places = await loadPlaces();
    const result = await runAgent({ userText: message, context: { position, places } });
    const byId = new Map(places.map((x) => [x.id, x]));
    return NextResponse.json(
      {
        text: result.text,
        places: result.citedIds.map((id) => byId.get(id)).filter(Boolean),
        grounded: result.grounded,
        corrected: result.corrected,
        toolCalls: result.toolCalls.map((t) => t.name),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "混み合っています。少し待ってからもう一度試してください" }, { status: 429 });
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `AI の呼び出しに失敗しました（${error.status ?? "接続"}）` }, { status: 502 });
    }
    throw error;
  }
}
