"use client";

import { useState } from "react";
import { loadProfile } from "@/lib/profile";

// 駅員・店員に見せる画面。病名は出さず、困っていることだけを伝える
export const DEFAULT_CARD = {
  ja: {
    title: "急いでトイレを使わせてください",
    body: "体の事情で、すぐにトイレが必要です。近くのトイレを教えてください。",
    contact: "具合が悪くなったら、この人に連絡してください",
    switch: "English",
  },
  en: {
    title: "I urgently need a toilet",
    body: "Due to a medical condition, I need to use a toilet right away. Could you tell me where the nearest one is?",
    contact: "If I become unwell, please contact",
    switch: "日本語",
  },
};

export function RequestCard({ onClose }: { onClose: () => void }) {
  const [lang, setLang] = useState<"ja" | "en">("ja");
  // 自分の情報で文面を変えていれば、それを使う（日本語のときだけ）
  const [profile] = useState(() => loadProfile());
  const t = DEFAULT_CARD[lang];
  const body = lang === "ja" && profile.cardMessage ? profile.cardMessage : t.body;
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        // 地図（Leaflet）の重なり順より上に出す
        zIndex: 2000,
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
      <div style={{ fontSize: "1.4rem", lineHeight: 1.6 }}>{body}</div>
      {profile.contactPhone && (
        <div style={{ fontSize: "1.1rem", lineHeight: 1.6 }}>
          {t.contact}：{profile.contactName ? `${profile.contactName} ` : ""}
          <a href={`tel:${profile.contactPhone.replace(/[^\d+]/g, "")}`} style={{ color: "#1d1d1b", fontWeight: 700 }}>
            {profile.contactPhone}
          </a>
        </div>
      )}
      <div className="row request-card-buttons">
        <button onClick={() => setLang(lang === "ja" ? "en" : "ja")}>{t.switch}</button>
        <button onClick={onClose}>閉じる</button>
      </div>
    </div>
  );
}
