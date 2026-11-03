"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Indoor } from "@/lib/indoor";
import { FLOOR_M, maneuvers, pointAt, routePath } from "@/lib/maneuvers";
import { guideSteps, type Network, type Route } from "@/lib/route";

// 歩く目線の 3D。カメラの映像（AR）ではなく、データから作った駅の中に矢印の帯を敷いて、その上を歩く。
// 地下で現在地が取れなくても使える。進み方は「▶ 歩く」（自動）か「次の曲がり角へ」。
// 壁は、部屋・店の形を 2.8m 立ち上げたもの。いまいる階（と上り下りの途中の階）だけを見せる。

const EYE = 1.6;
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

export function Walk({ net, indoor, route, center, goal }: { net: Network; indoor: Indoor; route: Route; center: { lat: number; lon: number }; goal: string }) {
  const box = useRef<HTMLDivElement>(null);
  const { pts, cum } = useMemo(() => routePath(net, route, center), [net, route, center]);
  const total = cum.at(-1) ?? 0;
  const list = useMemo(() => maneuvers(pts, cum, guideSteps(route)), [pts, cum, route]);
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

    let raf = 0;
    let last = performance.now();
    let lastHud = 0;
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
      const look = ahead.x === p.x && ahead.z === p.z ? new THREE.Vector3(p.x, p.y + EYE, p.z - 1) : new THREE.Vector3(ahead.x, ahead.y + EYE - 0.3, ahead.z);
      camera.lookAt(look);
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
      </div>
      {/* 下：行き先と残り */}
      <div style={{ position: "absolute", left: 8, right: 8, bottom: 8, background: "rgba(20,20,19,.82)", color: "#fff", borderRadius: 10, padding: "8px 12px" }}>
        <div style={{ fontSize: "0.8rem", opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{goal}</div>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ fontSize: "1.3rem" }}>{left} メートル</strong>
          <div className="row">
            <button
              onClick={() => {
                if (arrived) dist.current = 0;
                playing.current = !playing.current;
              }}
            >
              {hud.playing ? "⏸ 止める" : arrived ? "↺ もう一度" : "▶ 歩く"}
            </button>
            <button
              onClick={() => {
                playing.current = false;
                dist.current = Math.min(total, Math.max(dist.current, next.at - 1.5));
              }}
              disabled={arrived}
            >
              次の曲がり角へ
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
