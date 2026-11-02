import type { MetadataRoute } from "next";

// ホーム画面に追加したアプリとしての設定。
// share_target：Android でほかのアプリ（乗換案内など）の「共有」から、経路の文を /plan に受け取る
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "トイレ外出サポート",
    short_name: "トイレ外出",
    description: "急なトイレの不安がある人の外出を、確かめた事実の情報で支える",
    start_url: "/",
    display: "standalone",
    background_color: "#141413",
    theme_color: "#1f5fbf",
    lang: "ja",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    share_target: {
      action: "/plan",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
  };
}
