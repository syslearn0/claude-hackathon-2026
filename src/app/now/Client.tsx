"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LatLon } from "@/lib/geo";
import type { NearbyItem } from "@/lib/nearby";
import { displayName, findNearby } from "@/lib/nearby";
import type { Place } from "@/lib/places";
import { describeProfile, loadProfile } from "@/lib/profile";
import { loadTodayPlan } from "@/lib/saved-plan";
import { describeSituation, estimateSituation, type Fix, type RouteStation, type Situation } from "@/lib/situation";
import { distanceM } from "@/lib/geo";
import { describeTrainCars } from "@/lib/train-cars";
import { headline, isInStation, rankFromRef, stationAt, stationRefs, type Station, type StationRef } from "@/lib/station-mode";
import { indoorAt, INDOOR_STATIONS } from "@/lib/indoor";
import { AfterPanel } from "./AfterPanel";
import { EmergencyReview } from "./EmergencyReview";
import { IndoorMap } from "./IndoorMap";
import { RouteEditor } from "./RouteEditor";
import { MapView, type MapPoint } from "./MapView";
import { Badges, Details, Item, MapLink, NumberBadge } from "./PlaceInfo";

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
  const [after, setAfter] = useState(false);
  // 駅の中で「いまどこ？」に選んだホーム・改札（キーは label）
  const [refKey, setRefKey] = useState<string | null>(null);
  // ①で保存した今日の計画（あれば）
  const [plan, setPlan] = useState(() => loadTodayPlan());
  // 自分の情報（スマホの中だけ）
  const [profile] = useState(() => loadProfile());
  // 位置の取得が遅れて失敗したとき、すでに選んだ駅の表示を上書きしないため
  const chosen = useRef(false);
  // ② 直近4分の位置（この画面を開いているあいだだけ、メモリの中だけに持つ）
  const fixes = useRef<Fix[]>([]);
  const [situation, setSituation] = useState<Situation | null>(null);
  const [live, setLive] = useState<LatLon | null>(null);
  // 「電車の中なので次の駅」を利用者が「違う」と言ったら、自動の切り替えをやめる
  const [trainOff, setTrainOff] = useState(false);
  // 駅の中の地図（屋内データのある駅だけ）。通知から開いたとき（?indoor=）は最初から開く
  const [indoorFromUrl] = useState(() => {
    const key = new URLSearchParams(location.search).get("indoor");
    return Object.entries(INDOOR_STATIONS).find(([, v]) => v.key === key)?.[0];
  });
  const [indoorOpen, setIndoorOpen] = useState(() => !!indoorFromUrl);
  const indoorBox = useRef<HTMLElement>(null);
  const [notifyState, setNotifyState] = useState(() => ("Notification" in window ? Notification.permission : "unsupported"));
  // 範囲に入ったお知らせを閉じた駅
  const [noticeClosed, setNoticeClosed] = useState(false);
  // 地下などで位置が途切れたことを出すため、5秒ごとに今の時刻を持つ
  const [clock, setClock] = useState(() => Date.now());
  const [lastFixAt, setLastFixAt] = useState<number | null>(null);

  const choose = (at: LatLon, how: string) => {
    chosen.current = true;
    setStatus("");
    setRefKey(null);
    setTrainOff(true);
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

  const openIndoor = useCallback(() => {
    setIndoorOpen(true);
    setTimeout(() => indoorBox.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
  }, []);

  // 通知を押したとき、すでに開いていたこの画面にサービスワーカーから届く
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "open-indoor") openIndoor();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [openIndoor]);

  // トイレを探しているあいだ（この画面を開いているあいだ）に、屋内地図のある駅の範囲へ入ったら知らせる。
  // 画面を見ているときは画面の中で、ほかのアプリ（Google マップなど）を見ているときは通知で
  const inside = live ? indoorAt(live) : undefined;
  const lastInside = useRef<string | undefined>(undefined);
  useEffect(() => {
    const was = lastInside.current;
    lastInside.current = inside;
    // 画面を見ているときは、下の「範囲に入りました」の枠で知らせる
    if (!inside || inside === was || document.visibilityState === "visible") return;
    if (!("Notification" in window) || Notification.permission !== "granted" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready
      .then((reg) =>
        reg.showNotification(`${inside}駅の範囲に入りました`, {
          body: "押すと、駅の中の地図とトイレの候補を開きます",
          tag: `indoor-${INDOOR_STATIONS[inside].key}`,
          icon: "/icon-192.png",
          data: { url: `/now?indoor=${INDOOR_STATIONS[inside].key}` },
        }),
      )
      .catch(() => {});
  }, [inside]);

  // 保存した経路の駅に位置を付ける（データのある駅だけ）
  const route: RouteStation[] = useMemo(
    () =>
      (plan?.answer.route ?? [])
        .map((r) => {
          const s = all?.stations.find((x) => x.name === r.station);
          return s && { name: s.name, lat: s.lat, lon: s.lon, line: r.line, arr: r.arr, dep: r.dep };
        })
        .filter((x): x is NonNullable<typeof x> => !!x),
    [plan, all],
  );

  // 5秒ごとにも推定し直す。地下などで位置が届かないあいだも、予定の時刻から「いまどこ」を出し続けるため
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      setClock(now);
      if (all) setSituation(estimateSituation(fixes.current, all.stations ?? [], now, route));
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [all, route]);

  // 位置を追い続けて、止まっている／歩いている／乗り物の中かを推定する
  useEffect(() => {
    if (!("geolocation" in navigator) || !all) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const now = Date.now();
        fixes.current = [
          ...fixes.current.filter((f) => now - f.t < 240_000),
          { t: now, lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, speed: p.coords.speed },
        ];
        setLastFixAt(now);
        if (p.coords.accuracy <= 200) setLive({ lat: p.coords.latitude, lon: p.coords.longitude });
        setSituation(estimateSituation(fixes.current, all.stations ?? [], now, route));
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [all, route]);

  // 一覧を出す基準の位置。
  // ・電車の中と判断したら、次の駅（利用者が「違う」と言ったらやめる）
  // ・それ以外は最初に決めた位置のまま（歩き出した人の行き先を黙って変えないため）。
  //   ただし GPS で300m以上離れたら（電車で移動した後など）、いまの位置に合わせる
  const train = !trainOff && situation?.state === "vehicle" && situation.nextStation ? situation : null;
  const fromGps = pos?.how.startsWith("現在地") ?? false;
  const trainCars = train?.segment?.line ? describeTrainCars(train.segment.line) : null;
  const baseAt: LatLon | undefined = train
    ? { lat: train.nextStation!.lat, lon: train.nextStation!.lon }
    : fromGps && live && pos && distanceM(live, pos.at) > 300
      ? live
      : pos?.at;

  // 場所データは位置と関係なく丸ごと受け取る（位置をサーバーに送らないため）
  useEffect(() => {
    fetch("/api/places")
      .then((r) => r.json())
      .then(setAll)
      .catch(() => setStatus("候補を読み込めませんでした。通信を確かめてください。"));
  }, []);

  // 駅の中か、すぐそばにいるか。いるなら方角ではなく事実を見出しにする
  const station = useMemo(() => (baseAt && all ? stationAt(all.stations ?? [], baseAt) : undefined), [baseAt?.lat, baseAt?.lon, all]); // eslint-disable-line react-hooks/exhaustive-deps
  const refs = useMemo(() => (station && all ? stationRefs(all.places, station) : []), [station, all]);
  const ref: StationRef | undefined = refs.find((r) => `${r.kind}:${r.label}` === refKey);

  const data: Nearby | null = useMemo(() => {
    if (!baseAt || !all) return null;
    // 駅の中では直線距離の順が当てにならないので、候補を多めに取って、実測の分数で並べ替える
    const prefer = { preferAccessible: profile.needAccessible === true, preferOstomate: profile.needOstomate === true };
    const toilets = findNearby(all.places, { from: baseAt, kind: "toilet", limit: station ? 6 : 3, ...prefer });
    return {
      toilets: (ref ? rankFromRef(toilets, ref) : toilets).slice(0, station ? 4 : 3),
      changeRooms: findNearby(all.places, { from: baseAt, kind: "toilet", accessibleOnly: true, limit: 1, preferOstomate: prefer.preferOstomate }),
      stores: findNearby(all.places, { from: baseAt, kind: "store", limit: 3 }),
    };
  }, [baseAt?.lat, baseAt?.lon, all, station, ref, profile]); // eslint-disable-line react-hooks/exhaustive-deps

  // 駅を選ぶボタン：登録した「よく使う駅」を先に（データのある駅だけ）
  // 今日の経路の駅（出発・乗り換え・到着）を一番先に。次に登録した「よく使う駅」、そのあとに決まった駅
  const presets = useMemo(() => {
    const onRoute = route.map((s) => ({ label: `${s.name}駅`, pos: { lat: s.lat, lon: s.lon }, mark: "経路 " }));
    const mine = (profile.homeStations ?? [])
      .map((name) => all?.stations.find((s) => s.name === name))
      .filter((s): s is Station => !!s)
      .map((s) => ({ label: `${s.name}駅`, pos: { lat: s.lat, lon: s.lon }, mark: "★ " }));
    const list = [...onRoute, ...mine, ...PRESETS.map((p) => ({ ...p, mark: "" }))];
    return list.filter((p, i) => list.findIndex((q) => q.label === p.label) === i);
  }, [route, profile, all]);
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
  // 地図を出す駅：基準の位置が駅のそばなら、その駅。GPS で範囲の中にいれば、その駅
  // 通知から開いたときは、位置がまだ取れていなくてもその駅の地図を出す
  const indoorStation = station && INDOOR_STATIONS[station] ? station : (inside ?? indoorFromUrl);
  useEffect(() => {
    if (indoorOpen && indoorStation) indoorBox.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // 通知から開いたときに一度だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indoorStation]);

  return (
    <main>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <Link href="/" className="muted">
          ← もどる
        </Link>
        <Link href="/me" className="muted">
          自分の情報
        </Link>
      </div>

      {plan && (
        <p className="card">
          <strong>今日の計画</strong>：{plan.answer.summary} <Link href="/plan">計画を見る</Link>
        </p>
      )}

      {train ? (
        <section className="card" style={{ borderColor: "var(--accent)", borderWidth: 2 }}>
          {train.where && (
            <div style={{ fontSize: "1.4rem", fontWeight: 800, lineHeight: 1.3 }}>
              いま：{train.where}
            </div>
          )}
          {train.plan && <div>{train.plan}</div>}
          <strong>
            {train.basis === "schedule"
              ? "位置が取れないので、予定の時刻から推定しました"
              : train.betweenStations
                ? "駅と駅の間で止まっていると推定しました"
                : "電車で移動中と推定しました"}
            ：次の駅（推定）{train.nextStation!.name}駅のトイレを出しています
          </strong>
          <div className="muted">{train.reason}</div>
          {lastFixAt !== null && clock - lastFixAt > 30_000 && (
            <div style={{ marginTop: 4 }}>
              位置が {Math.round((clock - lastFixAt) / 1000)} 秒取れていません（地下かもしれません）。最後の推定のまま出しています。
            </div>
          )}
          {trainCars && <div style={{ marginTop: 4 }}>{trainCars}</div>}
          <div className="row" style={{ marginTop: 6 }}>
            <button onClick={() => setTrainOff(true)}>違う（いる場所の近くを出す）</button>
            <button onClick={() => document.getElementById("route-editor")?.scrollIntoView({ behavior: "smooth" })}>電車の予定を変える</button>
          </div>
        </section>
      ) : (
        pos && <p className="muted">基準：{baseAt && pos.at !== baseAt ? "いまの位置（最初の位置から300m以上動いたため）" : pos.how}</p>
      )}
      {/* 予定の時刻から出しているときは、上の枠で位置が取れないことを伝えているので重ねない */}
      {status && train?.basis !== "schedule" && <p className="card">{status}</p>}
      {!train && situation?.basis === "schedule" && situation.where && (
        <p className="card">
          予定では、いま<strong>{situation.where}</strong>です。{situation.plan}
        </p>
      )}

      {inside && !indoorOpen && !noticeClosed && (
        <section className="card" style={{ borderColor: "var(--accent)" }}>
          <strong>{inside}駅の範囲に入りました</strong>
          <div className="muted">駅の中の地図（試作）に、トイレの候補を階ごとに重ねて出せます。</div>
          <button
            style={{ marginTop: 6 }}
            onClick={() => {
              setNoticeClosed(true);
              openIndoor();
            }}
          >
            駅の中の地図を開く
          </button>
        </section>
      )}

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
          <MapLink item={first} inStation={isInStation(first, station)} big />
        </section>
      )}

      {pos && data && (
        <EmergencyReview
          pos={live ?? pos.at}
          programFirstId={first?.place.id}
          situationText={describeSituation(
            situation ?? { state: "unknown", reason: pos.how.startsWith("現在地") ? "位置は1回だけ取れた" : `利用者が「${pos.how}」を選んだ` },
            live ?? pos.at,
            first ? `${first.place.id}（${displayName(first.place)}）` : undefined,
            plan?.answer.summary,
          ) + (describeProfile(profile, "emergency") ? `\n${describeProfile(profile, "emergency")}` : "")}
        />
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
              この駅の中はまだ現地で測っていません。方角と距離は目安です。改札の内外・階を先に出しています。
            </div>
          )}
        </section>
      )}

      {indoorStation && (
        <section className="card" ref={indoorBox} style={{ scrollMarginTop: 8 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{indoorStation}駅の中の地図（試作）</strong>
            <button onClick={() => setIndoorOpen(!indoorOpen)}>{indoorOpen ? "閉じる" : "開く"}</button>
          </div>
          {indoorOpen && <IndoorMap station={indoorStation} points={points} here={live && indoorAt(live) ? live : undefined} />}
          {indoorOpen && (
            <Link
              href={`/lab/3d?station=${encodeURIComponent(indoorStation)}${first ? `&goal=${encodeURIComponent(first.place.id)}` : ""}`}
              className="button"
              style={{ marginTop: 8, display: "block", textAlign: "center" }}
            >
              ホーム・改札からトイレまでの道順を 3D で見る（試作）
            </Link>
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
            <AfterPanel pos={baseAt ?? pos.at} places={all.places} profile={profile} />
          )}
        </>
      )}

      {baseAt && points.length > 0 && <MapView center={baseAt} points={points} />}

      {data && data.toilets.length === 0 && (
        <p className="card">近く（1.5km 以内）にトイレのデータがありません。駅員や店員に聞いてください。</p>
      )}

      {data && data.toilets.length > 1 && (
        <>
          <h2>ほかのトイレ</h2>
          {data.toilets.slice(1).map((x) => (
            <Item key={x.place.id} item={x} n={numberOf.get(x.place.id)} head={headOf(x)} inStation={isInStation(x, station)} />
          ))}
        </>
      )}

      {data && (
        <>
          <h2>着替えられる場所（多機能トイレ）</h2>
          {data.changeRooms.length ? (
            data.changeRooms.map((x) => <Item key={x.place.id} item={x} n={numberOf.get(x.place.id)} head={headOf(x)} inStation={isInStation(x, station)} />)
          ) : (
            <p className="muted">近くに多機能トイレのデータがありません。</p>
          )}

          <h2>替えを買える店</h2>
          <p className="muted">品ぞろえは店によって違います。「現地確認済み」の店だけ、置いてあった品目を出しています。</p>
          {data.stores.map((x) => (
            <Item key={x.place.id} item={x} n={numberOf.get(x.place.id)} head={headOf(x)} inStation={isInStation(x, station)} />
          ))}
          <p className="muted">
            © OpenStreetMap contributors (ODbL 1.0)／出典：東京都「車椅子使用者対応トイレのバリアフリー情報」（CC BY 4.0）を加工して作成／出典：国土交通省 高精度測位社会プロジェクト、「新宿駅周辺屋内地図データ」「東京駅周辺屋内地図データ」（国土交通省）を加工して作成／出典：「歩行空間ネットワークデータ（都営地下鉄大江戸線 各駅）」構内地図データ（国土交通省）を加工して作成
          </p>
          <p className="muted">近くの場所はこの端末の中で探しています。現在地をサーバーに送るのは、AI の見直しがオンのときだけです（保存はしません）。</p>
        </>
      )}

      {notifyState === "default" && (
        <p className="card">
          <button
            onClick={() =>
              Notification.requestPermission()
                .then(setNotifyState)
                .catch(() => {})
            }
          >
            駅の中の地図がある駅に入ったら、通知で知らせる
          </button>
          <span className="muted" style={{ display: "block", marginTop: 4 }}>
            この画面を開いたまま、Google マップなどで道順を見ているときに使います。いまは新宿駅だけです。
          </span>
        </p>
      )}

      {all && (
        <RouteEditor
          plan={plan}
          stationNames={new Set(all.stations.map((s) => s.name))}
          onSaved={(p) => {
            setPlan(p);
            // 経路を直したら、「違う」で止めた自動の切り替えも戻す
            setTrainOff(false);
          }}
        />
      )}

      <h2>今いる場所を選ぶ</h2>
      <div className="chips">
        <button
          onClick={() => {
            chosen.current = false;
            setTrainOff(false);
            setStatus("位置を確かめています…");
            locate();
          }}
        >
          現在地をもう一度
        </button>
        {presets.map((p) => (
          <button key={p.label} onClick={() => choose(p.pos, `${p.label}（駅の中心のだいたいの位置）`)}>
            {p.mark}
            {p.label}
          </button>
        ))}
      </div>
    </main>
  );
}
