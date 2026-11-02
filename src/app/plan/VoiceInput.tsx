"use client";

import { useEffect, useRef, useState } from "react";

// ① 計画の「今日の予定」を声で入れる。ブラウザの音声認識（Web Speech API）を使う。
// 声は、ブラウザが使う音声認識サービス（Chrome なら Google、Safari なら Apple）に送られて文字になる。
// 緊急時や人前では声に出しにくいので、計画の画面だけに置く。

// ブラウザの音声認識の、ここで使う部分だけの型
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function createRecognition(): Recognition | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "マイクの使用が許可されていません。ブラウザの設定で許可してください。",
  "no-speech": "声が聞き取れませんでした。もう一度押して話してください。",
  network: "音声認識サービスにつながりませんでした。",
  "audio-capture": "マイクが見つかりませんでした。",
};

export function VoiceInput({ onText }: { onText: (text: string) => void }) {
  const [supported] = useState(() => createRecognition() !== null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const rec = useRef<Recognition | null>(null);
  // 利用者が「止める」を押すまで聞き続けたいか。
  // Android の Chrome は continuous を無視して一区切りで終わるので、終わるたびに聞き直す
  const want = useRef(false);
  const lastHeard = useRef(0);

  useEffect(
    () => () => {
      want.current = false;
      rec.current?.stop();
    },
    [],
  );

  if (!supported) {
    return <p className="muted">このブラウザでは声で入れられません。キーボードのマイクのボタンを使ってください。</p>;
  }

  const stop = () => {
    want.current = false;
    rec.current?.stop();
    setListening(false);
    setInterim("");
  };

  const listenOnce = () => {
    const r = createRecognition();
    if (!r) return;
    r.lang = "ja-JP";
    r.interimResults = true;
    // 一区切りずつ聞いて、終わったら聞き直す（continuous にすると Android で同じ文が重なることがある）
    r.continuous = false;
    r.onresult = (e) => {
      lastHeard.current = Date.now();
      let done = "";
      let partial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) done += res[0].transcript;
        else partial += res[0].transcript;
      }
      if (done) onText(done);
      setInterim(partial);
    };
    r.onerror = (e) => {
      // 黙っていた・途中で止めた、は聞き直せばよい。それ以外は止める
      if (e.error === "no-speech" || e.error === "aborted") return;
      want.current = false;
      setError(ERRORS[e.error] ?? `声を文字にできませんでした（${e.error}）`);
    };
    r.onend = () => {
      setInterim("");
      // 1分なにも聞き取れなければ、聞くのをやめる（押し忘れでマイクが開いたままにならないように）
      if (want.current && Date.now() - lastHeard.current < 60_000) {
        listenOnce();
      } else {
        want.current = false;
        setListening(false);
      }
    };
    rec.current = r;
    r.start();
  };

  const start = () => {
    want.current = true;
    lastHeard.current = Date.now();
    setError("");
    setListening(true);
    listenOnce();
  };

  return (
    <div style={{ margin: "8px 0" }}>
      <button onClick={() => (listening ? stop() : start())} aria-pressed={listening}>
        {listening ? "■ 話し終わったら押す" : "🎤 声で入れる"}
      </button>
      {listening && <div className="muted">聞いています…{interim && `「${interim}」`}</div>}
      {error && <div className="muted">{error}</div>}
      <div className="muted" style={{ fontSize: "0.8rem" }}>
        声は、ブラウザの音声認識サービス（Chrome なら Google、Safari なら Apple）に送られて文字になります。
      </div>
    </div>
  );
}
