"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Answer } from "@/lib/agent/answer";
import { PLAN_CONDITIONS } from "@/lib/agent/modes";
import type { NearbyItem } from "@/lib/nearby";
import { displayName } from "@/lib/nearby";
import type { Place } from "@/lib/places";
import { trainCarsParts } from "@/lib/train-cars";
import { describeProfile, loadProfile } from "@/lib/profile";
import { clearPlan, loadTodayPlan, savePlan, type SavedPlan } from "@/lib/saved-plan";
import { Badges, Details, MapLink, NumberBadge } from "../now/PlaceInfo";
import { VoiceInput } from "./VoiceInput";

// ① 出かける前の計画：今日の予定と条件を書くと、駅ごとに使える場所をまとめる。
// 経路や乗る電車はまだ調べられないので、書かれた駅の周りの事実だけで計画を作る。

// ほかのアプリの「共有」から届いた文（Android でホーム画面に追加したとき）
function readShared(): string {
  const q = new URLSearchParams(window.location.search);
  const parts = [q.get("title"), q.get("text"), q.get("url")].map((x) => x?.trim()).filter((x): x is string => !!x);
  return [...new Set(parts)].join("\n").slice(0, 1000);
}

const TRANSIT_URL = "https://transit.yahoo.co.jp/";

export default function PlanPage() {
  const [shared] = useState(readShared);
  const [note, setNote] = useState(shared);
  // 受け取ったら URL から消す（再読み込みで二重に入らないように）
  useEffect(() => {
    if (shared) window.history.replaceState(null, "", "/plan");
  }, [shared]);
  const [installed] = useState(() => window.matchMedia("(display-mode: standalone)").matches);
  const [conditions, setConditions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<SavedPlan | null>(() => loadTodayPlan());
  const [saved, setSaved] = useState(() => loadTodayPlan() !== null);
  // 保存した計画があれば、まず計画を見せる（入力欄は「作り直す」で開く）。共有から届いたときは入力欄から
  const [editing, setEditing] = useState(() => !!shared || loadTodayPlan() === null);
  const result = useRef<HTMLElement>(null);

  const toggle = (id: string) => setConditions((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const make = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "plan", message: note, conditions, profile: describeProfile(loadProfile(), "plan") }),
        signal: AbortSignal.timeout(90000),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.answer) {
        setError(json.code === "no_key" ? "AI がまだ使えない設定です。" : (json.error ?? "計画を作れませんでした。"));
        return;
      }
      setPlan({ createdAt: new Date().toISOString(), note, conditions, answer: json.answer as Answer, places: json.places as Place[] });
      setSaved(false);
      setEditing(false);
      // できた計画の頭へ（入力欄の下に出るので、押したあと気づけるように）
      setTimeout(() => result.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch {
      setError("時間内に計画が届きませんでした。通信を確かめて、もう一度試してください。");
    } finally {
      setBusy(false);
    }
  };

  const saveBar = plan && (
    <div className="card" style={{ borderColor: "var(--accent)", borderWidth: 2 }}>
      {saved ? (
        <>
          <div>
            <strong>この計画で出かけます。</strong>この端末に保存しました。外出中は「今すぐトイレ」の画面に出ます。
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <Link href="/now" className="button primary" style={{ flex: 1, padding: 10 }}>
              今すぐトイレを開く
            </Link>
            <button
              onClick={() => {
                clearPlan();
                setSaved(false);
              }}
            >
              保存を消す
            </button>
          </div>
        </>
      ) : (
        <>
          <button
            className="primary big"
            onClick={() => {
              if (savePlan(plan)) setSaved(true);
              else setError("この端末に保存できませんでした。");
            }}
          >
            この計画で出かける（端末に保存）
          </button>
          <div className="muted" style={{ marginTop: 4 }}>
            保存すると、外出中に「今すぐトイレ」の画面で、いまどの駅の間にいるかと次の駅のトイレを出せます。
          </div>
        </>
      )}
    </div>
  );

  return (
    <main>
      <p className="muted" style={{ margin: 0 }}>
        <Link href="/">← もどる</Link>
      </p>
      <h1>出かける前の計画</h1>

      {editing ? (
        <>
          {shared && <p className="card">共有された経路を入れました。当てはまるものを選んで「計画を作る」を押してください。</p>}

          <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
            <h2 style={{ margin: 0 }}>1. 経路と予定</h2>
            <a href={TRANSIT_URL} target="_blank" rel="noreferrer" className="button" style={{ padding: "6px 12px", flexShrink: 0 }}>
              乗換案内を開く
            </a>
          </div>
          <p className="muted" style={{ margin: "6px 0" }}>
            乗換アプリで調べた経路を貼り付けるか、声や文字で入れてください。
            {!installed && " Android でこのアプリをホーム画面に追加すると、乗換アプリの「共有」からここへ送れます。"}
          </p>
          <textarea
            aria-label="経路と予定"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            placeholder="例：京都 8:30発 → 東京 10:45着（のぞみ）、東京 10:55発 → 新宿 11:10着（中央線快速）。昼すぎに新宿の南口で用事。"
            style={{ minHeight: 110 }}
          />
          {/* 話した言葉は、書いてある予定の後ろに足す */}
          <VoiceInput onText={(t) => setNote((prev) => (prev ? `${prev}${/[。、\s]$/.test(prev) ? "" : "。"}${t}` : t).slice(0, 1000))} />
          <details className="muted">
            <summary>データがある場所</summary>
            トイレや店のデータがあるのは、いまは新宿駅・東京駅・京都駅の周り、京阪 丹波橋〜出町柳の沿線、都営大江戸線の一部の駅です。
          </details>

          <h2>2. 今日の調子・条件</h2>
          <p className="muted" style={{ margin: "0 0 6px" }}>
            当てはまるものを選んでください（いくつでも。なくてもよい）。
          </p>
          <div className="chips">
            {PLAN_CONDITIONS.map((c) => (
              <button key={c.id} aria-pressed={conditions.includes(c.id)} onClick={() => toggle(c.id)}>
                {c.label}
              </button>
            ))}
          </div>

          <button className="primary big" style={{ marginTop: 16 }} onClick={make} disabled={busy || !note.trim()}>
            {busy ? "計画を作っています…（30秒ほど）" : "計画を作る"}
          </button>
          <p className="muted">書いた予定を AI に送って計画を作ります（保存はしません）。経路は、書いた・貼ったものをそのまま使います。</p>
          {plan && !busy && (
            <button style={{ width: "100%" }} onClick={() => setEditing(false)}>
              作り直さずに、前の計画を見る
            </button>
          )}
        </>
      ) : (
        <button style={{ width: "100%" }} onClick={() => setEditing(true)}>
          予定を書き直して、計画を作り直す
        </button>
      )}
      {error && <p className="card">{error}</p>}

      {plan && !editing && (
        <section ref={result} style={{ scrollMarginTop: 8 }}>
          {saveBar}
          <PlanView plan={plan} />
          {!saved && saveBar}
        </section>
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
  const route = plan.answer.route ?? [];
  return (
    <section style={{ marginTop: 8 }}>
      <p style={{ fontWeight: 700, fontSize: "1.05rem" }}>{plan.answer.summary}</p>
      {route.length >= 2 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>経路と車内の設備</h2>
          {/* 駅を縦に並べ、駅と駅の間に乗る電車と、トイレのある号車 */}
          <ol className="route">
            {route.map((r, i) => {
              const cars = i < route.length - 1 && r.line ? trainCarsParts(r.line) : null;
              const times = [r.arr && `${r.arr}着`, r.dep && `${r.dep}発`].filter(Boolean).join("・");
              return (
                <li key={i}>
                  <strong>{r.station}</strong>
                  {times && <span className="muted"> {times}</span>}
                  {i < route.length - 1 && (
                    <div className="leg">
                      <div>{r.line ?? "路線不明"}</div>
                      {cars ? (
                        <>
                          {cars.facts.map((f) => (
                            <div key={f} style={{ fontWeight: 600 }}>
                              {f}
                            </div>
                          ))}
                          <div className="muted" style={{ fontSize: "0.8rem" }}>
                            {cars.title}・{cars.note}
                          </div>
                        </>
                      ) : (
                        r.line && <div className="muted">車内設備のデータなし</div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="muted" style={{ marginTop: 4, fontSize: "0.8rem" }}>
            経路は貼った・書いたものをそのまま使っています。号車の情報は鉄道会社の案内が出典です（編成によって違うことがあります）。
          </div>
        </div>
      )}
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
