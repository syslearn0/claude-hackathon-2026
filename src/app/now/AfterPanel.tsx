"use client";

import { useState } from "react";
import type { Answer } from "@/lib/agent/answer";
import { SITUATIONS } from "@/lib/agent/modes";
import { buildAfterFallback } from "@/lib/after-fallback";
import { bearingDeg, directionJa, distanceM, walkMinutes, type LatLon } from "@/lib/geo";
import type { NearbyItem } from "@/lib/nearby";
import type { Place } from "@/lib/places";
import { describeProfile, type Profile } from "@/lib/profile";
import { Item } from "./PlaceInfo";

// ③ トイレに入った後：状況を選ぶと、次の手順を出す。
// AI（/api/agent）に聞き、使えないときは同じデータから組み立てた簡易版を出す。
// 場所の名前・方角・分数・営業時間・品ぞろえは、AI の文ではなくデータから画面が出す。

type Shown = {
  answer: Answer;
  byId: Map<string, Place>;
  by: "ai" | "fallback";
  reason?: string; // 簡易版になった理由
};

export function AfterPanel({ pos, places, profile }: { pos: LatLon; places: Place[]; profile: Profile }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const ask = async () => {
    setBusy(true);
    setShown(null);
    const local = new Map(places.map((p) => [p.id, p]));
    const fallback = (reason: string): Shown => ({ answer: buildAfterFallback(places, pos, picked, profile), byId: local, by: "fallback", reason });
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "after", situations: picked, message: note, position: pos, profile: describeProfile(profile, "after") }),
        signal: AbortSignal.timeout(45000),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.answer) {
        setShown({ answer: json.answer, byId: new Map((json.places as Place[]).map((p) => [p.id, p])), by: "ai" });
      } else {
        setShown(fallback(json.code === "no_key" ? "AI がまだ使えない設定です" : (json.error ?? "AI に聞けませんでした")));
      }
    } catch {
      setShown(fallback("時間内に AI の返事が来ませんでした"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>次どうする？</h2>
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

      {shown && <AnswerView shown={shown} from={pos} />}
    </section>
  );
}

function AnswerView({ shown, from }: { shown: Shown; from: LatLon }) {
  const { answer, byId } = shown;
  const toItem = (p: Place): NearbyItem => {
    const meters = distanceM(from, p);
    return { place: p, meters: Math.round(meters), walkMin: walkMinutes(meters), direction: directionJa(bearingDeg(from, p)) };
  };
  return (
    <div style={{ marginTop: 12 }}>
      <div className="muted">
        {shown.by === "ai" ? "AI が作った手順（出てくる場所は、手元のデータにあるものだけ）" : `AI を使わない簡易版（${shown.reason}）`}
      </div>
      <p style={{ fontWeight: 700 }}>{answer.summary}</p>
      <ol style={{ paddingLeft: 20 }}>
        {answer.steps.map((step, i) => (
          <li key={i} style={{ margin: "10px 0" }}>
            <div>{step.text}</div>
            {step.placeIds
              .map((id) => byId.get(id))
              .filter((p): p is Place => !!p)
              .map((p) => (
                <Item key={p.id} item={toItem(p)} />
              ))}
          </li>
        ))}
      </ol>
      {answer.notes.map((n, i) => (
        <p key={i} className="muted">
          ※ {n}
        </p>
      ))}
    </div>
  );
}
