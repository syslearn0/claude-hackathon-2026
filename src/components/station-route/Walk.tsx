"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Indoor } from "@/lib/indoor";
import { FLOOR_M, pointAt, smoothPath, type Maneuver, type PathPoint } from "@/lib/maneuvers";

// 歩く目線の 3D。カメラの映像（AR）ではなく、データから作った駅の中に矢印の帯を敷いて、その上を歩く。
// 地下で現在地が取れなくても使える。位置（道順の上の m）は呼ぶ側が持つ（センサー・確認ポイントのボタン・タップで変わる）。
// 次の確認ポイント（mark）には、ピンクの輪と薄い柱を立てる（ここに来たらボタンで位置を合わせる）。
// 自分に合わせて動く（follow）ときは、スマホの向き（heading）に画面を回す。左右のドラッグは、向きのずれを直す（onNudge）。
// ここでは、その位置から見た景色と次の曲がり角を描くだけ。「▶ 歩く」（playing）のときは自分で進めて知らせる。
// 壁は、部屋・店の形を 2.8m 立ち上げたものと、階の外形（国交省のデータの「床」）のふち。改札は腰の高さの仕切り。
// いまいる階（と上り下りの途中の階）だけを見せる。指でドラッグするとまわりを見渡せ、離して少しすると前に向き直る。

