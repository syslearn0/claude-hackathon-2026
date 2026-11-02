// ①で作った「今日の計画」を端末の中だけに残す。/now と、②の見直しで使う。
import type { Answer } from "./agent/answer";
import { loadJson, saveJson } from "./local";
import type { Place } from "./places";

export type SavedPlan = {
  createdAt: string; // ISO
  note: string;
  conditions: string[];
  answer: Answer;
  places: Place[]; // 計画に出てくる場所（あとで通信できなくても出せるように）
};

const KEY = "plan.today.v1";

export function savePlan(plan: SavedPlan): boolean {
  return saveJson(KEY, plan);
}

// 今日作った計画だけを返す（前の日の計画は使わない）
export function loadTodayPlan(now = new Date()): SavedPlan | null {
  const p = loadJson<SavedPlan | null>(KEY, null);
  if (!p) return null;
  const made = new Date(p.createdAt);
  return made.toDateString() === now.toDateString() ? p : null;
}

export function clearPlan() {
  saveJson(KEY, null);
}
