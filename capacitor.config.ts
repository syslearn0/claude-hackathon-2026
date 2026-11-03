import type { CapacitorConfig } from "@capacitor/cli";

// Android アプリ（試作）。中身は公開中の Web アプリをそのまま読み込み、気圧センサーなどブラウザで読めないものだけをアプリ側で足す。
// 開発中のサーバーを読ませるときは CAP_SERVER_URL を指定する（例：http://192.168.0.10:3000）
const config: CapacitorConfig = {
  appId: "app.toiletsupport.trial",
  appName: "トイレ外出サポート",
  webDir: "capacitor-www",
  server: {
    url: process.env.CAP_SERVER_URL ?? "https://claude-hackathon-2026-sigma.vercel.app",
    cleartext: process.env.CAP_SERVER_URL?.startsWith("http://") ?? false,
  },
};

export default config;
