"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { barometerAvailable, heightDiffM, watchPressure } from "@/lib/barometer";
import { distanceM } from "@/lib/geo";
import { floorLabel, INDOOR_STATIONS, parseFloor, placeFloor, type Indoor } from "@/lib/indoor";
import type { Place } from "@/lib/places";
import { candidateLabel, candidates, describe, landmarks, type Candidate, type Gps } from "@/lib/locate";
import { FLOOR_M, maneuvers, nearestOnPath, pointAt, routePath, type Maneuver } from "@/lib/maneuvers";
import { carEnds, carStartNode, LINE_CARS } from "@/lib/platform";
import { findRoute, guideSteps, KIND, KIND_JA, nearestNode, type GuideStep, type Network, type Route, type RouteOptions } from "@/lib/route";
import type { Station } from "@/lib/station-mode";
import { advanceBySteps, checkpoints, nextCheckpoint, prevCheckpoint, snapFloor, snapTurn, STEP_M, StepCounter, TurnWatcher, yawRate, type Checkpoint } from "@/lib/tracking";
import { Walk } from "./Walk";

// 試作：駅の中の道順を 3D で見る。急いでいる人が読む順に並べる：
//   ① トイレまで何分・何m、② いまの一手（「エスカレーターで B5（ホーム）→ B3（改札の階）」）、③ 自分のまわりだけを切り出した 3D、④ 条件を変える
// 自分の位置は「道順の上で何 m 進んだか」の1つの数（pos）。歩く目線・上から見る・センサー・「着いたら押す」・地図のタップのどれで変えても同じ。
// 3D は、いまの手順の始まりを中心に半径 CROP_M だけを、出発と行き先の間の階だけ描く（駅の全体は情報が多すぎる）。

