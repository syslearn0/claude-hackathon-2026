import type { NearbyItem } from "@/lib/nearby";
import { displayName } from "@/lib/nearby";
import type { Tier } from "@/lib/places";

// 場所1件の表示（/now の一覧と、③の手順の下に並べる札で共通）

export const TIER_LABEL: Record<Tier, string> = {
  verified: "現地確認済み",
  official: "公式データ",
  osm: "OSM・未確認",
  report: "利用者の報告",
};

export function Item({ item }: { item: NearbyItem }) {
  const p = item.place;
  return (
    <div className="card">
      <div>
        <strong>
          {item.direction}へ 約{item.walkMin}分
        </strong>{" "}
        {displayName(p)}
      </div>
      {p.kind === "store" && <div className="muted">営業時間：{p.hoursText ?? p.openingHours ?? "登録なし"}</div>}
      <Details item={item} />
      <Badges item={item} />
      <MapLink item={item} />
    </div>
  );
}

const GATE_LABEL = { inside: "改札内", outside: "改札外", street: "駅の外", unknown: undefined } as const;

// "202601"（公式データ）と "2026-11-03"（現地確認）の両方を読める形に
const fmtChecked = (d: string) => (/^\d{6}$/.test(d) ? `${d.slice(0, 4)}年${Number(d.slice(4))}月` : d);

const fmtSec = (s: number) => (s < 60 ? `${s}秒` : `${Math.round(s / 60)}分`);

// 地図アプリにない情報（改札の内外、ホームからの道順と時間、品ぞろえ）。分かっているものだけ出す
export function Details({ item }: { item: NearbyItem }) {
  const p = item.place;
  const lines: string[] = [];
  const gate = p.gate ? GATE_LABEL[p.gate] : undefined;
  if (gate) lines.push(gate);
  if (p.platform) lines.push(p.platform);
  if (p.minFromPlatform !== undefined) lines.push(`ホームの階段から ${fmtSec(p.minFromPlatform)}`);
  if (p.minFromGate !== undefined) lines.push(`改札から ${fmtSec(p.minFromGate)}`);
  if (p.where) lines.push(p.where);
  if (p.toilet?.level && p.tier !== "osm") lines.push(p.toilet.level);
  const stock = Object.entries(p.store?.stock ?? {})
    .filter(([, has]) => has)
    .map(([name]) => name);
  return (
    <>
      {lines.length > 0 && <div>{lines.join("・")}</div>}
      {stock.length > 0 && <div>置いてあった：{stock.join("、")}</div>}
      {p.store?.aisle && <div>売り場：{p.store.aisle}</div>}
      {p.toilet?.sanitaryBoxMale === true && <div>男性個室にサニタリーボックスあり</div>}
      {p.toilet?.bench && <div className="muted">座れる場所：{p.toilet.bench}</div>}
      {p.toilet?.staffDesk && <div className="muted">駅員：{p.toilet.staffDesk}</div>}
      {p.kind === "toilet" && p.hoursText && <div className="muted">利用時間：{p.hoursText}</div>}
      {p.approxLocation && <div className="muted">位置は駅の中心で代用（方角・分数は目安）</div>}
      {p.checkedAt && p.tier !== "osm" && <div className="muted">確認：{fmtChecked(p.checkedAt)}</div>}
    </>
  );
}

export function Badges({ item }: { item: NearbyItem }) {
  const p = item.place;
  const tags: string[] = [TIER_LABEL[p.tier]];
  if (p.toilet?.accessible) tags.push("多機能");
  if (p.toilet?.ostomate) tags.push("オストメイト");
  if (p.toilet?.changingTable) tags.push("おむつ台");
  if (p.toilet?.fee) tags.push("有料");
  // OSM の level は「0 = 地上階」の書き方と日本式の階数が混ざっていて、そのまま「○階」と出すと誤る。いまは出さない
  if (p.store?.customerToilet === true) tags.push("店内トイレあり");
  if (p.store?.storeType === "drugstore") tags.push("ドラッグストア");
  if (p.store?.storeType === "convenience") tags.push("コンビニ");
  if (p.store?.storeType === "station_kiosk") tags.push("駅ナカ");
  return (
    <div className="chips" style={{ marginTop: 6 }}>
      {tags.map((t) => (
        <span key={t} className="tag">
          {t}
        </span>
      ))}
    </div>
  );
}

// 行き先（トイレや店）の位置だけを渡す。利用者の位置は渡さない
export function MapLink({ item }: { item: NearbyItem }) {
  const { lat, lon } = item.place;
  return (
    <a
      href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=walking`}
      target="_blank"
      rel="noreferrer"
      style={{ display: "inline-block", marginTop: 6 }}
    >
      地図で道順を見る
    </a>
  );
}
