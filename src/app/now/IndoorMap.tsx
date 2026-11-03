"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LatLon } from "@/lib/geo";
import { floorLabel, INDOOR_STATIONS, parseFloor, type Indoor, type IndoorFeature } from "@/lib/indoor";
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

// 1つの階の地物を描く（面 → 線 → 印の順）。試作ページ（/lab/indoor）でも使う
export function drawFeatures(g: L.LayerGroup, on: IndoorFeature[]) {
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

  useEffect(() => {
    if (!key) return;
    fetch(`/api/indoor?station=${key}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setFailed(true));
  }, [key]);

  // 候補の階（分かるものだけ）
  const pointFloor = useMemo(() => new Map(points.map((p) => [p.place.id, parseFloor(p.place.floor)])), [points]);

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
    m.attributionControl.addAttribution("© OpenStreetMap contributors");
    layer.current = L.layerGroup().addTo(m);
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
    const on = data.features.filter((f) => f.floors.includes(floor));
    drawFeatures(g, on);
    // 候補：この階のものは濃く、階が分からないものは薄く。別の階のものは出さない
    const shown: [number, number][] = [];
    for (const p of points) {
      const pf = pointFloor.get(p.place.id);
      if (pf !== undefined && pf !== floor) continue;
      L.marker([p.place.lat, p.place.lon], { icon: pin(p.n, p.place.tier), opacity: pf === undefined ? 0.55 : 1, zIndexOffset: 1000 })
        .bindTooltip(pf === undefined ? `${p.n}（階は不明）` : `${p.n}（${floorLabel(pf)}）`)
        .addTo(g);
      shown.push([p.place.lat, p.place.lon]);
    }
    if (here) L.marker([here.lat, here.lon], { icon: HERE, zIndexOffset: 2000, title: "いまの位置（階は分かりません）" }).addTo(g);
    // 候補と現在地が入る範囲に寄る。なければ、その階の全体
    const pts = shown.length ? [...shown, ...(here ? [[here.lat, here.lon] as [number, number]] : [])] : on.flatMap((f) => f.coords);
    if (pts.length) m.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 19 });
    // 現在地は動くたびに寄せ直さない（地図を触っている人の邪魔をしないため）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, floor, points, pointFloor, here?.lat, here?.lon]);

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
      <div ref={box} style={{ height: 340, borderRadius: 10, overflow: "hidden", border: "1px solid var(--line)", marginTop: 6, background: "#f7f6f1" }} />
      <div className="chips muted" style={{ marginTop: 6, fontSize: "0.8rem" }}>
        <span>番号：上の一覧の候補</span>
        <span>
          <span style={{ background: ICON.toilet.bg, color: "#fff", borderRadius: 4, padding: "0 3px" }}>WC</span> OSM に描かれたトイレ
        </span>
        <span>
          <span style={{ background: ICON.gate.bg, color: "#fff", borderRadius: 4, padding: "0 3px" }}>改</span> 改札
        </span>
      </div>
      <p className="muted" style={{ fontSize: "0.8rem", margin: "4px 0 0" }}>
        試作：OpenStreetMap の屋内データ（有志が描いたもの）で、抜けや古いところがあります。南口・新南のあたりはほとんど描かれていません。階が分からない候補は薄く出しています。
      </p>
    </div>
  );
}
