// 場面ごとの指示。共通の約束ごと（BASE_SYSTEM）に足して使う。

export type Mode = "after" | "plan";

// ③ トイレに入った後：個室で少し落ち着いて、次にどうするかを決めたい
export const SITUATIONS = [
  { id: "soiled_underwear", label: "下着を汚した" },
  { id: "soiled_clothes", label: "服（ズボンなど）まで汚れた" },
  { id: "change", label: "着替えたい" },
  { id: "dispose", label: "使ったものを捨てたい" },
  { id: "not_yet", label: "まだ出そう・動けない" },
  { id: "go_home", label: "帰りたい" },
  { id: "continue", label: "予定を続けたい" },
] as const;

export type SituationId = (typeof SITUATIONS)[number]["id"];

// ① 出かける前の計画で選べる条件
export const PLAN_CONDITIONS = [
  { id: "unwell", label: "今日は調子が悪い" },
  { id: "no_spare", label: "替えを持っていない" },
  { id: "need_accessible", label: "多機能トイレが要る" },
  { id: "long_ride", label: "長く乗るのが不安" },
  { id: "first_time", label: "初めて行く駅がある" },
] as const;

export const MODE_INSTRUCTIONS: Record<Mode, string> = {
  plan: `いまの場面：利用者は出かける前で、今日の外出の計画を立てたい。書かれた行き先・経由する駅・時間・条件から、駅ごとに「そこで使える場所」をまとめた計画を作る。

- 書かれた駅（出発・乗り換え・目的地）を find_station で調べ、見つかった駅ごとに find_nearby_places でトイレ（多機能トイレも）と店を調べる。
- 駅のデータが見つからないときは、その駅の section に「この駅のデータはまだありません」と書く。経路・乗る電車・所要時間・車両は、道具に無いので書かない。
- steps は駅ごとに section を分ける（例：「出発前」「新宿駅に着いたら」「目的地の近く」）。各 section は1〜3個の step。
- 「替えを持っていない」なら、替えを買える店を早めの section に入れる。「多機能トイレが要る」なら、多機能トイレを優先する。
- 書かれた時間があれば、営業時間が分かる店はそれを踏まえて選ぶ（営業時間そのものは画面が出す）。
- packing には、持っていくとよいものの例を短く（替えの下着、防臭袋、おしりふき、上着など）。薬や食事のことは書かない。
- summary は、この日の計画を一文で。`,
  after: `いまの場面：利用者はトイレの個室にいて、少し落ち着いたところ。選んだ状況（と書いた一言）に合わせて、次の行動を steps に順番に並べる。

- まず find_nearby_places で近くの店（kind=store）と、必要なら多機能トイレ（accessible_only=true）を調べる。
- 替えが要るとき：品ぞろえを確認済みの店（stock_checked に品目がある店）を優先して place_ids に入れる。品目や売り場は画面が出すので text に書かなくてよい。
- 着替えが要るとき：個室で着替えられる多機能トイレを place_ids に入れる。
- 捨てたいとき：防臭袋を買える店を挙げる。ゴミを捨ててよいかの判断はしない。
- まだ動けないとき：近くの座れる場所や駅員の窓口が分かれば挙げ、お願いカードで駅員や店員に頼めることを書く。
- 帰るか続けるかは、利用者が決める。最後の step で両方の選択肢を並べるだけにし、「帰り道の案内は準備中」と書く。
- steps は3つ程度、それぞれ短く。`,
};

export function describePlan(conditions: readonly string[], note: string): string {
  const labels = PLAN_CONDITIONS.filter((c) => conditions.includes(c.id)).map((c) => c.label);
  return [`今日の予定：${note.trim() || "（書かれていない）"}`, `条件：${labels.join("、") || "（なし）"}`].join("\n");
}

export function describeSituations(ids: readonly string[], note?: string): string {
  const labels = SITUATIONS.filter((s) => ids.includes(s.id)).map((s) => s.label);
  const parts = [labels.length ? `状況：${labels.join("、")}` : "状況：（選択なし）"];
  if (note?.trim()) parts.push(`一言：${note.trim()}`);
  return parts.join("\n");
}
