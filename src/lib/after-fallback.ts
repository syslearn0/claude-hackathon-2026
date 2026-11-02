// AI を使えないとき（キーがない・通信が悪い・混んでいる）の③の簡易版。
// 同じ場所データから、決まった順番で手順を組み立てる。返す文の形はエージェントと同じ（[[place:ID]]）。
import type { LatLon } from "./geo";
import { findNearby } from "./nearby";
import type { Place } from "./places";

export type AfterAnswer = { text: string; places: Place[] };

export function buildAfterFallback(places: Place[], from: LatLon, situations: readonly string[]): AfterAnswer {
  const has = (id: string) => situations.includes(id);
  const steps: string[] = [];
  const used = new Map<string, Place>();
  const cite = (p: Place) => {
    used.set(p.id, p);
    return `[[place:${p.id}]]`;
  };

  const needChange = has("soiled_clothes") || has("change") || has("soiled_underwear");
  const needBuy = has("soiled_underwear") || has("soiled_clothes") || has("dispose");

  if (needBuy) {
    const stores = findNearby(places, { from, kind: "store", limit: 2 });
    if (stores.length) {
      const lines = stores.map((s) => {
        const stock = Object.entries(s.place.store?.stock ?? {})
          .filter(([, v]) => v)
          .map(([k]) => k);
        const what = stock.length ? `置いてあった：${stock.join("、")}` : "品ぞろえは未確認";
        const aisle = s.place.store?.aisle ? `（売り場：${s.place.store.aisle}）` : "";
        return `${cite(s.place)} ${s.direction}へ約${s.walkMin}分・${what}${aisle}`;
      });
      steps.push(`替え${has("dispose") ? "や防臭袋" : ""}を買う：${lines.join(" ／ ")}`);
    } else {
      steps.push("近くに店のデータがありません。駅員や店員に聞いてください（お願いカードを見せられます）。");
    }
  }

  if (needChange) {
    const room = findNearby(places, { from, kind: "toilet", accessibleOnly: true, limit: 1 })[0];
    steps.push(
      room
        ? `着替える：個室で着替えられる多機能トイレ ${cite(room.place)}（${room.direction}へ約${room.walkMin}分）`
        : "着替える：近くに多機能トイレのデータがありません。",
    );
  }

  if (has("not_yet")) {
    const near = findNearby(places, { from, kind: "toilet", limit: 1 })[0];
    const rest = [near?.place.toilet?.bench && `座れる場所：${near.place.toilet.bench}`, near?.place.toilet?.staffDesk && `駅員：${near.place.toilet.staffDesk}`]
      .filter(Boolean)
      .join("・");
    steps.push(`動けないとき：${rest || "近くの座れる場所や駅員の窓口は未確認です"}。お願いカードで駅員や店員に頼めます。`);
  }

  if (has("go_home") || has("continue")) {
    steps.push("帰るか続けるかは、あなたが決めてください。帰り道の案内は準備中です。");
  }

  if (steps.length === 0) {
    const near = findNearby(places, { from, kind: "store", limit: 1 })[0];
    steps.push(near ? `近くの店：${cite(near.place)}（${near.direction}へ約${near.walkMin}分）` : "近くの場所のデータがありません。");
  }

  return { text: steps.map((s, i) => `${i + 1}. ${s}`).join("\n"), places: [...used.values()] };
}
