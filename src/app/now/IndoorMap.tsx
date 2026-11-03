"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LatLon } from "@/lib/geo";
import { FLOOR_BASIS_JA, floorLabel, INDOOR_STATIONS, placeFloor, type FloorGuess, type Indoor, type IndoorFeature } from "@/lib/indoor";
import { pin, type MapPoint } from "./MapView";

// 駅の中の階ごとの地図（試作）。OSM の屋内データを描き、一覧の候補を同じ番号で重ねる。
// 背景のタイルは使わない（屋内の形だけで足りるうえ、電波がなくても出せる）。

const STYLE: Record<string, { color: string; fill?: string; weight?: number }> = {
  room: { color: "#9a9a92", fill: "#e9e7df", weight: 1 },
  shop: { color: "#9a9a92", fill: "#f3e7c9", weight: 1 },
  corridor: { color: "#b9c7dd", fill: "#dfe8f5", weight: 1 },
  area: { color: "#c9d6c3", fill: "#eef3ea", weight: 1 },
  platform: { color: "#8aa0bf", fill: "#cfdaea", weight: 1 },
  steps: { color: "#a15c00", weight: 3 },
  escalator: { color: "#7a3fb0", weight: 3 },
};

const ICON: Record<string, { label: string; bg: string }> = {
  toilet: { label: "WC", bg: "#1f5fbf" },
  elevator: { label: "EV", bg: "#1e7a3c" },
  gate: { label: "改", bg: "#d93025" },
  entrance: { label: "出", bg: "#444" },
};

const KIND_JA: Record<string, string> = { toilet: "トイレ", elevator: "エレベーター", gate: "改札", entrance: "出入口", room: "部屋", shop: "店", corridor: "通路", platform: "ホーム" };

const centerOf = (f: IndoorFeature): [number, number] => [
  f.coords.reduce((a, c) => a + c[0], 0) / f.coords.length,
  f.coords.reduce((a, c) => a + c[1], 0) / f.coords.length,
];

// 1つの階の地物を描く（面 → 線 → 印の順）。試作ページ（/lab/indoor）では全部（detail）、
// 緊急の画面では見やすさを優先して、通路と部屋の形・トイレ・改札と、上り下りの手段を控えめに出す：
// ・エスカレーターは細い紫の線、エレベーターは小さな緑の点（文字なし）
// ・階段は数が多いので、細い点線にして、地図を大きくしたとき（fine）だけ出す
// ・行き先（focus）のそばの上り下りの手段だけ、どの階とつながるかを文字で添える
const SIMPLE: Record<string, { color: string; fill: string }> = {
  corridor: { color: "#c9d3e0", fill: "#dde7f2" },
  area: { color: "#c9d3e0", fill: "#dde7f2" },
  platform: { color: "#c9d3e0", fill: "#dde7f2" },
  room: { color: "#cfccc0", fill: "#ebe9e1" },
  shop: { color: "#cfccc0", fill: "#ebe9e1" },
};
const SMALL: Record<string, { label: string; bg: string }> = {
  toilet: { label: "WC", bg: "#1f5fbf" },
  gate: { label: "改", bg: "#d93025" },
};

const floorsText = (f: IndoorFeature) => f.floors.map(floorLabel).join("・");
const VERT = {
  escalator: { color: "#8a63b8", weight: 2.5, label: "エスカ" },
  steps: { color: "#a8875c", weight: 1.5, label: "階段" },
} as const;

function tag(at: [number, number], text: string, bg: string) {
  return L.marker(at, {
    interactive: false,
    icon: L.divIcon({
      className: "",
      html: `<div style="background:${bg};color:#fff;border-radius:4px;padding:0 3px;font:700 9px/13px system-ui;white-space:nowrap;transform:translate(6px,-14px)">${text}</div>`,
      iconSize: [0, 0],
    }),
  });
}

