"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { distanceM } from "@/lib/geo";
import { floorLabel, INDOOR_STATIONS, placeFloor, type Indoor } from "@/lib/indoor";
import type { Place } from "@/lib/places";
import { carEnds, carStartNode, LINE_CARS } from "@/lib/platform";
import { findRoute, guideSteps, KIND, nearestNode, type Network, type Route, type RouteOptions } from "@/lib/route";
import type { Station } from "@/lib/station-mode";

// 試作：駅の中を 3D で見る。階を積み重ね、階段・エスカレーター・エレベーターを縦の線で、経路を太い線で描く。
// 階の高さは見やすさのために実際より広げている（floorHeightFor）。

// 1階ぶんの高さ（m）。実際（約5m）のままだと、横に長い駅では階が重なって見えないので、駅の広さの 1/8 くらいに広げる
const floorHeightFor = (net: Network | null, kx: number) => {
  if (!net?.nodes.length) return 9;
  const xs = net.nodes.map((n) => n[1] * kx);
  const zs = net.nodes.map((n) => n[0] * 110_540);
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  return Math.min(30, Math.max(9, extent / 8));
};
const COLOR = { stairs: 0xa8875c, escalator: 0x8a63b8, elevator: 0x1e7a3c, slope: 0x7a7a72, walk: 0xb9c7dd, route: 0xd93025, toilet: 0x1f5fbf };

type Start = { label: string; node: number };
type Goal = { label: string; node: number; place: Place };
const MODES: { label: string; opts: RouteOptions }[] = [
  { label: "一番早い", opts: {} },
  { label: "階段を使わない", opts: { noStairs: true } },
  { label: "段差なし", opts: { stepFree: true } },
];

// 文字の看板（階の名前）
function label(text: string) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(20,20,19,.75)";
  g.fillRect(0, 0, 128, 64);
  g.fillStyle = "#fff";
  g.font = "bold 40px system-ui";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 64, 34);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.set(16, 8, 1);
  return s;
}

// /now から開くとき：?station=大門&goal=<トイレの id>
const query = () => new URLSearchParams(typeof location === "undefined" ? "" : location.search);

