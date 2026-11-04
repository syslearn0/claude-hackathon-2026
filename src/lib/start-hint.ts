// 歩き出す最初に、どちらへ向かえばいいか。地下では方角が分からないので、その場で目に入るもので言う：
//   ・ホームでは号車（「8号車の方（汐留寄り）へ」。足元や柱の号車の表示で分かる）
//   ・それ以外は、最初の区間の先にある目印（「中央東改札の方へ」「エスカレーターの方へ」）
// あわせて、最初の区間の向き（北から時計回りの度）を返す。スマホのコンパスと比べて「右を向く」などを出すため。
import { pointAt, type PathPoint } from "./maneuvers";

// 目印（この 3D の座標。x：東、z：南）
export type HintMark = { x: number; z: number; floor: number; name: string; kind: string };
// ホーム：1号車の側への向き（x, z）と、両端の隣の駅
export type PlatformInfo = { floor: number; toCar1: { x: number; z: number }; cars: number; car1Side: string; otherSide: string };

const PRIORITY: Record<string, number> = { gate: 3, entrance: 3, escalator: 2, elevator: 2, steps: 2, shop: 1, room: 1 };

export const bearingDeg = (dx: number, dz: number) => ((((Math.atan2(dx, -dz) * 180) / Math.PI) % 360) + 360) % 360;

export function startHint(pts: PathPoint[], cum: number[], pos: number, marks: HintMark[], platform?: PlatformInfo): { text?: string; bearing: number } | undefined {
  const total = cum.at(-1) ?? 0;
  const here = pointAt(pts, cum, pos);
  // 最初の区間：同じ階のまま進むところ（上り下りの手前まで）を 1m ごとに、最大 40m
  const ahead: PathPoint[] = [];
  for (let d = pos + 1; d <= Math.min(total, pos + 40); d += 1) {
    const p = pointAt(pts, cum, d);
    if (Math.abs(p.y - here.y) > 0.1) break;
    ahead.push(p);
  }
  if (!ahead.length) return undefined;
  // 向きは 8m 先（短ければ区間の終わり）まで
  const to = ahead[Math.min(7, ahead.length - 1)];
  const dx = to.x - here.x;
  const dz = to.z - here.z;
  if (Math.hypot(dx, dz) < 1) return undefined;
  const bearing = bearingDeg(dx, dz);

  // ホームで、ホームの長い向きに沿って歩くなら、号車で言う
  if (platform && Math.abs(here.floor - platform.floor) < 0.01) {
    const l = Math.hypot(platform.toCar1.x, platform.toCar1.z) || 1;
    const cos = (dx * platform.toCar1.x + dz * platform.toCar1.z) / (l * Math.hypot(dx, dz));
    if (Math.abs(cos) >= 0.6) return { bearing, text: cos > 0 ? `1号車の方（${platform.car1Side}寄り）へ` : `${platform.cars}号車の方（${platform.otherSide}寄り）へ` };
  }

  // 先にある目印：区間から 8m 以内で、4m 以上先にあるもの。大事なもの（改札・出入口 > 上り下り > 店）、近いものから
  let best: { m: HintMark; score: number } | undefined;
  for (const m of marks) {
    if (Math.abs(m.floor - here.floor) > 0.01) continue;
    let along = -1;
    let off = Infinity;
    ahead.forEach((p, i) => {
      const d = Math.hypot(p.x - m.x, p.z - m.z);
      if (d < off) {
        off = d;
        along = i + 1;
      }
    });
    if (off > 8 || along < 4) continue;
    const score = (PRIORITY[m.kind] ?? 0) * 100 - along;
    if (!best || score > best.score) best = { m, score };
  }
  return { bearing, text: best ? `${best.m.name}の方へ` : undefined };
}

// スマホの向き（コンパス）と、進む向きの差から、どちらを向けばいいか。地下ではずれやすいので、前・左右・後ろの大まかに
export function turnAdvice(bearing: number, heading: number): { diff: number; text: string } {
  const diff = ((((bearing - heading) % 360) + 540) % 360) - 180; // 正：右へ
  const a = Math.abs(diff);
  return { diff, text: a <= 30 ? "この向きでOK" : a >= 150 ? "後ろを向く" : diff > 0 ? "右を向く" : "左を向く" };
}
