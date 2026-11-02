// 現地確認の記録項目。トイレと店で同じ形の記録にし、あとで「場所＋属性＋出典＋確認日」にまとめる

export type FieldDef =
  | { kind: "text"; key: string; label: string; hint?: string; required?: boolean }
  | { kind: "textarea"; key: string; label: string; hint?: string }
  | { kind: "choice"; key: string; label: string; options: string[]; hint?: string; required?: boolean }
  | { kind: "multi"; key: string; label: string; options: string[]; hint?: string }
  | { kind: "stopwatch"; key: string; label: string; hint?: string }
  | { kind: "stock"; key: string; label: string; items: string[]; hint?: string }
  | { kind: "position"; key: string; label: string; hint?: string };

export type SurveyKind = "toilet" | "store";

const YES_NO = ["あり", "なし", "見ていない"];

export const STOCK_STATES = ["あり", "なし", "見ていない"] as const;

export const TOILET_FIELDS: FieldDef[] = [
  { kind: "text", key: "station", label: "駅名", required: true, hint: "例：新宿" },
  { kind: "text", key: "operator", label: "事業者", hint: "例：小田急、JR東日本、東京メトロ" },
  { kind: "choice", key: "gate", label: "改札の内か外か", options: ["改札内", "改札外", "分からない"], required: true },
  { kind: "text", key: "nearGate", label: "近い改札・出口の名前", hint: "例：南改札、西口地下改札" },
  { kind: "textarea", key: "where", label: "場所の説明（初めての人が迷わない書き方で）", hint: "例：南改札を入って右、階段の裏" },
  { kind: "text", key: "platform", label: "近いホーム・号車・階段", hint: "例：7・8番線、7号車付近の階段を上がる" },
  { kind: "stopwatch", key: "minFromPlatform", label: "ホームの階段下からトイレ入口まで", hint: "普通の速さで歩いて測る" },
  { kind: "stopwatch", key: "minFromGate", label: "改札からトイレ入口まで" },
  { kind: "multi", key: "types", label: "トイレの種類（入口の表示で分かる範囲）", options: ["男性", "女性", "多機能（だれでも）", "オストメイト対応"] },
  { kind: "choice", key: "sanitaryBoxMale", label: "男性トイレの個室にサニタリーボックス", options: YES_NO, hint: "男性トイレを使う人だけ。利用者がいないときに個室を見る" },
  { kind: "choice", key: "sanitaryBoxFemale", label: "女性トイレの個室にサニタリーボックス", options: YES_NO, hint: "女性トイレを使う人だけ" },
  { kind: "choice", key: "soap", label: "手洗いに石鹸", options: YES_NO },
  { kind: "choice", key: "queue", label: "行列（見たときの様子）", options: ["なし", "数人", "長い列", "見ていない"] },
  { kind: "text", key: "bench", label: "近くで座れる場所", hint: "例：ホーム中央にベンチ、改札外に待合室" },
  { kind: "text", key: "staff", label: "近い駅事務室・窓口（駅員に聞く用）", hint: "例：南改札の有人窓口" },
  { kind: "position", key: "pos", label: "トイレ入口の位置（取れれば）", hint: "地下では取れなくてよい" },
  { kind: "textarea", key: "mismatch", label: "案内表示や公式情報との食い違い", hint: "例：案内図にはあるが工事中で閉鎖" },
  { kind: "textarea", key: "note", label: "その他メモ" },
];

export const STORE_ITEMS = [
  "大人用紙パンツ",
  "尿もれ・吸水パッド",
  "吸水ショーツ（布）",
  "男性用下着",
  "女性用下着",
  "生理用ナプキン",
  "防臭袋・ビニール袋",
  "ウェットティッシュ（おしりふき）",
  "替えの靴下・ズボンなど衣類",
];

export const STORE_FIELDS: FieldDef[] = [
  { kind: "text", key: "name", label: "店名", required: true, hint: "例：ファミリーマート 新宿南口店" },
  { kind: "choice", key: "storeType", label: "店の種類", options: ["コンビニ", "ドラッグストア", "駅ナカの売店", "その他"], required: true },
  { kind: "text", key: "station", label: "近い駅", hint: "例：新宿" },
  { kind: "choice", key: "gate", label: "改札の内か外か", options: ["改札内", "改札外", "駅の外（街中）"] },
  { kind: "stopwatch", key: "minFromGate", label: "近い改札から店の入口まで" },
  { kind: "text", key: "hours", label: "営業時間（入口の表示）", hint: "例：24時間、7:00〜23:00" },
  { kind: "stock", key: "stock", label: "置いているもの", items: STORE_ITEMS, hint: "棚を見て分かる範囲。店員に聞かなくてよい" },
  { kind: "textarea", key: "aisle", label: "売り場の場所", hint: "例：入口から右奥、レジ横の衛生用品の棚。初めての人がすぐ行ける書き方で" },
  { kind: "choice", key: "storeToilet", label: "店のトイレ", options: ["お客が使える", "使えない（表示あり）", "ない", "見ていない"] },
  { kind: "text", key: "nearToilet", label: "着替えられる場所（近い多機能トイレなど）", hint: "例：駅ビル2階の多機能トイレ、徒歩2分" },
  { kind: "position", key: "pos", label: "店の入口の位置（取れれば）" },
  { kind: "textarea", key: "note", label: "その他メモ" },
];

export function fieldsFor(kind: SurveyKind): FieldDef[] {
  return kind === "toilet" ? TOILET_FIELDS : STORE_FIELDS;
}
