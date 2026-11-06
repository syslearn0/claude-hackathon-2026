"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { barometerAvailable, heightDiffM, watchPressure } from "@/lib/barometer";
import { distanceM } from "@/lib/geo";
import { floorLabel, INDOOR_STATIONS, parseFloor, placeFloor, type Indoor } from "@/lib/indoor";
import type { Place } from "@/lib/places";
import { candidateLabel, candidates, describe, landmarks, type Candidate, type Gps } from "@/lib/locate";
import { floorReach, gateDirs, gateFrames, gatePasses, type FloorPoly, type GateShape, type WalkLink } from "@/lib/gates";
import { liftParts } from "@/lib/lifts";
import VOIDS from "../../../data/station-voids.json";
import { Heading, headingFromEuler, signedDiff } from "@/lib/orientation";
import { bearingDeg, startHint, turnAdvice, type HintMark, type PlatformInfo } from "@/lib/start-hint";
import { FLOOR_M, maneuvers, nearestOnPath, pointAt, routePath, type Maneuver } from "@/lib/maneuvers";
import { carEnds, carStartNode, LINE_CARS } from "@/lib/platform";
import { findRoute, guideSteps, KIND_JA, nearestNode, type GuideStep, type Network, type Route, type RouteOptions } from "@/lib/route";
import type { Station } from "@/lib/station-mode";
import {
  advanceBySteps,
  checkpoints,
  HeadingCheck,
  nextCheckpoint,
  PhoneSteps,
  prevCheckpoint,
  snapFloor,
  snapTurn,
  STEP_M,
  StepCounter,
  TurnWatcher,
  yawRate,
  type Checkpoint,
  type Drift,
} from "@/lib/tracking";
import { gateRow } from "./gate-model";
import { elevatorModel, escalatorModel, stairsModel } from "./lift-model";
import { Walk, WALK_SPEED } from "./Walk";

// 駅の中の道順を 3D で見る。/now のトイレのカードの中（embedded）と、試作の画面（/lab/3d）で使う。急いでいる人が読む順に並べる：
//   ① トイレまで何分・何m、② いまの一手（「エスカレーターで B5（ホーム）→ B3（改札の階）」）、③ 自分のまわりだけを切り出した 3D、④ 条件を変える
// 出発地点は、すぐ道順を出せるように推し量る（号車・地上なら GPS）。分からなければ「いまどこ？」を1回だけ聞く（ホーム・改札・地上）。
// 違っていたら「ここじゃない」から、地図のタップか看板の写真で直す。embedded では、歩く目線・センサーは「もっと見る」にしまう。
// 自分の位置は「道順の上で何 m 進んだか」の1つの数（pos）。歩く目線・上から見る・センサー・確認ポイントのボタン・地図のタップのどれで変えても同じ。
// 次の確認ポイントは 3D にピンクの印で出し、ボタンで「いまここにいる」と位置をそこに合わせる（ずれを直す、という見せ方）。
// 3D は、いまの手順の始まりを中心に半径 CROP_M だけを、出発と行き先の間の階だけ描く（駅の全体は情報が多すぎる）。

const CROP_M = 70;
// 3D の上に重ねる案内（歩く目線と同じ見た目）と、押しやすい大きいボタン
const HUD: CSSProperties = { position: "absolute", left: 8, right: 8, background: "rgba(20,20,19,.82)", color: "#fff", borderRadius: 10, padding: "10px 12px" };
const RATES = [0.5, 1, 2, 4]; // 「歩く」の速さ（ふつうの何倍か）
const RATE_JA: Record<number, string> = { 0.5: "ゆっくり", 1: "ふつう", 2: "2倍", 4: "4倍" };
const ROUND: CSSProperties = { width: 40, height: 40, borderRadius: 20, padding: 0, fontSize: "1.1rem", background: "rgba(20,20,19,.82)", color: "#fff", border: "1px solid rgba(255,255,255,.25)" };
const BIG: CSSProperties = { flex: 1, minHeight: 52, fontSize: "1.05rem", fontWeight: 700 };
const GATE_SCALE = 4; // 上から見る画面の改札機は、実物の 4 倍（遠くから見ても改札だと分かるように）
const FLOOR_H = 14; // 1階ぶんの高さ（m。駅の立体図のように、階と階のあいだを大きくあける）
const COLOR = { stairs: 0xa8875c, escalator: 0x8a63b8, elevator: 0x1e7a3c, slope: 0x7a7a72, route: 0xd93025, now: 0xf2b705, toilet: 0x1f5fbf, you: 0xd93025, checkpoint: 0xd6338a };
const CP_CSS = "#ff6fb5"; // 確認ポイントの印の色（暗い案内の上の文字用に少し明るく）

type Start = { label: string; node: number; kind?: "car" | "platform" | "ground" | "gate" };
type Goal = { label: string; short: string; node: number; place: Place };
const MODES: { label: string; opts: RouteOptions }[] = [
  { label: "一番早い", opts: {} },
  { label: "階段を使わない", opts: { noStairs: true } },
  { label: "段差なし（車いす・ベビーカー）", opts: { stepFree: true } },
];

// 駅の立体図の色（白地に灰色の通路、ホームは路線の色、エレベーターは水色、階の名前は紺、出口番号は黄色）
const DIAGRAM = {
  floorTop: 0xeeeeec,
  floorSide: 0xb9b9b4,
  edge: 0x8f8f8a,
  platformTop: 0xf4c3d8, // 都営大江戸線（マゼンタ）のホーム
  platformSide: 0xc9729b,
  lift: 0x86cff2,
  stairs: 0xdcdcd8,
  route: 0xe60012,
  navy: "#1d2a7a",
};

// 文字だけの札（背景なし、または色つきの角丸）。幅は文字に合わせる
function label(text: string, opt: { fg?: string; bg?: string; border?: string; size?: number; scale?: number } = {}) {
  const size = opt.size ?? 40;
  const c = document.createElement("canvas");
  const g0 = c.getContext("2d")!;
  g0.font = `bold ${size}px system-ui`;
  const w = Math.ceil(g0.measureText(text).width) + (opt.bg ? size : 8);
  c.width = w;
  c.height = Math.ceil(size * 1.5);
  const g = c.getContext("2d")!;
  if (opt.bg) {
    g.fillStyle = opt.bg;
    g.beginPath();
    g.roundRect(2, 2, w - 4, c.height - 4, size * 0.25);
    g.fill();
    if (opt.border) {
      g.strokeStyle = opt.border;
      g.lineWidth = 3;
      g.stroke();
    }
  }
  g.fillStyle = opt.fg ?? DIAGRAM.navy;
  g.font = `bold ${size}px system-ui`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, c.height / 2 + 2);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  const k = (opt.scale ?? 4) / c.height;
  s.scale.set(c.width * k, c.height * k, 1);
  s.renderOrder = 9;
  return s;
}

// 床に隠れた階段・エスカレーターを、薄く透かして描く（手前に何かあるところだけ描く）
// 吹き抜け（駅ごとに手で確かめた一覧）。データの床には吹き抜けがないので、階段・エスカレーターの上の床をここで抜く
const STATION_VOIDS = VOIDS as unknown as Record<string, { floor: number; pts: [number, number][]; note: string }[]>;
// 階ごとの印（ステンシルの 1 ビット）。吹き抜けの四角がその階の印を付け、その階の床は印のあるところを描かない（ほかの階の床は消えない）
const voidBit = (fl: number) => 1 << (((fl % 8) + 8) % 8);

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

// 改札を通るところの言い方（「改札を出る」「中央東改札から入る」）
const gateText = (p: { out?: boolean; name?: string }) => `${p.name ?? "改札"}${p.out === undefined ? "を通る" : p.out ? "を出る" : "から入る"}`;

// 声で読む文に直す（「B6（ホーム） → B5」→「地下6階、ホーム、から、地下5階」、「約80m」→「約80メートル」）
function sayable(t: string) {
  return t
    .replace(/B(\d+)F?/g, "地下$1階")
    .replace(/(\d+)\s*m(?![a-z])/g, "$1メートル")
    .replace(/\s*→\s*/g, "から、")
    .replace(/[（(]/g, "、")
    .replace(/[）)]/g, "、")
    .replace(/、+/g, "、")
    .replace(/、$/, "");
}

// 道順の進む向き（真上から見た方位）。上り下りの途中など、水平にほとんど動かないところは、その先まで見る
function routeBearing(pts: Parameters<typeof pointAt>[0], cum: number[], d: number) {
  const total = cum.at(-1) ?? 0;
  const a = pointAt(pts, cum, d);
  for (let k = 2; k <= 12; k++) {
    const b = pointAt(pts, cum, Math.min(total, d + k));
    if (Math.hypot(b.x - a.x, b.z - a.z) >= 1.5 || d + k >= total) return bearingDeg(b.x - a.x, b.z - a.z);
  }
  return 0;
}

type Props = { station: string; goalId?: string | null; embedded?: boolean };

