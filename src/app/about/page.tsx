import Link from "next/link";

// データの出典・ライセンス・プライバシー・やらないこと。審査や利用者が確かめられるように一か所にまとめる

export const metadata = { title: "このアプリについて｜トイレ外出サポート" };

export default function About() {
  return (
    <main>
      <p className="muted">
        <Link href="/">← もどる</Link>
      </p>
      <h1>このアプリについて</h1>
      <p>
        急なトイレの不安がある人（クローン病・潰瘍性大腸炎・過敏性腸症候群などの人、妊娠中・高齢・子ども連れの人も）の外出を、
        <strong>確かめた事実の情報</strong>で支える Web アプリです。作者自身がクローン病の当事者です。
      </p>

      <h2>やらないこと</h2>
      <ul>
        <li>症状の判断、受診・食事・薬の助言はしません（医療の助言ではありません）。</li>
        <li>データにないトイレや店を、推測で案内しません。分からないことは「不明」と出します。</li>
        <li>乗換経路は調べません。いつもの乗換アプリで決めた経路を貼るか共有してください。</li>
        <li>大量の出血・高い熱など危険な状態が書かれたときは、決まった文で医療機関・119番への連絡を案内するだけです。</li>
      </ul>

      <h2>プライバシー</h2>
      <ul>
        <li>「今すぐトイレ」で近くを探す計算は、スマホの中だけで行います。現在地をこのアプリのサーバーに送りません。</li>
        <li>
          AI に聞くとき（トイレの後の手順、出かける前の計画、「AI にも見直してもらう」をオンにしたとき）だけ、選んだ状況・書いた文・現在地を
          AI（Anthropic の Claude）に送ります。会話は保存しません。
        </li>
        <li>「自分の情報」と「今日の計画」は、スマホの中（ブラウザ）だけに保存します。病名の欄はありません。緊急連絡先は AI に送りません。</li>
        <li>地図の画像は国土地理院から読み込むため、表示している範囲は国土地理院に伝わります。</li>
        <li>計画画面の音声入力は、ブラウザの音声認識サービス（Chrome なら Google、Safari なら Apple）に声が送られます。</li>
        <li>回数制限のために IP アドレスをサーバーのメモリで数えますが、記録はしません。</li>
      </ul>

      <h2>情報の確かさ</h2>
      <p>場所ごとに、どこから来た情報かを出しています。</p>
      <ul>
        <li>
          <strong>現地確認済み</strong>：協力者が現地で確かめた情報（確認日つき）
        </li>
        <li>
          <strong>公式データ</strong>：東京都のオープンデータ
        </li>
        <li>
          <strong>OSM・未確認</strong>：OpenStreetMap の情報
        </li>
      </ul>
      <p>工事や営業時間の変更などで、実際と違うことがあります。現地の案内表示や駅員・店員の案内を優先してください。</p>

      <h2>データの出典・ライセンス</h2>
      <ul>
        <li>
          © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>（ODbL 1.0）：トイレ・コンビニ・ドラッグストア・駅の位置・駅の屋内データ
        </li>
        <li>
          東京都「
          <a href="https://catalog.data.metro.tokyo.lg.jp/">車椅子使用者対応トイレのバリアフリー情報（令和7年度更新版）</a>
          」（CC BY 4.0）を加工して作成
        </li>
        <li>
          <a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>（国土地理院）
        </li>
        <li>運行情報：公共交通オープンデータセンター（都営の運行情報）</li>
        <li>車内トイレ・弱冷房車の号車：各鉄道会社の公式の案内（各項目に出典と確認日）</li>
      </ul>

      <h2>作った人</h2>
      <p>
        Built with Claude: Japan 2026 の応募作品です。ソースコード：
        <a href="https://github.com/syslearn0/claude-hackathon-2026">github.com/syslearn0/claude-hackathon-2026</a>
        。問い合わせは GitHub の Issues へ。鉄道会社や施設へは問い合わせないでください。
      </p>
    </main>
  );
}
