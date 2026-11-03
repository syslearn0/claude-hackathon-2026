"use client";

import { useState } from "react";
import type { RouteStop } from "@/lib/agent/answer";
import { cleanRoute, routeProblems, shiftUpcoming } from "@/lib/route-edit";
import { savePlan, type SavedPlan } from "@/lib/saved-plan";

// 今日の経路を途中で直す（乗る電車を変えた、遅れた、乗り換えを変えた）。AI は使わない。
// 直した経路は「いま何駅と何駅の間か」「次の駅のトイレ」の推定にすぐ使われる

const hhmmNow = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const summaryOf = (route: RouteStop[]) =>
  route.map((r) => `${r.station}${r.arr ? ` ${r.arr}着` : ""}${r.dep ? ` ${r.dep}発` : ""}`).join(" → ");

export function RouteEditor({
  plan,
  stationNames,
  onSaved,
}: {
  plan: SavedPlan | null;
  stationNames: Set<string>;
  onSaved: (p: SavedPlan) => void;
}) {
  const route = plan?.answer.route ?? [];
  const [draft, setDraft] = useState<RouteStop[] | null>(null);
  const [saved, setSaved] = useState(false);

  const start = () => {
    setSaved(false);
    setDraft(route.length ? route.map((r) => ({ ...r })) : [{ station: "" }, { station: "" }]);
  };
  const set = (i: number, v: Partial<RouteStop>) => setDraft((d) => d && d.map((r, j) => (j === i ? { ...r, ...v } : r)));
  const insertAfter = (i: number) => setDraft((d) => d && [...d.slice(0, i + 1), { station: "" }, ...d.slice(i + 1)]);
  const remove = (i: number) => setDraft((d) => d && d.filter((_, j) => j !== i));

  const save = () => {
    if (!draft) return;
    const next = cleanRoute(draft);
    const base: SavedPlan = plan ?? {
      createdAt: new Date().toISOString(),
      note: "手で入れた経路",
      conditions: [],
      places: [],
      answer: { summary: "", steps: [], notes: [] },
    };
    const p: SavedPlan = {
      ...base,
      answer: { ...base.answer, route: next, summary: base.answer.summary || `${next[0]?.station ?? ""}→${next.at(-1)?.station ?? ""}（手で入れた経路）` },
    };
    savePlan(p);
    onSaved(p);
    setDraft(null);
    setSaved(true);
  };

  if (!draft) {
    return (
      <section className="card" id="route-editor">
        <strong>今日の経路</strong>
        <div className="muted">{route.length ? summaryOf(route) : "まだ入っていません"}</div>
        {saved && <div>直した経路を保存しました。いまどこの推定に使います。</div>}
        <button style={{ marginTop: 6 }} onClick={start}>
          {route.length ? "予定を変える（乗る電車・時刻・駅）" : "経路を手で入れる"}
        </button>
      </section>
    );
  }

  const cleaned = cleanRoute(draft);
  const problems = routeProblems(cleaned);
  const unknown = cleaned.filter((r) => !stationNames.has(r.station)).map((r) => r.station);

  return (
    <section className="card" id="route-editor">
      <strong>今日の経路を直す</strong>
      <div className="muted">乗る電車を変えたとき・遅れたときに。時刻は分かるものだけでよい。</div>

      <div className="chips" style={{ marginTop: 6 }}>
        <span className="muted">これからの時刻をまとめてずらす：</span>
        {[-5, 5, 10, 15, 30].map((m) => (
          <button key={m} onClick={() => setDraft((d) => d && shiftUpcoming(d, m, hhmmNow()))}>
            {m > 0 ? `+${m}` : m}分
          </button>
        ))}
      </div>

      {draft.map((r, i) => (
        <div key={i} style={{ borderTop: "1px solid var(--line)", marginTop: 8, paddingTop: 8 }}>
          <div className="row">
            <input
              type="text"
              value={r.station}
              onChange={(e) => set(i, { station: e.target.value })}
              placeholder={i === 0 ? "出発の駅" : i === draft.length - 1 ? "着く駅" : "乗り換えの駅"}
              style={{ flex: 1, minWidth: 120 }}
            />
            <button onClick={() => remove(i)} disabled={draft.length <= 2} aria-label={`${r.station || "この駅"}を消す`}>
              消す
            </button>
          </div>
          <div className="row" style={{ marginTop: 4 }}>
            {i > 0 && (
              <label>
                着 <input type="time" value={r.arr ?? ""} onChange={(e) => set(i, { arr: e.target.value || undefined })} />
              </label>
            )}
            {i < draft.length - 1 && (
              <label>
                発 <input type="time" value={r.dep ?? ""} onChange={(e) => set(i, { dep: e.target.value || undefined })} />
              </label>
            )}
          </div>
          {i < draft.length - 1 && (
            <>
              <input
                type="text"
                value={r.line ?? ""}
                onChange={(e) => set(i, { line: e.target.value || undefined })}
                placeholder="ここから乗る路線（例：京阪本線）"
                style={{ marginTop: 4, width: "100%" }}
              />
              <button style={{ marginTop: 4 }} onClick={() => insertAfter(i)}>
                ↓ ここに乗り換えの駅を足す
              </button>
            </>
          )}
        </div>
      ))}

      {unknown.length > 0 && <p className="muted">データにない駅：{unknown.join("、")}（いまどこの推定には使えません）</p>}
      {problems.map((p) => (
        <p key={p} style={{ color: "var(--accent)" }}>
          {p}
        </p>
      ))}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="primary" onClick={save} disabled={cleaned.length < 2}>
          保存
        </button>
        <button onClick={() => setDraft(null)}>やめる</button>
      </div>
    </section>
  );
}
