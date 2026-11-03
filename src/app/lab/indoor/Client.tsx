"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { drawFeatures } from "@/app/now/IndoorMap";
import { floorLabel as label, type Indoor, type IndoorFeature } from "@/lib/indoor";

// 試作：駅の屋内データ（OSM）を階ごとに描いて、質を確かめる

type Feature = IndoorFeature;

// 階の呼び名。0 は「階不明」の目印に使う（日本式の階に 0 は無い）
const UNKNOWN = 0;
const floorLabel = (n: number) => (n === UNKNOWN ? "階不明" : label(n));
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
    drawFeatures(g, on);
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
