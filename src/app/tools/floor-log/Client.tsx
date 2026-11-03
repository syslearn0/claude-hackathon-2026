"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { barometerAvailable, heightDiffM, watchPressure } from "@/lib/barometer";
import { exportFile, loadJson, saveJson, stamp } from "@/lib/local";

// 気圧で階が分かるかを確かめるための記録。ブラウザは気圧計を読めないので、気圧は別のアプリ（phyphox）で取り、
// ここでは「いつ・どこで・何階にいたか」を押して残す。あとで時刻で突き合わせる。
// Android アプリ（Capacitor）の中で開いたときは、このページが気圧も一緒に記録する（phyphox は要らない）。

type Mark = { t: number; kind: string; floor?: string; note?: string };
type Log = { startedAt: number | null; stoppedAt: number | null; station: string; phone: string; marks: Mark[]; pressure?: [number, number][] };

const KEY = "floorlog.current.v1";
const EMPTY: Log = { startedAt: null, stoppedAt: null, station: "新宿", phone: "", marks: [] };

// 通るたびに押すところ（乗る・降りるは、足が乗った・離れた瞬間に）
const PLACES = [
  "地上（屋外）に出た",
  "改札を通った",
  "ホームに着いた",
  "階段：上り始め",
  "階段：上り終わり",
  "階段：下り始め",
  "階段：下り終わり",
  "エスカレーター：乗った",
  "エスカレーター：降りた",
  "エレベーター：乗った",
  "エレベーター：降りた",
  "立ち止まって30秒",
];
const FLOORS = ["B7", "B6", "B5", "B4", "B3", "B2", "B1", "1F", "2F", "3F", "4F", "分からない"];

const hms = (t: number) => new Date(t).toLocaleTimeString("ja-JP", { hour12: false });

