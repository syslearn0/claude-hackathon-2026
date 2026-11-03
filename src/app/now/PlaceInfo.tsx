import { useState } from "react";
import type { NearbyItem } from "@/lib/nearby";
import { loadProfile } from "@/lib/profile";
import { displayName } from "@/lib/nearby";
import { floorLabel, osmLevelFloor } from "@/lib/indoor";
import type { Tier } from "@/lib/places";
import { TIER_COLOR } from "./MapView";

// 場所1件の表示（/now の一覧と、③の手順の下に並べる札で共通）

export const TIER_LABEL: Record<Tier, string> = {
  verified: "現地確認済み",
  official: "公式データ",
  osm: "OSM・未確認",
  report: "利用者の報告",
};

// head：駅の中では、方角と分数の代わりに事実（改札の内外・階・実測の分数）を見出しにする
export function Item({
  item,
  n,
  head,
  inStation = false,
}: {
  item: NearbyItem;
  n?: number;
  head?: { main: string; sub?: string };
  inStation?: boolean;
}) {
  const p = item.place;
  return (
    <div className="card">
      <div>
        <NumberBadge n={n} tier={p.tier} />
        <strong>{head ? head.main : `${item.direction}へ 約${item.walkMin}分`}</strong> {displayName(p)}
      </div>
      {head?.sub && <div className="muted">{head.sub}</div>}
      {p.kind === "store" && <div className="muted">営業時間：{p.hoursText ?? p.openingHours ?? "登録なし"}</div>}
      <Details item={item} compact={!!head} />
      <Badges item={item} />
      <MapLink item={item} inStation={inStation} />
    </div>
  );
}

const GATE_LABEL = { inside: "改札内", outside: "改札外", street: "駅の外", unknown: undefined } as const;

// "202601"（公式データ）と "2026-11-03"（現地確認）の両方を読める形に
const fmtChecked = (d: string) => (/^\d{6}$/.test(d) ? `${d.slice(0, 4)}年${Number(d.slice(4))}月` : d);

const fmtSec = (s: number) => (s < 60 ? `${s}秒` : `${Math.round(s / 60)}分`);

// 地図アプリにない情報（改札の内外、ホームからの道順と時間、品ぞろえ）。分かっているものだけ出す
// compact：見出しに改札の内外・階・分数をもう出しているときは、ここでは繰り返さない
export function Details({ item, compact = false }: { item: NearbyItem; compact?: boolean }) {
  const p = item.place;
  const [side] = useState(() => loadProfile().toiletSide);
  const showMale = side !== "female";
  const showFemale = side !== "male";
  const box = (v: boolean | undefined, who: string) =>
    v === undefined ? null : <div>{`${who}個室にサニタリーボックス${v ? "あり" : "なし"}`}</div>;
  const lines: string[] = [];
  const gate = p.gate ? GATE_LABEL[p.gate] : undefined;
  if (gate && !compact) lines.push(gate);
  if (p.platform) lines.push(p.platform);
  if (!compact) {
    if (p.minFromPlatform !== undefined) lines.push(`ホームの階段から ${fmtSec(p.minFromPlatform)}`);
    if (p.minFromGate !== undefined) lines.push(`改札から ${fmtSec(p.minFromGate)}`);
  }
  if (p.where) lines.push(p.where);
  // OSM の level は書き方が建物で違うので、駅の地図と同じ「0 = 1F」で読み、目安と添える
  const osmFloor = p.tier === "osm" ? osmLevelFloor(p.toilet?.level) : undefined;
  const floor = p.floor ?? (p.tier !== "osm" ? p.toilet?.level : osmFloor !== undefined ? `${floorLabel(osmFloor)}（OSM の記載から。目安）` : undefined);
  if (floor && !compact) lines.push(floor);
  const stock = Object.entries(p.store?.stock ?? {})
    .filter(([, has]) => has)
    .map(([name]) => name);
  return (
    <>
      {lines.length > 0 && <div>{lines.join("・")}</div>}
      {stock.length > 0 && <div>置いてあった：{stock.join("、")}</div>}
      {p.store?.aisle && <div>売り場：{p.store.aisle}</div>}
      {showMale && box(p.toilet?.sanitaryBoxMale, "男性")}
      {showFemale && box(p.toilet?.sanitaryBoxFemale, "女性")}
      {p.toilet?.bench && <div className="muted">座れる場所：{p.toilet.bench}</div>}
      {p.toilet?.staffDesk && <div className="muted">駅員：{p.toilet.staffDesk}</div>}
      {p.kind === "toilet" && p.hoursText && <div className="muted">利用時間：{p.hoursText}</div>}
      {p.approxLocation && (
        <div className="muted">{compact ? "地図のピンは駅の代表の位置に置いています" : "位置は駅の中心で代用（方角・分数は目安）"}</div>
      )}
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
// inStation：駅の中では Google マップの歩きの道順も構内（階・改札）を扱えないので、場所を見せるだけにする
// big：一番近いトイレのカードでは、緊急時に押しやすい大きなボタンにする
export function MapLink({ item, inStation = false, big = false }: { item: NearbyItem; inStation?: boolean; big?: boolean }) {
  const { lat, lon } = item.place;
  const href = inStation
    ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=walking`;
  const label = inStation ? "地図で場所を見る" : "地図で道順を見る";
  if (big) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="button primary big" style={{ marginTop: 10 }}>
        {inStation ? label : `${label}（Google マップ）`}
      </a>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 6 }}>
      {label}
    </a>
  );
}

// 地図のピンと同じ番号・同じ色
export function NumberBadge({ n, tier }: { n?: number; tier: Tier }) {
  if (n === undefined) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        marginRight: 6,
        borderRadius: "50%",
        background: TIER_COLOR[tier],
        color: "#fff",
        fontSize: "0.75rem",
        fontWeight: 700,
      }}
    >
      {n}
    </span>
  );
}