export function StationRoute({ station, goalId: goalFromUrl = null, embedded = false }: Props) {
  const [car, setCar] = useState<number | null>(embedded ? null : 4); // 乗っていた号車（大江戸線）。/now では分かったときだけ
  const [gps, setGps] = useState<Gps | null>(null); // 地上で GPS が確かなとき（誤差 40m 以内）だけ
  const [reask, setReask] = useState(false); // 「いまどこ？に答え直す」：GPS の推し量りを使わない
  const [askGate, setAskGate] = useState(false);
  const [fixOpen, setFixOpen] = useState(!embedded);
  const [more, setMore] = useState(!embedded);
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
  const youGoal = useRef<THREE.Vector3 | null>(null); // 「あなた」の行き先。描くたびに少しずつ近づける（位置が飛んでも、滑って動く）
  const framed = useRef(""); // カメラの距離を決めた道順（同じ道順のあいだは、本人が決めた角度と距離のまま）
  const youMark = useRef<{ you: THREE.Mesh; beam: THREE.Mesh; cp: THREE.Group; cpSign: THREE.Sprite } | null>(null);
  // スマホの向き（北から時計回りの度）。上から見る画面で「あなた」から扇形で出し、歩く目線もこの向きに回す。速く変わるので state にせず、扇を直接回す。
  // 基準は磁石を使わない相対の向き（ジャイロ）。ホームで線路の向きに合わせたあとは、地下で磁石が狂っても向きがずれない
  const compass = useRef<number | null>(null);
  const gyro = useRef(new Heading());
  const [hasCompass, setHasCompass] = useState(false);
  const [phoneDeg, setPhoneDeg] = useState<number | null>(null); // 画面に出す用（4 度以上、0.15 秒以上あけて更新）
  const shownHeading = useRef({ h: -999, t: 0 });
  const [askCompass, setAskCompass] = useState(false); // iPhone：許可を聞くボタンを出す
  const showHeading = useCallback(() => {
    const h = gyro.current.now();
    if (h === null) return;
    compass.current = h;
    const b = youMark.current?.beam;
    if (b) {
      b.rotation.y = (-h * Math.PI) / 180;
      b.visible = true;
    }
    setHasCompass(true);
    const now = performance.now();
    const last = shownHeading.current;
    if (now - last.t > 150 && Math.abs(((h - last.h + 540) % 360) - 180) > 4) {
      shownHeading.current = { h, t: now };
      setPhoneDeg(h);
    }
  }, []);
  useEffect(() => {
    const H = gyro.current;
    // 相対の向き（Android の deviceorientation、iPhone の alpha）と、磁石の向き（deviceorientationabsolute、iPhone の webkitCompassHeading）
    const onRel = (e: DeviceOrientationEvent) => {
      const ios = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
      if (typeof ios === "number") H.setAbs(ios);
      if (e.alpha === null) return;
      if (e.absolute) H.setAbs(headingFromEuler(e.alpha, e.beta, e.gamma));
      else H.setRel(headingFromEuler(e.alpha, e.beta, e.gamma));
      showHeading();
    };
    const onAbs = (e: DeviceOrientationEvent) => {
      if (e.alpha === null) return;
      H.setAbs(headingFromEuler(e.alpha, e.beta, e.gamma));
      showHeading();
    };
    window.addEventListener("deviceorientationabsolute", onAbs as EventListener);
    window.addEventListener("deviceorientation", onRel);
    const DO = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    const t = setTimeout(() => setAskCompass(compass.current === null && typeof DO?.requestPermission === "function"), 1500);
    return () => {
      clearTimeout(t);
      window.removeEventListener("deviceorientationabsolute", onAbs as EventListener);
      window.removeEventListener("deviceorientation", onRel);
    };
  }, [showHeading]);
  const allowCompass = async () => {
    const DO = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    try {
      await DO?.requestPermission?.();
    } catch {
      // 聞けないとき（http など）は出さないまま
    }
    setAskCompass(false);
  };

  // 地上なら GPS で、いまいる所に近い出入口から出せる（地下では誤差が大きいので使わない）
  useEffect(() => {
    if (!embedded || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => p.coords.accuracy <= 40 && setGps({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => {},
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
    );
  }, [embedded]);
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
    const byCar =
      carEnds(station) && car !== null
        ? carStartNode(net, station, car, (name) => stations.find((x) => x.name === name && /交通局/.test(x.operator ?? "")) ?? stations.find((x) => x.name === name), LINE_CARS.大江戸線.cars)
        : undefined;
    if (byCar !== undefined) list.push({ label: `${line}のホーム（${floorLabel(Math.round(minFloor))}・${car}号車のあたり）`, node: byCar, kind: "car" });
    const gpsNode = gps ? nearestNode(net, gps, 1) : -1;
    const gpsNear = gpsNode >= 0 && net.nodes[gpsNode][2] === 1 && distanceM(gps!, { lat: net.nodes[gpsNode][0], lon: net.nodes[gpsNode][1] }) <= 80;
    const ground: Start = gpsNear
      ? { label: "地上の出入口（GPS で、いまいる所に近いもの）", node: gpsNode, kind: "ground" }
      : { label: "地上の出入口のあたり（1F）", node: nearestNode(net, center, 1), kind: "ground" };
    const platform: Start = { label: `${line ? `${line}の` : ""}ホーム（${floorLabel(Math.round(minFloor))}・まん中あたり）`, node: nearestNode(net, lowCenter, minFloor), kind: "platform" };
    // GPS で地上にいると分かれば、それを最初に（号車を選んだときは号車）
    list.push(...(gpsNear && byCar === undefined && !reask ? [ground, platform] : [platform, ground]));
    const seen = new Set<string>();
    // 改札の名前は日本語のものだけ（英語の重複や、壊れた文字の名前を除く）
    const readable = (name: string) => /[\u3040-\u30ff\u4e00-\u9fff]/.test(name) && !/[\u0000-\u001f]/.test(name);
    for (const g of indoor.features.filter((f) => f.kind === "gate" && f.name && readable(f.name) && f.floors.length)) {
      const name = `${g.name}（${floorLabel(g.floors[0])}）`;
      if (seen.has(name)) continue;
      seen.add(name);
      const c = { lat: g.coords.reduce((a, p) => a + p[0], 0) / g.coords.length, lon: g.coords.reduce((a, p) => a + p[1], 0) / g.coords.length };
      list.push({ label: `改札：${name}`, node: nearestNode(net, c, g.floors[0]), kind: "gate" });
    }
    return picked?.key === key ? [picked.start, ...list.filter((x) => x.label !== picked.start.label)] : list;
  }, [net, indoor, center, station, car, stations, minFloor, line, picked, key, gps, reask]);
  // /now で出発地点を推し量れない（号車も、地上の GPS もない）ときは、「いまどこ？」を聞いてから道順を出す
  const asking = embedded && !picked && car === null && (reask || starts[0]?.label.includes("GPS") !== true);
  const chooseStart = (s?: Start) => {
    if (!s) return;
    setPicked({ key, start: s });
    setStartIdx(0);
    setAskGate(false);
  };

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

  // 行き先：選んだもの。/now の中（embedded）では、経路でいちばん早く着くトイレ（直線で近いカードのトイレより、
  // エレベーターで 1 分のトイレが早いことがある。深い駅ほど差が大きい）。試作の画面では、URL のトイレ
  const urlGoal = goals.findIndex((g) => g.place.id === goalFromUrl);
  const goalAt = goalIdx >= 0 ? goalIdx : embedded ? 0 : Math.max(0, urlGoal);
  const goal = goals[goalAt];
  const route: Route | undefined = useMemo(() => {
    if (!net || !starts[startIdx] || !goal) return undefined;
    return findRoute(net, starts[startIdx].node, goal.node, MODES[mode].opts);
  }, [net, starts, startIdx, goal, mode]);
  const guide = useMemo(() => (route ? guideSteps(route) : []), [route]);
  const routeKey = route?.nodes.join(",") ?? "";
  const path = useMemo(() => (route && net ? routePath(net, route, center) : { pts: [], cum: [0] }), [net, route, center]);
  const total = path.cum.at(-1) ?? 0;
  // 道順が通る改札（出発がホームなら改札の中から。通るたびに出る・入るが入れ替わる）
  const gateShapes: GateShape[] = useMemo(
    () =>
      (indoor?.features ?? [])
        .filter((f) => f.kind === "gate" && f.coords.length)
        .flatMap((f) =>
          f.floors.map((floor) => ({
            name: f.name && /[ぁ-ヿ一-鿿]/.test(f.name) ? f.name : undefined,
            floor,
            pts: f.coords.map(([lat, lon]) => ({ x: (lon - center.lon) * kx, z: -(lat - center.lat) * 110_540 })),
          })),
        ),
    [indoor, center, kx],
  );
  // 出るか入るか：行き先のトイレの改札の内外が分かればそれから。分からなければ出発から（ホームは中、地上は外）。
  // 改札から出発するときは、その改札は数えない（内か外かも分からない）
  const startKind = starts[startIdx]?.kind;
  const startFloor = route && net ? net.nodes[route.nodes[0]][2] : undefined;
  const startInside = startKind === "gate" ? undefined : startKind === "ground" ? false : startFloor === minFloor ? true : undefined;
  const endInside = goal?.place.gate === "inside" ? true : goal?.place.gate === "outside" ? false : undefined;
  const skipStartM = startKind === "gate" ? 10 : 0;
  const passes = useMemo(() => (path.pts.length ? gatePasses(path.pts, path.cum, gateShapes, { startInside, endInside, skipStartM }) : []), [path, gateShapes, startInside, endInside, skipStartM]);
  // 改札機の列を立てる位置：道順が通る改札と、ほかの改札（点の改札は、近くの通路の向きで）
  // 階段・エスカレーター・エレベーターの形（歩く目線の座標：高さは実際に近い FLOOR_M）
  const walkLifts = useMemo(() => {
    if (!net) return undefined;
    return liftParts(net, (i) => {
      const [lat, lon, floor] = net.nodes[i];
      return { x: (lon - center.lon) * kx, y: floor * FLOOR_M, z: -(lat - center.lat) * 110_540, floor };
    });
  }, [net, center, kx]);
  const walkLinks: WalkLink[] = useMemo(() => {
    if (!net) return [];
    const xz = (i: number) => ({ x: (net.nodes[i][1] - center.lon) * kx, z: -(net.nodes[i][0] - center.lat) * 110_540 });
    return net.links.filter(([a, b]) => net.nodes[a][2] === net.nodes[b][2]).map(([a, b]) => ({ floor: net.nodes[a][2], ax: xz(a).x, az: xz(a).z, bx: xz(b).x, bz: xz(b).z }));
  }, [net, center, kx]);
  // 点の改札を通る向き：駅の道を、改札の内（ホーム側）と外（地上側）に分けて決める
  const dirs = useMemo(() => {
    if (!net) return undefined;
    const nodes = net.nodes.map(([lat, lon, floor]) => ({ x: (lon - center.lon) * kx, z: -(lat - center.lat) * 110_540, floor }));
    return gateDirs(
      nodes,
      net.links.map(([a, b]) => [a, b] as [number, number]),
      gateShapes,
    );
  }, [net, gateShapes, center, kx]);
  // 通路の床の形（改札の列の横を、床の端まで柵でふさぐため。改札のデータは点 1 つなので、そのままだと列の横が開いて、外とつながって見える）
  const floorPolys: FloorPoly[] = useMemo(
    () =>
      (indoor?.features ?? [])
        .filter((f) => f.closed && f.coords.length >= 3 && ["corridor", "area", "platform"].includes(f.kind))
        .flatMap((f) => f.floors.map((floor) => ({ floor, pts: f.coords.map(([lat, lon]) => ({ x: (lon - center.lon) * kx, z: -(lat - center.lat) * 110_540 })) }))),
    [indoor, center, kx],
  );
  const gateRows = useMemo(
    () =>
      gateFrames(gateShapes, walkLinks, path.pts.length ? { pts: path.pts, cum: path.cum, passes } : undefined, dirs).map((f) => {
        if (!f.fence) return f;
        // 柵は床の端まで（長くても片側 12m。広い広間で、関係のないところまでふさがないように）
        const r = floorReach(f, floorPolys);
        return { ...f, wallLeft: r.left > 0 ? Math.min(12, r.left) : undefined, wallRight: r.right > 0 ? Math.min(12, r.right) : undefined };
      }),
    [gateShapes, walkLinks, path, passes, dirs, floorPolys],
  );
  const list = useMemo(() => {
    if (!path.pts.length) return [];
    const gates: Maneuver[] = passes.map((p) => ({ at: p.at, kind: "gate", text: gateText(p), out: p.out, name: p.name }));
    return [...maneuvers(path.pts, path.cum, guide), ...gates].sort((a, b) => a.at - b.at || (a.kind === "arrive" ? 1 : b.kind === "arrive" ? -1 : 0));
  }, [path, guide, passes]);
  const cps = useMemo(() => checkpoints(list), [list]);
  // 手順の文。歩くあいだに改札を通るなら、それも言う（出るか入るかは大事な分かれ目）
  const stepLine = (g: GuideStep, next?: GuideStep) => {
    const gate = passes.find((p) => p.at >= path.cum[g.from] - 0.5 && p.at <= path.cum[g.to] + 0.5);
    return gate ? `${stepText(g, next)}（途中で${gateText(gate)}）` : stepText(g, next);
  };
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
  const [playing, setPlaying] = useState(false); // 「歩く」（事前に確かめるため、自動で進める）
  const [rate, setRate] = useState(1); // 「歩く」の速さ（ふつうの何倍か）。押すたびに 0.5 → 1 → 2 → 4 倍
  const [picking, setPicking] = useState(false); // 地図で位置を直す（次のタップ）
  const [follow, setFollow] = useState(true); // 自分に合わせて動く（センサーで位置、スマホの向きで歩く目線の向き）。規定でオン、選んで止める
  const [started, setStarted] = useState(false); // 「案内をスタート」で向きを合わせてから、案内を始める（それまでは地図を見るだけ）
  const [aligning, setAligning] = useState<null | "start" | "fix">(null);
  const [full, setFull] = useState(false); // 全画面（3D と案内だけを画面いっぱいに）
  const fullBox = useRef<HTMLDivElement>(null);
  // 全画面は、ページの上いっぱいに広げるだけにする（ブラウザの全画面機能は、Android で「全画面表示を終了するには…」の
  // 知らせが下に出たまま消えないことがあり、案内のボタンが隠れる）。スマホの「戻る」で閉じられるよう、履歴を1つ積む
  const openFull = () => {
    if (full) return;
    setFull(true);
    history.pushState({ srFull: true }, "");
  };
  const closeFull = () => {
    if ((history.state as { srFull?: boolean } | null)?.srFull) history.back();
    else setFull(false);
  };
  const toggleFull = () => (full ? closeFull() : openFull());
  const [voice, setVoice] = useState(false); // 音声ガイド（読み上げ）。人前で急に鳴らないよう、選んだときだけ // 向きを合わせる画面（スタートのときと、途中で直すとき）
  const followAsked = useRef(false); // 自分でオンにしたか（センサーが届かないときの知らせは、そのときだけ出す）
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
          : c.kind === "gate"
            ? `${gateText(c)}ところ`
            : "トイレ";
  // エレベーターのボタンの書き方（B3・1・2。中二階はボタンの名前が駅ごとに違うので、階の名前で）
  const liftButton = (f: number) => (!Number.isInteger(f) ? floorName(f) : f < 0 ? `B${-f}` : `${f}`);
  // 駅のエレベーターのボタンや案内は、階の数字（B4）と一緒に「改札」「ホーム」「地上」と大きく書いてあることが多い
  const liftRole = (f: number) => (f === minFloor ? "ホーム" : gateFloors.has(f) ? "改札" : f >= 1 ? "地上" : "");
  const liftPress = (f: number) => (liftRole(f) ? `「${liftRole(f)}」（${liftButton(f)}）` : `「${liftButton(f)}」`);
  // エレベーターの手前 25m から降りるまで、押す階を大きく出す
  const lift = cps.find((c) => c.via === "elevator" && ((c.kind === "board" && c.at > pos - 0.5 && c.at - pos <= 25) || (c.kind === "alight" && pos >= c.boardAt! - 0.5 && pos < c.at - 0.01)));
  // ボタン：「いまここにいる」と押して、位置をピンクの印に合わせる
  const cpButton = (c: Checkpoint) =>
    c.kind === "alight"
      ? `${KIND_JA[c.via!]}を降りた`
      : c.kind === "arrive"
        ? "トイレに着いた"
        : c.kind === "gate"
          ? c.out === undefined
            ? "改札を通った"
            : c.out
              ? "改札を出た"
              : "改札に入った"
          : `いま${cpLabel(c)}にいる`;
  const [drift, setDrift] = useState<Drift | null>(null); // センサーで追っているとき、逆向き・横向きに歩いている
  const recal = useRef(false); // 「向きは合っている」：次の1歩で、いまの向きを道順の向きに合わせ直す
  // 歩く目線の上の案内の文（上り下りは手順の文と同じ言い方に）
  const listText: Maneuver[] = list.map((m) => {
    const g = m.kind === "floor" ? guide.find((x) => path.cum[x.from] === m.at && x.fromFloor !== x.toFloor) : undefined;
    return g ? { ...m, text: stepText(g) } : m;
  });

  // センサーで追う：歩数で進め、曲がった・気圧で階が変わったら近くの確認ポイントに合わせ直す
  useEffect(() => {
    if (!follow || !started) return;
    const steps = new StepCounter();
    const turns = new TurnWatcher();
    let n = 0;
    let fixes = 0;
    let got = false;
    let baro = "";
    let alive = true;
    let stopBaro: (() => void) | undefined;
    const note = () => setTrackNote(`歩数 ${n}・曲がり角などで自動で合わせ直した ${fixes} 回${baro}`);
    // 向き：歩いている向きと道順の向きを比べる（後ろ向きなら戻す・横向きなら止めて知らせる）
    // スマホの向きを合わせてあれば（線路・道順の向き）、その向きで 進む・戻る・止まる を決める。なければジャイロで回った角度から
    const heads = new HeadingCheck();
    const phoneSteps = new PhoneSteps();
    const bearing = (d: number) => {
      const { path } = live.current;
      if (path.pts.length < 2) return 0; // 道順がまだない
      return routeBearing(path.pts, path.cum, d);
    };
    const spun: [number, number][] = []; // 回った角度の合計（度。左回りが正）の、直近 6 秒
    let turning: { t: number; dir: "left" | "right" } | null = null;
    let mine = live.current.pos; // センサーで置いた位置。ほかで変わったら（ボタン・地図）、その向きに合わせ直す
    heads.calibrate(bearing(mine));
    const go = (d: number | undefined, fix: boolean) => {
      if (d === undefined || Math.abs(d - live.current.pos) < 0.05) return;
      if (fix) {
        fixes++;
        heads.calibrate(bearing(d));
        phoneSteps.reset();
        // 角を曲がった・階が変わったところは、向きが道順の向きとほぼ同じはず。スマホの向きを半分だけ寄せる
        gyro.current.pull(bearing(d), 0.5, 30);
        setDrift(null);
      }
      mine = d;
      setPos(d);
      note();
    };
    const onMotion = (e: DeviceMotionEvent) => {
      const g = e.accelerationIncludingGravity;
      if (g?.x == null || g.y == null || g.z == null) return;
      got = true;
      const r = e.rotationRate;
      const yaw = r?.alpha != null && r.beta != null && r.gamma != null ? yawRate({ alpha: r.alpha, beta: r.beta, gamma: r.gamma }, { x: g.x, y: g.y, z: g.z }) : undefined;
      if (yaw !== undefined) {
        heads.turn(e.timeStamp, yaw);
        spun.push([e.timeStamp, (spun.at(-1)?.[1] ?? 0) + (yaw * Math.min(200, e.timeStamp - (spun.at(-1)?.[0] ?? e.timeStamp))) / 1000]);
        while (spun.length && e.timeStamp - spun[0][0] > 6000) spun.shift();
      }
      const at = live.current.pos;
      if (Math.abs(at - mine) > 0.05 || recal.current) {
        heads.calibrate(bearing(at));
        mine = at;
        recal.current = false;
        phoneSteps.reset();
        setDrift(null);
      }
      if (steps.push(e.timeStamp, Math.hypot(g.x, g.y, g.z))) {
        n++;
        const route = bearing(at);
        const ahead = bearing(at + 5);
        const phone = gyro.current.by === "track" ? gyro.current.now() : null;
        if (phone !== null) {
          const s = phoneSteps.step(phone, route, ahead);
          setDrift(s.drift ?? null);
          if (s.move === 1) {
            // まっすぐの通路を進んでいるときは、スマホの向きを道順の向きに少しずつ寄せる（ジャイロの少しずつのずれを消す）
            if (Math.abs(signedDiff(route, ahead)) < 10) gyro.current.pull(route, 0.08, 25);
            go(advanceBySteps(live.current.cps, at, STEP_M), false);
          } else if (s.move === -1) {
            // 後ろを向いて歩いている：来た道を戻す（エレベーターなどを降りたところより前には戻さない）
            const stop = live.current.cps.filter((c) => c.kind === "alight" && c.at <= at + 0.01).at(-1)?.at ?? 0;
            go(Math.max(stop, at - STEP_M), false);
          }
        } else {
          const h = heads.step(route, ahead);
          setDrift(h.drift ?? null);
          if (h.advance) go(advanceBySteps(live.current.cps, at, STEP_M), false);
        }
        note();
      }
      if (yaw === undefined) return;
      // 曲がった：回り終わるのを待って、回った角度をはかる。45〜135 度なら角を曲がった（近くの角に合わせる）。
      // それより大きいのは引き返した（角には合わせない。向きの確かめが「逆に歩いていませんか」と知らせる）
      const dir = turns.push(e.timeStamp, yaw);
      if (dir && !turning) turning = { t: e.timeStamp, dir };
      if (turning && e.timeStamp - turning.t > 1000 && Math.abs(yaw) < 20) {
        const before = spun.find(([t]) => t >= turning!.t - 2500)?.[1] ?? 0;
        const total = Math.abs((spun.at(-1)?.[1] ?? 0) - before);
        if (total >= 45 && total <= 135) go(snapTurn(live.current.cps, live.current.pos, turning.dir), true);
        turning = null;
      }
    };
    window.addEventListener("devicemotion", onMotion);
    const check = setTimeout(() => {
      if (!got && followAsked.current) setTrackNote("動きのセンサーが届いていません（パソコンのときなど）。ピンクの印のところで「いま〜にいる」を押すか、地図のタップで進めてください。");
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
      setDrift(null);
      window.removeEventListener("devicemotion", onMotion);
      clearTimeout(check);
      stopBaro?.();
    };
  }, [follow, started, setPos]);
  // iPhone は、ボタンを押したときに動きと向きのセンサーの許可を聞く。断られても止めない（届かなければ知らせる）
  const askSensors = async () => {
    for (const name of ["DeviceMotionEvent", "DeviceOrientationEvent"]) {
      const E = (window as unknown as Record<string, { requestPermission?: () => Promise<string> } | undefined>)[name];
      try {
        await E?.requestPermission?.();
      } catch {
        // 聞けない（http のときなど）。そのまま試す
      }
    }
    setAskCompass(false);
  };
  const toggleFollow = async () => {
    if (follow) {
      setFollow(false);
      setTrackNote("止めました。ピンクの印のところでボタンを押すか、地図のタップで進めます。");
      return;
    }
    followAsked.current = true;
    await askSensors();
    setPlaying(false);
    setTrackNote("自分に合わせて動きます。スマホを手に持って歩いてください。");
    setFollow(true);
  };

  // 3D の舞台
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.setClearColor(0xffffff);
    el.appendChild(renderer.domElement);
    const sc = new THREE.Scene();
    // 立体図のように、遠近の弱い（画角の狭い）カメラで遠くから見る
    const camera = new THREE.PerspectiveCamera(22, el.clientWidth / el.clientHeight, 5, 8000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    sc.add(new THREE.AmbientLight(0xffffff, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.4, 1, 0.6);
    sc.add(sun);
    const layer = new THREE.Group();
    sc.add(layer);
    scene.current = { camera, controls, layer };
    let raf = 0;
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // 「あなた」を行き先へ滑らせる（40m より離れたら飛ぶ）。回す・拡大の中心も一緒に動かす（角度と距離はそのまま）
      const m = youMark.current;
      const g = youGoal.current;
      if (m && g) {
        const at = m.you.userData.placed && m.you.position.distanceTo(g) < 40 ? m.you.position.clone().lerp(g, 1 - Math.exp(-dt * 6)) : g.clone();
        m.you.userData.placed = true;
        m.you.position.copy(at);
        m.beam.position.copy(at).add(new THREE.Vector3(0, 0.3, 0));
        camera.position.add(at.clone().sub(controls.target));
        controls.target.copy(at);
      }
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
    const ro = new ResizeObserver(() => el.clientWidth && onResize());
    ro.observe(el);
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
      ro.disconnect();
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

    // 駅の立体図ふうに描く：歩ける所（通路・広場・ホーム）だけを厚みのある板にし、部屋や店は描かない。
    // ホームは路線の色、エレベーターは水色の柱、階段・エスカレーターは段の模様の坂。階の名前・出口番号・改札・トイレ・方面は札で
    const xz = (lat: number, lon: number) => toXYZ(lat, lon, 0);
    const T = 0.9; // 板の厚み
    const walkFeatures = indoor.features.filter(
      (f) => f.closed && f.coords.length >= 3 && f.floors.some(inRange) && ["corridor", "area", "platform"].includes(f.kind) && f.coords.some(([lat, lon]) => near(lat, lon, crop * 1.2)),
    );
    const westOf = new Map<number, THREE.Vector3>(); // 階ごとの、いちばん西の角（階の名前を置く）
    // 吹き抜け：床より先に（描く順 -10）、四角のところに階の印を付ける。色も奥行きも書かない
    const voids = (STATION_VOIDS[station] ?? []).filter((v) => inRange(v.floor) && v.pts.some(([lat, lon]) => near(lat, lon, crop * 1.2)));
    const voidFloors = new Set(voids.map((v) => v.floor));
    for (const v of voids) {
      // 四角を周りに 0.3m 広げ（となりの吹き抜けとのあいだに細い床が残らないように）、床の厚みの分まで箱にする
      // （上の面だけだと、板の側面が穴の中に「切り残し」のように残る）
      const cs = v.pts.map(([lat, lon]) => new THREE.Vector2(xz(lat, lon).x, -xz(lat, lon).z));
      const c = cs.reduce((m, q) => m.add(q.clone().divideScalar(cs.length)), new THREE.Vector2());
      const grown = cs.map((q) => q.clone().add(q.clone().sub(c).normalize().multiplyScalar(0.42)));
      const g = new THREE.ExtrudeGeometry(new THREE.Shape(grown), { depth: T + 0.2, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      g.translate(0, v.floor * FLOOR_H - T - 0.1, 0);
      const bit = voidBit(v.floor);
      const m = new THREE.MeshBasicMaterial({
        colorWrite: false,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        stencilWrite: true,
        stencilRef: bit,
        stencilWriteMask: bit,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilZPass: THREE.ReplaceStencilOp,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.renderOrder = -10;
      s.layer.add(mesh);
    }
    // その階に吹き抜けがあれば、床は印のないところだけ描く
    const cut = (fl: number) => (voidFloors.has(fl) ? { stencilWrite: true, stencilWriteMask: 0, stencilRef: voidBit(fl), stencilFuncMask: voidBit(fl), stencilFunc: THREE.NotEqualStencilFunc } : {});
    for (const f of walkFeatures) {
      const shape = new THREE.Shape(f.coords.map(([lat, lon]) => new THREE.Vector2(xz(lat, lon).x, -xz(lat, lon).z)));
      for (const fl of f.floors.filter(inRange)) {
        // ホームは路線の色（大江戸線のデータは「ホーム」の区別がないので、いちばん下の階の歩ける所はホームとみなす）
        const plat = !!line && (f.kind === "platform" || fl === minFloor);
        const g = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false });
        g.rotateX(-Math.PI / 2);
        g.translate(0, fl * FLOOR_H - T, 0);
        const top = new THREE.MeshBasicMaterial({ color: plat ? DIAGRAM.platformTop : DIAGRAM.floorTop, ...cut(fl) });
        const side = new THREE.MeshBasicMaterial({ color: plat ? DIAGRAM.platformSide : DIAGRAM.floorSide, ...cut(fl) });
        s.layer.add(new THREE.Mesh(g, [top, side]));
        s.layer.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), new THREE.LineBasicMaterial({ color: DIAGRAM.edge, ...cut(fl) })));
        if (Number.isInteger(fl))
          for (const [lat, lon] of f.coords) {
            const v = toXYZ(lat, lon, fl);
            if (near(lat, lon, crop * 0.5) && (!westOf.has(fl) || v.x < westOf.get(fl)!.x)) westOf.set(fl, v);
          }
      }
    }

    // 上り下り：本物のような階段・エスカレーター・エレベーター（横は実物の大きさ。並んでいるものと重ならないように。高さは階の間を広げた分だけ伸びるので、
    // 階段の 1 段もそのぶん高くして、段の数は実際と同じくらいにする）。エレベーターのガラスは、立体図と同じ水色
    const parts = liftParts(net, (i) => {
      const [lat, lon, floor] = net.nodes[i];
      const v = toXYZ(lat, lon, floor);
      return { x: v.x, y: v.y, z: v.z, floor };
    });
    const nodeNear = (p: { x: number; z: number }) => near(center.lat - p.z / 110_540, center.lon + p.x / kx);
    for (const f of parts.flights) {
      if (!inRange(f.a.floor) || !inRange(f.b.floor) || !(nodeNear(f.a) || nodeNear(f.b))) continue;
      const g = f.kind === "stairs" ? stairsModel(f, { stepH: (0.17 * FLOOR_H) / FLOOR_M }) : escalatorModel(f);
      s.layer.add(g);
    }
    for (const sh of parts.shafts) {
      const stops = sh.stops.filter((t) => inRange(t.floor));
      if (stops.length < 1 || !nodeNear(sh)) continue;
      s.layer.add(elevatorModel({ ...sh, stops }, { k: 2, cab: 4, glass: 0.6 }).group);
    }

    // 札：階の名前（紺）、出口番号（黄色）、改札、トイレ
    for (const [fl, v] of westOf) {
      const l = label(fl < 0 ? `B${-fl}F` : `${fl}F`, { size: 48, scale: 7 });
      l.position.set(v.x - 6, v.y + 3, v.z);
      s.layer.add(l);
    }
    for (const f of indoor.features) {
      if (!f.coords.length || !f.coords.some(([lat, lon]) => near(lat, lon))) continue;
      const fl = f.floors[0] ?? (f.kind === "entrance" ? 1 : undefined);
      if (fl === undefined || !inRange(fl)) continue;
      const lat = f.coords.reduce((a, c) => a + c[0], 0) / f.coords.length;
      const lon = f.coords.reduce((a, c) => a + c[1], 0) / f.coords.length;
      const at = toXYZ(lat, lon, fl);
      if (f.kind === "entrance" && f.name) {
        const n = f.name.replace(/(出入口|出口|番)/g, "").trim();
        if (!n || n.length > 6) continue;
        const l = label(n, { fg: "#222", bg: "#ffe14d", size: 36, scale: 3.2 });
        l.position.set(at.x, at.y + 3, at.z);
        s.layer.add(l);
      } else if (f.kind === "gate") {
        const l = label("改札", { fg: "#fff", bg: "#4a5568", size: 30, scale: 2.6 });
        l.position.set(at.x, at.y + 15, at.z); // 改札機の列（案内板の高さ 12m ほど）より上に
        s.layer.add(l);
      }
    }
    for (const g of goals) {
      const fl = placeFloor(g.place, indoor.features)?.floor;
      if (fl === undefined || !inRange(fl) || !near(g.place.lat, g.place.lon)) continue;
      const l = label("🚻", { bg: "#ffffff", border: "#1f5fbf", size: 40, scale: 3.4 });
      const at = toXYZ(g.place.lat, g.place.lon, fl);
      l.position.set(at.x, at.y + 3, at.z);
      s.layer.add(l);
    }
    // ホームの両端に方面（大江戸線の駅）
    const ends = carEnds(station);
    const st = (name: string) => stations.find((x) => x.name === name && /交通局/.test(x.operator ?? "")) ?? stations.find((x) => x.name === name);
    if (ends && st(ends.car1Side) && st(ends.otherSide)) {
      const a = st(ends.otherSide)!;
      const b = st(ends.car1Side)!;
      const ax = toXYZ(b.lat, b.lon, 0)
        .sub(toXYZ(a.lat, a.lon, 0))
        .setY(0)
        .normalize();
      const plat = walkFeatures.filter((f) => f.kind === "platform" || f.floors.includes(minFloor)).flatMap((f) => f.coords.map(([lat, lon]) => toXYZ(lat, lon, minFloor)));
      if (plat.length) {
        const along = plat.map((v) => v.x * ax.x + v.z * ax.z);
        const hi = plat[along.indexOf(Math.max(...along))];
        const lo = plat[along.indexOf(Math.min(...along))];
        for (const [v, name] of [
          [hi, ends.car1Side],
          [lo, ends.otherSide],
        ] as const) {
          const l = label(`${name} 方面`, { bg: "#ffffff", border: DIAGRAM.navy, size: 34, scale: 3.4 });
          l.position.copy(v).add(new THREE.Vector3(0, 3, 0));
          s.layer.add(l);
        }
      }
    }

    // 改札：自動改札機の列（大きめに）。点の改札は 4 倍、線の改札は線の長さのまま並べる（台は 2 倍の大きさ）
    for (const f of gateRows) {
      if (!inRange(f.floor) || !near(center.lat - f.z / 110_540, center.lon + f.x / kx)) continue;
      const k = f.fence ? GATE_SCALE : 2;
      const g = gateRow({
        name: f.name,
        out: f.out,
        left: Math.min(f.left, f.wallLeft ?? 99) / k,
        right: Math.min(f.right, f.wallRight ?? 99) / k,
        fenceLeft: f.wallLeft !== undefined ? f.wallLeft / k : undefined,
        fenceRight: f.wallRight !== undefined ? f.wallRight / k : undefined,
        board: f.board,
        lane: f.onRoute,
      });
      g.scale.setScalar(k);
      g.traverse((o) => (o.renderOrder = 7)); // 赤い道順の線（奥行きを見ずに描く）のあとに描いて、手前の改札機が線に隠れないように
      g.position.set(f.x, f.floor * FLOOR_H, f.z);
      g.rotation.y = Math.atan2(f.dx, f.dz);
      s.layer.add(g);
    }

    // 経路と、いまの手順
    const pts = route.nodes.map((i) => toXYZ(net.nodes[i][0], net.nodes[i][1], net.nodes[i][2]).add(new THREE.Vector3(0, 0.6, 0)));
    const tube = (ps: THREE.Vector3[], r: number, color: number, order: number) => {
      const m = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ps, false, "catmullrom", 0), Math.max(16, ps.length * 4), r, 6, false),
        new THREE.MeshBasicMaterial({ color, depthTest: false }),
      );
      m.renderOrder = order;
      return m;
    };
    if (!arrived && current.to > current.from) s.layer.add(tube(pts.slice(current.from, current.to + 1), 1.6, COLOR.now, 5));
    s.layer.add(tube(pts, 0.8, DIAGRAM.route, 6));

    // あなた（赤い丸。札は付けない。位置は下の効果で動かす）・トイレ
    const you = new THREE.Mesh(new THREE.SphereGeometry(2.2, 20, 14), new THREE.MeshBasicMaterial({ color: COLOR.you, depthTest: false }));
    you.renderOrder = 8;
    const youAt = arrived ? pts.at(-1)! : pts[current.from];
    s.layer.add(you);
    // スマホの向き：あなたから前へ広がる扇（北から時計回りの度で回す。向きが取れないときは出さない）
    const fan = new THREE.Shape();
    fan.moveTo(0, 0);
    fan.lineTo(Math.sin(-0.45) * 12, Math.cos(-0.45) * 12);
    fan.quadraticCurveTo(0, 14, Math.sin(0.45) * 12, Math.cos(0.45) * 12);
    fan.lineTo(0, 0);
    const fanG = new THREE.ShapeGeometry(fan);
    fanG.rotateX(-Math.PI / 2);
    const beam = new THREE.Mesh(fanG, new THREE.MeshBasicMaterial({ color: COLOR.you, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    beam.visible = compass.current !== null;
    if (compass.current !== null) beam.rotation.y = (-compass.current * Math.PI) / 180;
    s.layer.add(beam);
    // 次の確認ポイント：道順をまたぐピンクの門（丸い「あなた」と形で見分け、近くても両脇の柱が見える）。位置と向きは下の効果で。
    // 札は、離れているときだけ（近いと赤い丸にかぶる）
    const cp = new THREE.Group();
    const cpMat = new THREE.MeshBasicMaterial({ color: COLOR.checkpoint });
    cp.add(new THREE.Mesh(new THREE.BoxGeometry(11, 0.4, 1.4), cpMat).translateY(0.7)); // 床の線
    for (const x of [-5.2, 5.2]) cp.add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 6, 0.7), cpMat).translateX(x).translateY(3)); // 両脇の柱
    cp.add(new THREE.Mesh(new THREE.BoxGeometry(11.1, 0.7, 0.7), cpMat).translateY(6)); // 上の横木（門の形。真上から見ても線に見える）
    const cpSign = sign("次の確認ポイント", "rgba(214,51,138,.92)", 300);
    cpSign.position.y = 9;
    cpSign.scale.multiplyScalar(0.75);
    cp.add(cpSign);
    cp.visible = false;
    s.layer.add(cp);
    youMark.current = { you, beam, cp, cpSign };
    const end = pts.at(-1)!;
    const wcSign = sign("トイレ", "rgba(31,95,191,.92)", 180);
    wcSign.position.copy(end).add(new THREE.Vector3(0, 8, 0));
    s.layer.add(wcSign);

    // カメラ：いまの手順が全部入る距離で、斜め上から（回す中心は、下の効果で「あなた」に移す）
    const seg = new THREE.Box3().setFromPoints(arrived ? [youAt] : pts.slice(current.from, current.to + 1));
    const c = seg.getCenter(new THREE.Vector3());
    const size = seg.getSize(new THREE.Vector3()).length();
    // 歩いているあいだに手順が変わっても、カメラは飛ばさない（あなたについて滑る）
    if (framed.current !== routeKey) {
      framed.current = routeKey;
      s.controls.target.copy(c);
      // 画角が狭いので、そのぶん遠くから（立体図のように、ほぼ平行に見える）
      s.camera.position.copy(c.clone().add(new THREE.Vector3(-0.6, 0.75, 0.9).multiplyScalar(Math.max(CROP_M * 1.1, size * 0.85) * 3.2)));
      s.camera.updateProjectionMatrix();
    }
  }, [indoor, net, route, current, arrived, toXYZ, routeKey, goals, stations, station, line, minFloor, gateRows, center, kx]);
  useEffect(() => {
    const m = youMark.current;
    if (!m || !path.pts.length) return;
    const p = pointAt(path.pts, path.cum, pos);
    // 「あなた」と回す中心は、描くたびにここへ滑らせる（上の舞台の毎フレームの処理）
    youGoal.current = new THREE.Vector3(p.x, (p.y / FLOOR_M) * FLOOR_H + 0.6, p.z);
    // 次の確認ポイント（トイレは青い柱があるので出さない）
    m.cp.visible = !!next && next.kind !== "arrive";
    if (next) {
      const c = pointAt(path.pts, path.cum, next.at);
      m.cp.position.set(c.x, (c.y / FLOOR_M) * FLOOR_H, c.z);
      // 帯は、そこへ来る向き（エレベーターの降り口のように真上から来るときは、出ていく向き）に直角に
      const flat = (a: number, b: number) => {
        const p = pointAt(path.pts, path.cum, a);
        const q = pointAt(path.pts, path.cum, b);
        return { dx: q.x - p.x, dz: q.z - p.z };
      };
      let d = flat(next.at - 3, next.at);
      if (Math.hypot(d.dx, d.dz) < 0.5) d = flat(next.at, next.at + 3);
      m.cp.rotation.y = Math.atan2(d.dx, d.dz);
      m.cpSign.visible = next.at - pos > 12;
      for (const i of [1, 2, 3]) m.cp.children[i].visible = next.kind !== "gate";
    }
  }, [pos, path, current, arrived, next]);

  // 上から見る画面の「歩く」（試しに自動で進める。歩く目線では Walk が自分で進める）
  useEffect(() => {
    if (!playing || view !== "above") return;
    let last = performance.now();
    let sent = 0;
    let d = live.current.pos;
    let raf = 0;
    const tick = (now: number) => {
      if (Math.abs(live.current.pos - d) > 2) d = live.current.pos; // ボタンや地図で位置を直したら、そこから
      d = Math.min(total, d + Math.min(0.1, (now - last) / 1000) * WALK_SPEED * rate);
      last = now;
      if (now - sent > 100 || d >= total) {
        sent = now;
        setPos(d);
      }
      if (d >= total) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, view, total, setPos, rate]);

  const startLabel = starts[startIdx]?.label;

  // 「いまどこ？」：看板を撮る → AI が看板と配置を読む → 地図のデータで候補を作る（GPS も）→ AI が写真と候補を比べる → 本人が選ぶ
  const lms = useMemo(() => (indoor ? landmarks(indoor.features) : []), [indoor]);

  // 歩き出す最初の向き：出発したところと、上り下りを降りたところから 3m のあいだだけ出す
  // 目印の名前は、日本語のものと出口番号（A15 など）だけ（「Odakyu West Gate」のような英語の重複は使わない）
  const hintMarks: HintMark[] = useMemo(
    () =>
      lms
        .filter((m) => /[぀-ヿ一-鿿]/.test(m.name) || /^[A-Za-z]?\d{1,3}[a-z]?$/.test(m.name))
        .map((m) => ({ x: (m.lon - center.lon) * kx, z: -(m.lat - center.lat) * 110_540, floor: m.floor, name: m.name, kind: m.kind })),
    [lms, center, kx],
  );
  const platformInfo: PlatformInfo | undefined = useMemo(() => {
    const ends = carEnds(station);
    if (!ends) return undefined;
    const at = (name: string) => stations.find((x) => x.name === name && /交通局/.test(x.operator ?? "")) ?? stations.find((x) => x.name === name);
    const a = at(ends.otherSide);
    const b = at(ends.car1Side);
    if (!a || !b) return undefined;
    return { floor: minFloor, toCar1: { x: (b.lon - a.lon) * kx, z: -(b.lat - a.lat) * 110_540 }, cars: LINE_CARS.大江戸線.cars, car1Side: ends.car1Side, otherSide: ends.otherSide };
  }, [station, stations, minFloor, kx]);
  // 向きを合わせる（「案内をスタート」と、途中の「向きを直す」）。ホームにいれば線路の向き（電車の行く方面）で、
  // それ以外は道順の最初に進む向き（目印があればその方）で。合わせたあとは、ジャイロだけで向きを追う（地下では磁石が狂う）
  const [calibNote, setCalibNote] = useState("");
  const onPlatform = !!platformInfo && path.pts.length > 0 && Math.abs(floorNow - minFloor) < 0.01;
  const align: { text: string; sub: string; deg: number } | undefined =
    !aligning || path.pts.length < 2
      ? undefined
      : aligning === "fix"
        ? { text: "道順の進む方（通路の先）", sub: "まわりの通路と地図を見くらべて、これから進む方を向いてください。", deg: routeBearing(path.pts, path.cum, pos) }
        : onPlatform && platformInfo
          ? {
              text: `${platformInfo.car1Side}方面`,
              sub: `線路と同じ向きに立って、電車が${platformInfo.car1Side}へ行く向きを向いてください。`,
              deg: bearingDeg(platformInfo.toCar1.x, platformInfo.toCar1.z),
            }
          : (() => {
              const h = startHint(path.pts, path.cum, pos, hintMarks);
              return {
                text: h?.text ? h.text.replace(/の方へ$/, "の方") : "道順の最初に進む方",
                sub: "地図の赤い道順の、最初に進む向きです。",
                deg: h?.bearing ?? routeBearing(path.pts, path.cum, pos),
              };
            })();
  const alignTap = async () => {
    if (!align) return;
    const fix = aligning === "fix";
    setAligning(null);
    followAsked.current = true;
    await askSensors();
    // 許可を聞いた直後は、まだ向きが届いていないことがある
    for (let i = 0; i < 10 && gyro.current.base === null; i++) await new Promise((r) => setTimeout(r, 100));
    const ok = gyro.current.calibrate(align.deg);
    showHeading();
    recal.current = true;
    setDrift(null);
    setPlaying(false);
    setStarted(true);
    openFull();
    setCalibNote(
      ok ? `${fix ? "向きを直しました" : "向きを合わせました"}。ずれてきたら「向きを直す」で、いつでも合わせ直せます。` : "スマホの向きが取れません（パソコンなど）。向きなしで案内します。",
    );
  };
  const alignSkip = async () => {
    setAligning(null);
    followAsked.current = true;
    await askSensors();
    setStarted(true);
    openFull();
    setCalibNote("磁石の向きで始めました（地下ではずれることがあります）。「向きを直す」で合わせられます。");
  };
  // 確認ポイントで位置を合わせたとき：そこで向いているのは、来た向きか進む向きのはず。近い方にスマホの向きを半分寄せる
  const pullAt = (d: number) => {
    if (!gyro.current.pull(routeBearing(path.pts, path.cum, d + 0.5), 0.5, 30)) gyro.current.pull(routeBearing(path.pts, path.cum, Math.max(0, d - 4)), 0.5, 30);
    showHeading();
  };
  useEffect(() => {
    if (!full) return;
    // 全画面のあいだは、後ろのページをスクロールさせない。スマホの「戻る」は、全画面をやめるだけにする
    const was = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onPop = () => setFull(false);
    window.addEventListener("popstate", onPop);
    return () => {
      document.body.style.overflow = was;
      window.removeEventListener("popstate", onPop);
    };
  }, [full]);

  // 音声ガイド：手順が変わったとき、確認ポイントの手前、逆向き・横向き、着いたときに読み上げる（同じことは二度言わない）
  const said = useRef<Record<string, string>>({});
  const speak = (text: string) => {
    const ss = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!ss) return;
    const u = new SpeechSynthesisUtterance(sayable(text));
    u.lang = "ja-JP";
    u.rate = 1.05;
    const ja = ss.getVoices().find((v) => v.lang.startsWith("ja"));
    if (ja) u.voice = ja;
    ss.speak(u);
  };
  const toggleVoice = () => {
    if (voice) {
      window.speechSynthesis?.cancel();
      setVoice(false);
      return;
    }
    said.current = {};
    setVoice(true);
    speak("音声ガイドをオンにしました。");
  };
  const cpVoice = (c: Checkpoint) =>
    c.kind === "turn"
      ? `${c.dir === "right" ? "右" : "左"}に曲がります。`
      : c.kind === "board"
        ? c.via === "stairs"
          ? `階段を${c.up ? "上ります" : "下ります"}。`
          : `${KIND_JA[c.via!]}に乗ります。${c.via === "elevator" && c.toFloor !== undefined ? `乗ったら、${liftPress(c.toFloor)}を押してください。` : ""}`
        : c.kind === "alight"
          ? c.via === "stairs"
            ? `階段を${c.up ? "上りきります" : "下りきります"}。`
            : `${KIND_JA[c.via!]}を降ります。`
          : c.kind === "gate"
            ? `${c.name ?? "改札"}${c.out === undefined ? "を通ります" : c.out ? "を出ます" : "から入ります"}。`
            : "トイレです。";
  useEffect(() => {
    if (!voice || !started || !current) return;
    const once = (slot: string, key: string, text: string) => {
      if (said.current[slot] === key) return;
      said.current[slot] = key;
      speak(text);
    };
    if (arrived) return once("arrive", routeKey, "トイレに着きました。");
    said.current.arrive = "";
    once("step", `${routeKey}:${stepIdx}`, stepLine(current, guide[stepIdx + 1]));
    if (next && next.kind !== "arrive" && next.at - pos <= 8 && next.at - pos > 0.5) once("cp", `${routeKey}:${next.at}`, `まもなく、${cpVoice(next)}`);
    if (drift) once("drift", drift, drift === "back" ? "来た道を戻っています。進む方を向いているなら、画面のボタンを押してください。" : "道順からそれていませんか。");
    else said.current.drift = "";
  });
  const headingNow = useCallback(() => gyro.current.now(), []);
  const nudgeHeading = useCallback(
    (deg: number) => {
      gyro.current.nudge(deg);
      showHeading();
    },
    [showHeading],
  );
  const starting = !arrived && path.pts.length > 0 && (pos < 3 || cps.some((c) => c.kind === "alight" && pos >= c.at - 0.01 && pos - c.at < 3));
  // すぐそこがエレベーター（乗り口まで 3m 未満か、乗っている）なら、押す階の案内を先に
  const liftFirst = !!lift && (lift.kind === "alight" || lift.at - pos < 3);
  const hint = starting && !liftFirst ? startHint(path.pts, path.cum, pos, hintMarks, platformInfo) : undefined;
  const advice = hint && phoneDeg !== null ? turnAdvice(hint.bearing, phoneDeg) : undefined;
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
      if (!navigator.onLine) throw new Error("電波がないため、看板を AI に読んでもらえません。地図でいまいる所をタップするか、「いまどこ？」の答えで選んでください。");
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
      // 届かなかった（地下で電波が切れたなど）ときは、fetch が TypeError を出す
      const offline = e instanceof TypeError || !navigator.onLine;
      setLoc({
        error: offline
          ? "電波が弱く、看板を AI に読んでもらえませんでした。地図でいまいる所をタップするか、「いまどこ？」の答えで選んでください。"
          : e instanceof Error
            ? e.message
            : "うまくいきませんでした",
      });
    }
  };
  const pickCandidate = (c: Candidate) => {
    setPicked({ key, start: { label: `写真で決めた場所：${candidateLabel(c)}`, node: c.node } });
    setStartIdx(0);
    setLoc(null);
  };

  const cars = carEnds(station) ? Array.from({ length: LINE_CARS.大江戸線.cars }, (_, i) => i + 1) : [];
  const gates = starts.filter((s) => s.kind === "gate");
  return (
    <div>
      {/* いまどこ？（出発地点を推し量れないとき、1回だけ） */}
      {asking && (
        <section className="card" style={{ borderColor: "var(--accent)", borderWidth: 2, marginTop: 8 }}>
          <div style={{ fontSize: "1.3rem", fontWeight: 800 }}>いまどこ？</div>
          <div className="muted">押すと、そこからトイレまでの道順を出します</div>
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            <button className="big" onClick={() => chooseStart(starts.find((s) => s.kind === "platform"))} disabled={!net}>
              ホーム（電車を降りたところ）
            </button>
            {cars.length > 0 && (
              <div>
                <span className="muted">何号車か分かれば（{LINE_CARS.大江戸線.note}）</span>
                <div className="chips">
                  {cars.map((n) => (
                    <button key={n} onClick={() => (setCar(n), setReask(false))}>
                      {n}号車
                    </button>
                  ))}
                </div>
              </div>
            )}
            {gates.length > 0 && (
              <button className="big" aria-expanded={askGate} onClick={() => setAskGate(!askGate)}>
                改札の近く
              </button>
            )}
            {askGate && (
              <div className="chips">
                {gates.map((g) => (
                  <button key={g.label} onClick={() => chooseStart(g)}>
                    {g.label.replace(/^改札：/, "")}
                  </button>
                ))}
              </div>
            )}
            <button className="big" onClick={() => chooseStart(starts.find((s) => s.kind === "ground"))} disabled={!net}>
              地上（出入口から入るところ）
            </button>
            <button onClick={startLocate} disabled={!net || !!loc?.busy}>
              分からない：近くの看板を撮る
            </button>
          </div>
        </section>
      )}

      {/* ① 答え：どのトイレまで、何分・何m */}
      {!asking &&
        (route && goal ? (
          <section className="card" style={{ borderColor: "var(--accent)", borderWidth: 2, marginTop: 8 }}>
            <div style={{ fontSize: "1.6rem", fontWeight: 800 }}>
              トイレまで 約{Math.max(1, Math.round(route.seconds / 60))}分・{route.meters}m
            </div>
            <div>{goal.short}</div>
            {embedded && goalFromUrl && goalIdx < 0 && goal.place.id !== goalFromUrl && (
              <div style={{ fontSize: "0.85rem", marginTop: 4 }}>
                {urlGoal >= 0
                  ? `上のトイレ（約${Math.max(1, Math.round(goals[urlGoal].seconds / 60))}分）より早く着くトイレへの道順です。`
                  : "上のトイレへの道は駅の中の地図のデータにないので、地図でたどれるトイレのうち、いちばん早く着くものを出しています。"}
              </div>
            )}
            <div className="row" style={{ marginTop: 4, justifyContent: "space-between", alignItems: "center", flexWrap: "nowrap" }}>
              <div className="muted">出発：{startLabel}</div>
              <button aria-expanded={fixOpen} onClick={() => setFixOpen(!fixOpen)} style={{ flexShrink: 0 }}>
                ここじゃない
              </button>
            </div>
          </section>
        ) : (
          net && <p className="card">この条件では経路が見つかりませんでした。下で条件を変えてください。</p>
        ))}

      {/* ここじゃない：号車・地図のタップ・看板の写真で、出発地点を直す */}
      {!asking && fixOpen && (
        <section className="card" style={{ marginTop: 8 }}>
          <strong>出発地点を直す</strong>
          {cars.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <span className="muted">何号車に乗っていた？（{LINE_CARS.大江戸線.note}）</span>
              <div className="chips">
                {cars.map((n) => (
                  <button
                    key={n}
                    aria-pressed={car === n && startIdx === 0 && !picked}
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
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            <button
              onClick={() => {
                setView("above");
                setPicking(true);
                if (embedded) setFixOpen(false);
              }}
              disabled={!route}
            >
              地図で、いまいる所をタップする
            </button>
            <button onClick={startLocate} disabled={!net || !!loc?.busy}>
              いまどこか分からない：近くの看板を撮る
            </button>
            {embedded && (
              <button
                onClick={() => {
                  setPicked(null);
                  setCar(null);
                  setReask(true);
                  setFixOpen(false);
                }}
              >
                ↺ 「いまどこ？」に答え直す
              </button>
            )}
          </div>
        </section>
      )}

      {/* 看板の写真と GPS から出発地点を決める */}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => (onPhoto(e.target.files?.[0]), (e.target.value = ""))} />
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

      {calibNote && (
        <p className="muted" style={{ fontSize: "0.85rem", margin: "4px 0" }}>
          {calibNote}
        </p>
      )}

      {/* ③ 自分のまわりだけの 3D（いまどこ？に答えるまでは隠す。舞台は作っておく） */}
      {!asking && more && (
        <div className="chips" style={{ marginTop: 8 }}>
          <button aria-pressed={view === "above"} onClick={() => setView("above")}>
            まわりを上から
          </button>
          <button aria-pressed={view === "walk"} onClick={() => setView("walk")} disabled={!route}>
            歩く目線
          </button>
        </div>
      )}
      <div
        ref={fullBox}
        style={
          full
            ? {
                position: "fixed",
                inset: 0,
                zIndex: 1000,
                background: "var(--bg, #fff)",
                padding: "env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)",
                display: asking ? "none" : "block",
              }
            : { position: "relative", marginTop: 8, display: asking ? "none" : "block" }
        }
      >
        <div style={{ position: "relative", height: full ? "100%" : undefined }}>
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
              mark={next && next.kind !== "arrive" ? next.at : undefined}
              follow={follow && started}
              platformFloor={line ? minFloor : undefined}
              heading={headingNow}
              onNudge={nudgeHeading}
              height={full ? "100%" : 520}
              hudRight={full ? 56 : 8}
              speed={WALK_SPEED * rate}
              gates={gateRows}
              lifts={walkLifts}
            />
          )}
          <div
            ref={box}
            style={{ height: full ? "100%" : 520, borderRadius: 10, overflow: "hidden", border: "1px solid var(--line)", touchAction: "none", display: view === "above" ? "block" : "none" }}
          />
          {view === "above" && route && goal && current && (
            <div style={{ ...HUD, top: 8, right: full ? 56 : 8 }}>
              {arrived ? (
                <div style={{ fontSize: "1.4rem", fontWeight: 800 }}>◎ トイレに着きました</div>
              ) : (
                <>
                  <div style={{ fontSize: "0.8rem", opacity: 0.85 }}>
                    いまの手順（{stepIdx + 1} / {guide.length}）
                  </div>
                  <div style={{ fontSize: "1.3rem", fontWeight: 800 }}>{stepLine(current, guide[stepIdx + 1])}</div>
                  {guide[stepIdx + 1] && <div style={{ fontSize: "0.85rem", opacity: 0.85 }}>そのあと：{stepLine(guide[stepIdx + 1], guide[stepIdx + 2])}</div>}
                </>
              )}
            </div>
          )}
          {/* スタートの前：地図は見られる。下に「案内をスタート」だけ */}
          {route && goal && !started && !aligning && (
            <div style={{ ...HUD, bottom: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: "0.85rem", opacity: 0.9, marginBottom: 6 }}>地図は指で動かして見られます。歩き出すときに押してください。</div>
              <button className="primary" style={{ ...BIG, width: "100%" }} onClick={() => setAligning("start")}>
                案内をスタート
              </button>
            </div>
          )}
          {/* 向きを合わせる：地図の前に出して、向いたら画面のどこかをタップ */}
          {align && (
            <div
              role="button"
              tabIndex={0}
              aria-label={`${align.text}を向いたら、ここをタップ`}
              onClick={alignTap}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && alignTap()}
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 5,
                borderRadius: 10,
                background: "rgba(15,20,25,.74)",
                color: "#fff",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                padding: 20,
                textAlign: "center",
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: "1.4rem", fontWeight: 800, lineHeight: 1.45 }}>
                <span style={{ color: "#9fe3ff" }}>{align.text}</span>を向いたら、
                <br />
                画面のどこかをタップ
              </div>
              <div style={{ fontSize: "0.9rem", opacity: 0.85, maxWidth: 300 }}>{align.sub}</div>
              <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>スマホは画面を上にして、胸の前で持ってください</div>
              <div className="row" style={{ gap: 8, marginTop: 4 }}>
                {aligning === "start" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      alignSkip();
                    }}
                  >
                    合わせずに始める
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setAligning(null);
                  }}
                >
                  やめる
                </button>
              </div>
            </div>
          )}
          {/* 下：次の確認ポイント（ピンクの印）と、そこに位置を合わせるボタン（どちらの見方でも同じ場所） */}
          {route && goal && started && (
            <div style={{ ...HUD, bottom: 8, padding: "8px 10px" }}>
              {/* 案内の2行。エレベーターの手前と中では、2行目を行き先にして、右に押すボタンを出す（高さは変えない。3D を狭めない） */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {picking ? (
                    <div style={{ fontWeight: 800 }}>いまいるところをタップしてください（道順から離れていれば、そこから出し直します）</div>
                  ) : next ? (
                    <div style={{ fontWeight: 800 }}>
                      {next.kind !== "arrive" && <span style={{ color: CP_CSS }}>● </span>}
                      次の確認ポイント：{cpLabel(next)}（あと{Math.max(0, Math.round(next.at - pos))}m）
                    </div>
                  ) : (
                    <div style={{ fontWeight: 800 }}>◎ トイレに着きました</div>
                  )}
                  <div style={{ fontSize: "0.8rem", opacity: (lift || hint) && !picking ? 1 : 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {drift && !picking ? (
                      <button
                        onClick={() => {
                          // 「進む方を向いている」：いまのスマホの向きを、道順の向きに合わせ直す
                          gyro.current.calibrate(routeBearing(path.pts, path.cum, pos));
                          showHeading();
                          recal.current = true;
                          setDrift(null);
                        }}
                        style={{ all: "unset", cursor: "pointer", color: "#ffb4a8", fontWeight: 800 }}
                      >
                        {drift === "back" ? "来た道を戻っています" : "道順からそれていませんか"}（進む方を向いていれば押す）
                      </button>
                    ) : hint && (hint.text || advice) && !picking ? (
                      <span style={{ color: "#9fe3ff", fontWeight: 800 }}>
                        {pos < 3 ? "最初は" : "降りたら"}
                        {hint.text ?? "矢印の向き"}
                        {advice && `・${advice.text}`}
                      </span>
                    ) : lift && !picking ? (
                      <span style={{ color: "#ffe27a", fontWeight: 800 }}>{lift.kind === "board" ? `乗ったら${liftPress(lift.toFloor!)}を押す` : `行き先：${floorName(lift.toFloor!)}`}</span>
                    ) : (
                      <>
                        {goal.short}・のこり {Math.max(0, Math.round(total - pos))} メートル
                      </>
                    )}
                  </div>
                </div>
                {advice && !picking ? (
                  <div
                    aria-label={`進む向き：${advice.text}`}
                    style={{
                      flexShrink: 0,
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      border: `3px solid ${Math.abs(advice.diff) <= 30 ? "#7ee2a0" : "#9fe3ff"}`,
                      background: "#0f2a36",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "1.5rem",
                      fontWeight: 800,
                    }}
                  >
                    <span style={{ display: "inline-block", transform: `rotate(${advice.diff}deg)`, transition: "transform .2s" }}>↑</span>
                  </div>
                ) : (
                  lift &&
                  !picking && (
                    <div
                      aria-label={`エレベーターで押すボタン：${liftPress(lift.toFloor!)}`}
                      style={{
                        flexShrink: 0,
                        minWidth: 52,
                        height: 48,
                        borderRadius: 12,
                        border: "3px solid #ffe27a",
                        background: "#fff4c2",
                        color: "#3a2f00",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: liftRole(lift.toFloor!) ? "1.05rem" : "1.25rem",
                        fontWeight: 800,
                        lineHeight: 1.1,
                        padding: "0 6px",
                      }}
                    >
                      {liftRole(lift.toFloor!) || liftButton(lift.toFloor!)}
                      {liftRole(lift.toFloor!) && <span style={{ fontSize: "0.72rem", fontWeight: 700 }}>{liftButton(lift.toFloor!)}</span>}
                    </div>
                  )
                )}
              </div>
              <div className="row" style={{ marginTop: 6, flexWrap: "nowrap" }}>
                <button
                  style={{ ...BIG, flex: 0.45, padding: 0 }}
                  aria-label="ひとつ前の確認ポイントへ"
                  onClick={() => {
                    setPlaying(false);
                    setPos(prevCheckpoint(cps, pos)?.at ?? 0);
                  }}
                  disabled={pos < 0.5}
                >
                  ←
                </button>
                <button style={{ ...BIG, padding: "0 4px", whiteSpace: "nowrap" }} onClick={() => (arrived ? (setPos(0), setPlaying(false)) : setPlaying(!playing))}>
                  {playing ? "止める" : arrived ? "↺ もう一度" : "歩く"}
                </button>
                <button
                  style={{ ...BIG, flex: 0.55, padding: 0, fontSize: "0.95rem", lineHeight: 1.15 }}
                  aria-label={`歩く速さ：${RATE_JA[rate]}。押すと変わります`}
                  onClick={() => setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length])}
                >
                  <span style={{ display: "block", fontSize: "0.7rem", fontWeight: 600 }}>速さ</span>×{rate}
                </button>
                {next ? (
                  <button
                    className="primary"
                    style={{ ...BIG, flex: 2 }}
                    onClick={() => {
                      setPlaying(false);
                      setPos(next.at);
                      pullAt(next.at);
                    }}
                  >
                    <span style={{ display: "block", lineHeight: 1.25 }}>{cpButton(next)}</span>
                    <span style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, opacity: 0.9 }}>
                      {next.kind === "arrive" ? "押すと、ここまで進めます" : "押すと、ピンクの印に位置を合わせます"}
                    </span>
                  </button>
                ) : (
                  <button style={{ ...BIG, flex: 2 }} onClick={() => setPos(0)}>
                    ↺ 最初から
                  </button>
                )}
              </div>
            </div>
          )}
          {full && (
            <div style={{ position: "absolute", top: 8, right: 8, zIndex: 6, display: "flex", flexDirection: "column", gap: 6 }}>
              <button aria-label="全画面をやめる" onClick={toggleFull} style={ROUND}>
                ✕
              </button>
              {route && (
                <button
                  aria-label={view === "walk" ? "まわりを上から見る" : "歩く目線で見る"}
                  onClick={() => {
                    setMore(true);
                    setView(view === "walk" ? "above" : "walk");
                  }}
                  style={ROUND}
                >
                  {view === "walk" ? "🗺" : "🚶"}
                </button>
              )}
              {started && (
                <button aria-label="向きを直す" onClick={() => setAligning("fix")} style={ROUND}>
                  🧭
                </button>
              )}
              <button aria-label={voice ? "音声ガイドを止める" : "音声ガイドをオンにする"} aria-pressed={voice} onClick={toggleVoice} style={ROUND}>
                {voice ? "🔊" : "🔇"}
              </button>
            </div>
          )}
        </div>
      </div>
      {!asking && (
        <div className="chips" style={{ marginTop: 6 }}>
          <button aria-pressed={picking} onClick={() => setPicking(!picking)}>
            地図で位置を直す
          </button>
          <button onClick={toggleFull}>全画面で見る</button>
          {started && <button onClick={() => setAligning("fix")}>向きを直す</button>}
          <button aria-pressed={voice} onClick={toggleVoice}>
            {voice ? "音声ガイドを止める" : "音声ガイド"}
          </button>
          <button aria-pressed={follow} onClick={toggleFollow}>
            {follow ? "自分に合わせて動くのを止める" : "自分に合わせて動く"}
          </button>
          {askCompass && !hasCompass && <button onClick={allowCompass}>スマホの向きを出す</button>}
          {!more && <button onClick={() => setMore(true)}>もっと見る（歩く目線）</button>}
        </div>
      )}
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
      {!asking && view === "above" && (
        <div className="chips muted" style={{ fontSize: "0.8rem", marginTop: 6 }}>
          <span style={{ color: "#f2b705" }}>━ いまの手順</span>
          <span style={{ color: "#d93025" }}>━ 道順</span>
          <span style={{ color: "#8a63b8" }}>━ エスカレーター</span>
          <span style={{ color: "#1e7a3c" }}>━ エレベーター</span>
          <span style={{ color: "#a8875c" }}>━ 階段</span>
          <span style={{ color: CP_CSS }}>◯ 次の確認ポイント</span>
          {hasCompass && <span style={{ color: "#d93025" }}>◢◣ スマホの向き</span>}
        </div>
      )}
      <p className="muted" style={{ fontSize: "0.8rem" }}>
        上から見る：いまの手順のまわりと、通る階だけ。指で回す・2本指で拡大。歩く目線：指でドラッグするとまわりを見渡せます（離すと前に向き直ります）。地下では現在地が取れないので、ピンクの印（次の確認ポイント）に来たらボタンで位置を合わせるか、センサーで進めます。最初に「案内をスタート」で向きを合わせると、後ろを向いて歩けば来た道を戻り、横を向いているあいだは止まります。向きがずれてきたら「🧭
        向きを直す」で合わせ直せます。
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
                {stepLine(g, guide[i + 1])}
              </li>
            ))}
          </ol>
        </details>
      )}
      <p className="muted" style={{ fontSize: "0.8rem" }}>
        データ：{net?.attribution.join("／")}。時間と道順は目安です。案内表示を優先してください。
      </p>
    </div>
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