export default function Station3D() {
  const [station, setStation] = useState(() => (INDOOR_STATIONS[query().get("station") ?? ""] ? query().get("station")! : "大門"));
  const [goalFromUrl] = useState(() => query().get("goal"));
  const [car, setCar] = useState(4);
  const [stations, setStations] = useState<Station[]>([]);
  const key = INDOOR_STATIONS[station].key;
  const [indoor, setIndoor] = useState<Indoor | null>(null);
  const [net, setNet] = useState<Network | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [startIdx, setStartIdx] = useState(0);
  const [goalIdx, setGoalIdx] = useState(-1); // -1：URL のトイレ（なければ一番近いトイレ）
  const [mode, setMode] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  // 駅を替えたときだけ、駅の全体が入るようにカメラを置き直す（経路を替えたたびには動かさない）
  const framedFor = useRef<Network | null>(null);
  const scene = useRef<{ scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; controls: OrbitControls; layer: THREE.Group } | null>(null);

  useEffect(() => {
    fetch("/api/places")
      .then((r) => r.json())
      .then((d: { places: Place[]; stations: Station[] }) => {
        setPlaces(d.places);
        setStations(d.stations);
      });
  }, []);
  useEffect(() => {
    let alive = true;
    Promise.all([fetch(`/api/indoor?station=${key}`).then((r) => r.json()), fetch(`/api/network?station=${key}`).then((r) => r.json())]).then(([i, n]) => {
      if (!alive) return;
      setIndoor(i);
      setNet(n);
      setStartIdx(0);
    });
    return () => {
      alive = false;
    };
  }, [key]);

  const center = INDOOR_STATIONS[station].center;
  // 緯度経度・階 → 3D の座標（m）。東が +x、北が -z、上が +y
  const kx = 111_320 * Math.cos((center.lat * Math.PI) / 180);
  const floorH = useMemo(() => floorHeightFor(net, kx), [net, kx]);
  const toXYZ = useMemo(
    () => (lat: number, lon: number, floor: number) => new THREE.Vector3((lon - center.lon) * kx, floor * floorH, -(lat - center.lat) * 110_540),
    [center, kx, floorH],
  );

  // 出発：ホーム（いちばん下の階）・地上・名前つきの改札
  const starts: Start[] = useMemo(() => {
    if (!net || !indoor) return [];
    const minFloor = Math.min(...net.nodes.map((n) => n[2]));
    const low = net.nodes.map((n, i) => ({ n, i })).filter(({ n }) => n[2] === minFloor);
    const lowCenter = { lat: low.reduce((a, x) => a + x.n[0], 0) / low.length, lon: low.reduce((a, x) => a + x.n[1], 0) / low.length };
    const list: Start[] = [];
    // 大江戸線の駅なら、乗っていた号車からホームのどのあたりかを出す
    const byCar = carEnds(station)
      ? carStartNode(net, station, car, (name) => stations.find((x) => x.name === name && /交通局/.test(x.operator ?? "")) ?? stations.find((x) => x.name === name), LINE_CARS.大江戸線.cars)
      : undefined;
    if (byCar !== undefined) list.push({ label: `ホーム（大江戸線 ${car}号車のあたり）`, node: byCar });
    list.push(
      { label: `ホーム（${floorLabel(Math.round(minFloor))}、いちばん下の階）`, node: nearestNode(net, lowCenter, minFloor) },
      { label: "地上（1F）", node: nearestNode(net, center, 1) },
    );
    const seen = new Set<string>();
    for (const g of indoor.features.filter((f) => f.kind === "gate" && f.name && f.floors.length)) {
      const name = `${g.name}（${floorLabel(g.floors[0])}）`;
      if (seen.has(name)) continue;
      seen.add(name);
      const c = { lat: g.coords.reduce((a, p) => a + p[0], 0) / g.coords.length, lon: g.coords.reduce((a, p) => a + p[1], 0) / g.coords.length };
      list.push({ label: `改札：${name}`, node: nearestNode(net, c, g.floors[0]) });
    }
    return list;
  }, [net, indoor, center, station, car, stations]);

  // 行き先：駅のまわりの、階が分かるトイレ（出発から近い順）
  const goals: Goal[] = useMemo(() => {
    if (!net || !indoor || !starts.length) return [];
    const s = net.nodes[starts[startIdx]?.node ?? 0];
    return places
      .filter((p) => p.kind === "toilet" && distanceM(p, center) < 450)
      .map((p) => ({ p, f: placeFloor(p, indoor.features) }))
      .filter((x) => x.f !== undefined && !x.p.approxLocation)
      .map(({ p, f }) => ({ place: p, node: nearestNode(net, p, f!.floor), label: `${p.name ?? "トイレ"}（${floorLabel(f!.floor)}${p.gate === "inside" ? "・改札内" : p.gate === "outside" ? "・改札外" : ""}）` }))
      .sort((a, b) => distanceM({ lat: s[0], lon: s[1] }, a.place) - distanceM({ lat: s[0], lon: s[1] }, b.place))
      .slice(0, 15);
  }, [net, indoor, places, starts, startIdx, center]);

  const goalAt = goalIdx >= 0 ? goalIdx : Math.max(0, goals.findIndex((g) => g.place.id === goalFromUrl));
  const route: Route | undefined = useMemo(() => {
    if (!net || !starts[startIdx] || !goals[goalAt]) return undefined;
    return findRoute(net, starts[startIdx].node, goals[goalAt].node, MODES[mode].opts);
  }, [net, starts, startIdx, goals, goalAt, mode]);
  const guide = useMemo(() => (route ? guideSteps(route) : []), [route]);
  // 案内の手順（いま何番目か）。経路が変わったら最初から
  const routeKey = route?.nodes.join(",") ?? "";
  const [stepState, setStepState] = useState({ key: "", idx: 0 });
  const stepIdx = stepState.key === routeKey ? Math.min(stepState.idx, Math.max(0, guide.length - 1)) : 0;
  const setStep = (idx: number) => setStepState({ key: routeKey, idx });
  const current = guide[stepIdx];

  // 3D の舞台を用意する
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.setClearColor(0xfcfcfa);
    el.appendChild(renderer.domElement);
    const sc = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 1, 5000);
    camera.position.set(-220, 220, 260);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    sc.add(new THREE.AmbientLight(0xffffff, 1.2));
    const layer = new THREE.Group();
    sc.add(layer);
    scene.current = { scene: sc, camera, renderer, controls, layer };
    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(sc, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();
    const onResize = () => {
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  // 駅の形・つながり・トイレ・経路を描く
  useEffect(() => {
    const s = scene.current;
    if (!s || !indoor || !net) return;
    s.layer.clear();

    // 階の面（通路・広場・ホームは青っぽく、部屋・店は薄い灰色）。階ごとにまとめて1つの形にする
    const groups = new Map<string, THREE.BufferGeometry[]>();
    for (const f of indoor.features) {
      if (!f.closed || f.coords.length < 3 || !f.floors.length) continue;
      const walk = ["corridor", "area", "platform"].includes(f.kind);
      if (!walk && !["room", "shop"].includes(f.kind)) continue;
      const shape = new THREE.Shape(f.coords.map(([lat, lon]) => {
        const v = toXYZ(lat, lon, 0);
        return new THREE.Vector2(v.x, -v.z);
      }));
      for (const fl of f.floors) {
        const g = new THREE.ShapeGeometry(shape);
        g.rotateX(-Math.PI / 2);
        g.translate(0, fl * floorH + (walk ? 0 : 0.2), 0);
        const k = walk ? "walk" : "room";
        groups.set(k, [...(groups.get(k) ?? []), g]);
      }
    }
    for (const [k, gs] of groups) {
      const merged = mergeGeometries(gs);
      if (!merged) continue;
      s.layer.add(
        new THREE.Mesh(
          merged,
          new THREE.MeshBasicMaterial({ color: k === "walk" ? 0xc9d8ea : 0xe4e1d6, transparent: true, opacity: k === "walk" ? 0.55 : 0.45, side: THREE.DoubleSide, depthWrite: false }),
        ),
      );
    }

    // ネットワーク：同じ階の通路は薄い線、階をまたぐものは種類ごとの色
    const buckets = new Map<number, number[]>();
    for (const [a, b, , kind] of net.links) {
      const na = net.nodes[a];
      const nb = net.nodes[b];
      const k = na[2] === nb[2] ? (kind === KIND.walk || kind === KIND.elevator ? COLOR.walk : kind === KIND.stairs ? COLOR.stairs : kind === KIND.escalator ? COLOR.escalator : COLOR.slope) : kind === KIND.stairs ? COLOR.stairs : kind === KIND.escalator ? COLOR.escalator : kind === KIND.elevator ? COLOR.elevator : COLOR.slope;
      const p = toXYZ(na[0], na[1], na[2]);
      const q = toXYZ(nb[0], nb[1], nb[2]);
      buckets.set(k, [...(buckets.get(k) ?? []), p.x, p.y + 0.4, p.z, q.x, q.y + 0.4, q.z]);
    }
    for (const [color, arr] of buckets) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      s.layer.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: color === COLOR.walk, opacity: color === COLOR.walk ? 0.6 : 1 })));
    }

    // 階の名前（いちばん西の端に）
    // 中間階（-0.5 など）には名前を付けない
    const floors = [...new Set(net.nodes.map((n) => n[2]).filter((f) => Number.isInteger(f) && f !== 0))].sort((a, b) => a - b);
    const minX = Math.min(...net.nodes.map((n) => toXYZ(n[0], n[1], 0).x));
    for (const f of floors) {
      const l = label(floorLabel(f));
      l.position.set(minX - floorH * 2, f * floorH, 0);
      l.scale.set(floorH * 0.9, floorH * 0.45, 1);
      s.layer.add(l);
    }

    // トイレ（行き先の候補）
    for (const g of goals) {
      const n = net.nodes[g.node];
      const m = new THREE.Mesh(new THREE.SphereGeometry((g === goals[goalAt] ? 0.35 : 0.22) * floorH, 16, 12), new THREE.MeshBasicMaterial({ color: COLOR.toilet }));
      m.position.copy(toXYZ(n[0], n[1], n[2]).add(new THREE.Vector3(0, 2, 0)));
      s.layer.add(m);
    }

    // 経路（太い赤の線）と、いまの手順（黄色でもっと太く）と、出発の印
    if (route && route.nodes.length > 1) {
      const pts = route.nodes.map((i) => toXYZ(net.nodes[i][0], net.nodes[i][1], net.nodes[i][2]).add(new THREE.Vector3(0, 1.2, 0)));
      const tube = (ps: THREE.Vector3[], r: number, color: number) =>
        new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ps, false, "catmullrom", 0), Math.max(16, ps.length * 4), r, 6, false), new THREE.MeshBasicMaterial({ color }));
      s.layer.add(tube(pts, floorH / 9, COLOR.route));
      if (current && current.to > current.from) {
        const seg = pts.slice(current.from, current.to + 1);
        s.layer.add(tube(seg, floorH / 5, 0xf2b705));
        if (framedFor.current === net) s.controls.target.copy(new THREE.Box3().setFromPoints(seg).getCenter(new THREE.Vector3()));
      }
      const start = new THREE.Mesh(new THREE.SphereGeometry(floorH / 3, 16, 12), new THREE.MeshBasicMaterial({ color: 0x222222 }));
      start.position.copy(pts[0]);
      s.layer.add(start);
    }

    if (framedFor.current !== net) {
      framedFor.current = net;
      const bb = new THREE.Box3().setFromPoints(net.nodes.map((n) => toXYZ(n[0], n[1], n[2])));
      const c = bb.getCenter(new THREE.Vector3());
      const size = Math.max(60, bb.getSize(new THREE.Vector3()).length());
      s.controls.target.copy(c);
      // 斜め横から（階の重なりが見える高さ）
      s.camera.position.copy(c.clone().add(new THREE.Vector3(-0.55, 0.35, 0.75).multiplyScalar(size)));
      s.camera.near = size / 100;
      s.camera.far = size * 10;
      s.camera.updateProjectionMatrix();
    }
  }, [indoor, net, goals, goalAt, route, toXYZ, floorH, current]);

  return (
    <main style={{ maxWidth: 900 }}>
      <p className="muted">
        <Link href="/">← もどる</Link>（試作ページ）
      </p>
      <h1>駅の中を 3D で見る</h1>
      <div className="chips">
        {Object.keys(INDOOR_STATIONS).map((s) => (
          <button key={s} aria-pressed={station === s} onClick={() => setStation(s)}>
            {s}
          </button>
        ))}
      </div>
      {carEnds(station) && (
        <div className="field">
          <span>乗っていた号車（大江戸線は8両。{LINE_CARS.大江戸線.note}）</span>
          <div className="chips">
            {Array.from({ length: LINE_CARS.大江戸線.cars }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                aria-pressed={car === n}
                onClick={() => {
                  setCar(n);
                  setStartIdx(0);
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="field">
        <span>どこから</span>
        <select value={startIdx} onChange={(e) => setStartIdx(Number(e.target.value))}>
          {starts.map((s, i) => (
            <option key={s.label} value={i}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>どのトイレへ（近い順）</span>
        <select value={goalAt} onChange={(e) => setGoalIdx(Number(e.target.value))}>
          {goals.map((g, i) => (
            <option key={g.place.id} value={i}>
              {g.label}
            </option>
          ))}
        </select>
      </label>
      <div className="chips">
        {MODES.map((m, i) => (
          <button key={m.label} aria-pressed={mode === i} onClick={() => setMode(i)}>
            {m.label}
          </button>
        ))}
      </div>
      <div ref={box} style={{ height: 420, borderRadius: 10, overflow: "hidden", border: "1px solid var(--line)", marginTop: 8, touchAction: "none" }} />
      <div className="chips muted" style={{ fontSize: "0.8rem", marginTop: 6 }}>
        <span style={{ color: "#d93025" }}>━ 経路</span>
        <span style={{ color: "#1f5fbf" }}>● トイレ</span>
        <span style={{ color: "#8a63b8" }}>━ エスカレーター</span>
        <span style={{ color: "#1e7a3c" }}>━ エレベーター</span>
        <span style={{ color: "#a8875c" }}>━ 階段</span>
      </div>
      <p className="muted" style={{ fontSize: "0.8rem" }}>指1本で回す・2本で拡大。階の間は、重なって見えないように実際よりかなり広げています。</p>
      {route ? (
        <section className="card">
          <strong>
            約{Math.max(1, Math.round(route.seconds / 60))}分・{route.meters}m（{MODES[mode].label}）
          </strong>
          {current && (
            <div style={{ fontSize: "1.3rem", fontWeight: 800, margin: "6px 0" }}>
              {stepIdx + 1}. {current.text}
            </div>
          )}
          <div className="row">
            <button onClick={() => setStep(Math.max(0, stepIdx - 1))} disabled={stepIdx === 0}>
              ← 前へ
            </button>
            <button className="primary" onClick={() => setStep(Math.min(guide.length - 1, stepIdx + 1))} disabled={stepIdx >= guide.length - 1}>
              次へ →
            </button>
          </div>
          <ol style={{ paddingLeft: 20, margin: "6px 0 0" }}>
            {guide.map((g, i) => (
              <li key={i} onClick={() => setStep(i)} style={{ fontWeight: i === stepIdx ? 800 : 400, cursor: "pointer" }}>
                {g.text}
              </li>
            ))}
          </ol>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: "0.8rem" }}>
            通り過ぎたら「次へ」。地図の黄色が、いまの手順です。
          </p>
        </section>
      ) : (
        net && <p className="card">この条件では経路が見つかりませんでした（データのつながりがない、または階段しかない）。</p>
      )}
      <p className="muted" style={{ fontSize: "0.8rem" }}>
        データ：{net?.attribution.join("／")}。時間は目安です。
      </p>
    </main>
  );
}
