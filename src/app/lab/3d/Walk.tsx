"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Indoor } from "@/lib/indoor";
import { FLOOR_M, maneuvers, pointAt, routePath } from "@/lib/maneuvers";
import type { GuideStep, Network, Route } from "@/lib/route";

// 歩く目線の 3D。カメラの映像（AR）ではなく、データから作った駅の中に矢印の帯を敷いて、その上を歩く。
// 地下で現在地が取れなくても使える。進み方は「▶ 歩く」（自動）か「次の曲がり角へ」。
// 壁は、部屋・店の形を 2.8m 立ち上げたもの。いまいる階（と上り下りの途中の階）だけを見せる。

const EYE = 1.6;
const BIG: CSSProperties = { flex: 1, minHeight: 52, fontSize: "1.05rem", fontWeight: 700 }; // 押しやすい大きさ（上から見る画面と同じ）
const SPEED = 1.3; // m/秒（少し速めに歩く）

// 矢印の帯の模様（進む向きが上）
function chevronTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#2f8f8f";
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "#ffffff";
  g.lineWidth = 16;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(22, 86);
  g.lineTo(64, 44);
  g.lineTo(106, 86);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function Walk({
  net,
  indoor,
  route,
  center,
  goal,
  steps,
  floorName,
}: {
  net: Network;
  indoor: Indoor;
  route: Route;
  center: { lat: number; lon: number };
  goal: string;
  steps: GuideStep[]; // 文は呼ぶ側で作る（「エスカレーターで B5（ホーム）→ B3（改札の階）」）
  floorName: (f: number) => string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const { pts, cum } = useMemo(() => routePath(net, route, center), [net, route, center]);
  const total = cum.at(-1) ?? 0;
  const list = useMemo(() => maneuvers(pts, cum, steps), [pts, cum, steps]);
  const dist = useRef(0);
  const [hud, setHud] = useState({ d: 0, playing: false });
  const playing = useRef(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.setClearColor(0xf2f1ec);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xf2f1ec, 20, 70);
    const camera = new THREE.PerspectiveCamera(70, el.clientWidth / el.clientHeight, 0.1, 300);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9a9a92, 2.2));
    const kx = 111_320 * Math.cos((center.lat * Math.PI) / 180);
    const xz = (lat: number, lon: number) => new THREE.Vector2((lon - center.lon) * kx, (lat - center.lat) * 110_540);

    // 階ごとの床と壁
    const byFloor = new Map<number, THREE.Group>();
    const floorGroup = (f: number) => {
      let g = byFloor.get(f);
      if (!g) {
        g = new THREE.Group();
        byFloor.set(f, g);
        scene.add(g);
      }
      return g;
    };
    const floors = new Map<number, THREE.BufferGeometry[]>();
    const walls = new Map<number, THREE.BufferGeometry[]>();
    for (const f of indoor.features) {
      if (!f.closed || f.coords.length < 3 || !f.floors.length) continue;
      const walk = ["corridor", "area", "platform"].includes(f.kind);
      if (!walk && !["room", "shop"].includes(f.kind)) continue;
      const shape = new THREE.Shape(f.coords.map(([lat, lon]) => xz(lat, lon)));
      for (const fl of f.floors) {
        if (walk) {
          const g = new THREE.ShapeGeometry(shape);
          g.rotateX(-Math.PI / 2);
          g.translate(0, fl * FLOOR_M, 0);
          floors.set(fl, [...(floors.get(fl) ?? []), g]);
        } else {
          const g = new THREE.ExtrudeGeometry(shape, { depth: 2.8, bevelEnabled: false });
          g.rotateX(-Math.PI / 2);
          g.translate(0, fl * FLOOR_M, 0);
          walls.set(fl, [...(walls.get(fl) ?? []), g]);
        }
      }
    }
    for (const [fl, gs] of floors) {
      const m = mergeGeometries(gs);
      if (m) floorGroup(fl).add(new THREE.Mesh(m, new THREE.MeshLambertMaterial({ color: 0xdfe6ee, side: THREE.DoubleSide })));
    }
    for (const [fl, gs] of walls) {
      const m = mergeGeometries(gs);
      if (m) floorGroup(fl).add(new THREE.Mesh(m, new THREE.MeshLambertMaterial({ color: 0xd8d4c8 })));
    }
    // 床のデータがない駅（OSM だけの駅など）でも、足元が見えるように広い床を敷く
    for (const f of new Set(pts.map((p) => Math.round(p.floor)))) {
      const g = new THREE.PlaneGeometry(400, 400);
      g.rotateX(-Math.PI / 2);
      g.translate(0, f * FLOOR_M - 0.02, 0);
      floorGroup(f).add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xe9e8e2 })));
    }

    // 矢印の帯（幅 1.4m）。上り下りの線（エレベーター）は帯にしない
    const tex = chevronTexture();
    const pos: number[] = [];
    const uv: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const h = Math.hypot(b.x - a.x, b.z - a.z);
      if (h < 0.2) continue;
      const nx = -(b.z - a.z) / h;
      const nz = (b.x - a.x) / h;
      const w = 0.7;
      const v0 = cum[i - 1] / 2;
      const v1 = cum[i] / 2;
      const quad = [
        [a.x + nx * w, a.y + 0.03, a.z + nz * w, 0, v0],
        [a.x - nx * w, a.y + 0.03, a.z - nz * w, 1, v0],
        [b.x + nx * w, b.y + 0.03, b.z + nz * w, 0, v1],
        [b.x - nx * w, b.y + 0.03, b.z - nz * w, 1, v1],
      ];
      for (const k of [0, 1, 2, 1, 3, 2]) {
        pos.push(quad[k][0], quad[k][1], quad[k][2]);
        uv.push(quad[k][3], quad[k][4]);
      }
    }
    const carpet = new THREE.BufferGeometry();
    carpet.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    carpet.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    scene.add(new THREE.Mesh(carpet, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, opacity: 0.92 })));

    // 行き先の目印（青い柱）
    const end = pts.at(-1)!;
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2.4, 20), new THREE.MeshBasicMaterial({ color: 0x1f5fbf }));
    pin.position.set(end.x, end.y + 1.2, end.z);
    scene.add(pin);
    const c = document.createElement("canvas");
    c.width = 200;
    c.height = 64;
    const g2 = c.getContext("2d")!;
    g2.fillStyle = "rgba(31,95,191,.95)";
    g2.fillRect(0, 0, 200, 64);
    g2.fillStyle = "#fff";
    g2.font = "bold 36px system-ui";
    g2.textAlign = "center";
    g2.textBaseline = "middle";
    g2.fillText("トイレ", 100, 34);
    const wcSign = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
    wcSign.scale.set(3.2, 1, 1);
    wcSign.position.set(end.x, end.y + 3.2, end.z);
    scene.add(wcSign);

    let raf = 0;
    let last = performance.now();
    let lastHud = 0;
    let facing = Math.PI; // 水平の向き（ラジアン。+z からの角度）。最初は北
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (playing.current) {
        dist.current = Math.min(total, dist.current + dt * SPEED);
        if (dist.current >= total) playing.current = false;
      }
      const p = pointAt(pts, cum, dist.current);
      const ahead = pointAt(pts, cum, Math.min(total, dist.current + 6));
      camera.position.set(p.x, p.y + EYE, p.z);
      // 向きは水平に。エレベーターの中など前が真上・真下のときは、その先の歩く向き（なければ直前の向き）を見る
      for (let k = 6; k <= 30; k += 3) {
        const q = pointAt(pts, cum, Math.min(total, dist.current + k));
        if (Math.hypot(q.x - p.x, q.z - p.z) >= 1.5) {
          facing = Math.atan2(q.x - p.x, q.z - p.z);
          break;
        }
        if (dist.current + k >= total) break;
      }
      camera.lookAt(p.x + Math.sin(facing), p.y + EYE - 0.05, p.z + Math.cos(facing));
      // いまの階と、上り下りの途中なら行き先の階も見せる
      const fNow = p.y / FLOOR_M;
      for (const [f, g] of byFloor) g.visible = Math.abs(f - fNow) < 0.9 || Math.abs(f - ahead.y / FLOOR_M) < 0.5;
      renderer.render(scene, camera);
      if (now - lastHud > 120) {
        lastHud = now;
        setHud({ d: dist.current, playing: playing.current });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onResize = () => {
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [indoor, pts, cum, total, center]);

  const next = list.find((m) => m.at > hud.d + 0.5) ?? list.at(-1)!;
  const toNext = Math.max(0, Math.round(next.at - hud.d));
  const left = Math.max(0, Math.round(total - hud.d));
  const arrived = hud.d >= total - 0.5;
  const icon = next.kind === "right" ? "↱" : next.kind === "left" ? "↰" : next.kind === "floor" ? "⇅" : "◎";
  const here = pointAt(pts, cum, hud.d);

  return (
    <div style={{ position: "relative" }}>
      <div ref={box} style={{ height: 520, borderRadius: 10, overflow: "hidden", border: "1px solid var(--line)", touchAction: "none" }} />
      {/* 上：次の曲がり角 */}
      <div style={{ position: "absolute", left: 8, right: 8, top: 8, background: "rgba(20,20,19,.82)", color: "#fff", borderRadius: 10, padding: "10px 12px" }}>
        {arrived ? (
          <div style={{ fontSize: "1.4rem", fontWeight: 800 }}>◎ 到着しました</div>
        ) : (
          <div style={{ fontSize: "1.4rem", fontWeight: 800 }}>
            {icon} {next.kind === "arrive" ? `${toNext}m で到着` : next.kind === "floor" ? `${toNext}m 先：${next.text}` : `${toNext}m ${next.text}`}
          </div>
        )}
        <div style={{ fontSize: "0.85rem", opacity: 0.85 }}>いま：{floorName(Math.round(here.floor * 2) / 2)}</div>
      </div>
      {/* 下：行き先と残り */}
      <div style={{ position: "absolute", left: 8, right: 8, bottom: 8, background: "rgba(20,20,19,.82)", color: "#fff", borderRadius: 10, padding: "8px 10px" }}>
        <div style={{ fontSize: "0.8rem", opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {goal}・のこり {left} メートル
        </div>
        <div className="row" style={{ marginTop: 6, flexWrap: "nowrap" }}>
          <button
            style={BIG}
            onClick={() => {
              if (arrived) dist.current = 0;
              playing.current = !playing.current;
            }}
          >
            {hud.playing ? "⏸ 止める" : arrived ? "↺ もう一度" : "▶ 歩く"}
          </button>
          <button
            className="primary"
            style={{ ...BIG, flex: 2 }}
            onClick={() => {
              playing.current = false;
              // 曲がり角の少し手前で止まる。いまの止まり位置より先の、次の止まり位置へ（最後は到着）
              const stops = list.map((m) => (m.kind === "arrive" ? total : Math.max(0, m.at - 1.5)));
              dist.current = stops.find((s) => s > dist.current + 0.5) ?? total;
            }}
            disabled={arrived}
          >
            次の曲がり角へ →
          </button>
        </div>
      </div>
    </div>
  );
}
