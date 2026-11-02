// エージェントの返答の形。自由な文ではなく、決まった JSON で返させる。
// 手順ごとの place_ids は「その回に道具が返した id」だけを選べるよう、毎回スキーマを作り直す。
// こうすると、道具が返していない場所は、そもそも書けない。

export type AnswerStep = { text: string; placeIds: string[]; section?: string };
// 経路の駅（利用者が書いた・貼った経路から。line はその駅から次の駅まで乗る路線）
export type RouteStop = { station: string; line?: string };
export type Answer = { summary: string; steps: AnswerStep[]; notes: string[]; packing?: string[]; route?: RouteStop[] };

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
      ...(plan && {
        route: {
          type: "array",
          description: "書かれた・貼られた経路の駅を、出発→乗り換え→到着の順に。駅名は「駅」を付けない。line はその駅から次の駅まで乗る路線（書かれていなければ空文字）。経路が書かれていなければ空の配列",
          items: {
            type: "object",
            properties: { station: { type: "string" }, line: { type: "string" } },
            required: ["station", "line"],
            additionalProperties: false,
          },
        },
      }),
    },
    required: ["summary", "steps", "notes", ...(plan ? ["packing", "route"] : [])],
    additionalProperties: false,
  };
}

// API の返事（JSON 文字列）を Answer にする。形が合わなければ null
export function parseAnswer(json: string): Answer | null {
  try {
    const v = JSON.parse(json) as { summary?: unknown; steps?: unknown; notes?: unknown; packing?: unknown; route?: unknown };
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
      ...(Array.isArray(v.route) && {
        route: v.route
          .filter((r: { station?: unknown }) => typeof r?.station === "string" && r.station)
          .map((r: { station: string; line?: unknown }) => ({
            station: r.station.replace(/駅$/, ""),
            ...(typeof r.line === "string" && r.line && { line: r.line }),
          })),
      }),
    };
  } catch {
    return null;
  }
}

export function citedIds(a: Answer): string[] {
  return [...new Set(a.steps.flatMap((s) => s.placeIds))];
}

// 文の中に場所の印（[[place:ID]]）が書かれてしまったとき：文からは消し、
// 道具が返した場所なら place_ids に移す（画面に印の文字がそのまま出ないように）
const MARK = /\s*\[\[place:([^\]\s]+)\]\]\s*/g;

function moveMarkers(a: Answer): Answer {
  const clean = (t: string) => t.replace(MARK, " ").replace(/\s{2,}/g, " ").trim();
  return {
    ...a,
    summary: clean(a.summary),
    notes: a.notes.map(clean),
    steps: a.steps.map((s) => {
      const found = [...s.text.matchAll(MARK)].map((m) => m[1]);
      return { ...s, text: clean(s.text), placeIds: [...new Set([...s.placeIds, ...found])] };
    }),
  };
}

// 念のための確認（スキーマで防いでいるので、ふだんは何も起きない）：道具が返していない id を落とす
export function dropUnseen(a: Answer, seen: ReadonlySet<string>): { answer: Answer; dropped: string[] } {
  const dropped: string[] = [];
  const moved = moveMarkers(a);
  const steps = moved.steps.map((s) => ({
    ...s,
    placeIds: s.placeIds.filter((id) => {
      if (seen.has(id)) return true;
      dropped.push(id);
      return false;
    }),
  }));
  return { answer: { ...moved, steps }, dropped };
}
