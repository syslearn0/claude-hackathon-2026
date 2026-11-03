"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

// 試作：駅の屋内データ（OSM）を階ごとに描いて、質を確かめる

type Feature = {
  id: string;
  kind: string;
  levels: string[];
  floors: number[]; // 日本式の階（1 = 1F、-1 = B1。scripts/normalize-indoor.ts が付ける）
  floorBasis: string;
  name?: string;
  coords: [number, number][];
  closed: boolean;
  tags: Record<string, string>;
};
type Indoor = { station: string; bbox: [number, number, number, number]; features: Feature[]; attribution: string };

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

// 階の呼び名。0 は「階不明」の目印に使う（日本式の階に 0 は無い）
const UNKNOWN = 0;
const floorLabel = (n: number) => (n === UNKNOWN ? "階不明" : n < 0 ? `B${-n}` : `${n}F`);
const floorsOf = (f: Feature) => (f.floors.length ? f.floors : [UNKNOWN]);

export default function IndoorLab() {
  const [data, setData] = useState<Indoor | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    fetch("/api/indoor?station=shinjuku")
      .then((r) => r.json())
      .then((d: Indoor) => setData(d));
  }, []);

  // 下の階から上へ。階不明は最後
  const floors = useMemo(() => {
    const count = new Map<number, number>();
    for (const f of data?.features ?? []) for (const n of floorsOf(f)) count.set(n, (count.get(n) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => (a[0] === UNKNOWN ? 1 : b[0] === UNKNOWN ? -1 : a[0] - b[0]));
  }, [data]);

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current);
    L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", {
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル</a> / © OpenStreetMap contributors',
      maxZoom: 20,
      maxNativeZoom: 18,
      opacity: 0.4,
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    m.setView([35.6896, 139.7006], 17);
    return () => {
      m.remove();
    };
  }, []);

  useEffect(() => {
    const g = layer.current;
    if (!g || !data || level === null) return;
    g.clearLayers();
    const on = data.features.filter((f) => floorsOf(f).includes(level));
    // その階の範囲に合わせて寄る
    const pts = on.flatMap((f) => f.coords);
    if (pts.length) map.current?.fitBounds(L.latLngBounds(pts), { padding: [12, 12], maxZoom: 19 });
    // 面を先に、線と点をあとに描く
    for (const f of on.filter((x) => x.closed && STYLE[x.kind])) {
      const s = STYLE[f.kind];
      L.polygon(f.coords, { color: s.color, weight: s.weight, fillColor: s.fill, fillOpacity: 0.9 })
        .bindTooltip(`${f.kind}${f.name ? `：${f.name}` : ""}`)
        .addTo(g);
    }
    for (const f of on.filter((x) => !x.closed && x.coords.length > 1 && STYLE[x.kind])) {
      const s = STYLE[f.kind];
      L.polyline(f.coords, { color: s.color, weight: s.weight }).bindTooltip(f.kind).addTo(g);
    }
    for (const f of on.filter((x) => ICON[x.kind])) {
      const i = ICON[f.kind];
      // 面で描かれたトイレなどは、真ん中あたりに印を置く
      const lat = f.coords.reduce((a, c) => a + c[0], 0) / f.coords.length;
      const lon = f.coords.reduce((a, c) => a + c[1], 0) / f.coords.length;
      L.marker([lat, lon], {
        icon: L.divIcon({
          className: "",
          html: `<div style="background:${i.bg};color:#fff;border-radius:6px;padding:1px 4px;font:700 11px system-ui;white-space:nowrap">${i.label}</div>`,
          iconSize: [24, 16],
          iconAnchor: [12, 8],
        }),
      })
        .bindTooltip(`${f.kind}${f.name ? `：${f.name}` : ""}${f.tags.wheelchair ? `（wheelchair=${f.tags.wheelchair}）` : ""}`)
        .addTo(g);
    }
  }, [data, level]);

  const on = data && level !== null ? data.features.filter((f) => floorsOf(f).includes(level)) : [];
  const count = (k: string) => on.filter((f) => f.kind === k).length;

  return (
    <main style={{ maxWidth: 900 }}>
      <p className="muted">
        <Link href="/">← もどる</Link>（試作ページ）
      </p>
      <h1>新宿駅の屋内データ（OSM）を階ごとに見る</h1>
      {!data && <p>読み込み中…</p>}
      <div className="chips">
        {floors.map(([l, n]) => (
          <button key={l} aria-pressed={level === l} onClick={() => setLevel(l)}>
            {floorLabel(l)}（{n}）
          </button>
        ))}
      </div>
      {level !== null && (
        <p className="muted">
          部屋 {count("room")}・店 {count("shop")}・通路 {count("corridor")}・広場 {count("area")}・ホーム {count("platform")}・トイレ {count("toilet")}・階段 {count("steps")}・EV {count("elevator")}・改札 {count("gate")}
        </p>
      )}
      <div ref={box} style={{ height: 560, border: "1px solid var(--line)", borderRadius: 10, marginTop: 8 }} />
      <p className="muted">{data?.attribution}</p>
    </main>
  );
}
