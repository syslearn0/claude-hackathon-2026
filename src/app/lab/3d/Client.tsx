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
import { findRoute, guideSteps, KIND, KIND_JA, nearestNode, type GuideStep, type Network, type Route, type RouteOptions } from "@/lib/route";
import type { Station } from "@/lib/station-mode";
import { Walk } from "./Walk";

// 試作：駅の中の道順を 3D で見る。急いでいる人が読む順に並べる：
//   ① トイレまで何分・何m、② いまの一手（「エスカレーターで B5（ホーム）→ B3（改札の階）」）、③ 自分のまわりだけを切り出した 3D、④ 条件を変える
// 3D は、いまの手順の始まりを中心に半径 CROP_M だけを、出発と行き先の間の階だけ描く（駅の全体は情報が多すぎる）。

const CROP_M = 70;
const FLOOR_H = 10; // 1階ぶんの高さ（m。見やすさのため実際の約2倍）
const COLOR = { stairs: 0xa8875c, escalator: 0x8a63b8, elevator: 0x1e7a3c, slope: 0x7a7a72, route: 0xd93025, now: 0xf2b705, toilet: 0x1f5fbf, you: 0xd93025 };

type Start = { label: string; node: number };
type Goal = { label: string; short: string; node: number; place: Place };
const MODES: { label: string; opts: RouteOptions }[] = [
  { label: "一番早い", opts: {} },
  { label: "階段を使わない", opts: { noStairs: true } },
  { label: "段差なし（車いす・ベビーカー）", opts: { stepFree: true } },
];

// 文字の看板
function sign(text: string, bg = "rgba(20,20,19,.8)", w = 220) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, 64);
  g.fillStyle = "#fff";
  g.font = "bold 34px system-ui";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, 34);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.set((w / 64) * 4, 4, 1);
  s.renderOrder = 10;
  return s;
}

// /now から開くとき：?station=大門&goal=<トイレの id>
const query = () => new URLSearchParams(typeof location === "undefined" ? "" : location.search);

