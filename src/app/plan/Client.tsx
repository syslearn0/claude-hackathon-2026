"use client";

import Link from "next/link";
import { useState } from "react";
import type { Answer } from "@/lib/agent/answer";
import { PLAN_CONDITIONS } from "@/lib/agent/modes";
import type { NearbyItem } from "@/lib/nearby";
import { displayName } from "@/lib/nearby";
import type { Place } from "@/lib/places";
import { clearPlan, loadTodayPlan, savePlan, type SavedPlan } from "@/lib/saved-plan";
import { Badges, Details, MapLink, NumberBadge } from "../now/PlaceInfo";

// ① 出かける前の計画：今日の予定と条件を書くと、駅ごとに使える場所をまとめる。
// 経路や乗る電車はまだ調べられないので、書かれた駅の周りの事実だけで計画を作る。

export default function PlanPage() {
  const [note, setNote] = useState("");
  const [conditions, setConditions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<SavedPlan | null>(() => loadTodayPlan());
  const [saved, setSaved] = useState(() => loadTodayPlan() !== null);

  const toggle = (id: string) => setConditions((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const make = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "plan", message: note, conditions }),
        signal: AbortSignal.timeout(90000),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.answer) {
        setError(json.code === "no_key" ? "AI がまだ使えない設定です。" : (json.error ?? "計画を作れませんでした。"));
        return;
      }
      setPlan({ createdAt: new Date().toISOString(), note, conditions, answer: json.answer as Answer, places: json.places as Place[] });
      setSaved(false);
    } catch {
      setError("時間内に計画が届きませんでした。通信を確かめて、もう一度試してください。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <p className="muted">
        <Link href="/">← もどる</Link>
      </p>
      <h1>出かける前の計画</h1>

      <label className="field">
        <span>今日の予定</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="例：今日は調子が悪い。京都から新宿に初めて行く。昼すぎに新宿に着いて、南口の近くで用事。"
        />
        <div className="muted">駅の名前を入れてください。データがあるのは、いまは新宿駅の周りと、京阪 丹波橋〜出町柳の沿線です。</div>
      </label>
      <div className="chips">
        {PLAN_CONDITIONS.map((c) => (
          <button key={c.id} aria-pressed={conditions.includes(c.id)} onClick={() => toggle(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <button className="primary big" style={{ marginTop: 12 }} onClick={make} disabled={busy || !note.trim()}>
        {busy ? "計画を作っています…（30秒ほど）" : "計画を作る"}
      </button>
      <p className="muted">書いた予定を AI に送って計画を作ります（保存はしません）。乗る電車や経路はまだ調べられません。</p>
      {error && <p className="card">{error}</p>}

      {plan && <PlanView plan={plan} />}

      {plan && (
        <div className="row" style={{ marginTop: 12 }}>
          {saved ? (
            <>
              <span className="muted">この計画を、この端末に保存しています。「今すぐトイレ」の画面にも出ます。</span>
              <button
                onClick={() => {
                  clearPlan();
                  setSaved(false);
                }}
              >
                保存を消す
              </button>
            </>
          ) : (
            <button
              className="primary big"
              onClick={() => {
                if (savePlan(plan)) setSaved(true);
                else setError("この端末に保存できませんでした。");
              }}
            >
              この計画で出かける（端末に保存）
            </button>
          )}
        </div>
      )}
    </main>
  );
}

export function PlanView({ plan }: { plan: SavedPlan }) {
  const byId = new Map(plan.places.map((p) => [p.id, p]));
  // section ごとにまとめる（AI が返した順のまま）
  const sections: { title: string; steps: SavedPlan["answer"]["steps"] }[] = [];
  for (const s of plan.answer.steps) {
    const title = s.section ?? "";
    const last = sections.at(-1);
    if (last && last.title === title) last.steps.push(s);
    else sections.push({ title, steps: [s] });
  }
  let n = 0;
  return (
    <section style={{ marginTop: 16 }}>
      <p style={{ fontWeight: 700 }}>{plan.answer.summary}</p>
      {sections.map((sec, i) => (
        <div key={i} className="card">
          {sec.title && <h2 style={{ marginTop: 0 }}>{sec.title}</h2>}
          {sec.steps.map((step, j) => (
            <div key={j} style={{ margin: "8px 0" }}>
              <div>{step.text}</div>
              {step.placeIds
                .map((id) => byId.get(id))
                .filter((p): p is Place => !!p)
                .map((p) => {
                  n++;
                  return <PlanPlace key={p.id} place={p} n={n} />;
                })}
            </div>
          ))}
        </div>
      ))}
      {plan.answer.packing && plan.answer.packing.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>持っていくとよいもの（例）</h2>
          <ul style={{ margin: 0 }}>
            {plan.answer.packing.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      {plan.answer.notes.map((x, i) => (
        <p key={i} className="muted">
          ※ {x}
        </p>
      ))}
    </section>
  );
}

// 計画の中の場所。いまの位置とは関係ないので、方角ではなく事実だけを出す
function PlanPlace({ place, n }: { place: Place; n: number }) {
  const item: NearbyItem = { place, meters: 0, walkMin: 0, direction: "" };
  return (
    <div className="card" style={{ margin: "6px 0" }}>
      <div>
        <NumberBadge n={n} tier={place.tier} />
        <strong>{displayName(place)}</strong>
        {place.station && <span className="muted">（{place.station}駅）</span>}
      </div>
      {place.kind === "store" && <div className="muted">営業時間：{place.hoursText ?? place.openingHours ?? "登録なし"}</div>}
      <Details item={item} />
      <Badges item={item} />
      <MapLink item={item} />
    </div>
  );
}
