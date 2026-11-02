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

  useEffect(() => () => rec.current?.stop(), []);

  if (!supported) {
    return <p className="muted">このブラウザでは声で入れられません。キーボードのマイクのボタンを使ってください。</p>;
  }

  const start = () => {
    const r = createRecognition();
    if (!r) return;
    r.lang = "ja-JP";
    r.interimResults = true;
    r.continuous = true;
    r.onresult = (e) => {
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
    r.onerror = (e) => setError(ERRORS[e.error] ?? `声を文字にできませんでした（${e.error}）`);
    r.onend = () => {
      setListening(false);
      setInterim("");
    };
    rec.current = r;
    setError("");
    setListening(true);
    r.start();
  };

  return (
    <div style={{ margin: "8px 0" }}>
      <button onClick={() => (listening ? rec.current?.stop() : start())} aria-pressed={listening}>
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
