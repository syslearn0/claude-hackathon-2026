import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { MODEL, SUPPORTS_FALLBACK } from "@/lib/agent/run";
import { RateLimiter } from "@/lib/rate-limit";

// 「いまどこ？」：駅の中で撮った看板の写真から、いる場所を決める手伝い。2段で呼ぶ：
//   read  … 写真の看板の文字・矢印の向き・写っているものの配置を読む
//   judge … 端末が地図のデータから作った候補（候補から見た目印の方角と距離）と写真を比べて、合う候補と向きを選ぶ
// 候補は端末が地図から作る（AI が地図にない場所を答えないように）。写真・位置は記録しない。
export const maxDuration = 60;

// 1人（IP）10分に10回、全体で1日200回まで（1回の「いまどこ？」で2回使う）
const limiter = new RateLimiter({ max: 10, windowMs: 10 * 60_000 }, { max: 200, windowMs: 24 * 60 * 60_000 });

const DIRS = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];

const READ_SYSTEM = `駅の構内や駅前で撮った写真から、いる場所を探す手がかりを読み取ります。
- signs：写っている案内表示・看板の文字を、読めるものはすべて。改札の名前、出口の番号・名前、路線名、のりば、店の名前、階の表示など。
  where は写真の中の位置（左・中央・右）。arrow は、その文字に付いている矢印が指す向き（写真の中で 左・右・前・後ろ・上・下。矢印がなければ なし）。
- floor：看板に出ている今いる階の表示（例：B1F、2F）。なければ空の文字。
- scene：写真の左・中央・右に何があるか（改札、エスカレーター、階段、エレベーター、店、ホーム、通路、地上の道路など）を短く。
人の顔や、人を特定できることは書かないでください。`;

const JUDGE_SYSTEM = `駅の中で自分のいる場所が分からなくなった人を手伝います。
写真と、地図のデータから作った「候補」（それぞれの候補から見た目印の方角と距離）を比べて、写真を撮った場所に一番合う候補を選びます。
手がかりは、写っている看板の名前、矢印の向きと撮ったときのスマホの向き、写っているものの配置（例：右にエスカレーター、正面に改札）、GPS です。
- 地図にない場所は答えません。どの候補とも合わなければ choice は none。
- スマホの向きは地下では鉄骨で狂いやすい目安です。写真の中身と食い違うときは写真を優先します。GPS も地下ではほぼ届きません。
- facing は、写真を撮ったとき（カメラの向き）に向いていた方角。分からなければ 不明。
- reason は本人に見せる文です。1〜2文で、何が合ったから選んだのかを、やさしい言葉で（例：「中央東改札の看板が正面にあり、右のエスカレーターの位置も合うため」）。
  候補の記号（A・B…）は本人の画面に出ないので、reason には書かず「中央東改札のそば」のように場所で言います。
  急いでいる人が読むので短く。気休めや、病気・トイレの不安には触れません。`;

const READ_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["signs", "floor", "scene"],
  properties: {
    signs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "where", "arrow"],
        properties: {
          text: { type: "string" },
          where: { type: "string", enum: ["左", "中央", "右"] },
          arrow: { type: "string", enum: ["左", "右", "前", "後ろ", "上", "下", "なし"] },
        },
      },
    },
    floor: { type: "string" },
    scene: { type: "string" },
  },
};

const judgeSchema = (ids: string[]) => ({
  type: "object",
  additionalProperties: false,
  required: ["choice", "facing", "confidence", "reason"],
  properties: {
    choice: { type: "string", enum: [...ids, "none"] },
    facing: { type: "string", enum: [...DIRS, "不明"] },
    confidence: { type: "string", enum: ["高い", "中くらい", "低い"] },
    reason: { type: "string" },
  },
});

type Body = {
  step?: "read" | "judge";
  image?: string; // JPEG（base64）。端末で 1280px 以下に縮め、撮影情報（位置など）は落としてある
  ids?: string[];
  candidates?: string;
  signs?: string;
  heading?: number | null;
  gps?: string;
};

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "サーバーに ANTHROPIC_API_KEY が設定されていません", code: "no_key" }, { status: 503 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const limited = limiter.check(ip);
  if (limited) {
    return NextResponse.json(
      { error: "短い時間に使いすぎています。少し待ってからもう一度試してください", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const image = body.image ?? "";
  if (!/^[A-Za-z0-9+/=]+$/.test(image) || image.length > 2_500_000) return NextResponse.json({ error: "写真が読めませんでした" }, { status: 400 });
  const ids = (body.ids ?? []).filter((x) => /^[A-D]$/.test(x));
  if (body.step === "judge" && (!ids.length || !body.candidates)) return NextResponse.json({ error: "候補がありません" }, { status: 400 });

  const photo = { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: image } };
  const heading = typeof body.heading === "number" && Number.isFinite(body.heading) ? Math.round(((body.heading % 360) + 360) % 360) : null;
  const isRead = body.step !== "judge";
  const text = isRead
    ? "この写真の看板と、写っているものの配置を読んでください。"
    : [
        "地図のデータから作った候補：",
        (body.candidates ?? "").slice(0, 8000),
        "",
        `写真から読めた看板：${(body.signs ?? "").slice(0, 3000) || "（なし）"}`,
        `撮る直前のスマホの向き：${heading === null ? "分からない" : `北から時計回りに ${heading} 度（${DIRS[Math.round(heading / 45) % 8]}）。目安`}`,
        `GPS：${body.gps?.slice(0, 300) || "なし"}`,
        "",
        "写真を撮った場所に一番合う候補と、そのとき向いていた方角を選んでください。",
      ].join("\n");

  try {
    const client = new Anthropic();
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: isRead ? READ_SYSTEM : JUDGE_SYSTEM,
      messages: [{ role: "user", content: [photo, { type: "text", text }] }],
      output_config: { effort: isRead ? "low" : "medium", format: { type: "json_schema", schema: isRead ? READ_SCHEMA : judgeSchema(ids) } },
      ...(SUPPORTS_FALLBACK.test(MODEL) && { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
    });
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
      return NextResponse.json({ error: "この写真では判断できませんでした。看板が写るように撮り直してください" }, { status: 422 });
    }
    const json = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return NextResponse.json(JSON.parse(json));
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return NextResponse.json({ error: "混み合っています。少し待ってからもう一度試してください" }, { status: 429 });
    if (e instanceof Anthropic.APIError) return NextResponse.json({ error: "AI に聞けませんでした。少し待ってからもう一度試してください" }, { status: 502 });
    return NextResponse.json({ error: "AI の返事が読めませんでした" }, { status: 502 });
  }
}