export default function FloorLogPage() {
  const [log, setLog] = useState<Log>(() => loadJson<Log>(KEY, EMPTY));
  const [now, setNow] = useState(() => Date.now());
  const [note, setNote] = useState("");
  const logRef = useRef<Log>(log);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  // アプリの中なら気圧も（[時刻ms, hPa]。1秒に1つ）
  const [baro, setBaro] = useState<boolean | null>(null);
  const [hPa, setHPa] = useState<number | null>(null);
  const stopBaro = useRef<(() => void) | null>(null);
  const lastSaved = useRef(0);
  useEffect(() => {
    barometerAvailable().then(setBaro);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const update = (fn: (l: Log) => Log) => {
    const next = fn(logRef.current);
    logRef.current = next;
    setLog(next);
    saveJson(KEY, next);
  };
  const mark = (m: Omit<Mark, "t">) => update((l) => ({ ...l, marks: [...l.marks, { t: Date.now(), ...m }] }));

  const start = async () => {
    if (log.marks.length > 0 && !confirm("前の記録を消して新しく始めますか？（先に書き出してください）")) return;
    update((l) => ({ ...EMPTY, station: l.station, phone: l.phone, startedAt: Date.now(), pressure: [] }));
    if (baro) {
      stopBaro.current = await watchPressure((p, t) => {
        setHPa(p);
        if (t - lastSaved.current < 1000) return;
        lastSaved.current = t;
        update((l) => ({ ...l, pressure: [...(l.pressure ?? []), [t, Math.round(p * 100) / 100]] }));
      });
    }
    try {
      wakeLock.current = await navigator.wakeLock?.request("screen");
    } catch {
      // 画面を消さない設定が使えない端末もある（記録は画面が消えても残る）
    }
  };
  const stop = () => {
    update((l) => ({ ...l, stoppedAt: Date.now() }));
    stopBaro.current?.();
    stopBaro.current = null;
    wakeLock.current?.release().catch(() => {});
  };
  const doExport = () =>
    exportFile(`floorlog-${log.station}-${stamp(new Date(log.startedAt ?? Date.now()))}.json`, JSON.stringify({ ...log, exportedAt: new Date().toISOString() }, null, 1));

  const recording = log.startedAt !== null && log.stoppedAt === null;
  const lastFloor = [...log.marks].reverse().find((m) => m.floor)?.floor;

  return (
    <main>
      <p className="muted">
        <Link href="/">← もどる</Link>（調査用のページ）
      </p>
      <h1>階と気圧の記録</h1>

      <details className="card">
        <summary>
          <strong>はじめに（1回だけ）</strong>
        </summary>
        <ol>
          <li>
            スマホに <strong>phyphox</strong>（無料。ドイツのアーヘン工科大学のアプリ。Android・iPhone どちらも）を入れる。
          </li>
          <li>phyphox で「気圧（Pressure）」を開く。気圧計のない機種では出てこない（そのときは知らせてください）。</li>
          <li>
            このページで「記録を始める」→ すぐに phyphox の ▶（開始）を押す。<strong>そのときのこのページの時刻</strong>を、メモに書くか画面を撮っておく。
          </li>
          <li>歩きながら、通ったところ・案内表示の階を、このページで押す。phyphox は止めない。</li>
          <li>
            終わったら phyphox を止めて、メニューの「データのエクスポート」→「CSV（カンマ区切り）」で書き出す。このページも「書き出して送る」。
            <strong>2つのファイル</strong>を送ってください。
          </li>
        </ol>
        <p className="muted">
          気圧は天気でも少しずつ変わるので、<strong>最初と最後に、地上の同じ場所で30秒立ち止まって</strong>「立ち止まって30秒」を押してください。
          エレベーターは乗っている間ほど変化が大きいので、乗った・降りたは足が床に乗った・離れた瞬間に。
        </p>
      </details>

      <div className="card" style={{ textAlign: "center" }}>
        <div className="muted">この端末の時刻</div>
        <div style={{ fontSize: "2.4rem", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{hms(now)}</div>
        {log.startedAt && <div className="muted">記録の開始：{hms(log.startedAt)}</div>}
        {baro && (
          <div style={{ marginTop: 4 }}>
            気圧センサー：{hPa !== null ? `${hPa.toFixed(2)} hPa` : "記録を始めると読みます"}
            {hPa !== null && log.pressure?.length ? `（最初から ${heightDiffM(log.pressure[0][1], hPa) >= 0 ? "+" : ""}${heightDiffM(log.pressure[0][1], hPa).toFixed(1)} m）` : ""}
          </div>
        )}
        {baro === false && <div className="muted">このページでは気圧を読めません（phyphox で記録してください）</div>}
      </div>

      <div className="row">
        <label className="field" style={{ flex: 1 }}>
          <span>駅</span>
          <input type="text" value={log.station} onChange={(e) => update((l) => ({ ...l, station: e.target.value }))} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          <span>スマホの機種</span>
          <input type="text" value={log.phone} onChange={(e) => update((l) => ({ ...l, phone: e.target.value }))} placeholder="例：Pixel 8" />
        </label>
      </div>

      {!recording ? (
        <button className="primary big" onClick={start}>
          記録を始める
        </button>
      ) : (
        <>
          <h2>いまの階（案内表示や構内図の書き方で）{lastFloor && <span className="muted">：いま {lastFloor}</span>}</h2>
          <div className="chips">
            {FLOORS.map((f) => (
              <button key={f} aria-pressed={lastFloor === f} onClick={() => mark({ kind: "階", floor: f })}>
                {f}
              </button>
            ))}
          </div>

          <h2>通ったところ</h2>
          <div className="chips">
            {PLACES.map((p) => (
              <button key={p} onClick={() => mark({ kind: p })}>
                {p}
              </button>
            ))}
          </div>

          <div className="row" style={{ marginTop: 8 }}>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="メモ（例：大江戸線 新宿駅 ホーム 3号車付近）" style={{ flex: 1 }} />
            <button
              onClick={() => {
                if (!note.trim()) return;
                mark({ kind: "メモ", note: note.trim() });
                setNote("");
              }}
            >
              残す
            </button>
          </div>

          <button className="big" style={{ marginTop: 12 }} onClick={stop}>
            記録を止める
          </button>
        </>
      )}

      {log.marks.length > 0 && (
        <>
          <h2>記録（新しい順）</h2>
          <ul className="muted" style={{ paddingLeft: 18 }}>
            {[...log.marks]
              .reverse()
              .slice(0, 12)
              .map((m) => (
                <li key={m.t}>
                  {hms(m.t)} {m.kind}
                  {m.floor ? `：${m.floor}` : ""}
                  {m.note ? `：${m.note}` : ""}
                </li>
              ))}
          </ul>
          <button className="big" onClick={doExport} disabled={recording}>
            書き出して送る（{log.marks.length}件）
          </button>
          {recording && <p className="muted">書き出すには、先に記録を止めてください。</p>}
        </>
      )}
    </main>
  );
}
