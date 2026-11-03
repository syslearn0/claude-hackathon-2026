"use client";

import { useEffect } from "react";

// サービスワーカーを登録し、この画面が読み込んだ JS・CSS を端末に持たせる（電波がなくても開けるように）。
// 開発中は通知だけ扱う版を登録する（public/sw.js の ?dev=1）
export function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const dev = process.env.NODE_ENV !== "production";
    navigator.serviceWorker
      .register(dev ? "/sw.js?dev=1" : "/sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        if (dev) return;
        const send = () => {
          const urls = performance
            .getEntriesByType("resource")
            .map((r) => r.name)
            .filter((u) => u.includes("/_next/static/"));
          reg.active?.postMessage({ type: "cache-urls", urls: [...urls, location.pathname] });
        };
        send();
        // 画面の中身（あとから読み込む部品）が届いたころに、もう一度
        setTimeout(send, 5000);
      })
      .catch(() => {});
  }, []);
  return null;
}
