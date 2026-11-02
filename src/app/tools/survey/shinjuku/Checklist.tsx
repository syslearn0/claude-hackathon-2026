"use client";

import { useEffect, useState } from "react";
import { loadJson, saveJson } from "@/lib/local";

export type Section = { id: string; title: string; when: string; items: string[] };

const KEY = "survey.shinjuku.checks.v1";

export function Checklist({ sections, targets }: { sections: Section[]; targets: { id: string; label: string }[] }) {
  const [done, setDone] = useState<Record<string, boolean>>({});

  // サーバーで描いた画面と食い違わないよう、保存したチェックは描いたあとに読む
  useEffect(() => {
    const saved = loadJson<Record<string, boolean>>(KEY, {});
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 端末の保存は描画後にしか読めない
    setDone(saved);
  }, []);

  const toggle = (key: string) => {
    const next = { ...done, [key]: !done[key] };
    setDone(next);
    saveJson(KEY, next);
  };

  const box = (key: string, label: string) => (
    <label key={key} className="row" style={{ alignItems: "flex-start", margin: "8px 0", flexWrap: "nowrap" }}>
      <input type="checkbox" checked={!!done[key]} onChange={() => toggle(key)} style={{ marginTop: 6, width: 20, height: 20, flex: "none" }} />
      <span style={{ textDecoration: done[key] ? "line-through" : undefined, opacity: done[key] ? 0.6 : 1 }}>{label}</span>
    </label>
  );

  return (
    <>
      {sections.map((s) => (
        <section key={s.id} className="card">
          <h2 style={{ marginTop: 0 }}>{s.title}</h2>
          <div className="muted">{s.when}</div>
          {s.items.map((item, i) => box(`${s.id}-${i}`, item))}
        </section>
      ))}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>公式データにある新宿駅の多機能トイレ（{targets.length}件）</h2>
        <div className="muted">
          東京都のデータには載っているが、<strong>どれも改札の内か外かが分からない</strong>。経路の途中で見つけたら、改札の内外と行き方を記録してチェック。
        </div>
        {targets.map((t) => box(`official-${t.id}`, t.label))}
      </section>
    </>
  );
}
