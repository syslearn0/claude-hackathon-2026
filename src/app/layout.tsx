import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SwRegister } from "./SwRegister";

export const metadata: Metadata = {
  title: "トイレ外出サポート",
  description: "急なトイレの不安がある人の外出を、事実の情報で支える",
  // iPhone でホーム画面に追加したときのアイコン
  icons: { apple: "/apple-touch-icon.png" },
  appleWebApp: { title: "トイレ外出" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1f5fbf",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
