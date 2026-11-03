"use client";

import Link from "next/link";
import { useState } from "react";
import { clearProfile, loadProfile, saveProfile, type Profile, type ToiletSide } from "@/lib/profile";

// 自分の情報。スマホの中だけに保存する。病名は聞かない。

const SIDES: { id: ToiletSide; label: string }[] = [
  { id: "male", label: "男性側" },
  { id: "female", label: "女性側" },
  { id: "any", label: "どちらでも・答えない" },
];

export default function MePage() {
  const [p, setP] = useState<Profile>(() => loadProfile());
  const [stationsText, setStationsText] = useState(() => (loadProfile().homeStations ?? []).join("、"));
  const [message, setMessage] = useState("");

  const set = (patch: Partial<Profile>) => setP((prev) => ({ ...prev, ...patch }));
  const tri = (key: "needAccessible" | "needOstomate" | "carriesSpare", label: string, yes: string, no: string) => (
    <fieldset>
      <legend>{label}</legend>
      <div className="chips">
        <button aria-pressed={p[key] === true} onClick={() => set({ [key]: p[key] === true ? undefined : true })}>
          {yes}
        </button>
        <button aria-pressed={p[key] === false} onClick={() => set({ [key]: p[key] === false ? undefined : false })}>
          {no}
        </button>
      </div>
    </fieldset>
  );

  const save = () => {
    const homeStations = stationsText
      .split(/[、,，\s]+/)
      .map((s) => s.trim().replace(/駅$/, ""))
      .filter(Boolean);
    const next = { ...p, homeStations };
    setP(next);
    setMessage(saveProfile(next) ? "保存しました" : "この端末に保存できませんでした（プライベートモードなど）");
  };

  return (
    <main>
      <p className="muted">
        <Link href="/">← もどる</Link>
      </p>
      <h1>自分の情報</h1>
      <p className="card" style={{ marginTop: 0 }}>
        ここで入れた情報は<strong>このスマホの中だけ</strong>に保存し、サーバーには保存しません。
        AI に聞くときは、その場面に要る条件（多機能トイレが要る、など）だけを送ります。よく使う駅は送りません。
        病名を書く欄はありません。
      </p>

      <fieldset>
        <legend>使うトイレの側</legend>
        <div className="chips">
          {SIDES.map((s) => (
            <button key={s.id} aria-pressed={p.toiletSide === s.id} onClick={() => set({ toiletSide: p.toiletSide === s.id ? undefined : s.id })}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="muted">サニタリーボックスがあるかを、自分に関係ある側だけ出すために使います。</div>
      </fieldset>

      {tri("needAccessible", "多機能トイレ（個室で着替えられる）", "要る・優先したい", "なくてよい")}
      {tri("needOstomate", "オストメイト対応", "要る", "要らない")}
      {tri("carriesSpare", "替えの下着などを、ふだん持ち歩いている", "持ち歩いている", "持ち歩いていない")}

      <label className="field">
        <span>よく使う駅</span>
        <input type="text" value={stationsText} onChange={(e) => setStationsText(e.target.value)} placeholder="例：丹波橋、出町柳" />
        <div className="muted">「今すぐトイレ」で駅を選ぶとき、先に出します（データのある駅だけ）。</div>
      </label>

      <button className="primary big" onClick={save}>
        保存
      </button>
      {message && <p className="card">{message}</p>}

      <button
        style={{ marginTop: 24 }}
        onClick={() => {
          if (!confirm("このスマホに保存した自分の情報を消しますか？")) return;
          clearProfile();
          setP({});
          setStationsText("");
          setMessage("消しました");
        }}
      >
        自分の情報を消す
      </button>
      <p className="muted">ブラウザのデータを消したり機種を変えたりすると、ここの情報も消えます。</p>
    </main>
  );
}
