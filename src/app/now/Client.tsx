"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LatLon } from "@/lib/geo";
import type { NearbyItem } from "@/lib/nearby";
import { displayName, findNearby } from "@/lib/nearby";
import type { Place } from "@/lib/places";
import { headline, rankFromRef, stationAt, stationRefs, type Station, type StationRef } from "@/lib/station-mode";
import { AfterPanel } from "./AfterPanel";
import { MapView, type MapPoint } from "./MapView";
import { Badges, Details, Item, MapLink, NumberBadge } from "./PlaceInfo";
import { RequestCard } from "./RequestCard";

type Nearby = {
  toilets: NearbyItem[];
  changeRooms: NearbyItem[];
  stores: NearbyItem[];
};

type PlacesResponse = { places: Place[]; stations: Station[] };

// 地下などで位置が取れないときに選ぶ場所（駅の中心のだいたいの位置）
const PRESETS: { label: string; pos: LatLon }[] = [
  { label: "新宿駅", pos: { lat: 35.6896, lon: 139.7006 } },
  { label: "丹波橋駅", pos: { lat: 34.937, lon: 135.7737 } },
  { label: "祇園四条駅", pos: { lat: 35.0037, lon: 135.7722 } },
  { label: "三条駅", pos: { lat: 35.0089, lon: 135.7723 } },
  { label: "出町柳駅", pos: { lat: 35.0303, lon: 135.7727 } },
];

export default function NowPage() {
  const [pos, setPos] = useState<{ at: LatLon; how: string } | null>(null);
  const [status, setStatus] = useState(() =>
    "geolocation" in navigator ? "位置を確かめています…" : "位置が使えません。下から今いる駅を選んでください。",
  );
  const [all, setAll] = useState<PlacesResponse | null>(null);
  const [card, setCard] = useState(false);
  const [after, setAfter] = useState(false);
  // 駅の中で「いまどこ？」に選んだホーム・改札（キーは label）
  const [refKey, setRefKey] = useState<string | null>(null);
  // 位置の取得が遅れて失敗したとき、すでに選んだ駅の表示を上書きしないため
  const chosen = useRef(false);

  const choose = (at: LatLon, how: string) => {
    chosen.current = true;
    setStatus("");
    setRefKey(null);
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

  // 駅の中か、すぐそばにいるか。いるなら方角ではなく事実を見出しにする
  const station = useMemo(() => (pos && all ? stationAt(all.stations ?? [], pos.at) : undefined), [pos, all]);
  const refs = useMemo(() => (station && all ? stationRefs(all.places, station) : []), [station, all]);
  const ref: StationRef | undefined = refs.find((r) => `${r.kind}:${r.label}` === refKey);

  const data: Nearby | null = useMemo(() => {
    if (!pos || !all) return null;
    // 駅の中では直線距離の順が当てにならないので、候補を多めに取って、実測の分数で並べ替える
    const toilets = findNearby(all.places, { from: pos.at, kind: "toilet", limit: station ? 6 : 3 });
    return {
      toilets: (ref ? rankFromRef(toilets, ref) : toilets).slice(0, station ? 4 : 3),
      changeRooms: findNearby(all.places, { from: pos.at, kind: "toilet", accessibleOnly: true, limit: 1 }),
      stores: findNearby(all.places, { from: pos.at, kind: "store", limit: 3 }),
    };
  }, [pos, all, station, ref]);
  const headOf = (x: NearbyItem) => (station ? headline(x, station, ref) : undefined);

  // 地図のピンと一覧で同じ番号を使う（トイレ → 着替えられる場所 → 店の順）
  const points: MapPoint[] = useMemo(() => {
    if (!data) return [];
    const seen = new Set<string>();
    const list: MapPoint[] = [];
    for (const x of [...data.toilets, ...data.changeRooms, ...data.stores]) {
      if (seen.has(x.place.id)) continue;
      seen.add(x.place.id);
      list.push({ n: list.length + 1, place: x.place });
    }
    return list;
  }, [data]);
  const numberOf = useMemo(() => new Map(points.map((p) => [p.place.id, p.n])), [points]);

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
          <div className="muted">
            <NumberBadge n={numberOf.get(first.place.id)} tier={first.place.tier} />
            {ref ? `${ref.label}から近いトイレ` : station ? `${station}駅のトイレ` : "一番近いトイレ"}
          </div>
          <div style={{ fontSize: station ? "1.5rem" : "2rem", fontWeight: 800, lineHeight: 1.25 }}>
            {headOf(first)?.main ?? `${first.direction}へ 約${first.walkMin}分`}
          </div>
          {headOf(first)?.sub && <div className="muted">{headOf(first)!.sub}</div>}
          <div>
            {displayName(first.place)}
            {!station && `（直線 ${first.meters}m）`}
          </div>
          <Details item={first} compact={!!station} />
          <Badges item={first} />
          <MapLink item={first} />
        </section>
      )}

      {station && (
        <section className="card">
          <div>
            <strong>いまどこ？（{station}駅の中）</strong>
          </div>
          {refs.length > 0 ? (
            <>
              <div className="muted">選ぶと、そこから実際に歩いて測った時間の短い順に並べ替えます。</div>
              <div className="chips" style={{ marginTop: 6 }}>
                {refs.map((r) => {
                  const key = `${r.kind}:${r.label}`;
                  return (
                    <button key={key} aria-pressed={refKey === key} onClick={() => setRefKey(refKey === key ? null : key)}>
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="muted">
              この駅の中は、まだ現地で測っていません。駅の中では方角と直線距離が当てにならないので、改札の内外や階など分かっていることを先に出しています。
            </div>
          )}
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

      {pos && points.length > 0 && <MapView center={pos.at} points={points} />}

      {data && data.toilets.length === 0 && (
        <p className="card">近く（1.5km 以内）にトイレのデータがありません。駅員や店員に聞いてください（お願いカードを見せられます）。</p>
      )}

      {data && data.toilets.length > 1 && (
        <>
          <h2>ほかのトイレ</h2>
          {data.toilets.slice(1).map((x) => (
            <Item key={x.place.id} item={x} n={numberOf.get(x.place.id)} head={headOf(x)} />
          ))}
        </>
      )}

      {data && (
        <>
          <h2>着替えられる場所（多機能トイレ）</h2>
          {data.changeRooms.length ? (
            data.changeRooms.map((x) => <Item key={x.place.id} item={x} n={numberOf.get(x.place.id)} head={headOf(x)} />)
          ) : (
            <p className="muted">近くに多機能トイレのデータがありません。</p>
          )}

          <h2>替えを買える店</h2>
          <p className="muted">品ぞろえは店によって違います。「現地確認済み」の店だけ、置いてあった品目を出しています。</p>
          {data.stores.map((x) => (
            <Item key={x.place.id} item={x} n={numberOf.get(x.place.id)} head={headOf(x)} />
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
