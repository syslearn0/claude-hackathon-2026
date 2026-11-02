"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LatLon } from "@/lib/geo";
import type { NearbyItem } from "@/lib/nearby";
import { displayName } from "@/lib/nearby";
import type { Tier } from "@/lib/places";
import { RequestCard } from "./RequestCard";

type Nearby = {
  toilets: NearbyItem[];
  changeRooms: NearbyItem[];
  stores: NearbyItem[];
  attribution: string;
};

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
  const [status, setStatus] = useState("位置を確かめています…");
  const [data, setData] = useState<Nearby | null>(null);
  const [card, setCard] = useState(false);
  // 位置の取得が遅れて失敗したとき、すでに選んだ駅の表示を上書きしないため
  const chosen = useRef(false);

  const choose = (at: LatLon, how: string) => {
    chosen.current = true;
    setPos({ at, how });
  };

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatus("位置が使えません。下から今いる駅を選んでください。");
      return;
    }
    setStatus("位置を確かめています…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (chosen.current) return;
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

  useEffect(() => {
    if (!pos) return;
    setStatus("");
    fetch(`/api/nearby?lat=${pos.at.lat}&lon=${pos.at.lon}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setStatus("候補を読み込めませんでした。通信を確かめてください。"));
  }, [pos]);

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
          <Badges item={first} />
          <MapLink item={first} />
        </section>
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
          <p className="muted">下着・生理用品・防臭袋などの品ぞろえは店によって違います（まだ確認していません）。</p>
          {data.stores.map((x) => (
            <Item key={x.place.id} item={x} />
          ))}
          <p className="muted">{data.attribution}</p>
        </>
      )}

      <h2>今いる場所を選ぶ</h2>
      <div className="chips">
        <button
          onClick={() => {
            chosen.current = false;
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
      {p.kind === "store" && <div className="muted">営業時間：{p.openingHours ?? "登録なし"}</div>}
      <Badges item={item} />
      <MapLink item={item} />
    </div>
  );
}

function Badges({ item }: { item: NearbyItem }) {
  const p = item.place;
  const tags: string[] = [TIER_LABEL[p.tier]];
  if (p.toilet?.accessible) tags.push("多機能");
  if (p.toilet?.changingTable) tags.push("おむつ台");
  if (p.toilet?.fee) tags.push("有料");
  // OSM の level は「0 = 地上階」の書き方と日本式の階数が混ざっていて、そのまま「○階」と出すと誤る。いまは出さない
  if (p.store?.customerToilet === true) tags.push("店内トイレあり");
  if (p.store?.storeType === "drugstore") tags.push("ドラッグストア");
  if (p.store?.storeType === "convenience") tags.push("コンビニ");
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
