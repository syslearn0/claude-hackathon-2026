// 気圧センサー。ブラウザでは読めないので、Android アプリ（Capacitor、android/）の中で開いたときだけ使える。
// アプリ側は android/app/src/main/java/app/toiletsupport/trial/BarometerPlugin.java
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

type BarometerPlugin = {
  isAvailable(): Promise<{ available: boolean; name?: string }>;
  start(): Promise<void>;
  stop(): Promise<void>;
  addListener(event: "pressure", cb: (d: { hPa: number; t: number }) => void): Promise<PluginListenerHandle>;
};

const Barometer = registerPlugin<BarometerPlugin>("Barometer");

// アプリの中で、気圧センサーがある端末か
export async function barometerAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    return (await Barometer.isAvailable()).available;
  } catch {
    return false;
  }
}

// 気圧を受け取り始める。止めるときは返した関数を呼ぶ
export async function watchPressure(cb: (hPa: number, t: number) => void): Promise<() => void> {
  const handle = await Barometer.addListener("pressure", (d) => cb(d.hPa, d.t));
  await Barometer.start();
  return () => {
    handle.remove();
    Barometer.stop();
  };
}

// 気圧の差 → 高さの差（m）。地上近くでは 1hPa ≒ 8.3m（上がると気圧は下がる）
export const heightDiffM = (fromHPa: number, toHPa: number) => (fromHPa - toHPa) * 8.3;
