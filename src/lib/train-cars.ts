// 車内トイレのある号車・弱冷房車の表（data/train-cars.json）。各項目に出典と確認日を持つ。
// 路線名は利用者が書いた・貼った文から来るので、別名でも引けるようにする。
import table from "../../data/train-cars.json";

export type TrainCars = {
  operator: string;
  line: string;
  aliases: string[]; // 「中央線快速」「JR中央線快速」「中央快速線」など
  service?: string;
  cars?: number;
  toiletCars?: number[] | null;
  accessibleToiletCars?: number[] | null;
  weakAcCars?: number[] | null;
  carNumbering?: string | null;
  conditions?: string | null;
  sources: string[];
  checkedAt: string;
  note?: string | null;
};

const ENTRIES = (table as { entries: TrainCars[] }).entries;

const norm = (s: string) => s.replace(/\s|ＪＲ|JR|線$/g, "").replace(/各駅停車|各停/g, "");

export function findTrainCars(line: string): TrainCars | undefined {
  const key = norm(line);
  if (!key) return undefined;
  return ENTRIES.find((e) => [e.line, ...e.aliases].some((name) => norm(name) === key || key.includes(norm(name))));
}

const list = (xs: number[]) => xs.map((x) => `${x}号車`).join("・");

// 画面に出す一文。分かっていることだけ
export function describeTrainCars(line: string): string | null {
  const e = findTrainCars(line);
  if (!e) return null;
  const parts: string[] = [];
  if (e.toiletCars?.length) parts.push(`トイレ：${list(e.toiletCars)}`);
  else if (e.toiletCars && e.toiletCars.length === 0) parts.push("車内トイレなし");
  if (e.accessibleToiletCars?.length) parts.push(`多機能トイレ：${list(e.accessibleToiletCars)}`);
  if (e.weakAcCars?.length) parts.push(`弱冷房車：${list(e.weakAcCars)}`);
  if (parts.length === 0) return null;
  return `${e.line}（${e.service ?? "全列車"}）：${parts.join("、")}${e.conditions ? `（${e.conditions}）` : ""}・確認 ${e.checkedAt}`;
}
