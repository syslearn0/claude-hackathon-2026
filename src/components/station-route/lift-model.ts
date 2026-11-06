// 階段・エスカレーター・エレベーターの 3D の形（駅で見るものに近く）。
// 階段：段（踏み面の先に黄色の滑り止め）、両わきの壁と手すり。踊り場は平らな床と手すり。
// エスカレーター：段の帯（黄色の縁どり）、ガラスの欄干、黒い手すり（両端は丸く折り返す）、ステンレスの縁、下の骨組みの箱、
// 乗り降り口の黄色いくし板と床の板。
// エレベーター：ガラスのかご道と鉄の柱、止まる階ごとにステンレスの扉・呼びボタン・「エレベーター」の札、いちばん下にかご。
// どれも、ローカルの座標（+z が上る向き、+y が上、+x が横）で作ってから、向きと位置を合わせる。
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Flight, Shaft } from "@/lib/lifts";

type V3 = { x: number; y: number; z: number };

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 共有の材料（階段・エスカレーターは数が多いので、材料は使い回す）
let shared: ReturnType<typeof makeShared> | undefined;
function makeShared() {
  const lam = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
  // エスカレーターの段：濃い灰色に溝、前と両わきに黄色の縁（1 段 0.4m を 1 枚）
  const step = canvasTex(128, 64, (g) => {
    g.fillStyle = "#4b4f55";
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = "#6c7178";
    for (let x = 8; x < 120; x += 5) g.fillRect(x, 0, 2, 64);
    g.fillStyle = "#f2c230";
    g.fillRect(0, 0, 128, 6);
    g.fillRect(0, 0, 7, 64);
    g.fillRect(121, 0, 7, 64);
    g.fillStyle = "#2c2f33";
    g.fillRect(0, 62, 128, 2);
  });
  step.wrapS = THREE.ClampToEdgeWrapping;
  step.wrapT = THREE.RepeatWrapping;
  return {
    tread: lam(0xc4c2bb),
    nosing: lam(0xe0a91f),
    stairWall: lam(0xd9d7d0),
    rail: lam(0x9aa1a8),
    band: lam(0xffffff, { map: step, side: THREE.DoubleSide }),
    glass: lam(0xbfe6ef, { transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
    steel: lam(0xb9bfc5),
    handrail: lam(0x1c1d20),
    truss: lam(0xc7cacd),
    comb: lam(0xf2c230),
  };
}
const S = () => (shared ??= makeShared());

// 材料ごとに形を集め、最後に 1 つずつにまとめる
class Parts {
  by = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(m: THREE.Material, g: THREE.BufferGeometry) {
    this.by.set(m, [...(this.by.get(m) ?? []), g]);
  }
  box(m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, tilt = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (tilt) g.rotateX(-tilt);
    g.translate(x, y, z);
    this.add(m, g);
  }
  // (z0, y0) → (z1, y1) に沿った細長い箱。off：線から（坂に直角に）上へずらす量
  slant(m: THREE.Material, w: number, h: number, x: number, z0: number, y0: number, z1: number, y1: number, off: number) {
    const len = Math.hypot(z1 - z0, y1 - y0);
    if (len < 0.01) return;
    const a = Math.atan2(y1 - y0, z1 - z0);
    const g = new THREE.BoxGeometry(w, h, len);
    g.translate(0, off, 0);
    g.rotateX(-a);
    g.translate(x, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(m, g);
  }
  rod(m: THREE.Material, r: number, x: number, z0: number, y0: number, z1: number, y1: number) {
    const len = Math.hypot(z1 - z0, y1 - y0);
    if (len < 0.01) return;
    const g = new THREE.CylinderGeometry(r, r, len, 8);
    g.rotateX(Math.PI / 2);
    g.rotateX(-Math.atan2(y1 - y0, z1 - z0));
    g.translate(x, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(m, g);
  }
  group(): THREE.Group {
    const out = new THREE.Group();
    for (const [m, gs] of this.by) {
      const merged = mergeGeometries(gs);
      if (merged) out.add(new THREE.Mesh(merged, m));
      for (const g of gs) g.dispose();
    }
    return out;
  }
}

// 低いほうの端から高いほうの端へ。向き（y 軸まわり）と位置を合わせる
function place<T extends THREE.Object3D>(g: T, lo: V3, hi: V3): T {
  g.position.set(lo.x, lo.y, lo.z);
  g.rotation.y = Math.atan2(hi.x - lo.x, hi.z - lo.z);
  return g;
}
function ends(f: Flight) {
  const [lo, hi] = f.a.y <= f.b.y ? [f.a, f.b] : [f.b, f.a];
  return { lo, hi, L: Math.hypot(hi.x - lo.x, hi.z - lo.z), H: hi.y - lo.y };
}

// 階段。k：横の大きさ（上から見る画面では大きめに）。stepH：1 段の高さ（高さを伸ばした画面では、そのぶん高く）
export function stairsModel(f: Flight, opt: { k?: number; stepH?: number } = {}): THREE.Group {
  const m = S();
  const k = opt.k ?? 1;
  const W = Math.max(0.6, Math.min(2.4 * k, f.room - 0.15)); // となりと重ならない幅
  const { lo, hi, L, H } = ends(f);
  const p = new Parts();
  if (H < 0.05) {
    // 踊り場：平らな床
    p.box(m.tread, W, 0.25, L, 0, -0.125, L / 2);
  } else {
    const n = Math.max(1, Math.round(H / (opt.stepH ?? 0.17)));
    const h = H / n;
    const d = L / n;
    for (let i = 0; i < n; i++) {
      const top = (i + 1) * h;
      p.box(m.tread, W, h + 0.25, d, 0, top - (h + 0.25) / 2, (i + 0.5) * d);
      p.box(m.nosing, W - 0.12 * k, 0.012, Math.min(0.06, d / 3), 0, top + 0.006, i * d + Math.min(0.03, d / 6));
    }
  }
  // 両わきの側板（段の端をおおう）と、手すり（柱つき）
  const posts = Math.max(1, Math.round(Math.hypot(L, H) / 3));
  for (const s of [-1, 1]) {
    p.slant(m.stairWall, 0.06, 0.45, (s * W) / 2, 0, 0, L, H, 0.05);
    const x = s * (W / 2 - 0.04);
    p.rod(m.rail, 0.03, x, 0, 0.9, L, H + 0.9);
    for (let i = 0; i <= posts; i++) {
      const t = i / posts;
      p.box(m.rail, 0.03, 0.9, 0.03, x, t * H + 0.45, t * L);
    }
  }
  return place(p.group(), lo, hi);
}

// エスカレーター
export function escalatorModel(f: Flight, opt: { k?: number } = {}): THREE.Group {
  const m = S();
  const k = opt.k ?? 1;
  const { lo, hi, L, H } = ends(f);
  // 高さの変わらない部分（エスカレーターとエスカレーターのあいだの、階の途中の高さの通路）は、手すりのある踊り場として描く
  if (H < 0.05) return stairsModel(f, { k });
  const side = Math.max(0.3, Math.min(0.62 * k, (f.room - 0.1) / 2)); // 欄干の位置（となりと重ならない）
  const half = side - 0.12; // 段の幅の半分
  const rail = 0.95 * k; // 手すりの高さ
  const run = 0.35 * k; // 両端の平らなところ（乗り降り口。データの端の点は乗り降りしたあとの床なので、はみ出しは短く）
  const p = new Parts();
  // 段の帯：平ら → 坂 → 平ら（v は 0.4m で 1 段）
  const prof: [number, number][] = [
    [-run, 0],
    [0, 0],
    [L, H],
    [L + run, H],
  ];
  const pos: number[] = [];
  const uv: number[] = [];
  let v = 0;
  for (let i = 1; i < prof.length; i++) {
    const [z0, y0] = prof[i - 1];
    const [z1, y1] = prof[i];
    const v1 = v + Math.hypot(z1 - z0, y1 - y0) / (0.4 * k);
    pos.push(-half, y0 + 0.01, z0, half, y0 + 0.01, z0, -half, y1 + 0.01, z1, half, y0 + 0.01, z0, half, y1 + 0.01, z1, -half, y1 + 0.01, z1);
    uv.push(0, v, 1, v, 0, v1, 1, v, 1, v1, 0, v1);
    v = v1;
  }
  const band = new THREE.BufferGeometry();
  band.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  band.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  band.computeVertexNormals();
  p.add(m.band, band);
  for (let i = 1; i < prof.length; i++) {
    const [z0, y0] = prof[i - 1];
    const [z1, y1] = prof[i];
    for (const s of [-1, 1]) {
      p.slant(m.steel, 0.14 * k, 0.16 * k, s * side, z0, y0, z1, y1, 0.08 * k); // 縁（スカート）
      p.slant(m.glass, 0.02 * k, rail - 0.2 * k, s * side, z0, y0, z1, y1, 0.16 * k + (rail - 0.2 * k) / 2); // ガラス
      p.slant(m.handrail, 0.09 * k, 0.05 * k, s * side, z0, y0, z1, y1, rail); // 手すり
    }
  }
  // 坂の下の骨組み（横から見える箱。欄干の幅のまま）
  p.slant(m.truss, 2 * side, 0.8, 0, 0, 0, L, H, -0.42);
  // 手すりの両端は丸く折り返す
  for (const s of [-1, 1])
    for (const [z, y, dir] of [
      [-run, 0, -1],
      [L + run, H, 1],
    ] as const) {
      const g = new THREE.TorusGeometry(0.34 * k, 0.045 * k, 6, 14, Math.PI);
      g.rotateZ(Math.PI / 2); // 左半分の弧
      g.rotateY((dir * Math.PI) / 2); // 外へふくらむ向き
      g.translate(s * side, y + rail - 0.34 * k, z);
      p.add(m.handrail, g);
      const disc = new THREE.CircleGeometry(0.34 * k, 14, Math.PI / 2, Math.PI);
      disc.rotateY((dir * Math.PI) / 2);
      disc.translate(s * side, y + rail - 0.34 * k, z);
      p.add(m.glass, disc);
    }
  // くし板（黄色）と、乗り降り口の床の板
  for (const [z, y] of [
    [0, 0],
    [L, H],
  ])
    p.box(m.comb, 2 * half, 0.015, 0.06 * k, 0, y + 0.02, z);
  p.box(m.steel, 2 * side, 0.02, 0.8, 0, 0.012, -run - 0.4);
  p.box(m.steel, 2 * side, 0.02, 0.8, 0, H + 0.012, L + run + 0.4);
  return place(p.group(), lo, hi);
}

// エレベーター。材料は 1 つずつ（近づいたら薄くするため）。mats：薄くするときに opacity を掛ける材料と、もとの不透明度
export function elevatorModel(sh: Shaft, opt: { k?: number; cab?: number; glass?: number } = {}): { group: THREE.Group; mats: { m: THREE.Material; base: number }[]; box: THREE.Box3 } {
  const k = opt.k ?? 1;
  const lam = (color: number, opacity = 1) => new THREE.MeshLambertMaterial({ color, transparent: true, opacity, depthWrite: opacity >= 1, side: THREE.DoubleSide });
  const glass = lam(0x9fd3e6, opt.glass ?? 0.3);
  const frame = lam(0x7f878f);
  const door = lam(0xcfd4d9);
  const doorFrame = lam(0xa9b0b7);
  const dark = lam(0x2a2e33);
  const cab = lam(0xe4e7ea);
  const sign = canvasTex(256, 64, (g) => {
    g.fillStyle = "#1d4f91";
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = "#fff";
    g.font = "bold 34px system-ui";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("エレベーター", 128, 34);
  });
  const signMat = new THREE.MeshLambertMaterial({ map: sign, transparent: true, side: THREE.DoubleSide });
  const s = 0.95 * k; // かご道の幅の半分
  const ys = sh.stops.map((t) => t.y);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys) + (opt.cab ?? 3) * k;
  const Hh = y1 - y0;
  const out = new THREE.Group();
  const add = (g: THREE.BufferGeometry, m: THREE.Material) => out.add(new THREE.Mesh(g, m));
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    return g;
  };
  // 柱・ガラス・天井
  const posts: THREE.BufferGeometry[] = [];
  for (const [x, z] of [
    [-s, -s],
    [s, -s],
    [-s, s],
    [s, s],
  ])
    posts.push(box(0.1 * k, Hh, 0.1 * k, x, y0 + Hh / 2, z));
  for (const y of [...ys, y1])
    for (const [w, d, x, z] of [
      [2 * s, 0.08 * k, 0, -s],
      [2 * s, 0.08 * k, 0, s],
      [0.08 * k, 2 * s, -s, 0],
      [0.08 * k, 2 * s, s, 0],
    ])
      posts.push(box(w, 0.1 * k, d, x, y, z));
  add(mergeGeometries(posts)!, frame);
  add(mergeGeometries([box(2 * s, Hh, 0.02, 0, y0 + Hh / 2, -s), box(2 * s, Hh, 0.02, 0, y0 + Hh / 2, s), box(0.02, Hh, 2 * s, -s, y0 + Hh / 2, 0), box(0.02, Hh, 2 * s, s, y0 + Hh / 2, 0)])!, glass);
  add(box(2 * s + 0.1 * k, 0.15 * k, 2 * s + 0.1 * k, 0, y1, 0), frame);
  // かご（いちばん下の階に止まっている）
  add(box(1.6 * k, 2.3 * k, 1.6 * k, 0, y0 + 1.15 * k + 0.05, 0), cab);
  // 止まる階ごとの扉（乗り場の向きの面）
  for (const t of sh.stops) {
    const a = Math.atan2(t.dx, t.dz);
    const parts: [THREE.BufferGeometry, THREE.Material][] = [
      [box(1.3 * k, 2.4 * k, 0.1 * k, 0, 1.2 * k, s + 0.05 * k), doorFrame],
      [box(0.52 * k, 2.1 * k, 0.04 * k, -0.27 * k, 1.05 * k, s + 0.12 * k), door],
      [box(0.52 * k, 2.1 * k, 0.04 * k, 0.27 * k, 1.05 * k, s + 0.12 * k), door],
      [box(0.015 * k, 2.1 * k, 0.05 * k, 0, 1.05 * k, s + 0.12 * k), dark],
      [box(0.14 * k, 0.32 * k, 0.04 * k, 0.88 * k, 1.1 * k, s + 0.04 * k), dark], // 呼びボタン
    ];
    for (const [g, m] of parts) {
      g.rotateY(a);
      g.translate(sh.x, t.y, sh.z);
      add(g, m);
    }
    const plate = new THREE.PlaneGeometry(1.3 * k, 0.32 * k);
    plate.translate(0, 2.62 * k, s + 0.06 * k);
    plate.rotateY(a);
    plate.translate(sh.x, t.y, sh.z);
    add(plate, signMat);
  }
  // かご道とかごは位置を足す（扉はすでに足してある）
  for (const o of out.children.slice(0, 4)) o.position.set(sh.x, 0, sh.z);
  const mats = [glass, frame, door, doorFrame, dark, cab, signMat].map((m) => ({ m: m as THREE.Material, base: m.opacity }));
  return { group: out, mats, box: new THREE.Box3(new THREE.Vector3(sh.x - s, y0, sh.z - s), new THREE.Vector3(sh.x + s, y1, sh.z + s)) };
}
