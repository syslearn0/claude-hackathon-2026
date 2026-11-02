"use client";

import { useState } from "react";

// 駅員・店員に見せる画面。病名は出さず、困っていることだけを伝える
const TEXT = {
  ja: {
    title: "急いでトイレを使わせてください",
    body: "体の事情で、すぐにトイレが必要です。近くのトイレを教えてください。",
    switch: "English",
  },
  en: {
    title: "I urgently need a toilet",
    body: "Due to a medical condition, I need to use a toilet right away. Could you tell me where the nearest one is?",
    switch: "日本語",
  },
};

export function RequestCard({ onClose }: { onClose: () => void }) {
  const [lang, setLang] = useState<"ja" | "en">("ja");
  const t = TEXT[lang];
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10,
        background: "#fff8d6",
        color: "#1d1d1b",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: 24,
        gap: 24,
      }}
    >
      <div style={{ fontSize: "2.2rem", fontWeight: 800, lineHeight: 1.3 }}>{t.title}</div>
      <div style={{ fontSize: "1.4rem", lineHeight: 1.6 }}>{t.body}</div>
      <div className="row request-card-buttons">
        <button onClick={() => setLang(lang === "ja" ? "en" : "ja")}>{t.switch}</button>
        <button onClick={onClose}>閉じる</button>
      </div>
    </div>
  );
}
