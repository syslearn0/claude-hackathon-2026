"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LatLon } from "@/lib/geo";
import type { NearbyItem } from "@/lib/nearby";
import { displayName, findNearby } from "@/lib/nearby";
import type { Place, Tier } from "@/lib/places";
import { AfterPanel } from "./AfterPanel";
import { RequestCard } from "./RequestCard";

type Nearby = {
  toilets: NearbyItem[];
  changeRooms: NearbyItem[];
  stores: NearbyItem[];
};

type PlacesResponse = { places: Place[] };

// 地下などで位置が取れないときに選ぶ場所（駅の中心のだいたいの位置）
const PRESETS: { label: string; pos: LatLon }[] = [
  { label: "新宿駅", pos: { lat: 35.6896, lon: 139.7006 } },
  { label: "丹波橋駅", pos: { lat: 34.937, lon: 135.7737 } },
  { label: "祇園四条駅", pos: { lat: 35.0037, lon: 135.7722 } },
  { label: "三条駅", pos: { lat: 35.0089, lon: 135.7723 } },
  { label: "出町柳駅", pos: { lat: 35.0303, lon: 135.7727 } },
];

const TIER_LABEL: Record<Tier, string> = {
  verified: "現地確認済み",
  official: "公式データ",
  osm: "OSM・未確認",
  report: "利用者の報告",
};

export default function NowPage() {
  const [pos, setPos] = useState<{ at: LatLon; how: string } | null>(null);
  const [status, setStatus] = useState(() =>
    "geolocation" in navigator ? "位置を確かめています…" : "位置が使えません。下から今いる駅を選んでください。",
  );
  const [all, setAll] = useState<PlacesResponse | null>(null);
  const [card, setCard] = useState(false);
  const [after, setAfter] = useState(false);
  // 位置の取得が遅れて失敗したとき、すでに選んだ駅の表示を上書きしないため
  const chosen = useRef(false);

  const choose = (at: LatLon, how: string) => {
    chosen.current = true;
    setStatus("");
    setPos({ at, how });
  };

  // 結果はあとから届くので、ここでは状態を直接変えない（画面の文言は呼ぶ側で出す）
  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (chosen.current) return;
        setStatus("");
        setPos({
          at: { lat: p.coords.latitude, lon: p.coords.longitude },
          how: `現在地（誤差 約${Math.round(p.coords.accuracy)}m）`,
        });
      },
      () => {
        if (!chosen.current) setStatus("位置が取れませんでした。下から今いる駅を選んでください。");
      },
      // 急いでいるので、少し前の位置でもよい
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 },
    );
  }, []);

  useEffect(() => {
    locate();
  }, [locate]);

  // 場所データは位置と関係なく丸ごと受け取る（位置をサーバーに送らないため）
  useEffect(() => {
    fetch("/api/places")
      .then((r) => r.json())
      .then(setAll)
      .catch(() => setStatus("候補を読み込めませんでした。通信を確かめてください。"));
  }, []);

  const data: Nearby | null =
    pos && all
      ? {
          toilets: findNearby(all.places, { from: pos.at, kind: "toilet", limit: 3 }),
          changeRooms: findNearby(all.places, { from: pos.at, kind: "toilet", accessibleOnly: true, limit: 1 }),
          stores: findNearby(all.places, { from: pos.at, kind: "store", limit: 3 }),
        }
      : null;

  const first = data?.toilets[0];

  return (
    <main>
      {card && <RequestCard onClose={() => setCard(false)} />}

      <div className="row" style={{ justifyContent: "space-between" }}>
        <Link href="/" className="muted">
          ← もどる
        </Link>
        <button onClick={() => setCard(true)}>お願いカード</button>
      </div>

      {pos && <p className="muted">基準：{pos.how}</p>}
      {status && <p className="card">{status}</p>}

      {first && (
        <section className="card" style={{ borderWidth: 2, borderColor: "var(--accent)" }}>
          <div className="muted">一番近いトイレ</div>
          <div style={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1.2 }}>
            {first.direction}へ 約{first.walkMin}分
          </div>
          <div>
            {displayName(first.place)}（直線 {first.meters}m）
          </div>
          <Details item={first} />
          <Badges item={first} />
          <MapLink item={first} />
        </section>
      )}

      {pos && all && (
        <>
          {!after ? (
            <button className="big" onClick={() => setAfter(true)}>
              トイレに入った（次どうする？）
            </button>
          ) : (
            <AfterPanel pos={pos.at} places={all.places} />
          )}
        </>
      )}

      {data && data.toilets.length === 0 && (
        <p className="card">近く（1.5km 以内）にトイレのデータがありません。駅員や店員に聞いてください（お願いカードを見せられます）。</p>
      )}

      {data && data.toilets.length > 1 && (
        <>
          <h2>ほかのトイレ</h2>
          {data.toilets.slice(1).map((x) => (
            <Item key={x.place.id} item={x} />
          ))}
        </>
      )}

      {data && (
        <>
          <h2>着替えられる場所（多機能トイレ）</h2>
          {data.changeRooms.length ? (
            data.changeRooms.map((x) => <Item key={x.place.id} item={x} />)
          ) : (
            <p className="muted">近くに多機能トイレのデータがありません。</p>
          )}

          <h2>替えを買える店</h2>
          <p className="muted">品ぞろえは店によって違います。「現地確認済み」の店だけ、置いてあった品目を出しています。</p>
          {data.stores.map((x) => (
            <Item key={x.place.id} item={x} />
          ))}
          <p className="muted">
            © OpenStreetMap contributors (ODbL 1.0)／出典：東京都「車椅子使用者対応トイレのバリアフリー情報」（CC BY 4.0）を加工して作成
          </p>
          <p className="muted">現在地はこの端末の中だけで使い、サーバーには送りません。</p>
        </>
      )}

      <h2>今いる場所を選ぶ</h2>
      <div className="chips">
        <button
          onClick={() => {
            chosen.current = false;
            setStatus("位置を確かめています…");
            locate();
          }}
        >
          現在地をもう一度
        </button>
        {PRESETS.map((p) => (
          <button key={p.label} onClick={() => choose(p.pos, `${p.label}（駅の中心のだいたいの位置）`)}>
            {p.label}
          </button>
        ))}
      </div>
    </main>
  );
}

function Item({ item }: { item: NearbyItem }) {
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
function Details({ item }: { item: NearbyItem }) {
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

function Badges({ item }: { item: NearbyItem }) {
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
function MapLink({ item }: { item: NearbyItem }) {
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