const CROP_M = 70;
// 3D の上に重ねる案内（歩く目線と同じ見た目）と、押しやすい大きいボタン
const HUD: CSSProperties = { position: "absolute", left: 8, right: 8, background: "rgba(20,20,19,.82)", color: "#fff", borderRadius: 10, padding: "10px 12px" };
const BIG: CSSProperties = { flex: 1, minHeight: 52, fontSize: "1.05rem", fontWeight: 700 };
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
  const [picked, setPicked] = useState<{ key: string; start: Start } | null>(null); // 「いまどこ？」・地図のタップで決めた出発地点
  const [view, setView] = useState<"above" | "walk">("above");
  const box = useRef<HTMLDivElement>(null);
  const scene = useRef<{ camera: THREE.PerspectiveCamera; controls: OrbitControls; layer: THREE.Group } | null>(null);
  const youMark = useRef<{ you: THREE.Mesh; sign: THREE.Sprite } | null>(null);

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
  const toXYZ = useMemo(() => (lat: number, lon: number, floor: number) => new THREE.Vector3((lon - center.lon) * kx, floor * FLOOR_H, -(lat - center.lat) * 110_540), [center, kx]);

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
    return picked?.key === key ? [picked.start, ...list] : list;
  }, [net, indoor, center, station, car, stations, minFloor, line, picked, key]);

  // 行き先：駅のまわりの、階が分かるトイレを、出発から「経路でかかる時間」の短い順に。
  // 直線の近さで選ぶと、真上の別の階のトイレ（何階も上り下りが要る）を選んでしまうため。
  // 通路のデータから SNAP_M より離れたトイレは、そこまでの道が分からないので外す
  const goals: (Goal & { seconds: number })[] = useMemo(() => {
    if (!net || !indoor || !starts.length) return [];
    const from = starts[startIdx]?.node ?? 0;
    const SNAP_M = 25;
    return places
      .filter((p) => p.kind === "toilet" && distanceM(p, center) < 450)
      .filter((p, i, near) => near.findIndex((q) => q.id === p.id) === i)
      .map((p) => ({ p, f: placeFloor(p, indoor.features) }))
      .filter((x) => x.f !== undefined && !x.p.approxLocation)
      .flatMap(({ p, f }) => {
        const node = nearestNode(net, p, f!.floor);
        const n = net.nodes[node];
        const snap = distanceM(p, { lat: n[0], lon: n[1] });
        if (snap > SNAP_M || n[2] !== f!.floor) return [];
        const r = findRoute(net, from, node, MODES[mode].opts);
        if (!r) return [];
        const where = `${floorLabel(f!.floor)}${p.gate === "inside" ? "・改札内" : p.gate === "outside" ? "・改札外" : ""}${p.toilet?.accessible ? "・多機能" : ""}`;
        const min = Math.max(1, Math.round((r.seconds + snap) / 60));
        return [{ place: p, node, seconds: r.seconds + snap, label: `約${min}分：${p.name ?? "トイレ"}（${where}）`, short: `トイレ（${where}）` }];
      })
      .sort((a, b) => a.seconds - b.seconds)
      .slice(0, 15);
  }, [net, indoor, places, starts, startIdx, center, mode]);

  const goalAt =
    goalIdx >= 0
      ? goalIdx
      : Math.max(
          0,
          goals.findIndex((g) => g.place.id === goalFromUrl),
        );
  const goal = goals[goalAt];
  const route: Route | undefined = useMemo(() => {
    if (!net || !starts[startIdx] || !goal) return undefined;
    return findRoute(net, starts[startIdx].node, goal.node, MODES[mode].opts);
  }, [net, starts, startIdx, goal, mode]);
  const guide = useMemo(() => (route ? guideSteps(route) : []), [route]);
  const routeKey = route?.nodes.join(",") ?? "";
  const path = useMemo(() => (route && net ? routePath(net, route, center) : { pts: [], cum: [0] }), [net, route, center]);
  const total = path.cum.at(-1) ?? 0;
  const list = useMemo(() => (path.pts.length ? maneuvers(path.pts, path.cum, guide) : []), [path, guide]);
  const cps = useMemo(() => checkpoints(list), [list]);
  const [posState, setPosState] = useState({ key: "", d: 0 });
  const pos = posState.key === routeKey ? Math.min(posState.d, total) : 0;
  const setPos = useCallback((d: number) => setPosState({ key: routeKey, d }), [routeKey]);
  const arrived = total > 0 && pos >= total - 0.5;
  let stepIdx = 0;
  guide.forEach((g, i) => {
    if (path.cum[g.from] <= pos + 0.5) stepIdx = i;
  });
  const current = guide[stepIdx];
  const next = nextCheckpoint(cps, pos);
  const [playing, setPlaying] = useState(false); // 歩く目線の「▶ 歩く」（試しに自動で進める）
  const [picking, setPicking] = useState(false); // 地図で位置を直す（次のタップ）
  const [track, setTrack] = useState(false); // センサーで追う
  const [trackNote, setTrackNote] = useState("");
  const [pickNote, setPickNote] = useState("");
  const floors = useMemo(() => (net ? [...new Set(net.nodes.map((n) => n[2]))] : []), [net]); // データにある階（B1.5 のような中二階も）
  // 地図のタップ（qs：タップの線が当たった床の点、手前から順。いちばん後ろは今の階の高さの平面。floorH：その 3D の1階ぶんの高さ）。
  // 手前から順に見て、最初に使える点を使う：道順の近く（同じ階で 6m 以内）なら道順の上に合わせ、
  // 離れていても通路が近ければ（30m 以内）、そこのいちばん近い通路を新しい出発地点にして道順を引き直す
  const pickAt = (qs: { x: number; y: number; z: number }[], floorH: number) => {
    if (!net || !qs.length) return;
    setPicking(false);
    setPlaying(false);
    for (const q of qs) {
      const f = q.y / floorH;
      const floor = floors.reduce((a, b) => (Math.abs(b - f) < Math.abs(a - f) ? b : a), floors[0]);
      if (Math.abs(floor - f) > 0.15) continue;
      const d = nearestOnPath(path.pts, path.cum, { x: q.x, y: floor * FLOOR_M, z: q.z });
      const onRoute = pointAt(path.pts, path.cum, d);
      if (Math.abs(onRoute.y - floor * FLOOR_M) < 0.1 && Math.hypot(onRoute.x - q.x, onRoute.z - q.z) <= 6) {
        setPos(d);
        setPickNote("");
        return;
      }
      const at = { lat: center.lat - q.z / 110_540, lon: center.lon + q.x / kx };
      const node = nearestNode(net, at, floor);
      const n = net.nodes[node];
      if (n[2] !== floor || distanceM(at, { lat: n[0], lon: n[1] }) > 30) continue;
      const where = Number.isInteger(floor) ? floorLabel(floor) : "中間の階";
      setPicked({ key, start: { label: `地図で選んだ場所（${where}）`, node } });
      setStartIdx(0);
      setPickNote(`${where}のタップしたところから、道順を出し直しました。`);
      return;
    }
    setPickNote("そこには通路のデータがありません。通路（青い床）の上をタップしてください。");
  };
  const floorNow = path.pts.length ? pointAt(path.pts, path.cum, pos).floor : 0;
  const live = useRef({ pos, cps, picking, path, floorNow, pick: pickAt });
  useLayoutEffect(() => {
    live.current = { pos, cps, picking, path, floorNow, pick: pickAt };
  });

  // 確認ポイントの呼び方と、そこで押すボタン
  const cpLabel = (c: Checkpoint) =>
    c.kind === "turn"
      ? `${c.dir === "right" ? "右" : "左"}に曲がる角`
      : c.kind === "board"
        ? `${KIND_JA[c.via!]}の乗り口`
        : c.kind === "alight"
          ? `${KIND_JA[c.via!]}を降りたところ・${floorName(c.toFloor!)}`
          : "トイレ";
  const cpButton = (c: Checkpoint) => (c.kind === "alight" ? `${KIND_JA[c.via!]}を降りたら押す` : c.kind === "arrive" ? "トイレに着いたら押す" : `${cpLabel(c)}に着いたら押す`);
  // 歩く目線の上の案内の文（上り下りは手順の文と同じ言い方に）
  const listText: Maneuver[] = list.map((m) => {
    const g = m.kind === "floor" ? guide.find((x) => path.cum[x.from] === m.at && x.fromFloor !== x.toFloor) : undefined;
    return g ? { ...m, text: stepText(g) } : m;
  });

  // センサーで追う：歩数で進め、曲がった・気圧で階が変わったら近くの確認ポイントに合わせ直す
  useEffect(() => {
    if (!track) return;
    const steps = new StepCounter();
    const turns = new TurnWatcher();
    let n = 0;
    let fixes = 0;
    let got = false;
    let baro = "";
    let alive = true;
    let stopBaro: (() => void) | undefined;
    const note = () => setTrackNote(`歩数 ${n}・曲がり角などで自動で合わせ直した ${fixes} 回${baro}`);
    const go = (d: number | undefined, fix: boolean) => {
      if (d === undefined || Math.abs(d - live.current.pos) < 0.05) return;
      if (fix) fixes++;
      setPos(d);
      note();
    };
    const onMotion = (e: DeviceMotionEvent) => {
      const g = e.accelerationIncludingGravity;
      if (g?.x == null || g.y == null || g.z == null) return;
      got = true;
      if (steps.push(e.timeStamp, Math.hypot(g.x, g.y, g.z))) {
        n++;
        go(advanceBySteps(live.current.cps, live.current.pos, STEP_M), false);
        note();
      }
      const r = e.rotationRate;
      if (r?.alpha == null || r.beta == null || r.gamma == null) return;
      const dir = turns.push(e.timeStamp, yawRate({ alpha: r.alpha, beta: r.beta, gamma: r.gamma }, { x: g.x, y: g.y, z: g.z }));
      if (dir) go(snapTurn(live.current.cps, live.current.pos, dir), true);
    };
    window.addEventListener("devicemotion", onMotion);
    const check = setTimeout(() => {
      if (!got) setTrackNote("動きのセンサーが届いていません（パソコンのときなど）。「着いたら押す」と地図のタップで進めてください。");
    }, 3000);
    barometerAvailable().then(async (ok) => {
      if (!ok || !alive) return;
      baro = "・気圧で階の変化も見ています";
      note();
      let smooth: number | undefined;
      let base: number | undefined;
      const t0 = Date.now();
      const stop = await watchPressure((p) => {
        smooth = smooth === undefined ? p : smooth + (p - smooth) * 0.2;
        if (base === undefined || Date.now() - t0 < 2000) {
          base = smooth;
          return;
        }
        const h = heightDiffM(base, smooth);
        if (Math.abs(h) < 3.5) return;
        base = smooth;
        go(snapFloor(live.current.cps, live.current.pos, h > 0), true);
      });
      if (alive) stopBaro = stop;
      else stop();
    });
    return () => {
      alive = false;
      window.removeEventListener("devicemotion", onMotion);
      clearTimeout(check);
      stopBaro?.();
    };
  }, [track, setPos]);
  const toggleTrack = async () => {
    if (track) {
      setTrack(false);
      setTrackNote("");
      return;
    }
    // iPhone は、ボタンを押したときに許可を聞く。断られても止めない（届かなければ 3 秒後に知らせる）
    const DM = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
    try {
      await DM?.requestPermission?.();
    } catch {
      // 許可を聞けない（http のときなど）。そのまま試す
    }
    setPlaying(false);
    setTrackNote("センサーで追っています。スマホを手に持って歩いてください。");
    setTrack(true);
  };

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
    // 位置を直す：回す・拡大の操作と分けるため、ほとんど動かさずに離したときだけ
    const ray = new THREE.Raycaster();
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      const { picking, pick, floorNow } = live.current;
      if (!picking || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
      const r = el.getBoundingClientRect();
      controls.update(); // まだ描いていない（画面が隠れている）ときも、いまのカメラの向きで
      camera.updateMatrixWorld();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      // 床の形に当たらなかったとき（データのない所）は、今の階の高さの平面で受ける
      const flat = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -floorNow * FLOOR_H), new THREE.Vector3());
      pick(
        [
          ...ray
            .intersectObjects(layer.children, false)
            .filter((h) => h.object instanceof THREE.Mesh)
            .map((h) => h.point),
          ...(flat ? [flat] : []),
        ],
        FLOOR_H,
      );
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
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
    // 切り出す中心は、いまの手順のまんなか。長い手順（ホームを 140m 歩くなど）でも全体と「あなた」が入る大きさに
    const segNodes = route.nodes.slice(current.from, current.to + 1).map((i) => net.nodes[i]);
    const a0 = arrived ? net.nodes[route.nodes.at(-1)!] : segNodes[0];
    const b0 = arrived ? a0 : segNodes.at(-1)!;
    const focus = { lat: (a0[0] + b0[0]) / 2, lon: (a0[1] + b0[1]) / 2 };
    const crop = Math.max(CROP_M, distanceM({ lat: a0[0], lon: a0[1] }, { lat: b0[0], lon: b0[1] }) / 2 + 30);
    const near = (lat: number, lon: number, r = crop) => distanceM(focus, { lat, lon }) <= r;
    const fl = route.nodes.map((i) => net.nodes[i][2]);
    const [fMin, fMax] = [Math.floor(Math.min(...fl)), Math.ceil(Math.max(...fl))];
    const inRange = (f: number) => f >= fMin - 0.01 && f <= fMax + 0.01;

    // 床（通路・広場・ホーム）と部屋・店
    const groups = new Map<string, THREE.BufferGeometry[]>();
    for (const f of indoor.features) {
      if (!f.closed || f.coords.length < 3 || !f.floors.some(inRange)) continue;
      const walk = ["corridor", "area", "platform"].includes(f.kind);
      if (!walk && !["room", "shop"].includes(f.kind)) continue;
      if (!f.coords.some(([lat, lon]) => near(lat, lon, crop * 1.2))) continue;
      const shape = new THREE.Shape(
        f.coords.map(([lat, lon]) => {
          const v = toXYZ(lat, lon, 0);
          return new THREE.Vector2(v.x, -v.z);
        }),
      );
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
          new THREE.Mesh(
            merged,
            new THREE.MeshBasicMaterial({ color: k === "walk" ? 0xc9d8ea : 0xe4e1d6, transparent: true, opacity: k === "walk" ? 0.6 : 0.5, side: THREE.DoubleSide, depthWrite: false }),
          ),
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
    if (!arrived && current.to > current.from) s.layer.add(tube(pts.slice(current.from, current.to + 1), 1.6, COLOR.now));

    // あなた（位置は下の効果で動かす）・トイレ
    const you = new THREE.Mesh(new THREE.SphereGeometry(2.2, 20, 14), new THREE.MeshBasicMaterial({ color: COLOR.you }));
    const youAt = arrived ? pts.at(-1)! : pts[current.from];
    s.layer.add(you);
    const youSign = sign("あなた", "rgba(217,48,37,.92)", 180);
    s.layer.add(youSign);
    youMark.current = { you, sign: youSign };
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
      l.position.set(fx.x - crop * 0.9, f * FLOOR_H, fx.z);
      s.layer.add(l);
    }

    // カメラ：あなたといまの手順が真ん中に来るように、斜め上から
    const seg = new THREE.Box3().setFromPoints(arrived ? [youAt] : pts.slice(current.from, current.to + 1));
    const c = seg.getCenter(new THREE.Vector3());
    const size = seg.getSize(new THREE.Vector3()).length();
    s.controls.target.copy(c);
    s.camera.position.copy(c.clone().add(new THREE.Vector3(-0.6, 0.75, 0.9).multiplyScalar(Math.max(CROP_M * 1.1, size * 0.85))));
    s.camera.updateProjectionMatrix();
    // floorName は描くたびに作り直しているので、依存に入れない（階の役割が変わるのは駅を替えたときだけ）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indoor, net, route, current, arrived, toXYZ]);
  useEffect(() => {
    const m = youMark.current;
    if (!m || !path.pts.length) return;
    const p = pointAt(path.pts, path.cum, pos);
    const v = new THREE.Vector3(p.x, (p.y / FLOOR_M) * FLOOR_H + 0.6, p.z);
    m.you.position.copy(v);
    m.sign.position.copy(v).add(new THREE.Vector3(0, 6, 0));
  }, [pos, path, current, arrived]);

  const startLabel = starts[startIdx]?.label;

  // 「いまどこ？」：看板を撮る → AI が看板と配置を読む → 地図のデータで候補を作る（GPS も）→ AI が写真と候補を比べる → 本人が選ぶ
  const lms = useMemo(() => (indoor ? landmarks(indoor.features) : []), [indoor]);
  const [loc, setLoc] = useState<{ busy?: string; error?: string; read?: string[]; cands?: Candidate[]; choice?: string; facing?: string; confidence?: string; reason?: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const heading = useRef<number | null>(null);
  const gpsWait = useRef<Promise<Gps | undefined> | null>(null);
  const stopHeading = useRef<(() => void) | null>(null);
  const startLocate = async () => {
    // 撮る直前の向き（iPhone は許可が要る）と GPS を、撮っている間に取っておく
    const DO = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    try {
      await DO?.requestPermission?.();
    } catch {
      // 聞けないときは向きなしで
    }
    heading.current = null;
    const onAbs = (e: DeviceOrientationEvent) => {
      if (e.alpha !== null) heading.current = (360 - e.alpha) % 360;
    };
    const onIos = (e: DeviceOrientationEvent) => {
      const h = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
      if (typeof h === "number") heading.current = h;
    };
    window.addEventListener("deviceorientationabsolute", onAbs as EventListener);
    window.addEventListener("deviceorientation", onIos);
    stopHeading.current?.();
    stopHeading.current = () => {
      window.removeEventListener("deviceorientationabsolute", onAbs as EventListener);
      window.removeEventListener("deviceorientation", onIos);
    };
    gpsWait.current = new Promise((done) => {
      if (!navigator.geolocation) return done(undefined);
      navigator.geolocation.getCurrentPosition(
        (p) => done({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
        () => done(undefined),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
      );
    });
    fileRef.current?.click();
  };
  const onPhoto = async (file: File | undefined) => {
    const h = heading.current;
    stopHeading.current?.();
    if (!file || !net) return;
    try {
      setLoc({ busy: "看板を読んでいます…" });
      const image = await shrinkPhoto(file);
      const ask = async (body: object) => {
        const r = await fetch("/api/locate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image, ...body }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "うまくいきませんでした");
        return d;
      };
      const read = (await ask({ step: "read" })) as { signs: { text: string; where: string; arrow: string }[]; floor: string; scene: string };
      const texts = read.signs.map((x) => x.text);
      const gps = (await gpsWait.current) ?? undefined;
      const cands = candidates(net, lms, texts, station, gps, parseFloor(read.floor));
      if (!cands.length) {
        setLoc({ read: texts, cands: [], error: "看板の名前が、この駅の地図のデータと合いませんでした。改札名や出口番号が写るように撮り直すか、下の「出発・行き先」で選んでください。" });
        return;
      }
      setLoc({ busy: "地図と照らし合わせています…", read: texts, cands });
      const signs = [
        ...read.signs.map((x) => `「${x.text}」（写真の${x.where}${x.arrow !== "なし" ? `・矢印は${x.arrow}` : ""}）`),
        read.floor && `階の表示：${read.floor}`,
        read.scene && `配置：${read.scene}`,
      ]
        .filter(Boolean)
        .join("、");
      const judged = (await ask({
        step: "judge",
        ids: cands.map((c) => c.id),
        candidates: cands.map((c) => describe(c, lms, gps)).join("\n\n"),
        signs,
        heading: h,
        gps: gps ? `精度 ±${Math.round(gps.accuracy)}m` : "",
      })) as { choice: string; facing: string; confidence: string; reason: string };
      setLoc({ read: texts, cands, ...judged });
    } catch (e) {
      setLoc({ error: e instanceof Error ? e.message : "うまくいきませんでした" });
    }
  };
  const pickCandidate = (c: Candidate) => {
    setPicked({ key, start: { label: `写真で決めた場所：${candidateLabel(c)}`, node: c.node } });
    setStartIdx(0);
    setLoc(null);
  };

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
          <div className="muted" style={{ marginTop: 4 }}>
            出発：{startLabel}
          </div>
        </section>
      ) : (
        net && <p className="card">この条件では経路が見つかりませんでした。下で条件を変えてください。</p>
      )}

      {/* いまどこ？（看板の写真と GPS から出発地点を決める） */}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => (onPhoto(e.target.files?.[0]), (e.target.value = ""))} />
      <button className="big" style={{ marginTop: 8, width: "100%" }} onClick={startLocate} disabled={!net || !!loc?.busy}>
        📷 いまどこか分からない：近くの看板を撮る
      </button>
      {loc && (
        <section className="card" style={{ marginTop: 8 }}>
          {loc.busy && <p style={{ margin: 0, fontWeight: 700 }}>{loc.busy}</p>}
          {loc.error && <p style={{ margin: 0 }}>{loc.error}</p>}
          {!loc.busy && loc.cands && loc.cands.length > 0 && (
            <>
              <div className="muted" style={{ fontSize: "0.85rem" }}>
                読めた看板：{loc.read?.slice(0, 6).join("、") || "なし"}
              </div>
              {loc.choice === "none" && <p style={{ margin: "6px 0" }}>写真と合う場所を決めきれませんでした。下の候補から、近いものを選んでください。</p>}
              {[...loc.cands]
                .sort((a, b) => Number(b.id === loc.choice) - Number(a.id === loc.choice))
                .map((c) => (
                  <div key={c.id} style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}>
                    <div style={{ fontWeight: 800 }}>
                      {c.id === loc.choice ? "たぶんここ：" : "ほかの候補："}
                      {candidateLabel(c)}
                    </div>
                    {c.id === loc.choice && (
                      <div style={{ fontSize: "0.9rem" }}>
                        {loc.reason}
                        {loc.facing && loc.facing !== "不明" && `（撮ったとき${loc.facing}を向いていたようです）`}
                        <span className="muted">（確からしさ：{loc.confidence}）</span>
                      </div>
                    )}
                    <button className={c.id === loc.choice ? "primary" : ""} style={{ marginTop: 4 }} onClick={() => pickCandidate(c)}>
                      ここから出発
                    </button>
                  </div>
                ))}
            </>
          )}
          {!loc.busy && (
            <button style={{ marginTop: 6 }} onClick={() => setLoc(null)}>
              閉じる
            </button>
          )}
          <p className="muted" style={{ fontSize: "0.8rem", margin: "6px 0 0" }}>
            看板だけを撮ってください。写真は AI に場所を聞くためだけに使い、保存しません。地上なら GPS も手がかりにします。
          </p>
        </section>
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
                  setPicked(null);
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
      <div style={{ position: "relative", marginTop: 8 }}>
        {view === "walk" && route && indoor && goal && (
          <Walk
            key={routeKey}
            indoor={indoor}
            pts={path.pts}
            cum={path.cum}
            list={listText}
            center={center}
            floorName={floorName}
            pos={pos}
            onPos={setPos}
            playing={playing}
            onStop={() => setPlaying(false)}
            picking={picking}
            onPick={(q) => live.current.pick([q], FLOOR_M)}
          />
        )}
        <div ref={box} style={{ height: 520, borderRadius: 10, overflow: "hidden", border: "1px solid var(--line)", touchAction: "none", display: view === "above" ? "block" : "none" }} />
        {view === "above" && route && goal && current && (
          <div style={{ ...HUD, top: 8 }}>
            {arrived ? (
              <div style={{ fontSize: "1.4rem", fontWeight: 800 }}>◎ トイレに着きました</div>
            ) : (
              <>
                <div style={{ fontSize: "0.8rem", opacity: 0.85 }}>
                  いまの手順（{stepIdx + 1} / {guide.length}）
                </div>
                <div style={{ fontSize: "1.3rem", fontWeight: 800 }}>{stepText(current, guide[stepIdx + 1])}</div>
                {guide[stepIdx + 1] && <div style={{ fontSize: "0.85rem", opacity: 0.85 }}>そのあと：{stepText(guide[stepIdx + 1], guide[stepIdx + 2])}</div>}
              </>
            )}
          </div>
        )}
        {/* 下：次の確認ポイントと、着いたら押すボタン（どちらの見方でも同じ場所） */}
        {route && goal && (
          <div style={{ ...HUD, bottom: 8, padding: "8px 10px" }}>
            {picking ? (
              <div style={{ fontWeight: 800 }}>📍 いまいるところをタップしてください（道順から離れていれば、そこから出し直します）</div>
            ) : next ? (
              <div style={{ fontWeight: 800 }}>
                次の確認ポイント：{cpLabel(next)}（あと{Math.max(0, Math.round(next.at - pos))}m）
              </div>
            ) : (
              <div style={{ fontWeight: 800 }}>◎ トイレに着きました</div>
            )}
            <div style={{ fontSize: "0.8rem", opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {goal.short}・のこり {Math.max(0, Math.round(total - pos))} メートル
            </div>
            <div className="row" style={{ marginTop: 6, flexWrap: "nowrap" }}>
              <button
                style={view === "walk" ? { ...BIG, flex: 0.6 } : BIG}
                aria-label="ひとつ前の確認ポイントへ"
                onClick={() => {
                  setPlaying(false);
                  setPos(prevCheckpoint(cps, pos)?.at ?? 0);
                }}
                disabled={pos < 0.5}
              >
                {view === "walk" ? "←" : "← 前へ"}
              </button>
              {view === "walk" && (
                <button style={BIG} onClick={() => (arrived ? (setPos(0), setPlaying(false)) : setPlaying(!playing))} disabled={track}>
                  {playing ? "⏸ 止める" : arrived ? "↺ もう一度" : "▶ 歩く"}
                </button>
              )}
              {next ? (
                <button
                  className="primary"
                  style={{ ...BIG, flex: 2 }}
                  onClick={() => {
                    setPlaying(false);
                    setPos(next.at);
                  }}
                >
                  {cpButton(next)}
                </button>
              ) : (
                <button style={{ ...BIG, flex: 2 }} onClick={() => setPos(0)}>
                  ↺ 最初から
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="chips" style={{ marginTop: 6 }}>
        <button aria-pressed={track} onClick={toggleTrack}>
          📡 センサーで位置を追う（試作）
        </button>
        <button aria-pressed={picking} onClick={() => setPicking(!picking)}>
          📍 地図で位置を直す
        </button>
      </div>
      {pickNote && (
        <p className="muted" style={{ fontSize: "0.85rem", margin: "4px 0" }}>
          {pickNote}
        </p>
      )}
      {trackNote && (
        <p className="muted" style={{ fontSize: "0.85rem", margin: "4px 0" }}>
          {trackNote}
        </p>
      )}
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
        上から見る：いまの手順のまわりと、通る階だけ。指で回す・2本指で拡大。歩く目線：指でドラッグするとまわりを見渡せます（離すと前に向き直ります）。地下では現在地が取れないので、「着いたら押す」かセンサーで進めます。
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
          <span>どのトイレへ（早く着く順）</span>
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
              <li key={i} onClick={() => setPos(path.cum[g.from])} style={{ fontWeight: i === stepIdx ? 800 : 400, cursor: "pointer" }}>
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

// 写真を長い辺 1280px の JPEG に縮める（送る量を減らし、撮影情報（位置など）も落とす）。base64 で返す
async function shrinkPhoto(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * k);
  cv.height = Math.round(bmp.height * k);
  cv.getContext("2d")!.drawImage(bmp, 0, 0, cv.width, cv.height);
  return cv.toDataURL("image/jpeg", 0.8).split(",")[1];
}
