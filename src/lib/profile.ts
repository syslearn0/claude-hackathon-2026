// 自分の情報。スマホの中（localStorage）だけに保存し、サーバーには保存しない。
// 病名の欄は作らない。外出に要る条件だけを持つ。
import { loadJson, saveJson } from "./local";

export type ToiletSide = "male" | "female" | "any";

export type Profile = {
  toiletSide?: ToiletSide; // 使うトイレの側（サニタリーボックスの情報をどちらの側で出すか）
  needAccessible?: boolean; // 多機能トイレが要る
  needOstomate?: boolean; // オストメイト対応が要る
  carriesSpare?: boolean; // ふだん替えを持ち歩いている
  homeStations?: string[]; // よく使う駅（駅を選ぶボタンで先に出す）
  cardMessage?: string; // お願いカードの文面（空なら決まった文）
  contactName?: string; // 緊急連絡先（お願いカードにだけ出す。AI には送らない）
  contactPhone?: string;
};

const KEY = "profile.v1";

export function loadProfile(): Profile {
  return loadJson<Profile>(KEY, {});
}

export function saveProfile(p: Profile): boolean {
  return saveJson(KEY, p);
}

export function clearProfile() {
  saveJson(KEY, {});
}

export type ProfileUse = "after" | "plan" | "emergency";

// AI に送る条件。場面に要るものだけ。連絡先・お願いカードの文面・よく使う駅は送らない
export function describeProfile(p: Profile, use: ProfileUse): string {
  const lines: string[] = [];
  if (p.needAccessible) lines.push("多機能トイレ（個室で着替えられる）が要る");
  if (p.needOstomate) lines.push("オストメイト対応のトイレが要る");
  if (use !== "emergency" && p.carriesSpare !== undefined) {
    lines.push(p.carriesSpare ? "ふだん替えを持ち歩いている" : "ふだん替えは持ち歩いていない");
  }
  if (use !== "plan" && p.toiletSide && p.toiletSide !== "any") {
    lines.push(`使うトイレ：${p.toiletSide === "male" ? "男性側" : "女性側"}`);
  }
  return lines.length ? `利用者があらかじめ登録した条件：${lines.join("、")}` : "";
}
