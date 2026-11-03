import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>トイレ外出サポート</h1>
      <p>
        急なトイレの不安がある人の外出を、確かめた事実の情報で支える Web アプリです。
        改札の内か外か、何階か、着替えられるか、替えを買える店はどこか。地図アプリにない情報を出します。
      </p>
      <Link href="/now" className="button primary big">
        今すぐトイレ
      </Link>
      <p className="muted">近いトイレ・着替えられる場所・替えを買える店。</p>

      <Link href="/plan" className="button big" style={{ marginTop: 12 }}>
        出かける前の計画
      </Link>
      <p className="muted">今日の予定と調子から、駅ごとに使えるトイレ・着替えられる場所・店をまとめます。</p>

      <Link href="/me" className="button" style={{ marginTop: 12, padding: 10 }}>
        自分の情報（このスマホだけに保存）
      </Link>

      <p className="muted">
        <Link href="/about">このアプリについて（やらないこと・プライバシー・データの出典）</Link>
      </p>

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
        <li>
          <Link href="/tools/floor-log">階と気圧の記録</Link>
          <span className="muted">（駅の中で何階にいたか。Android アプリの中で開くと気圧も一緒に記録）</span>
        </li>
        <li>
          <Link href="/lab/3d">駅の中を 3D で見る（試作）</Link>
          <span className="muted">（ホーム・改札からトイレまでの経路）</span>
        </li>
      </ul>
      <p className="muted">記録はこの端末の中だけに保存されます。送るときは「書き出し」から。</p>
    </main>
  );
}
