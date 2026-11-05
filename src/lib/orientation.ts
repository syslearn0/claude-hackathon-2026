// スマホの向き（北から時計回りの度）。
// ・センサーの角度（alpha・beta・gamma）から、スマホの背中（立てて持ったとき）か上の端（寝かせたとき）が向く方位を出す
// ・地下では磁石が狂うので、基準は「磁石を使わない相対の向き」（ジャイロ）にし、ずれ（offset）を足して方位にする。
//   ずれは、ホームで線路の向きに合わせて決めるのがいちばん確か。合わせる前は、磁石の向きがあればそれに合わせておく

const D2R = Math.PI / 180;
export const norm360 = (d: number) => ((d % 360) + 360) % 360;

// W3C の「方位の出し方」の式。ほぼ寝かせているとき（背中が真下を向く）は式が不安定なので、上の端の向き（360 - alpha）にする
export function headingFromEuler(alpha: number, beta?: number | null, gamma?: number | null): number {
  const b = beta ?? 0;
  const g = gamma ?? 0;
  if (Math.abs(b) < 25 && Math.abs(g) < 25) return norm360(360 - alpha);
  const [x, y, z] = [b * D2R, g * D2R, alpha * D2R];
  const vx = -Math.cos(z) * Math.sin(y) - Math.sin(z) * Math.sin(x) * Math.cos(y);
  const vy = -Math.sin(z) * Math.sin(y) + Math.cos(z) * Math.sin(x) * Math.cos(y);
  let h = Math.atan(vx / vy);
  if (vy < 0) h += Math.PI;
  else if (vx < 0) h += 2 * Math.PI;
  return norm360(h / D2R);
}

export type HeadingSource = "none" | "compass" | "track";

// 相対の向き（rel）と磁石の向き（abs）から、いまの方位を出す
export class Heading {
  rel: number | null = null;
  abs: number | null = null;
  offset: number | null = null;
  by: HeadingSource = "none";
  // 合わせる前は、磁石の向きに合わせておく（相対の向きがなければ、磁石の向きをそのまま使う）
  private auto() {
    if (this.by === "track") return;
    if (this.abs === null) return;
    this.offset = this.rel === null ? 0 : norm360(this.abs - this.rel);
    this.by = "compass";
  }
  setRel(h: number) {
    this.rel = h;
    this.auto();
  }
  setAbs(h: number) {
    this.abs = h;
    this.auto();
  }
  get base() {
    return this.rel ?? this.abs;
  }
  now(): number | null {
    const b = this.base;
    return b === null || this.offset === null ? null : norm360(b + this.offset);
  }
  // 線路の向きなど、確かな方位に合わせる（いまスマホが trueDeg を向いている）
  calibrate(trueDeg: number): boolean {
    const b = this.base;
    if (b === null) return false;
    this.offset = norm360(trueDeg - b);
    this.by = "track";
    return true;
  }
  // 画面を見ながら少しずつ直す（度）
  nudge(deg: number) {
    if (this.offset === null) return;
    this.offset = norm360(this.offset + deg);
  }
  // 歩きながら、道順の向き（routeDeg）に少しだけ寄せる（k：寄せる割合）。差が maxDiff 度より大きいときは、
  // よそ見や向きの取り違えかもしれないので寄せない。線路などで合わせたあとだけ
  pull(routeDeg: number, k: number, maxDiff = 30): boolean {
    const h = this.now();
    if (h === null || this.by !== "track") return false;
    const d = signedDiff(routeDeg, h);
    if (Math.abs(d) > maxDiff) return false;
    this.nudge(d * k);
    return true;
  }
}

// 向き h から向き a へ回す角度（-180〜180。正：時計回り）
export function signedDiff(a: number, h: number): number {
  return norm360(a - h + 180) - 180;
}
