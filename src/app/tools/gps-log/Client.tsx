"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { exportFile, loadJson, saveJson, stamp } from "@/lib/local";

// ブラウザの位置情報がどう取れるか（地下で途切れる・ぶれる）をそのまま残す。
// 本番の Web アプリが受け取るのと同じ経路で取るので、市販の記録アプリより正直な結果になる。

type Fix = {
  t: number; // 端末の時刻（ms）
  lat: number;
  lon: number;
  acc: number;
  speed: number | null; // m/s
  heading: number | null;
};

type Event = { t: number; type: "error" | "mark"; text: string };

type Log = {
  startedAt: number | null;
  stoppedAt: number | null;
  note: string;
  fixes: Fix[];
  events: Event[];
};

const LOG_KEY = "gpslog.current.v1";
const EMPTY: Log = { startedAt: null, stoppedAt: null, note: "", fixes: [], events: [] };
const MARKS = ["駅に着いた", "発車した", "地下に入った", "地上に出た", "電車を降りた", "遅延・停車中"];

export default function GpsLogPage() {
  const [log, setLog] = useState<Log>(() => loadJson<Log>(LOG_KEY, EMPTY));
  const [recording, setRecording] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [trimMeters, setTrimMeters] = useState(500);
  const watchId = useRef<number | null>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const logRef = useRef<Log>(log);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const update = (fn: (l: Log) => Log) => {
    const next = fn(logRef.current);
    logRef.current = next;
    setLog(next);
    saveJson(LOG_KEY, next);
  };

  const keepAwake = async () => {
    try {
      wakeLock.current = await navigator.wakeLock?.request("screen");
    } catch {
      // 画面が消えると記録が止まる端末がある。使えなければ表示で知らせる
    }
  };

  // 画面に戻ってきたら、画面を消さない設定をかけ直す
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && recording) keepAwake();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [recording]);

  const start = () => {
    if (!("geolocation" in navigator)) {
      alert("この端末では位置情報が使えません");
      return;
    }
    if (logRef.current.fixes.length > 0 && !confirm("前の記録を消して新しく始めますか？（先に書き出してください）")) return;
    update(() => ({ ...EMPTY, startedAt: Date.now() }));
    watchId.current = navigator.geolocation.watchPosition(
      (p) =>
        update((l) => ({
          ...l,
          fixes: [
            ...l.fixes,
            {
              t: p.timestamp,
              lat: p.coords.latitude,
              lon: p.coords.longitude,
              acc: p.coords.accuracy,
              speed: p.coords.speed,
              heading: p.coords.heading,
            },
          ],
        })),
      (e) => update((l) => ({ ...l, events: [...l.events, { t: Date.now(), type: "error", text: `${e.code}: ${e.message}` }] })),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
    setRecording(true);
    keepAwake();
  };

  const stop = () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
    setRecording(false);
    update((l) => ({ ...l, stoppedAt: Date.now() }));
  };

  const mark = (text: string) => update((l) => ({ ...l, events: [...l.events, { t: Date.now(), type: "mark", text }] }));

  const doExport = () => {
    const trimmed = trimEnds(log.fixes, trimMeters);
    const t0 = trimmed[0]?.t ?? -Infinity;
    const t1 = trimmed[trimmed.length - 1]?.t ?? Infinity;
    const body = {
      exportedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      note: log.note,
      startedAt: log.startedAt,
      stoppedAt: log.stoppedAt,
      privacyTrimMeters: trimMeters,
      fixes: trimmed,
      // 削った区間の出来事は残さない（家の近くでの動きが分からないように）
      events: log.events.filter((e) => e.t >= t0 && e.t <= t1),
    };
    exportFile(`trace-${stamp(new Date(log.startedAt ?? Date.now()))}.gpslog.json`, JSON.stringify(body));
  };

  const last = log.fixes[log.fixes.length - 1];
  const lastAge = last ? Math.round((now - last.t) / 1000) : null;
  const trimmedCount = trimEnds(log.fixes, trimMeters).length;

  return (
    <main>
      <p className="muted">
        <Link href="/">← もどる</Link>
      </p>
      <h1>位置の記録</h1>
      <p className="muted">
        電車で移動するあいだ、ブラウザの位置情報がどう取れるかを記録します。記録中は<strong>画面を開いたまま</strong>にしてください（画面が消えると止まる端末があります）。
      </p>

      {!recording ? (
        <button className="primary big" onClick={start}>
          記録を始める
        </button>
      ) : (
        <button className="big" onClick={stop}>
          記録を止める
        </button>
      )}

      <div className="card">
        <table>
          <tbody>
            <tr>
              <th>状態</th>
              <td>{recording ? "記録中" : log.stoppedAt ? "停止" : "未開始"}</td>
            </tr>
            <tr>
              <th>位置の数</th>
              <td>{log.fixes.length}</td>
            </tr>
            <tr>
              <th>最後に取れてから</th>
              <td style={{ color: lastAge !== null && lastAge > 30 ? "var(--danger)" : undefined }}>
                {lastAge === null ? "—" : `${lastAge}秒`}
              </td>
            </tr>
            <tr>
              <th>誤差</th>
              <td>{last ? `約${Math.round(last.acc)}m` : "—"}</td>
            </tr>
            <tr>
              <th>速さ</th>
              <td>{last?.speed != null ? `時速 約${Math.round(last.speed * 3.6)}km` : "—"}</td>
            </tr>
            <tr>
              <th>エラー</th>
              <td>{log.events.filter((e) => e.type === "error").length}回</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>出来事を記録（押すだけ）</h2>
      <div className="chips">
        {MARKS.map((m) => (
          <button key={m} onClick={() => mark(m)} disabled={!recording}>
            {m}
          </button>
        ))}
      </div>
      <p className="muted">駅に着いたら駅名をメモ欄に足しておくと、あとで照らし合わせやすくなります。</p>

      <label className="field">
        <span>メモ（路線・方向・乗った車両など）</span>
        <textarea
          value={log.note}
          onChange={(e) => update((l) => ({ ...l, note: e.target.value }))}
          placeholder="例：京阪本線 出町柳行き 準急 3号車。七条で地下に"
        />
      </label>

      <h2>書き出し</h2>
      <label className="field">
        <span>始まりと終わりの近くを削る（家などの場所を残さないため）</span>
        <select value={trimMeters} onChange={(e) => setTrimMeters(Number(e.target.value))}>
          <option value={0}>削らない</option>
          <option value={300}>半径300m</option>
          <option value={500}>半径500m</option>
          <option value={1000}>半径1km</option>
        </select>
        <div className="muted">
          書き出す位置の数：{trimmedCount} / {log.fixes.length}
        </div>
      </label>
      <button className="big" onClick={doExport} disabled={log.fixes.length === 0 || recording}>
        書き出す
      </button>

      <h2>直近の出来事</h2>
      <ul className="muted">
        {[...log.events]
          .reverse()
          .slice(0, 10)
          .map((e, i) => (
            <li key={i}>
              {new Date(e.t).toLocaleTimeString("ja-JP")} {e.type === "error" ? "⚠ " : ""}
              {e.text}
            </li>
          ))}
      </ul>
    </main>
  );
}

// 最初と最後の位置から半径 r メートル以内の点を落とす
function trimEnds(fixes: Fix[], r: number): Fix[] {
  if (r <= 0 || fixes.length === 0) return fixes;
  const first = fixes[0];
  const lastFix = fixes[fixes.length - 1];
  return fixes.filter((f) => distance(f, first) > r && distance(f, lastFix) > r);
}

function distance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
