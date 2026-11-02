import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>トイレ外出サポート（開発中）</h1>
      <p>
        急なトイレの不安がある人の外出を、確かめた事実の情報で支える Web アプリです。
        いまはデータ集めの道具だけを置いています。
      </p>
      <Link href="/now" className="button primary big">
        今すぐトイレ
      </Link>
      <p className="muted">近いトイレ・着替えられる場所・替えを買える店と、駅員や店員に見せる「お願いカード」。</p>

      <h2>データ集めの道具</h2>
      <ul>
        <li>
          <Link href="/tools/survey">現地確認の記録</Link>
          <span className="muted">（駅のトイレ・店の品ぞろえ）</span>
        </li>
        <li>
          <Link href="/tools/gps-log">位置の記録</Link>
          <span className="muted">（電車移動中の GPS の取れ方を調べる）</span>
        </li>
      </ul>
      <p className="muted">記録はこの端末の中だけに保存されます。送るときは「書き出し」から。</p>
    </main>
  );
}
