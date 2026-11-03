"use client";

import { useEffect } from "react";

// この画面がこれまでに読み込んだ JS・CSS を、端末に持つようサービスワーカーに頼む（あとから読み込んだ部品も）
export function cacheLoadedFiles() {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.ready
    .then((reg) => {
      const urls = performance
        .getEntriesByType("resource")
        .map((r) => r.name)
        .filter((u) => u.includes("/_next/static/"));
      reg.active?.postMessage({ type: "cache-urls", urls: [...urls, location.pathname] });
    })
    .catch(() => {});
}

// サービスワーカーを登録し、この画面が読み込んだ JS・CSS を端末に持たせる（電波がなくても開けるように）。
// 開発中は通知だけ扱う版を登録する（public/sw.js の ?dev=1）
export function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const dev = process.env.NODE_ENV !== "production";
    navigator.serviceWorker
      .register(dev ? "/sw.js?dev=1" : "/sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        if (dev) return;
        cacheLoadedFiles();
        // 画面の中身（あとから読み込む部品）が届いたころに、もう一度
        setTimeout(cacheLoadedFiles, 5000);
      })
      .catch(() => {});
  }, []);
  return null;
}
