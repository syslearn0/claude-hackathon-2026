// 場面ごとの指示。共通の約束ごと（BASE_SYSTEM）に足して使う。

export type Mode = "after";

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

export const MODE_INSTRUCTIONS: Record<Mode, string> = {
  after: `いまの場面：利用者はトイレの個室にいて、少し落ち着いたところ。選んだ状況（と書いた一言）に合わせて、次の行動を steps に順番に並べる。

- まず find_nearby_places で近くの店（kind=store）と、必要なら多機能トイレ（accessible_only=true）を調べる。
- 替えが要るとき：品ぞろえを確認済みの店（stock_checked に品目がある店）を優先して place_ids に入れる。品目や売り場は画面が出すので text に書かなくてよい。
- 着替えが要るとき：個室で着替えられる多機能トイレを place_ids に入れる。
- 捨てたいとき：防臭袋を買える店を挙げる。ゴミを捨ててよいかの判断はしない。
- まだ動けないとき：近くの座れる場所や駅員の窓口が分かれば挙げ、お願いカードで駅員や店員に頼めることを書く。
- 帰るか続けるかは、利用者が決める。最後の step で両方の選択肢を並べるだけにし、「帰り道の案内は準備中」と書く。
- steps は3つ程度、それぞれ短く。`,
};

export function describeSituations(ids: readonly string[], note?: string): string {
  const labels = SITUATIONS.filter((s) => ids.includes(s.id)).map((s) => s.label);
  const parts = [labels.length ? `状況：${labels.join("、")}` : "状況：（選択なし）"];
  if (note?.trim()) parts.push(`一言：${note.trim()}`);
  return parts.join("\n");
}
