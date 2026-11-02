// AI を使えないとき（キーがない・通信が悪い・混んでいる）の③の簡易版。
// 同じ場所データから、決まった順番で手順を組み立てる。返す形はエージェントと同じ（Answer）。
import type { Answer, AnswerStep } from "./agent/answer";
import type { LatLon } from "./geo";
import { findNearby } from "./nearby";
import type { Place } from "./places";

export function buildAfterFallback(places: Place[], from: LatLon, situations: readonly string[]): Answer {
  const has = (id: string) => situations.includes(id);
  const steps: AnswerStep[] = [];
  const notes: string[] = [];

  const needChange = has("soiled_clothes") || has("change") || has("soiled_underwear");
  const needBuy = has("soiled_underwear") || has("soiled_clothes") || has("dispose");

  if (needBuy) {
    const stores = findNearby(places, { from, kind: "store", limit: 2 });
    if (stores.length) {
      steps.push({ text: `替えの下着${has("dispose") ? "や防臭袋" : ""}を買う`, placeIds: stores.map((s) => s.place.id) });
      if (stores.some((s) => !Object.keys(s.place.store?.stock ?? {}).length)) notes.push("品ぞろえを確かめていない店があります。");
    } else {
      steps.push({ text: "近くに店のデータがありません。駅員や店員に聞く（お願いカードを見せられます）", placeIds: [] });
    }
  }

  if (needChange) {
    const room = findNearby(places, { from, kind: "toilet", accessibleOnly: true, limit: 1 })[0];
    steps.push(
      room
        ? { text: "個室で着替えられる多機能トイレで着替える", placeIds: [room.place.id] }
        : { text: "近くに多機能トイレのデータがありません", placeIds: [] },
    );
  }

  if (has("not_yet")) {
    const near = findNearby(places, { from, kind: "toilet", limit: 1 })[0];
    const t = near?.place.toilet;
    const rest = [t?.bench && `座れる場所：${t.bench}`, t?.staffDesk && `駅員：${t.staffDesk}`].filter(Boolean).join("・");
    steps.push({
      text: `${rest ? `${rest}。` : "近くの座れる場所や駅員の窓口は未確認です。"}お願いカードで駅員や店員に頼めます`,
      placeIds: rest && near ? [near.place.id] : [],
    });
  }

  if (has("go_home") || has("continue")) {
    steps.push({ text: "帰るか続けるかは、あなたが決めてください。帰り道の案内は準備中です", placeIds: [] });
  }

  if (steps.length === 0) {
    const near = findNearby(places, { from, kind: "store", limit: 1 })[0];
    steps.push(near ? { text: "近くの店", placeIds: [near.place.id] } : { text: "近くの場所のデータがありません", placeIds: [] });
  }

  return { summary: "近い順に、次の手順をまとめました。", steps, notes };
}
