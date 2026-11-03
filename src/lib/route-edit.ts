// 今日の経路を途中で直すための計算（乗る電車を変えた、遅れた、など）。画面は src/app/now/RouteEditor.tsx
import type { RouteStop } from "./agent/answer";

export const isHhmm = (s?: string) => !!s && /^\d{2}:\d{2}$/.test(s);

const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));
const fromMin = (m: number) => {
  const d = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(d / 60)).padStart(2, "0")}:${String(d % 60).padStart(2, "0")}`;
};

export const addMinutes = (hm: string, d: number) => fromMin(toMin(hm) + d);

// いま（now、"HH:MM"）より後の時刻だけを d 分ずらす。もう過ぎた発着はそのまま
export function shiftUpcoming(route: RouteStop[], d: number, now: string): RouteStop[] {
  const upcoming = (t?: string) => isHhmm(t) && toMin(t!) >= toMin(now);
  return route.map((r) => ({
    ...r,
    ...(upcoming(r.arr) && { arr: addMinutes(r.arr!, d) }),
    ...(upcoming(r.dep) && { dep: addMinutes(r.dep!, d) }),
  }));
}

// 保存する前に整える：駅名の空白と「駅」を外し、空の駅は捨て、時刻の形でないものは外す
export function cleanRoute(route: RouteStop[]): RouteStop[] {
  return route
    .map((r) => ({
      station: r.station.trim().replace(/駅$/, ""),
      ...(r.line?.trim() && { line: r.line.trim() }),
      ...(isHhmm(r.arr) && { arr: r.arr }),
      ...(isHhmm(r.dep) && { dep: r.dep }),
    }))
    .filter((r) => r.station);
}

// 時刻の順がおかしいところ（前の駅を出るより前に着く、など）を人が読める文で返す
export function routeProblems(route: RouteStop[]): string[] {
  const out: string[] = [];
  let last: { t: number; label: string } | undefined;
  for (const r of route) {
    for (const [t, what] of [
      [r.arr, "着"],
      [r.dep, "発"],
    ] as const) {
      if (!isHhmm(t)) continue;
      const m = toMin(t!);
      if (last && m < last.t && last.t - m < 12 * 60) out.push(`${r.station} ${t}${what} が、${last.label} より前になっています`);
      last = { t: m, label: `${r.station} ${t}${what}` };
    }
  }
  return out;
}