export function drawFeatures(g: L.LayerGroup, on: IndoorFeature[], detail = true, opts: { fine?: L.LayerGroup; focus?: [number, number][] } = {}) {
  if (!detail) {
    for (const f of on.filter((x) => x.closed && SIMPLE[x.kind])) {
      const s = SIMPLE[f.kind];
      L.polygon(f.coords, { color: s.color, weight: 0.5, fillColor: s.fill, fillOpacity: 1, interactive: false }).addTo(g);
    }
    for (const f of on.filter((x) => SMALL[x.kind])) {
      const i = SMALL[f.kind];
      L.marker(centerOf(f), {
        icon: L.divIcon({
          className: "",
          html: `<div style="background:${i.bg};color:#fff;border-radius:4px;padding:0 2px;font:700 9px/13px system-ui;opacity:.75">${i.label}</div>`,
          iconSize: [18, 13],
          iconAnchor: [9, 6],
        }),
      })
        .bindTooltip(`${KIND_JA[f.kind]}${f.name ? `：${f.name}` : ""}（OSM）`)
        .addTo(g);
    }
    // 上り下りの手段
    const focus = opts.focus ?? [];
    const nearFocus = (f: IndoorFeature) => {
      const c = centerOf(f);
      return focus.some((p) => Math.hypot((p[0] - c[0]) * 111_000, (p[1] - c[1]) * 91_000) < 60);
    };
    // 文字を添えるのは、行き先に近いエレベーターとエスカレーターを2つずつだけ（階段には添えない。数が多くて込み合うため）
    const away = (f: IndoorFeature) => Math.min(...focus.map((p) => Math.hypot((p[0] - centerOf(f)[0]) * 111_000, (p[1] - centerOf(f)[1]) * 91_000)));
    const nearest = (kind: string) =>
      on
        .filter((x) => x.kind === kind && x.floors.length > 1 && nearFocus(x))
        .sort((x, y) => away(x) - away(y))
        .slice(0, 2)
        .map((x) => x.id);
    const tagged = new Set([...nearest("elevator"), ...nearest("escalator")]);
    for (const f of on.filter((x) => x.kind === "escalator" || x.kind === "steps")) {
      const v = VERT[f.kind as keyof typeof VERT];
      const close = nearFocus(f);
      const shape = f.closed
        ? L.polygon(f.coords, { color: v.color, weight: v.weight * (close ? 1.5 : 1), fillOpacity: 0.15, fillColor: v.color })
        : L.polyline(f.coords, { color: v.color, weight: v.weight * (close ? 1.5 : 1), dashArray: f.kind === "steps" ? "3 3" : undefined });
      shape.bindTooltip(`${f.kind === "steps" ? "階段" : "エスカレーター"}（${floorsText(f) || "階不明"}）`);
      // 階段は、行き先のそば以外は大きくしたときだけ
      shape.addTo(f.kind === "steps" && !close && opts.fine ? opts.fine : g);
      if (tagged.has(f.id)) tag(centerOf(f), `${v.label} ${floorsText(f)}`, v.color).addTo(g);
    }
    for (const f of on.filter((x) => x.kind === "elevator")) {
      const close = nearFocus(f);
      L.marker(centerOf(f), {
        icon: L.divIcon({
          className: "",
          html: `<div style="width:${close ? 11 : 8}px;height:${close ? 11 : 8}px;border-radius:2px;background:#1e7a3c;border:1px solid #fff"></div>`,
          iconSize: [close ? 11 : 8, close ? 11 : 8],
          iconAnchor: [close ? 5 : 4, close ? 5 : 4],
        }),
      })
        .bindTooltip(`エレベーター（${floorsText(f) || "階不明"}）${f.name ? `：${f.name}` : ""}`)
        .addTo(g);
      if (tagged.has(f.id)) tag(centerOf(f), `EV ${floorsText(f)}`, "#1e7a3c").addTo(g);
    }
    return;
  }
  for (const f of on.filter((x) => x.closed && STYLE[x.kind])) {
    const s = STYLE[f.kind];
    L.polygon(f.coords, { color: s.color, weight: s.weight, fillColor: s.fill, fillOpacity: 0.9 })
      .bindTooltip(`${KIND_JA[f.kind] ?? f.kind}${f.name ? `：${f.name}` : ""}`)
      .addTo(g);
  }
  for (const f of on.filter((x) => !x.closed && x.coords.length > 1 && STYLE[x.kind])) {
    const s = STYLE[f.kind];
    L.polyline(f.coords, { color: s.color, weight: s.weight }).bindTooltip(f.kind === "steps" ? "階段" : "エスカレーター").addTo(g);
  }
  for (const f of on.filter((x) => ICON[x.kind])) {
    const i = ICON[f.kind];
    L.marker(centerOf(f), {
      icon: L.divIcon({
        className: "",
        html: `<div style="background:${i.bg};color:#fff;border-radius:6px;padding:1px 4px;font:700 11px system-ui;white-space:nowrap">${i.label}</div>`,
        iconSize: [24, 16],
        iconAnchor: [12, 8],
      }),
    })
      .bindTooltip(`${KIND_JA[f.kind]}${f.name ? `：${f.name}` : ""}（OSM）`)
      .addTo(g);
  }
}

const floorText = (g: FloorGuess) => `${floorLabel(g.floor)}${FLOOR_BASIS_JA[g.basis] ? `・${FLOOR_BASIS_JA[g.basis]}` : ""}`;