export default function Station3D() {
  const [fromNow] = useState(() => !!INDOOR_STATIONS[query().get("station") ?? ""]);
  const [station, setStation] = useState(() => (fromNow ? query().get("station")! : "大門"));
  const [pickStation, setPickStation] = useState(!fromNow);
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
  const [view, setView] = useState<"above" | "walk">("above");
  const box = useRef<HTMLDivElement>(null);
  const scene = useRef<{ camera: THREE.PerspectiveCamera; controls: OrbitControls; layer: THREE.Group } | null>(null);

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
    // 屋内の地図がない駅もある（ネットワークだけで描く）
    const indoorOrEmpty = fetch(`/api/indoor?station=${key}`).then((r) => (r.ok ? r.json() : { station: key, bbox: [0, 0, 0, 0], features: [], attribution: "" }));
    Promise.all([indoorOrEmpty, fetch(`/api/network?station=${key}`).then((r) => r.json())]).then(([i, n]) => {
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
  const line = carEnds(station) ? "都営大江戸線" : undefined;
  const kx = 111_320 * Math.cos((center.lat * Math.PI) / 180);
  const toXYZ = useMemo(
    () => (lat: number, lon: number, floor: number) => new THREE.Vector3((lon - center.lon) * kx, floor * FLOOR_H, -(lat - center.lat) * 110_540),
    [center, kx],
  );

  // 階の役割：いちばん下はホーム、改札のある階は「改札の階」、1F は地上
  const minFloor = net ? Math.min(...net.nodes.map((n) => n[2])) : 0;
  const gateFloors = useMemo(() => new Set((indoor?.features ?? []).filter((f) => f.kind === "gate").flatMap((f) => f.floors)), [indoor]);
  const floorName = (f: number) => {
    const base = Number.isInteger(f) ? floorLabel(f) : "中間の階";
    const role = f === minFloor ? (line ? `${line}のホーム` : "ホーム") : gateFloors.has(f) ? "改札の階" : f === 1 ? "地上" : "";
    return role ? `${base}（${role}）` : base;
  };
  // 歩くところは、どこまで歩くのかを言う（「エレベーターまで歩く 約20m」「トイレまで歩く 約40m」）
  const stepText = (g: GuideStep, next?: GuideStep) => {
    if (g.fromFloor !== g.toFloor) return `${KIND_JA[g.kind]}で ${floorName(g.fromFloor)} → ${floorName(g.toFloor)}`;
    const m = `約${Math.max(10, Math.round(g.meters / 10) * 10)}m`;
    if (g.kind !== "walk") return `${KIND_JA[g.kind]} ${m}`;
    return next ? `${KIND_JA[next.kind]}の乗り口まで歩く ${m}`.replace(/(階段|スロープ|エレベーター)の乗り口/, "$1") : `トイレまで歩く ${m}`;
  };

  // 出発：乗っていた号車（大江戸線）・ホーム・地上・名前つきの改札
  const starts: Start[] = useMemo(() => {
    if (!net || !indoor) return [];
    const low = net.nodes.map((n, i) => ({ n, i })).filter(({ n }) => n[2] === minFloor);
    const lowCenter = { lat: low.reduce((a, x) => a + x.n[0], 0) / low.length, lon: low.reduce((a, x) => a + x.n[1], 0) / low.length };
    const list: Start[] = [];
    const byCar = carEnds(station)
      ? carStartNode(net, station, car, (name) => stations.find((x) => x.name === name && /交通局/.test(x.operator ?? "")) ?? stations.find((x) => x.name === name), LINE_CARS.大江戸線.cars)
      : undefined;
    if (byCar !== undefined) list.push({ label: `${line}のホーム（${floorLabel(Math.round(minFloor))}・${car}号車のあたり）`, node: byCar });
    list.push(
      { label: `${line ? `${line}の` : ""}ホーム（${floorLabel(Math.round(minFloor))}・まん中あたり）`, node: nearestNode(net, lowCenter, minFloor) },
      { label: "地上の出入口のあたり（1F）", node: nearestNode(net, center, 1) },
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
  }, [net, indoor, center, station, car, stations, minFloor, line]);

  // 行き先：駅のまわりの、階が分かるトイレ（出発から近い順）
  const goals: Goal[] = useMemo(() => {
    if (!net || !indoor || !starts.length) return [];
    const s = net.nodes[starts[startIdx]?.node ?? 0];
    return places
      .filter((p) => p.kind === "toilet" && distanceM(p, center) < 450)
      .filter((p, i, near) => near.findIndex((q) => q.id === p.id) === i)
      .map((p) => ({ p, f: placeFloor(p, indoor.features) }))
      .filter((x) => x.f !== undefined && !x.p.approxLocation)
      .map(({ p, f }) => {
        const where = `${floorLabel(f!.floor)}${p.gate === "inside" ? "・改札内" : p.gate === "outside" ? "・改札外" : ""}${p.toilet?.accessible ? "・多機能" : ""}`;
        return { place: p, node: nearestNode(net, p, f!.floor), label: `${p.name ?? "トイレ"}（${where}）`, short: `トイレ（${where}）` };
      })
      .sort((a, b) => distanceM({ lat: s[0], lon: s[1] }, a.place) - distanceM({ lat: s[0], lon: s[1] }, b.place))
      .slice(0, 15);
  }, [net, indoor, places, starts, startIdx, center]);

  const goalAt = goalIdx >= 0 ? goalIdx : Math.max(0, goals.findIndex((g) => g.place.id === goalFromUrl));
  const goal = goals[goalAt];
  const route: Route | undefined = useMemo(() => {
    if (!net || !starts[startIdx] || !goal) return undefined;
    return findRoute(net, starts[startIdx].node, goal.node, MODES[mode].opts);
  }, [net, starts, startIdx, goal, mode]);
  const guide = useMemo(() => (route ? guideSteps(route) : []), [route]);
  const routeKey = route?.nodes.join(",") ?? "";
  const [stepState, setStepState] = useState({ key: "", idx: 0 });
  const stepIdx = stepState.key === routeKey ? Math.min(stepState.idx, Math.max(0, guide.length - 1)) : 0;
  const setStep = (idx: number) => setStepState({ key: routeKey, idx });
  const current = guide[stepIdx];

  // 3D の舞台
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.setClearColor(0xfcfcfa);
    el.appendChild(renderer.domElement);
    const sc = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 1, 2000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    sc.add(new THREE.AmbientLight(0xffffff, 1.2));
    const layer = new THREE.Group();
    sc.add(layer);
    scene.current = { camera, controls, layer };
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

  // いまの手順の始まりのまわりだけを描く
  useEffect(() => {
    const s = scene.current;
    if (!s || !indoor || !net || !route || !current) return;
    s.layer.clear();
    const focusNode = net.nodes[route.nodes[current.from]];
    const focus = { lat: focusNode[0], lon: focusNode[1] };
    const near = (lat: number, lon: number, r = CROP_M) => distanceM(focus, { lat, lon }) <= r;
    const fl = route.nodes.map((i) => net.nodes[i][2]);
    const [fMin, fMax] = [Math.floor(Math.min(...fl)), Math.ceil(Math.max(...fl))];
    const inRange = (f: number) => f >= fMin - 0.01 && f <= fMax + 0.01;

    // 床（通路・広場・ホーム）と部屋・店
    const groups = new Map<string, THREE.BufferGeometry[]>();
    for (const f of indoor.features) {
      if (!f.closed || f.coords.length < 3 || !f.floors.some(inRange)) continue;
      const walk = ["corridor", "area", "platform"].includes(f.kind);
      if (!walk && !["room", "shop"].includes(f.kind)) continue;
      if (!f.coords.some(([lat, lon]) => near(lat, lon, CROP_M * 1.2))) continue;
      const shape = new THREE.Shape(f.coords.map(([lat, lon]) => {
        const v = toXYZ(lat, lon, 0);
        return new THREE.Vector2(v.x, -v.z);
      }));
      for (const x of f.floors.filter(inRange)) {
        const g = new THREE.ShapeGeometry(shape);
        g.rotateX(-Math.PI / 2);
        g.translate(0, x * FLOOR_H + (walk ? 0 : 0.2), 0);
        const k = walk ? "walk" : "room";
        groups.set(k, [...(groups.get(k) ?? []), g]);
      }
    }
    for (const [k, gs] of groups) {
      const merged = mergeGeometries(gs);
      if (merged)
        s.layer.add(
          new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ color: k === "walk" ? 0xc9d8ea : 0xe4e1d6, transparent: true, opacity: k === "walk" ? 0.6 : 0.5, side: THREE.DoubleSide, depthWrite: false })),
        );
    }

    // 上り下りの手段（まわりのものだけ。同じ階の通路の線は描かない）
    const buckets = new Map<number, number[]>();
    for (const [a, b, , kind] of net.links) {
      const na = net.nodes[a];
      const nb = net.nodes[b];
      if (na[2] === nb[2] || !inRange(na[2]) || !inRange(nb[2]) || !near(na[0], na[1])) continue;
      const color = kind === KIND.stairs ? COLOR.stairs : kind === KIND.escalator ? COLOR.escalator : kind === KIND.elevator ? COLOR.elevator : COLOR.slope;
      const p = toXYZ(na[0], na[1], na[2]);
      const q = toXYZ(nb[0], nb[1], nb[2]);
      buckets.set(color, [...(buckets.get(color) ?? []), p.x, p.y, p.z, q.x, q.y, q.z]);
    }
    for (const [color, arr] of buckets) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      s.layer.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color })));
    }

    // 経路と、いまの手順
    const pts = route.nodes.map((i) => toXYZ(net.nodes[i][0], net.nodes[i][1], net.nodes[i][2]).add(new THREE.Vector3(0, 0.6, 0)));
    const tube = (ps: THREE.Vector3[], r: number, color: number) =>
      new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ps, false, "catmullrom", 0), Math.max(16, ps.length * 4), r, 6, false), new THREE.MeshBasicMaterial({ color }));
    s.layer.add(tube(pts, 0.8, COLOR.route));
    if (current.to > current.from) s.layer.add(tube(pts.slice(current.from, current.to + 1), 1.6, COLOR.now));

    // あなた（いまの手順の始まり）・トイレ
    const you = new THREE.Mesh(new THREE.SphereGeometry(2.2, 20, 14), new THREE.MeshBasicMaterial({ color: COLOR.you }));
    you.position.copy(pts[current.from]);
    s.layer.add(you);
    const youSign = sign("あなた", "rgba(217,48,37,.92)", 180);
    youSign.position.copy(pts[current.from]).add(new THREE.Vector3(0, 6, 0));
    s.layer.add(youSign);
    const end = pts.at(-1)!;
    const wc = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 5, 20), new THREE.MeshBasicMaterial({ color: COLOR.toilet }));
    wc.position.copy(end).add(new THREE.Vector3(0, 2.5, 0));
    s.layer.add(wc);
    const wcSign = sign("トイレ", "rgba(31,95,191,.92)", 180);
    wcSign.position.copy(end).add(new THREE.Vector3(0, 8, 0));
    s.layer.add(wcSign);

    // 階の名前（この範囲の西の端に）
    const fx = toXYZ(focus.lat, focus.lon, 0);
    for (let f = fMin; f <= fMax; f++) {
      if (f === 0 || !net.nodes.some((n) => n[2] === f)) continue;
      const l = sign(floorName(f), "rgba(20,20,19,.75)", Math.max(160, floorName(f).length * 30));
      l.position.set(fx.x - CROP_M * 0.9, f * FLOOR_H, fx.z);
      s.layer.add(l);
    }

    // カメラ：あなたといまの手順が真ん中に来るように、斜め上から
    const seg = new THREE.Box3().setFromPoints(pts.slice(current.from, current.to + 1));
    const c = seg.getCenter(new THREE.Vector3());
    s.controls.target.copy(c);
    s.camera.position.copy(c.clone().add(new THREE.Vector3(-0.6, 0.75, 0.9).multiplyScalar(CROP_M * 1.1)));
    s.camera.updateProjectionMatrix();
    // floorName は描くたびに作り直しているので、依存に入れない（階の役割が変わるのは駅を替えたときだけ）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indoor, net, route, current, toXYZ]);

  const startLabel = starts[startIdx]?.label;

  return (
    <main style={{ maxWidth: 900 }}>
      <p className="muted">
        <Link href={fromNow ? "/now" : "/"}>← もどる</Link>（試作）
      </p>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={{ margin: 0 }}>
          {station}駅{line ? `（${line}）` : ""}
        </h1>
        <button onClick={() => setPickStation(!pickStation)}>駅を変える</button>
      </div>
      {pickStation && (
        <div className="chips" style={{ marginTop: 6 }}>
          {Object.keys(INDOOR_STATIONS).map((s) => (
            <button
              key={s}
              aria-pressed={station === s}
              onClick={() => {
                setStation(s);
                setPickStation(false);
                setGoalIdx(-1);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* ① 答え：どのトイレまで、何分・何m */}
      {route && goal ? (
        <section className="card" style={{ borderColor: "var(--accent)", borderWidth: 2, marginTop: 8 }}>
          <div style={{ fontSize: "1.6rem", fontWeight: 800 }}>
            トイレまで 約{Math.max(1, Math.round(route.seconds / 60))}分・{route.meters}m
          </div>
          <div>{goal.short}</div>
          <div className="muted" style={{ marginTop: 4 }}>あなた：{startLabel}</div>
          {/* ② いまの一手 */}
          {current && (
            <div style={{ marginTop: 10, padding: "8px 10px", background: "rgba(242,183,5,.18)", borderRadius: 8 }}>
              <div className="muted" style={{ fontSize: "0.8rem" }}>
                いまの手順（{stepIdx + 1} / {guide.length}）
              </div>
              <div style={{ fontSize: "1.3rem", fontWeight: 800 }}>{stepText(current, guide[stepIdx + 1])}</div>
              {guide[stepIdx + 1] && <div className="muted">そのあと：{stepText(guide[stepIdx + 1], guide[stepIdx + 2])}</div>}
            </div>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={() => setStep(Math.max(0, stepIdx - 1))} disabled={stepIdx === 0}>
              ← 前へ
            </button>
            <button className="primary" onClick={() => setStep(Math.min(guide.length - 1, stepIdx + 1))} disabled={stepIdx >= guide.length - 1}>
              通り過ぎた・次へ →
            </button>
          </div>
        </section>
      ) : (
        net && <p className="card">この条件では経路が見つかりませんでした。下で条件を変えてください。</p>
      )}

      {/* 乗っていた号車（大江戸線）：出発の位置がこれで決まるので、すぐ見えるところに */}
      {carEnds(station) && (
        <div style={{ marginTop: 8 }}>
          <span className="muted">何号車に乗っていた？（{LINE_CARS.大江戸線.note}）</span>
          <div className="chips">
            {Array.from({ length: LINE_CARS.大江戸線.cars }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                aria-pressed={car === n && startIdx === 0}
                onClick={() => {
                  setCar(n);
                  setStartIdx(0);
                }}
              >
                {n}号車
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ③ 自分のまわりだけの 3D */}
      <div className="chips" style={{ marginTop: 8 }}>
        <button aria-pressed={view === "above"} onClick={() => setView("above")}>
          まわりを上から
        </button>
        <button aria-pressed={view === "walk"} onClick={() => setView("walk")} disabled={!route}>
          歩く目線
        </button>
      </div>
      {view === "walk" && route && net && indoor && goal && (
        <div style={{ marginTop: 8 }}>
          <Walk key={routeKey} net={net} indoor={indoor} route={route} center={center} goal={goal.short} steps={guide.map((g, i) => ({ ...g, text: stepText(g, guide[i + 1]) }))} floorName={floorName} />
        </div>
      )}
      <div
        ref={box}
        style={{ height: 380, borderRadius: 10, overflow: "hidden", border: "1px solid var(--line)", marginTop: 8, touchAction: "none", display: view === "above" ? "block" : "none" }}
      />
      {view === "above" && (
        <div className="chips muted" style={{ fontSize: "0.8rem", marginTop: 6 }}>
          <span style={{ color: "#f2b705" }}>━ いまの手順</span>
          <span style={{ color: "#d93025" }}>━ 道順</span>
          <span style={{ color: "#8a63b8" }}>━ エスカレーター</span>
          <span style={{ color: "#1e7a3c" }}>━ エレベーター</span>
          <span style={{ color: "#a8875c" }}>━ 階段</span>
        </div>
      )}
      <p className="muted" style={{ fontSize: "0.8rem" }}>
        あなたのまわり（半径約{CROP_M}m）と、通る階だけを出しています。指で回す・2本指で拡大。
      </p>

      {/* ④ 条件を変える */}
      <details className="card">
        <summary>
          <strong>出発・行き先・道の選び方を変える</strong>
        </summary>
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
              <option key={`${g.place.id}-${i}`} value={i}>
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
      </details>

      {guide.length > 0 && (
        <details className="card">
          <summary>
            <strong>すべての手順（{guide.length}）</strong>
          </summary>
          <ol style={{ paddingLeft: 20, margin: "6px 0 0" }}>
            {guide.map((g, i) => (
              <li key={i} onClick={() => setStep(i)} style={{ fontWeight: i === stepIdx ? 800 : 400, cursor: "pointer" }}>
                {stepText(g, guide[i + 1])}
              </li>
            ))}
          </ol>
        </details>
      )}
      <p className="muted" style={{ fontSize: "0.8rem" }}>
        データ：{net?.attribution.join("／")}。時間と道順は目安です。案内表示を優先してください。
      </p>
    </main>
  );
}