const EYE = 1.6;
export const WALK_SPEED = 1.3; // 「▶ 歩く」の速さ（m/秒。少し速めに歩く）

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
  indoor,
  pts,
  cum,
  list,
  center,
  floorName,
  pos,
  onPos,
  playing,
  onStop,
  picking,
  onPick,
  mark,
  follow = false,
  platformFloor,
  heading,
  onNudge,
}: {
  indoor: Indoor;
  pts: PathPoint[];
  cum: number[];
  list: Maneuver[]; // 文は呼ぶ側で作る（「エスカレーターで B5（ホーム）→ B3（改札の階）」）
  center: { lat: number; lon: number };
  floorName: (f: number) => string;
  pos: number;
  onPos: (d: number) => void;
  playing: boolean;
  onStop: () => void;
  picking: boolean; // 「地図で位置を直す」：次のタップで、そこを今の位置にする
  onPick: (q: { x: number; y: number; z: number }) => void; // タップした床の点（この 3D の座標）
  mark?: number; // 次の確認ポイント（道順の上の m）
  platformFloor?: number; // ホームの階（路線の色で塗る）
  follow?: boolean; // スマホの向きに合わせて画面を回す（「▶ 歩く」で試しているあいだは、道順の向き）
  heading?: () => number | null; // スマホの向き（北から時計回りの度）。分からなければ null
  onNudge?: (deg: number) => void; // 向きのずれを直す（度）
}) {
  const box = useRef<HTMLDivElement>(null);
  const total = cum.at(-1) ?? 0;
  // 見せる道は、通路のデータの細かいジグザグをならしたもの（位置の m はそのまま）
  const sm = useMemo(() => smoothPath(pts, cum), [pts, cum]);
  const dist = useRef(pos);
  const play = useRef(playing);
  const pick = useRef(picking);
  const cb = useRef({ onPos, onStop, onPick, heading, onNudge });
  const followRef = useRef(follow);
  const lst = useRef(list);
  const markAt = useRef(mark);
  const veil = useRef<HTMLDivElement>(null); // エレベーターに乗っている間の暗幕
  // 外で位置が変わったら合わせる（自分で歩いている途中の小さな差は、自分の位置のまま）
  useLayoutEffect(() => {
    if (!playing || Math.abs(pos - dist.current) > 2) dist.current = pos;
    play.current = playing;
    pick.current = picking;
    cb.current = { onPos, onStop, onPick, heading, onNudge };
    followRef.current = follow;
    lst.current = list;
    markAt.current = mark;
  }, [pos, playing, picking, onPos, onStop, onPick, list, mark, follow, heading, onNudge]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.setClearColor(0xf7f7f5); // 駅の立体図に合わせた明るい色（白に近い灰色の床・壁、ホームは路線の色）
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xf7f7f5, 20, 70);
    const camera = new THREE.PerspectiveCamera(70, el.clientWidth / el.clientHeight, 0.1, 300);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9a9a92, 2.2));
    const kx = 111_320 * Math.cos((center.lat * Math.PI) / 180);
    const xz = (lat: number, lon: number) => new THREE.Vector2((lon - center.lon) * kx, (lat - center.lat) * 110_540);
    const { pts: way, cum: wayAt } = sm;

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
    // 道順が中を通る（またはふちから 0.6m 以内を通る）部屋・店は、箱を立てない（箱の中に目が入ると、壁しか見えずちかちかする）
    const routeInside = (v: THREE.Vector2[], fl: number) =>
      way.some((p) => {
        if (Math.abs(p.y - fl * FLOOR_M) > 0.1) return false;
        let inside = false;
        for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
          const [a, b] = [v[i], v[j]];
          if (a.y > -p.z !== b.y > -p.z && p.x < ((b.x - a.x) * (-p.z - a.y)) / (b.y - a.y) + a.x) inside = !inside;
          const l = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
          const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (-p.z - a.y) * (b.y - a.y)) / l)) : 0;
          if (Math.hypot(p.x - (a.x + t * (b.x - a.x)), -p.z - (a.y + t * (b.y - a.y))) < 0.6) return true;
        }
        return inside;
      });
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
        } else if (!routeInside(shape.getPoints(), fl)) {
          const g = new THREE.ExtrudeGeometry(shape, { depth: 2.8, bevelEnabled: false });
          g.rotateX(-Math.PI / 2);
          g.translate(0, fl * FLOOR_M, 0);
          walls.set(fl, [...(walls.get(fl) ?? []), g]);
        }
      }
    }
    for (const [fl, gs] of floors) {
      const m = mergeGeometries(gs);
      if (m) floorGroup(fl).add(new THREE.Mesh(m, new THREE.MeshLambertMaterial({ color: fl === platformFloor ? 0xf4c3d8 : 0xeeeeec })));
    }
    for (const [fl, gs] of walls) {
      const m = mergeGeometries(gs);
      if (m) floorGroup(fl).add(new THREE.Mesh(m, new THREE.MeshLambertMaterial({ color: 0xdcdcd8 })));
    }
    // 立てた面（ふちに沿った帯）。道順がまたぐところ、すぐそば（0.6m 以内）、上り下りの乗り降りの所（2.5m 以内）は開けておく
    // （目の前で壁を突き抜けると、ちかちかする）
    const lifts0 = way.filter((p, i) => (i > 0 && Math.abs(way[i - 1].y - p.y) > 0.1) || (i + 1 < way.length && Math.abs(way[i + 1].y - p.y) > 0.1));
    const segDist = (px: number, pz: number, ax: number, az: number, bx: number, bz: number) => {
      const l = (bx - ax) ** 2 + (bz - az) ** 2;
      const t = l ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / l)) : 0;
      return Math.hypot(px - (ax + t * (bx - ax)), pz - (az + t * (bz - az)));
    };
    const tooClose = (fl: number, ax: number, az: number, bx: number, bz: number) =>
      way.some((p) => Math.abs(p.y - fl * FLOOR_M) < 0.1 && segDist(p.x, p.z, ax, az, bx, bz) < 0.6) ||
      lifts0.some((p) => Math.abs(p.y - fl * FLOOR_M) < 0.1 && segDist(p.x, p.z, ax, az, bx, bz) < 2.5);
    const ribbons = new Map<string, { fl: number; color: number; opacity: number; pos: number[] }>();
    const crossesRoute = (fl: number, ax: number, az: number, bx: number, bz: number) => {
      for (let i = 1; i < way.length; i++) {
        const p = way[i - 1];
        const q = way[i];
        if (Math.abs(p.y - fl * FLOOR_M) > 0.1 || Math.abs(q.y - fl * FLOOR_M) > 0.1) continue;
        const d1 = (bx - ax) * (p.z - az) - (bz - az) * (p.x - ax);
        const d2 = (bx - ax) * (q.z - az) - (bz - az) * (q.x - ax);
        const d3 = (q.x - p.x) * (az - p.z) - (q.z - p.z) * (ax - p.x);
        const d4 = (q.x - p.x) * (bz - p.z) - (q.z - p.z) * (bx - p.x);
        if (d1 * d2 <= 0 && d3 * d4 <= 0) return true;
      }
      return false;
    };
    const ribbon = (key: string, fl: number, coords: [number, number][], closed: boolean, h: number, color: number, opacity: number, openForRoute: boolean) => {
      const r = ribbons.get(key) ?? { fl, color, opacity, pos: [] };
      ribbons.set(key, r);
      const v = coords.map(([lat, lon]) => xz(lat, lon));
      const y = fl * FLOOR_M;
      for (let i = 1; i < v.length + (closed ? 1 : 0); i++) {
        const a = v[i - 1];
        const b = v[i % v.length];
        if (openForRoute && (crossesRoute(fl, a.x, -a.y, b.x, -b.y) || tooClose(fl, a.x, -a.y, b.x, -b.y))) continue;
        r.pos.push(a.x, y, -a.y, b.x, y, -b.y, a.x, y + h, -a.y, b.x, y, -b.y, b.x, y + h, -b.y, a.x, y + h, -a.y);
      }
    };
    // 上り下りの手段の床（エスカレーター・階段）と、エレベーターの箱
    const pads = new Map<string, { fl: number; color: number; gs: THREE.BufferGeometry[] }>();
    const PAD = { escalator: 0x9a9a94, steps: 0xb4b4ae, elevator: 0x86cff2 } as Record<string, number>;
    // エレベーターの箱は1つずつ。近づくと薄くして、入る前に消す（箱の壁をくぐると、目の前で壁が切れてちかちかする）
    const lifts: { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>; box: THREE.Box3 }[] = [];
    for (const f of indoor.features) {
      if (f.coords.length < 2) continue;
      for (const fl of f.floors) {
        if (f.tags?.category === "floor" && f.closed) ribbon(`wall${fl}`, fl, f.coords, true, 2.8, 0xcfcfca, 0.55, true);
        else if (f.tags?.indoor === "wall") ribbon(`wall${fl}`, fl, f.coords, f.closed, 2.8, 0xcfcfca, 0.55, true);
        else if (f.kind === "gate") ribbon(`gate${fl}`, fl, f.coords, f.closed, 1.0, 0x4a5a6a, 0.45, false);
        else if (f.closed && f.coords.length >= 3 && f.kind in PAD) {
          const shape = new THREE.Shape(f.coords.map(([lat, lon]) => xz(lat, lon)));
          const g = f.kind === "elevator" ? new THREE.ExtrudeGeometry(shape, { depth: 2.6, bevelEnabled: false }) : new THREE.ShapeGeometry(shape);
          g.rotateX(-Math.PI / 2);
          g.translate(0, fl * FLOOR_M + 0.02, 0);
          if (f.kind === "elevator") {
            const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: PAD.elevator, side: THREE.DoubleSide, transparent: true, opacity: 0.55, depthWrite: false }));
            floorGroup(fl).add(mesh);
            lifts.push({ mesh, box: new THREE.Box3().setFromObject(mesh) });
            continue;
          }
          const k = `${f.kind}${fl}`;
          const pad = pads.get(k) ?? { fl, color: PAD[f.kind], gs: [] };
          pad.gs.push(g);
          pads.set(k, pad);
        }
      }
    }
    for (const r of ribbons.values()) {
      if (!r.pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(r.pos, 3));
      g.computeVertexNormals();
      floorGroup(r.fl).add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: r.color, side: THREE.DoubleSide, transparent: true, opacity: r.opacity, depthWrite: false })));
    }
    for (const pad of pads.values()) {
      const m = mergeGeometries(pad.gs);
      if (m) floorGroup(pad.fl).add(new THREE.Mesh(m, new THREE.MeshLambertMaterial({ color: pad.color, side: THREE.DoubleSide, transparent: true, opacity: 0.55, depthWrite: false })));
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
    for (let i = 1; i < way.length; i++) {
      const a = way[i - 1];
      const b = way[i];
      const h = Math.hypot(b.x - a.x, b.z - a.z);
      if (h < 0.2) continue;
      const nx = -(b.z - a.z) / h;
      const nz = (b.x - a.x) / h;
      const w = 0.7;
      const v0 = wayAt[i - 1] / 2;
      const v1 = wayAt[i] / 2;
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
    const carpetMesh = new THREE.Mesh(carpet, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, opacity: 0.92 }));
    scene.add(carpetMesh);

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

    // 次の確認ポイントの印（ピンクの輪と、くぐれる薄い柱）
    const cpMark = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.07, 8, 40), new THREE.MeshBasicMaterial({ color: 0xd6338a }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    cpMark.add(ring);
    const glow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 0.9, 2.6, 32, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xd6338a, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
    );
    glow.position.y = 1.3;
    cpMark.add(glow);
    scene.add(cpMark);

    let raf = 0;
    let last = performance.now();
    let lastHud = 0;
    let facing: number | null = null; // 水平の向き（ラジアン。+z からの角度）
    let shown = dist.current; // 画面の位置。ボタンで位置が飛んでも、そこまで滑って動く
    const look = { yaw: 0, pitch: 0, last: -Infinity }; // 指で見渡した分。離して 2.5 秒たつと前に戻る
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (play.current) {
        dist.current = Math.min(total, dist.current + dt * WALK_SPEED);
        if (now - lastHud > 120 || dist.current >= total) {
          lastHud = now;
          cb.current.onPos(dist.current);
        }
        if (dist.current >= total) {
          play.current = false;
          cb.current.onStop();
        }
      }
      const gap = dist.current - shown;
      shown = play.current || Math.abs(gap) > 80 ? dist.current : shown + gap * (1 - Math.exp(-dt * 4));
      const p = pointAt(way, wayAt, shown);
      camera.position.set(p.x, p.y + EYE, p.z);
      // 向きは水平に。少し先（3〜10m）の何点かの平均の方へ、ゆっくり回る（曲がり角で一気に回らない）。
      // エレベーターの中など前が真上・真下のときは、その先の歩く向きを探し、なければ今の向きのまま
      let ax = 0;
      let az = 0;
      for (let k = 3; k <= 10; k += 1.5) {
        const q = pointAt(way, wayAt, Math.min(total, shown + k));
        ax += q.x - p.x;
        az += q.z - p.z;
      }
      for (let k = 12; Math.hypot(ax, az) < 1.5 && k <= 30 && shown + k <= total + 3; k += 3) {
        const q = pointAt(way, wayAt, Math.min(total, shown + k));
        ax = q.x - p.x;
        az = q.z - p.z;
      }
      // 自分に合わせるときは、スマホの向き（北から時計回り）。この 3D は +z が南なので、向きは π − 方位
      const phone = followRef.current && !play.current ? (cb.current.heading?.() ?? null) : null;
      if (phone !== null || Math.hypot(ax, az) >= 1.5) {
        const want = phone !== null ? Math.PI - (phone * Math.PI) / 180 : Math.atan2(ax, az);
        if (facing === null) facing = want;
        else {
          const turn = ((want - facing + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
          facing += turn * (1 - Math.exp(-dt * 3));
        }
      }
      if (now - look.last > 2500) {
        const k = Math.exp(-dt * 2.5);
        look.yaw *= k;
        look.pitch *= k;
      }
      const f = (facing ?? Math.PI) + look.yaw;
      camera.lookAt(p.x + Math.sin(f), p.y + EYE - 0.05 + Math.tan(look.pitch), p.z + Math.cos(f));
      // いまの階と、上り下りの途中なら行き先の階も見せる
      // 見せる階：ふだんは今の階（と、6m 以内に上り下りがあればその行き先）。上り下りの途中は、出発と行き先の階だけ
      // （途中の階を次々に出し入れすると、ちかちかする）
      const floorAt = (d: number) => pointAt(way, wayAt, d).y / FLOOR_M;
      const moving = lst.current.find((m) => m.kind === "floor" && shown > m.at + 0.01 && shown < (m.end ?? m.at) - 0.01);
      const soon = lst.current.find((m) => m.kind === "floor" && m.at >= shown - 0.01 && m.at - shown <= 6);
      const show = moving ? [floorAt(moving.at), floorAt(moving.end ?? moving.at)] : [floorAt(shown), ...(soon ? [floorAt(soon.end ?? soon.at)] : [])];
      for (const [f, g] of byFloor) g.visible = show.some((x) => Math.abs(f - x) < 0.01);
      for (const { mesh, box } of lifts) {
        const o = 0.55 * Math.max(0, Math.min(1, (box.distanceToPoint(camera.position) - 1) / 4));
        mesh.material.opacity = o;
        mesh.visible = o > 0.01;
      }
      // エレベーターに乗っている間は、画面を暗くして行き先を出す（中の景色は箱の壁だけで、ちかちかするので）
      const lift = moving && moving.via === "elevator";
      if (veil.current) {
        const t = lift ? (shown - moving.at) / Math.max(0.01, (moving.end ?? moving.at) - moving.at) : 0;
        veil.current.style.opacity = lift ? String(Math.max(0, Math.min(1, t / 0.15, (1 - t) / 0.15))) : "0";
        const text = lift ? `${moving.text}\n（乗っています）` : "";
        if (veil.current.textContent !== text) veil.current.textContent = text;
      }
      // 確認ポイントの印：同じ階にあるときだけ（4m より近いと筒が画面をふさぐので、輪だけ）
      const mk = markAt.current;
      if (mk === undefined) cpMark.visible = false;
      else {
        const q = pointAt(way, wayAt, mk);
        cpMark.position.set(q.x, q.y, q.z);
        cpMark.visible = Math.abs(q.y - p.y) < 1;
        glow.visible = Math.hypot(q.x - p.x, q.z - p.z) > 4;
      }
      // トイレの青い柱は、目の前まで来たら消す（柱に入ると画面が青一色になる）
      pin.visible = Math.hypot(end.x - p.x, end.z - p.z) > 2.5 || Math.abs(end.y - p.y) > 1;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onResize = () => {
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    };
    window.addEventListener("resize", onResize);
    // 位置を直す：タップしたところ（見えている床か矢印の帯）を呼ぶ側に渡す（道順の上に合わせるか、出発地点にするかは呼ぶ側）
    const ray = new THREE.Raycaster();
    let drag: { x: number; y: number; moved: number } | null = null;
    const onDown = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY, moved: 0 };
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag = { x: e.clientX, y: e.clientY, moved: drag.moved + Math.hypot(dx, dy) };
      // スマホの向きに合わせているときは、左右のドラッグで向きのずれを直す（見えている景色を、実際の景色に合わせる）
      if (followRef.current && !play.current && cb.current.heading?.() != null) cb.current.onNudge?.(-dx * 0.344);
      else look.yaw += dx * 0.006;
      look.pitch = Math.max(-0.7, Math.min(0.7, look.pitch + dy * 0.004));
      look.last = performance.now();
    };
    const onUp = (e: PointerEvent) => {
      const tap = drag && drag.moved < 8;
      drag = null;
      if (tap) onTap(e);
    };
    const onTap = (e: PointerEvent) => {
      if (!pick.current) return;
      const r = el.getBoundingClientRect();
      camera.updateMatrixWorld();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const targets = [carpetMesh, ...[...byFloor.values()].filter((g) => g.visible)];
      const hit = ray.intersectObjects(targets, true)[0];
      if (hit) cb.current.onPick(hit.point);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerup", onUp);
    return () => {
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerup", onUp);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [indoor, pts, cum, sm, total, center, platformFloor]);

  const next = list.find((m) => m.at > pos + 0.5) ?? list.at(-1)!;
  const toNext = Math.max(0, Math.round(next.at - pos));
  const arrived = pos >= total - 0.5;
  const icon = next.kind === "right" ? "↱" : next.kind === "left" ? "↰" : next.kind === "floor" ? "⇅" : next.kind === "gate" ? "🎫" : "◎";
  const here = pointAt(pts, cum, pos);

  return (
    <>
      <div ref={box} style={{ height: 520, borderRadius: 10, overflow: "hidden", border: "1px solid var(--line)", touchAction: "none" }} />
      <div
        ref={veil}
        style={{
          position: "absolute",
          inset: 0,
          height: 520,
          borderRadius: 10,
          background: "rgba(20,20,19,.92)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          whiteSpace: "pre-line",
          fontSize: "1.3rem",
          fontWeight: 800,
          padding: 24,
          opacity: 0,
          pointerEvents: "none",
        }}
      />
      {/* 上：次の曲がり角 */}
      <div style={{ position: "absolute", left: 8, right: 8, top: 8, background: "rgba(20,20,19,.82)", color: "#fff", borderRadius: 10, padding: "10px 12px" }}>
        {arrived ? (
          <div style={{ fontSize: "1.4rem", fontWeight: 800 }}>◎ トイレに着きました</div>
        ) : (
          <div style={{ fontSize: "1.4rem", fontWeight: 800 }}>
            {icon} {next.kind === "arrive" ? `${toNext}m で到着` : next.kind === "floor" || next.kind === "gate" ? `${toNext}m 先：${next.text}` : `${toNext}m ${next.text}`}
          </div>
        )}
        <div style={{ fontSize: "0.85rem", opacity: 0.85 }}>いま：{floorName(Math.round(here.floor * 2) / 2)}</div>
      </div>
    </>
  );
}
