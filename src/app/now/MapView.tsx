"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import type { LatLon } from "@/lib/geo";
import type { Place, Tier } from "@/lib/places";

// 一覧の場所を番号つきのピンで出す補助の地図。主役は文の案内のまま。
// 背景は国土地理院の淡色地図（出典の表示が必要）。

export type MapPoint = { n: number; place: Place };

// 信頼度ごとの色（明るい背景・暗い背景のどちらでも見分けられる組み合わせ）
export const TIER_COLOR: Record<Tier, string> = {
  verified: "#1e7a3c",
  official: "#1f5fbf",
  osm: "#7a7a72",
  report: "#a15c00",
};

const GSI_PALE = "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png";
const GSI_ATTRIBUTION = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル</a>';

export function pin(n: number, tier: Tier): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="background:${TIER_COLOR[tier]};color:#fff;border:2px solid #fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font:700 13px system-ui;box-shadow:0 1px 3px rgba(0,0,0,.4)">${n}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

const HERE = L.divIcon({
  className: "",
  html: '<div style="background:#d93025;border:3px solid #fff;border-radius:50%;width:18px;height:18px;box-shadow:0 0 0 6px rgba(217,48,37,.25)"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

export function MapView({ center, points }: { center: LatLon; points: MapPoint[] }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { zoomControl: true, attributionControl: true });
    L.tileLayer(GSI_PALE, { attribution: GSI_ATTRIBUTION, maxZoom: 18, minZoom: 5 }).addTo(m);
    m.attributionControl.setPrefix(false);
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
    if (!m || !g) return;
    g.clearLayers();
    L.marker([center.lat, center.lon], { icon: HERE, title: "基準の位置" }).addTo(g);
    for (const p of points) {
      L.marker([p.place.lat, p.place.lon], { icon: pin(p.n, p.place.tier), title: String(p.n) }).addTo(g);
    }
    const all = [[center.lat, center.lon], ...points.map((p) => [p.place.lat, p.place.lon])] as [number, number][];
    m.fitBounds(L.latLngBounds(all), { padding: [24, 24], maxZoom: 18 });
  }, [center, points]);

  return (
    <div>
      <div ref={box} style={{ height: 240, borderRadius: 10, overflow: "hidden", border: "1px solid var(--line)" }} />
      <div className="chips muted" style={{ marginTop: 6, fontSize: "0.8rem" }}>
        <span>
          <span style={{ color: "#d93025" }}>●</span> 基準の位置
        </span>
        <span>
          <span style={{ color: TIER_COLOR.verified }}>●</span> 現地確認済み
        </span>
        <span>
          <span style={{ color: TIER_COLOR.official }}>●</span> 公式データ
        </span>
        <span>
          <span style={{ color: TIER_COLOR.osm }}>●</span> OSM・未確認
        </span>
      </div>
      <p className="muted" style={{ fontSize: "0.8rem", margin: "4px 0 0" }}>
        地図の画像は国土地理院から読み込むため、表示している範囲は国土地理院のサーバーに伝わります（現在地そのものは送りません）。
      </p>
    </div>
  );
}
