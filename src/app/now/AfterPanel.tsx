"use client";

import { useState } from "react";
import { buildAfterFallback } from "@/lib/after-fallback";
import { SITUATIONS } from "@/lib/agent/modes";
import type { LatLon } from "@/lib/geo";
import { bearingDeg, directionJa, distanceM, walkMinutes } from "@/lib/geo";
import { displayName } from "@/lib/nearby";
import type { Place, Tier } from "@/lib/places";

// ③ トイレに入った後：状況を選ぶと、次の手順を出す。
// AI（/api/agent）に聞き、使えないときは同じデータから組み立てた簡易版を出す。

type Answer = {
  text: string;
  places: Place[];
  by: "ai" | "fallback";
  reason?: string; // 簡易版になった理由
  grounded?: boolean;
};

const TIER_LABEL: Record<Tier, string> = {
  verified: "現地確認済み",
  official: "公式データ",
  osm: "OSM・未確認",
  report: "利用者の報告",
};

export function AfterPanel({ pos, places }: { pos: LatLon; places: Place[] }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const ask = async () => {
    setBusy(true);
    setAnswer(null);
    const fallback = (reason: string): Answer => ({ ...buildAfterFallback(places, pos, picked), by: "fallback", reason });
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "after", situations: picked, message: note, position: pos }),
        signal: AbortSignal.timeout(45000),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setAnswer({ text: json.text, places: json.places ?? [], by: "ai", grounded: json.grounded });
      } else {
        setAnswer(fallback(json.code === "no_key" ? "AI がまだ使えない設定です" : (json.error ?? "AI に聞けませんでした")));
      }
    } catch {
      setAnswer(fallback("時間内に AI の返事が来ませんでした"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>トイレに入った後：次どうする？</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        当てはまるものを選んでください（いくつでも）。
      </p>
      <div className="chips">
        {SITUATIONS.map((s) => (
          <button key={s.id} aria-pressed={picked.includes(s.id)} onClick={() => toggle(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <label className="field">
        <span>ひとこと（なくてよい）</span>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：ズボンの替えも欲しい" maxLength={200} />
      </label>
      <button className="primary big" onClick={ask} disabled={busy || picked.length === 0}>
        {busy ? "考えています…" : "次の手順を出す"}
      </button>
      <p className="muted">選んだ内容と現在地を、AI に送って手順を作ります（保存はしません）。</p>

      {answer && <AnswerView answer={answer} from={pos} />}
    </section>
  );
}

function AnswerView({ answer, from }: { answer: Answer; from: LatLon }) {
  const byId = new Map(answer.places.map((p) => [p.id, p]));
  return (
    <div style={{ marginTop: 12 }}>
      <div className="muted">
        {answer.by === "ai"
          ? `AI が作った手順${answer.grounded === false ? "（根拠を確かめられない場所は伏せました）" : "（出てくる場所は、すべて手元のデータにあることをプログラムで確認済み）"}`
          : `AI を使わない簡易版（${answer.reason}）`}
      </div>
      {answer.text.split("\n").map((line, i) => (
        <p key={i} style={{ margin: "8px 0" }}>
          {renderLine(line, byId, from)}
        </p>
      ))}
    </div>
  );
}

// [[place:ID]] を、場所の名前と信頼度の札に置き換える
function renderLine(line: string, byId: Map<string, Place>, from: LatLon) {
  const parts = line.split(/(\[\[place:[^\]\s]+\]\])/g);
  return parts.map((part, i) => {
    const m = part.match(/^\[\[place:([^\]\s]+)\]\]$/);
    if (!m) return <span key={i}>{part}</span>;
    const p = byId.get(m[1]);
    if (!p) return <span key={i}>（確認できない場所）</span>;
    const meters = distanceM(from, p);
    return (
      <a
        key={i}
        href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}&travelmode=walking`}
        target="_blank"
        rel="noreferrer"
        title={`${directionJa(bearingDeg(from, p))}へ約${walkMinutes(meters)}分`}
        style={{ fontWeight: 700 }}
      >
        {displayName(p)}
        <span className="tag" style={{ marginLeft: 4, fontWeight: 400 }}>
          {TIER_LABEL[p.tier]}
        </span>
      </a>
    );
  });
}
