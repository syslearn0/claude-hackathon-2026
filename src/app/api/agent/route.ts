import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { describePlan, describeSituations, MODE_INSTRUCTIONS, type Mode } from "@/lib/agent/modes";
import { runAgent } from "@/lib/agent/run";
import { loadPlaces } from "@/lib/data";
import { RateLimiter } from "@/lib/rate-limit";

// エージェントに聞く。現在地は本文（POST）で受け取り、記録しない。
// ①の計画は駅ごとに道具を何度も呼ぶので長めに
export const maxDuration = 120;

// 1人（IP）10分に8回、全体で1日300回まで
const limiter = new RateLimiter({ max: 8, windowMs: 10 * 60_000 }, { max: 300, windowMs: 24 * 60 * 60_000 });

type Body = {
  mode?: Mode;
  message?: string;
  situations?: string[];
  conditions?: string[];
  profile?: string; // 自分の情報から、その場面に要る条件だけ（端末で作った文）
  position?: { lat: number; lon: number } | null;
};

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "サーバーに ANTHROPIC_API_KEY が設定されていません", code: "no_key" }, { status: 503 });
  }
  // IP は回数を数えるためだけに使い、記録しない
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const limited = limiter.check(ip);
  if (limited) {
    return NextResponse.json(
      { error: "短い時間に使いすぎています。少し待ってからもう一度試してください", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const mode = body.mode && body.mode in MODE_INSTRUCTIONS ? body.mode : undefined;
  const note = body.message?.trim() ?? "";
  if (note.length > 1000) return NextResponse.json({ error: "一言は1000文字までです" }, { status: 400 });
  const situations = Array.isArray(body.situations) ? body.situations.filter((s) => typeof s === "string") : [];
  const conditions = Array.isArray(body.conditions) ? body.conditions.filter((s) => typeof s === "string") : [];
  const userText =
    mode === "after" ? describeSituations(situations, note) : mode === "plan" ? describePlan(conditions, note) : note;
  if (!userText) return NextResponse.json({ error: "質問が空です" }, { status: 400 });
  const profile = typeof body.profile === "string" ? body.profile.slice(0, 300).trim() : "";

  const p = body.position;
  const position = p && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? { lat: p.lat, lon: p.lon } : undefined;

  try {
    const places = await loadPlaces();
    const result = await runAgent({
      userText: profile ? `${userText}\n${profile}` : userText,
      modeInstruction: mode ? MODE_INSTRUCTIONS[mode] : undefined,
      shape: mode === "plan" ? "plan" : "steps",
      context: { position, places },
    });
    const byId = new Map(places.map((x) => [x.id, x]));
    return NextResponse.json(
      {
        answer: result.answer,
        places: result.citedIds.map((id) => byId.get(id)).filter(Boolean),
        ok: result.ok,
        toolCalls: result.toolCalls.map((t) => t.name),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "混み合っています。少し待ってからもう一度試してください", code: "upstream_busy" }, { status: 429 });
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `AI の呼び出しに失敗しました（${error.status ?? "接続"}）`, code: "upstream_error" }, { status: 502 });
    }
    throw error;
  }
}
