import Link from "next/link";
import official from "../../../../../data/places/official-tokyo-station-toilets.json";
import type { Place } from "@/lib/places";
import { Checklist, type Section } from "./Checklist";

// 11/3 の新宿駅の現地確認の段取り。場面は「京都から初めて新宿に来た日」
// （東京駅で新幹線から中央線快速に乗り換え、新宿で降りる）

const SECTIONS: Section[] = [
  {
    id: "a",
    title: "A. 中央線快速のホーム → 南口・新南改札 → 駅の外",
    when: "朝（いちばん大事。時間がなければここだけ）",
    items: [
      "東京方面から来た中央線快速が着くホームに降りる（番線は案内表示で確認してメモ）",
      "ホームから一番近いトイレ：改札内か外か、どの階段か、何号車あたりか、ホームの階段下から何分か",
      "そこの多機能トイレ（だれでもトイレ）の場所と、行き方",
      "男性トイレの個室にサニタリーボックスがあるか（利用者がいない個室だけ）、石鹸があるか",
      "改札内の売店（NewDays など）：下着・ナプキン・防臭袋・おしりふきがあるか、棚のどこか",
      "近くで座れる場所（ベンチ）と、駅員のいる窓口",
      "南口か新南改札を出て、すぐのコンビニ1〜2軒：同じく品ぞろえと売り場の場所",
    ],
  },
  {
    id: "c",
    title: "C. 中央線快速のホーム → 都営新宿線・大江戸線への乗り換え",
    when: "夕方（都営のトイレは公式データに1件もないので、2番目に大事）",
    items: [
      "乗り換えの途中で寄れるトイレ：改札内か外か、どこか、何分か",
      "都営側の改札内のトイレと多機能トイレ",
      "途中で迷ったところがあれば、どこで迷ったかをメモ",
    ],
  },
  {
    id: "b",
    title: "B. 中央線快速のホーム → 小田急・京王への乗り換え",
    when: "夕方（時間があれば）",
    items: [
      "JR と小田急・京王の乗り換え口の近くのトイレ：改札内か外か、何分か",
      "乗り換え通路の多機能トイレ",
    ],
  },
  {
    id: "d",
    title: "D. 駅の外のドラッグストア",
    when: "夕方（多くの店は10時ごろ開くので、朝は避ける）",
    items: [
      "南口・東口の近くのドラッグストア1〜2軒：大人用紙パンツ、吸水パッド、下着、ナプキン、防臭袋、売り場の場所、営業時間",
      "店にお客が使えるトイレがあるか（表示で分かる範囲）",
    ],
  },
];

export default function ShinjukuPlan() {
  const places = (official as { places: Place[] }).places;
  // 公式データにある新宿駅の多機能トイレ。どれも改札の内か外かが分からない
  const targets = places
    .filter((p) => p.station === "新宿")
    .map((p) => ({ id: p.id, label: `${p.name}（${p.toilet?.level ?? "階不明"}）` }));

  return (
    <main>
      <p className="muted">
        <Link href="/tools/survey">← 記録にもどる</Link>
      </p>
      <h1>11/3 新宿駅の現地確認</h1>
      <div className="card">
        <p style={{ margin: 0 }}>
          <strong>場面</strong>：京都から初めて東京に来た人が、東京駅から中央線快速に乗って新宿で降りた。急にお腹が痛くなったとき、どこへ行けばいいか。汚してしまったら、どこで替えを買って着替えられるか。
        </p>
      </div>

      <h2>時間の目安</h2>
      <ul>
        <li>
          <strong>朝 〜10:15</strong>：A を回る（大岡山まで40分ほどかかるので、10:15 には新宿を出る）
        </li>
        <li>
          <strong>夕方 16:45〜</strong>：C → B → D の順。疲れたら途中でやめて大丈夫
        </li>
      </ul>
      <p className="muted">
        1か所ごとに<Link href="/tools/survey">記録ページ</Link>で保存し、区切りのいいところで「書き出して送る」。先に
        <Link href="/tools/survey/rules">調査のルール</Link>も読んでください。チェックはこの端末だけに保存されます。
      </p>

      <Checklist sections={SECTIONS} targets={targets} />

      <h2>女性の協力者がいれば（できればでよい）</h2>
      <ul className="muted">
        <li>A のトイレで、女性トイレの入口の位置（男性トイレと離れていることがある）と、行列の様子</li>
        <li>個室のサニタリーボックスと石鹸</li>
        <li>記録は同じページで、呼び名を変えて保存してもらう</li>
      </ul>
    </main>
  );
}
