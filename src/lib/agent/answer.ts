// エージェントの返答の形。自由な文ではなく、決まった JSON で返させる。
// 手順ごとの place_ids は「その回に道具が返した id」だけを選べるよう、毎回スキーマを作り直す。
// こうすると、道具が返していない場所は、そもそも書けない。

export type AnswerStep = { text: string; placeIds: string[]; section?: string };
export type Answer = { summary: string; steps: AnswerStep[]; notes: string[]; packing?: string[] };

// plan：①出かける前の計画。手順を駅ごとの区切り（section）に分け、持ち物の例も付ける
export type Shape = "steps" | "plan";

// API に渡す JSON スキーマ（構造化出力）
export function answerSchema(seenIds: readonly string[], shape: Shape = "steps"): Record<string, unknown> {
  const plan = shape === "plan";
  const step: Record<string, unknown> = {
    type: "object",
    properties: {
      ...(plan && { section: { type: "string", description: "区切りの見出し。例：「出発前」「新宿駅に着いたら」「目的地の近く」" } }),
      text: { type: "string", description: "この手順でやること。場所の名前・id・距離・方角・営業時間は書かない（画面が place_ids から出す）" },
      ...(seenIds.length > 0 && {
        place_ids: {
          type: "array",
          description: "この手順で使う場所。道具が返した id だけ",
          items: { type: "string", enum: [...seenIds] },
        },
      }),
    },
    required: [...(plan ? ["section"] : []), "text", ...(seenIds.length > 0 ? ["place_ids"] : [])],
    additionalProperties: false,
  };
  return {
    type: "object",
    properties: {
      summary: { type: "string", description: "結論を一文で" },
      steps: { type: "array", items: step, description: "番号順の手順" },
      notes: { type: "array", items: { type: "string" }, description: "まとめて一度だけ伝える注意（品ぞろえは未確認など）。なければ空" },
      ...(plan && { packing: { type: "array", items: { type: "string" }, description: "持っていくとよいものの例（替えの下着、防臭袋など）" } }),
    },
    required: ["summary", "steps", "notes", ...(plan ? ["packing"] : [])],
    additionalProperties: false,
  };
}

// API の返事（JSON 文字列）を Answer にする。形が合わなければ null
export function parseAnswer(json: string): Answer | null {
  try {
    const v = JSON.parse(json) as { summary?: unknown; steps?: unknown; notes?: unknown; packing?: unknown };
    if (typeof v.summary !== "string" || !Array.isArray(v.steps) || !Array.isArray(v.notes)) return null;
    const strings = (x: unknown[]) => x.filter((y): y is string => typeof y === "string");
    const steps = v.steps.map((s: { text?: unknown; place_ids?: unknown; section?: unknown }) => ({
      text: typeof s.text === "string" ? s.text : "",
      placeIds: Array.isArray(s.place_ids) ? strings(s.place_ids) : [],
      ...(typeof s.section === "string" && { section: s.section }),
    }));
    return {
      summary: v.summary,
      steps,
      notes: strings(v.notes),
      ...(Array.isArray(v.packing) && { packing: strings(v.packing) }),
    };
  } catch {
    return null;
  }
}

export function citedIds(a: Answer): string[] {
  return [...new Set(a.steps.flatMap((s) => s.placeIds))];
}

// 念のための確認（スキーマで防いでいるので、ふだんは何も起きない）：道具が返していない id を落とす
export function dropUnseen(a: Answer, seen: ReadonlySet<string>): { answer: Answer; dropped: string[] } {
  const dropped: string[] = [];
  const steps = a.steps.map((s) => ({
    ...s,
    placeIds: s.placeIds.filter((id) => {
      if (seen.has(id)) return true;
      dropped.push(id);
      return false;
    }),
  }));
  return { answer: { ...a, steps }, dropped };
}
