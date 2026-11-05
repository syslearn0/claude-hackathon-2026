// 自動改札機の列の 3D（歩く目線と、上から見る画面で同じものを使う）。
// 中の向き：+z が進む向き、y が上、+x は進む向きの左。道順の通路が x = 0 のまんなか。大きさは m（上から見る画面では拡大して置く）
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// 絵（canvas）を貼る模様
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

// 自動改札機の部品（形と色。どの改札でも同じなので、一度だけ作る）
let parts: ReturnType<typeof makeGateParts> | null = null;
function makeGateParts() {
  const L = 1.7;
  const CW = 0.24;
  const geo = {
    base: new THREE.BoxGeometry(CW + 0.02, 0.08, L + 0.02),
    body: new THREE.BoxGeometry(CW, 0.84, L - 0.08),
    top: new THREE.BoxGeometry(CW + 0.04, 0.05, L + 0.04),
    cap: new THREE.BoxGeometry(CW + 0.03, 0.88, 0.07),
    slot: new THREE.BoxGeometry(0.12, 0.012, 0.03),
    reader: new THREE.PlaneGeometry(0.2, 0.2),
    screen: new THREE.PlaneGeometry(0.18, 0.11),
    sign: new THREE.PlaneGeometry(0.13, 0.13),
    flap: new THREE.BoxGeometry(0.1, 0.42, 0.035),
    rod: new THREE.CylinderGeometry(0.025, 0.025, 0.9, 8),
  };
  const ok = canvasTex(64, 64, (g) => {
    g.fillStyle = "#111";
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = "#33d860";
    g.beginPath();
    for (const [x, y] of [
      [32, 8],
      [55, 33],
      [41, 33],
      [41, 56],
      [23, 56],
      [23, 33],
      [9, 33],
    ])
      g.lineTo(x, y);
    g.fill();
  });
  const no = canvasTex(64, 64, (g) => {
    g.fillStyle = "#111";
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = "#e8392f";
    g.beginPath();
    g.arc(32, 32, 23, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#fff";
    g.fillRect(15, 27, 34, 10);
  });
  const ic = canvasTex(128, 128, (g) => {
    g.fillStyle = "#1a78dc";
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = "#cfe8ff";
    g.lineWidth = 6;
    g.strokeRect(9, 9, 110, 110);
    g.fillStyle = "#fff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "bold 52px system-ui";
    g.fillText("IC", 64, 56);
    g.font = "bold 20px system-ui";
    g.fillText("タッチ", 64, 98);
  });
  const screen = canvasTex(96, 64, (g) => {
    g.fillStyle = "#14243a";
    g.fillRect(0, 0, 96, 64);
    g.fillStyle = "#7fd0ff";
    g.font = "bold 16px system-ui";
    g.textAlign = "center";
    g.fillText("残額", 48, 26);
    g.fillText("¥ ----", 48, 48);
  });
  const mat = {
    base: new THREE.MeshLambertMaterial({ color: 0x4a4d54 }),
    body: new THREE.MeshLambertMaterial({ color: 0xe6e4dd }),
    side: new THREE.MeshLambertMaterial({ color: 0x2f5f9e }),
    top: new THREE.MeshLambertMaterial({ color: 0xc3c9d1 }),
    slot: new THREE.MeshBasicMaterial({ color: 0x0b0b0b }),
    ic: new THREE.MeshBasicMaterial({ map: ic }),
    screen: new THREE.MeshBasicMaterial({ map: screen }),
    ok: new THREE.MeshBasicMaterial({ map: ok }),
    no: new THREE.MeshBasicMaterial({ map: no }),
    flap: new THREE.MeshLambertMaterial({ color: 0xf0a81c }),
    glass: new THREE.MeshLambertMaterial({ color: 0xc4dfea, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide }),
    rail: new THREE.MeshLambertMaterial({ color: 0x9a9ea6 }),
    board: new THREE.MeshLambertMaterial({ color: 0x1c2b55 }),
  };
  return { geo, mat };
}

// 改札の上の案内板：紺に白で改札の名前。出るときは右に黄色の「出口」
function gateBoard(name: string, out: boolean, aspect: number) {
  const H = 96;
  const W = Math.round(H * aspect);
  return canvasTex(W, H, (g) => {
    g.fillStyle = "#1c2b55";
    g.fillRect(0, 0, W, H);
    const split = out ? Math.round(W * 0.62) : W;
    g.fillStyle = "#fff";
    g.textBaseline = "middle";
    g.textAlign = "center";
    g.font = "bold 46px system-ui";
    g.fillText(name, split / 2, 40);
    g.font = "600 18px system-ui";
    g.fillText("Ticket Gate", split / 2, 77);
    if (out) {
      g.fillStyle = "#f7c600";
      g.fillRect(split, 0, W - split, H);
      g.fillStyle = "#111";
      g.font = "bold 44px system-ui";
      g.fillText("出口", (split + W) / 2, 40);
      g.font = "600 18px system-ui";
      g.fillText("Exit", (split + W) / 2, 77);
    }
  });
}

export const GATE_L = 1.7; // 改札機の長さ（進む向き）
export const GATE_HALF_W = 2.8; // 列の幅の半分（多くても 6 台・5 通路）

// 改札機の列。left・right：列のまんなかから -x・+x の側に、改札機を並べてよい幅（m）。
// fenceLeft・fenceRight：そこまでガラスの柵でふさぐ（壁までの距離。なければ柵なし）。lane：まんなか（x = 0）を必ず通路にする（道順が通る）。
// 上に「改札」（出るときは「出口」も）の案内板。部品は色ごとに 1 つにまとめる（長い改札の列でも重くならないように）
export function gateRow(opt: { name?: string; out?: boolean; left?: number; right?: number; fenceLeft?: number; fenceRight?: number; board?: boolean; lane?: boolean }): THREE.Group {
  const GATE = (parts ??= makeGateParts());
  const left = opt.left ?? GATE_HALF_W;
  const right = opt.right ?? GATE_HALF_W;
  const L = GATE_L;
  const CW = 0.24; // 改札機の幅
  const PITCH = CW + 0.62; // 通路 0.62m
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0) => {
    const o = new THREE.Mesh(geo, mat);
    o.position.set(x, y, z);
    o.rotation.set(rx, ry, 0);
    g.add(o);
  };
  const xs: number[] = [];
  const kl = Math.ceil(left / PITCH) + 1;
  const kr = Math.ceil(right / PITCH) + 1;
  for (let k = -Math.min(kl, 60); k <= Math.min(kr, 60); k++) {
    const x = (k + 0.5) * PITCH;
    const fits = x < 0 ? -x + CW / 2 <= left + 0.05 : x + CW / 2 <= right + 0.05;
    if (fits || (opt.lane !== false && (k === -1 || k === 0))) xs.push(x);
  }
  if (!xs.length) xs.push((right - left) / 2); // 短い線の改札：まんなかに 1 台
  xs.forEach((x, i) => {
    const k = Math.round(x / PITCH - 0.5);
    add(GATE.geo.base, GATE.mat.base, x, 0.04, 0);
    add(GATE.geo.body, GATE.mat.body, x, 0.5, 0);
    add(GATE.geo.top, GATE.mat.top, x, 0.955, 0);
    add(GATE.geo.cap, GATE.mat.side, x, 0.5, -L / 2);
    add(GATE.geo.cap, GATE.mat.side, x, 0.5, L / 2);
    add(GATE.geo.slot, GATE.mat.slot, x, 0.985, -L / 2 + 0.14); // きっぷを入れる口
    add(GATE.geo.reader, GATE.mat.ic, x, 0.99, -L / 2 + 0.4, -Math.PI / 2 + 0.25); // IC のタッチ面（手前に少し傾ける）
    add(GATE.geo.screen, GATE.mat.screen, x, 0.99, -L / 2 + 0.66, -Math.PI / 2 + 0.25);
    add(GATE.geo.slot, GATE.mat.slot, x, 0.985, L / 2 - 0.14); // 出てくる口
    // 入る側の表示：通れる（緑の矢印）・通れない（赤）。道順の通路の両側は緑
    add(GATE.geo.sign, Math.abs(k + 0.5) <= 1 || k % 2 === 0 ? GATE.mat.ok : GATE.mat.no, x, 0.74, -L / 2 - 0.035, 0, Math.PI);
    // 扉（開いている：改札機から少しだけ出ている）
    if (i > 0) add(GATE.geo.flap, GATE.mat.flap, x - CW / 2 - 0.05, 0.62, 0.15);
    if (i < xs.length - 1) add(GATE.geo.flap, GATE.mat.flap, x + CW / 2 + 0.05, 0.62, 0.15);
  });
  const fence = (from: number, to: number) => {
    const w = Math.abs(to - from);
    if (w < 0.1) return;
    const cx = (from + to) / 2;
    add(new THREE.BoxGeometry(w, 0.9, 0.03), GATE.mat.glass, cx, 0.6, 0);
    add(new THREE.BoxGeometry(w, 0.05, 0.06), GATE.mat.rail, cx, 1.07, 0);
  };
  const xl = Math.min(...xs) - CW / 2;
  const xr = Math.max(...xs) + CW / 2;
  if (opt.fenceLeft !== undefined && opt.fenceLeft < 7) fence(-opt.fenceLeft, xl);
  if (opt.fenceRight !== undefined && opt.fenceRight < 7) fence(xr, opt.fenceRight);
  if (opt.board !== false) {
    // 通る通路の真上につるした案内板（列のまんなかだと、壁に隠れることがある）
    const bw = 2.6;
    const board = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.5, 0.08), GATE.mat.board);
    board.position.set(0, 2.55, -L / 2 - 0.4);
    g.add(board);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(bw - 0.04, 0.46), new THREE.MeshBasicMaterial({ map: gateBoard(opt.name ?? "改札", opt.out === true, bw / 0.46) }));
    face.position.set(0, 2.55, -L / 2 - 0.445);
    face.rotation.y = Math.PI;
    g.add(face);
    for (const sx of [-1, 1]) add(GATE.geo.rod, GATE.mat.rail, sx * (bw / 2 - 0.2), 3.0, -L / 2 - 0.4);
  }
  return mergeByMaterial(g);
}

// 同じ色の部品を 1 つの形にまとめる（描く回数を減らす）
function mergeByMaterial(g: THREE.Group): THREE.Group {
  const by = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const o of g.children) {
    if (!(o instanceof THREE.Mesh)) continue;
    o.updateMatrix();
    const geo = (o.geometry as THREE.BufferGeometry).clone().applyMatrix4(o.matrix);
    const m = o.material as THREE.Material;
    by.set(m, [...(by.get(m) ?? []), geo]);
  }
  const out = new THREE.Group();
  for (const [m, gs] of by) {
    const merged = mergeGeometries(gs);
    if (merged) out.add(new THREE.Mesh(merged, m));
    for (const x of gs) x.dispose();
  }
  return out;
}
