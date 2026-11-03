// 地下で GPS が届かなくても、決まった道順の上で「どこまで進んだか」をスマホのセンサーで数える。
// 当てるのは道順の上の位置（始まりからの m）の1つの数だけ。歩数で進め、曲がった・階が変わったで確認ポイントに合わせ直す。
// 手でも直せる（「着いたら押す」・地図をタップ）。歩数のずれは 100m あたり 5〜10m ほど出るので、合わせ直しが前提。
import type { Maneuver } from "./maneuvers";
import type { KindName } from "./route";

export const STEP_M = 0.7; // 1歩（m）

// 確認ポイント：曲がる角・上り下りの乗り口と降り口・トイレ
export type Checkpoint = { at: number; kind: "turn" | "board" | "alight" | "arrive"; dir?: "left" | "right"; via?: KindName; toFloor?: number; up?: boolean; boardAt?: number };

export function checkpoints(list: Maneuver[]): Checkpoint[] {
  const out: Checkpoint[] = [];
  for (const m of list) {
    if (m.kind === "left" || m.kind === "right") out.push({ at: m.at, kind: "turn", dir: m.kind });
    else if (m.kind === "floor") {
      out.push({ at: m.at, kind: "board", via: m.via, toFloor: m.toFloor, up: m.up });
      out.push({ at: m.end ?? m.at, kind: "alight", via: m.via, toFloor: m.toFloor, up: m.up, boardAt: m.at });
    } else out.push({ at: m.at, kind: "arrive" });
  }
  return out.sort((a, b) => a.at - b.at);
}

// 次の確認ポイント（いまの位置より先）と、ひとつ前
export const nextCheckpoint = (cps: Checkpoint[], pos: number) => cps.find((c) => c.at > pos + 0.5);
export const prevCheckpoint = (cps: Checkpoint[], pos: number) => [...cps].reverse().find((c) => c.at < pos - 0.5);

// 歩いたぶん進める。ただし上り下りの乗り口より先へは、歩数だけでは進めない（乗っている間は歩かないので）。
// 乗ったら、気圧の変化か「降りたら押す」で降り口へ
export function advanceBySteps(cps: Checkpoint[], pos: number, meters: number): number {
  const board = cps.find((c) => c.kind === "board" && c.at > pos - 0.01);
  const end = cps.at(-1)?.at ?? pos + meters;
  return Math.min(pos + meters, board ? board.at : end, end);
}

// 曲がったのを感じたら、近く（前後 within m）の同じ向きの角に合わせる
export function snapTurn(cps: Checkpoint[], pos: number, dir: "left" | "right", within = 20): number | undefined {
  const near = cps.filter((c) => c.kind === "turn" && c.dir === dir && Math.abs(c.at - pos) <= within);
  near.sort((a, b) => Math.abs(a.at - pos) - Math.abs(b.at - pos));
  return near[0]?.at;
}

// 気圧で上がった・下がったのを感じたら、近くの同じ向きの上り下りの降り口に合わせる
export function snapFloor(cps: Checkpoint[], pos: number, up: boolean, within = 40): number | undefined {
  const from = (c: Checkpoint) => c.boardAt ?? c.at;
  const near = cps.filter((c) => c.kind === "alight" && c.up === up && (Math.abs(from(c) - pos) <= within || (pos >= from(c) && pos <= c.at)));
  near.sort((a, b) => Math.abs(from(a) - pos) - Math.abs(from(b) - pos));
  return near[0]?.at;
}

// 歩数：加速度の大きさ（重力込み）の山を数える。ゆっくり追う基準より 1.3 m/s² 上に出たら1歩（0.28 秒より詰まったものは数えない）
export class StepCounter {
  private base = 9.8;
  private above = false;
  private last = -Infinity;
  push(t: number, mag: number): boolean {
    this.base += (mag - this.base) * 0.02;
    const d = mag - this.base;
    if (!this.above && d > 1.3) {
      this.above = true;
      if (t - this.last > 280) {
        this.last = t;
        return true;
      }
    } else if (this.above && d < 0.3) this.above = false;
    return false;
  }
}

// 鉛直のまわりの回る速さ（度/秒。上から見て左回りが正）。ジャイロの回転を重力の向きに投影する（スマホの持ち方によらない）
export function yawRate(rot: { alpha: number; beta: number; gamma: number }, g: { x: number; y: number; z: number }): number {
  const n = Math.hypot(g.x, g.y, g.z) || 1;
  return (rot.beta * g.x + rot.gamma * g.y + rot.alpha * g.z) / n;
}

// 曲がった：2.5 秒のうちに 55 度より多く同じ向きに回ったら。続けては 2 秒あける
export class TurnWatcher {
  private hist: [number, number][] = [];
  private last = -Infinity;
  push(t: number, yaw: number): "left" | "right" | undefined {
    this.hist.push([t, yaw]);
    while (this.hist.length && t - this.hist[0][0] > 2500) this.hist.shift();
    if (t - this.last < 2000 || this.hist.length < 2) return undefined;
    let sum = 0;
    for (let i = 1; i < this.hist.length; i++) sum += (this.hist[i][1] * (this.hist[i][0] - this.hist[i - 1][0])) / 1000;
    if (Math.abs(sum) < 55) return undefined;
    this.last = t;
    this.hist = [];
    return sum > 0 ? "left" : "right";
  }
}