const HERE = L.divIcon({
  className: "",
  html: '<div style="background:#d93025;border:3px solid #fff;border-radius:50%;width:16px;height:16px;box-shadow:0 0 0 6px rgba(217,48,37,.25)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

export function IndoorMap({ station, points, here }: { station: string; points: MapPoint[]; here?: LatLon }) {
  const key = INDOOR_STATIONS[station]?.key;
  const [data, setData] = useState<Indoor | null>(null);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fine = useRef<L.LayerGroup | null>(null);
  // いま見えている範囲に、この階の屋内データがほとんどないか（空の地図だけを見せないため）
  const shownFeatures = useRef<IndoorFeature[]>([]);
  const [sparse, setSparse] = useState(false);

  useEffect(() => {
    if (!key) return;
    fetch(`/api/indoor?station=${key}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setFailed(true));
  }, [key]);

  // 候補の階（分かるものだけ）。書いてある階 → OSM の level（目安）→ 駅の地図の部屋・通路から推定、の順
  const guess = useMemo(() => new Map(points.map((p) => [p.place.id, placeFloor(p.place, data?.features)])), [points, data]);
  const pointFloor = useMemo(() => new Map([...guess].map(([id, g]) => [id, g?.floor])), [guess]);

  // 選べる階：地物が多い階だけ（下から上へ）
  const floors = useMemo(() => {
    const count = new Map<number, number>();
    for (const f of data?.features ?? []) for (const n of f.floors) count.set(n, (count.get(n) ?? 0) + 1);
    return [...count.entries()].filter(([, c]) => c >= 20).map(([n]) => n).sort((a, b) => a - b);
  }, [data]);

  // 最初に出す階：一番の候補の階。分からなければ地下1階
  const firstFloor = points.map((p) => pointFloor.get(p.place.id)).find((n) => n !== undefined);
  const [picked, setPicked] = useState<number | null>(null);
  const floor = picked ?? (firstFloor !== undefined && floors.includes(firstFloor) ? firstFloor : floors.includes(-1) ? -1 : floors[0]);

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { zoomControl: true, attributionControl: true });
    m.attributionControl.setPrefix(false);
    m.attributionControl.addAttribution('© OpenStreetMap contributors／出典：国土交通省 高精度測位社会プロジェクト');
    layer.current = L.layerGroup().addTo(m);
    fine.current = L.layerGroup();
    // 階段（細かい層）は、地図を大きくしたときだけ出す
    const toggleFine = () => {
      if (m.getZoom() >= 19) fine.current!.addTo(m);
      else fine.current!.remove();
    };
    m.on("zoomend", toggleFine);
    m.on("moveend", () => {
      const b = m.getBounds();
      // 見えている範囲に重なる面の数（大きな通路は中心が範囲の外にあることが多いので、重なりで数える）
      const n = shownFeatures.current.filter((f) => f.closed && b.intersects(L.latLngBounds(f.coords))).length;
      setSparse(n < 5);
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g || !data || floor === undefined) return;
    g.clearLayers();
    fine.current?.clearLayers();
    const on = data.features.filter((f) => f.floors.includes(floor));
    shownFeatures.current = on;
    const near = (f: IndoorFeature) => points.some((p) => Math.hypot((p.place.lat - centerOf(f)[0]) * 111_000, (p.place.lon - centerOf(f)[1]) * 91_000) < 30);
    // 行き先：一番の候補（位置が分かり、この階にあるとき）と現在地。上り下りの手段のどれを目立たせるかに使う
    const top0 = points[0];
    const goal: [number, number][] = [
      ...(top0 && !top0.place.approxLocation && (pointFloor.get(top0.place.id) ?? floor) === floor ? [[top0.place.lat, top0.place.lon] as [number, number]] : []),
      ...(here ? [[here.lat, here.lon] as [number, number]] : []),
    ];
    drawFeatures(g, on.filter((f) => !(f.kind === "toilet" && near(f))), false, { fine: fine.current ?? undefined, focus: goal });
    // 候補：この階のものは濃く、階が分からないものは薄く。別の階のものは出さない
    const shown: [number, number][] = [];
    for (const p of points) {
      const pf = pointFloor.get(p.place.id);
      // 駅の代表の位置しか分からない候補は、地図に置くと場所を誤って伝えるので、地図の下に文で出す
      if (p.place.approxLocation || (pf !== undefined && pf !== floor)) continue;
      L.marker([p.place.lat, p.place.lon], { icon: pin(p.n, p.place.tier), opacity: pf === undefined ? 0.55 : 1, zIndexOffset: 1000 })
        .bindTooltip(pf === undefined ? `${p.n}（階は不明）` : `${p.n}（${floorText(guess.get(p.place.id)!)}）`)
        .addTo(g);
      shown.push([p.place.lat, p.place.lon]);
    }
    if (here) L.marker([here.lat, here.lon], { icon: HERE, zIndexOffset: 2000, title: "いまの位置（階は分かりません）" }).addTo(g);
    // 一番の候補（と現在地）に寄る。一番の候補がこの階になければ、出した候補の範囲。どれもなければ、その階の全体
    const top = points[0];
    const topHere = top && !top.place.approxLocation && (pointFloor.get(top.place.id) ?? floor) === floor ? [[top.place.lat, top.place.lon] as [number, number]] : [];
    const focus = topHere.length ? topHere : shown;
    // 駅の中心もいつも入れる（中心の近くほど屋内データが多い。端に立っていても駅の中が見えるように）
    const c = INDOOR_STATIONS[station].center;
    const pts = focus.length || here ? [...focus, ...(here ? [[here.lat, here.lon] as [number, number]] : []), [c.lat, c.lon] as [number, number]] : on.flatMap((f) => f.coords);
    if (pts.length) m.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 18 });
    // 寄せ直さなかったとき（同じ範囲）も、「地図がほとんどない」の判定をこの階でやり直す
    m.fire("moveend");
    // 現在地は動くたびに寄せ直さない（地図を触っている人の邪魔をしないため）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, floor, points, pointFloor, here?.lat, here?.lon, station]);

  // この階の、位置が駅の代表でしか分からない候補
  const approx = points.filter((p) => p.place.approxLocation && (pointFloor.get(p.place.id) ?? floor) === floor);

  if (!key) return null;
  return (
    <div>
      <div className="chips">
        {floors.map((n) => (
          <button key={n} aria-pressed={floor === n} onClick={() => setPicked(n)}>
            {floorLabel(n)}
          </button>
        ))}
      </div>
      {failed && <p className="muted">駅の中の地図を読み込めませんでした。</p>}
      {!data && !failed && <p className="muted">駅の中の地図を読み込んでいます…</p>}
      <div style={{ position: "relative", marginTop: 6 }}>
        <div ref={box} style={{ height: 340, borderRadius: 10, overflow: "hidden", border: "1px solid var(--line)", background: "#fcfcfa" }} />
        {sparse && data && floor !== undefined && (
          <div
            style={{ position: "absolute", left: 8, right: 8, bottom: 26, zIndex: 1000, background: "rgba(255,255,255,.92)", color: "#1d1d1b", borderRadius: 8, padding: "6px 8px", fontSize: "0.85rem", pointerEvents: "none" }}
          >
            この辺りの{floorLabel(floor)}は、駅の中の地図がほとんどありません（まだ誰も描いていない場所です）。番号の候補と、下の一覧を見てください。
          </div>
        )}
      </div>
      {approx.length > 0 && (
        <div style={{ marginTop: 6 }}>
          地図にない候補（場所は駅の代表の位置しか分からない）：
          {approx.map((p) => `${p.n}（${p.place.floor ?? "階不明"}）`).join("、")}
        </div>
      )}
      <div className="chips muted" style={{ marginTop: 6, fontSize: "0.8rem" }}>
        <span>番号：上の一覧の候補</span>
        <span>
          <span style={{ background: ICON.toilet.bg, color: "#fff", borderRadius: 4, padding: "0 3px" }}>WC</span> OSM に描かれたトイレ
        </span>
        <span>
          <span style={{ background: ICON.gate.bg, color: "#fff", borderRadius: 4, padding: "0 3px" }}>改</span> 改札
        </span>
        <span>
          <span style={{ color: VERT.escalator.color, fontWeight: 800 }}>━</span> エスカレーター
        </span>
        <span>
          <span style={{ display: "inline-block", width: 8, height: 8, background: "#1e7a3c", borderRadius: 2 }} /> エレベーター
        </span>
        <span>
          <span style={{ color: VERT.steps.color }}>┅</span> 階段（拡大すると出ます）
        </span>
      </div>
      <p className="muted" style={{ fontSize: "0.8rem", margin: "4px 0 0" }}>
        試作：OpenStreetMap の屋内データ（有志が描いたもの）と、
        <a href="https://www.geospatial.jp/ckan/dataset/mlit-indoor-shinjuku-r2" target="_blank" rel="noreferrer">
          「新宿駅周辺屋内地図データ」（国土交通省）
        </a>
        を加工して重ねています（国の案内ではありません）。国交省のデータは2020年8月時点で、改札の外が中心です。抜けや古いところがあります。階が分からない候補は薄く出しています。
      </p>
    </div>
  );
}
