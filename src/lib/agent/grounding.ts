// 根拠チェック：返答に出てくる場所は、この回に道具が返した場所でなければならない。
// AI ではなくプログラムで確かめる。

// 返答の中で場所を指すときの書き方：[[place:ID]]
const MARK = /\[\[place:([^\]\s]+)\]\]/g;

export function placeIdsIn(text: string): string[] {
  return [...new Set([...text.matchAll(MARK)].map((m) => m[1]))];
}

export type GroundingResult = { ok: boolean; cited: string[]; unknown: string[] };

export function checkGrounding(text: string, seen: ReadonlySet<string>): GroundingResult {
  const cited = placeIdsIn(text);
  const unknown = cited.filter((id) => !seen.has(id));
  return { ok: unknown.length === 0, cited, unknown };
}

// 直しきれなかったときの最後の手段：根拠のない場所の印を「（確認できない場所）」に置き換える
export function stripUnknown(text: string, seen: ReadonlySet<string>): string {
  return text.replace(MARK, (whole, id: string) => (seen.has(id) ? whole : "（確認できない場所）"));
}
