"use client";

import { useEffect, useRef, useState } from "react";
import type { Answer } from "@/lib/agent/answer";
import { bearingDeg, directionJa, distanceM, walkMinutes, type LatLon } from "@/lib/geo";
import { loadJson, saveJson } from "@/lib/local";
import type { Place } from "@/lib/places";
import { Item } from "./PlaceInfo";

// ② 緊急時の見直し：画面の一番の候補はプログラムがすぐに出し、AI は並行して状況を判断し直す。
// AI の答えで一番の候補を黙って差し替えない。違うときだけ、理由つきで別の候補として出す。

// 最初からオン。「オフにする」を押した人だけ止める
const ENABLED_KEY = "ai.review.enabled";

type Review = { answer: Answer; places: Place[]; ms: number };

export function EmergencyReview({
  pos,
  situationText,
  programFirstId,
}: {
  pos: LatLon;
  situationText: string;
  programFirstId?: string;
}) {
  const [enabled, setEnabled] = useState(() => loadJson<boolean>(ENABLED_KEY, true));
  const [review, setReview] = useState<Review | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  // 聞き直すのは、画面の一番の候補が変わったとき（電車と分かって次の駅に切り替わったなど）と、約300m 動いたときだけ。
  // GPS は毎秒届くので、そのたびには聞かない。前に聞いてから、候補が変わったときは10秒、動いただけなら1分あける（費用と回数制限のため）
  const area = `${Math.round(pos.lat / 0.003)},${Math.round(pos.lon / 0.003)}`;
  const lastAsked = useRef(0);
  const lastFirst = useRef<string | undefined>(undefined);
  // 一番新しい問い合わせの番号。場所が変わっても、届いた返事は捨てない（古い返事だけ捨てる）
  const seq = useRef(0);

  // 問い合わせには、その時点の一番新しい状況と位置を使う
  const latest = useRef({ situationText, pos });
  useEffect(() => {
    latest.current = { situationText, pos };
  });

  // 位置が決まったら（または有効にしたら）聞く。間を空ける時間の中なら、あけ終わってから聞く。プログラムの表示はその間もそのまま
  useEffect(() => {
    if (!enabled) return;
    const firstChanged = programFirstId !== lastFirst.current;
    const wait = Math.max(0, lastAsked.current + (firstChanged ? 10_000 : 60_000) - Date.now());
    const ask = async () => {
      lastAsked.current = Date.now();
      lastFirst.current = programFirstId;
      const id = ++seq.current;
      const alive = () => id === seq.current;
      const started = Date.now();
      setState("busy");
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "emergency", message: latest.current.situationText, position: latest.current.pos }),
          signal: AbortSignal.timeout(45000),
        });
        const json = await res.json().catch(() => ({}));
        if (!alive()) return;
        if (res.ok && json.answer) {
          setReview({ answer: json.answer, places: json.places ?? [], ms: Date.now() - started });
          setState("idle");
        } else setState("error");
      } catch {
        if (alive()) setState("error");
      }
    };
    // 待っているあいだにまた変われば、待ち直す（聞くのは最後の1回）。送った問い合わせの返事は捨てない
    const timer = setTimeout(ask, wait);
    return () => clearTimeout(timer);
  }, [enabled, area, programFirstId]);

  if (!enabled) {
    return (
      <div className="card">
        <button
          onClick={() => {
            saveJson(ENABLED_KEY, true);
            setEnabled(true);
          }}
        >
          AI の見直しをオンにする
        </button>
        <div className="muted">
          オンにすると、この画面を開くたびに現在地とプログラムの推定を AI に送り、状況を判断し直します（保存はしません）。画面の候補はそのまま出ます。
        </div>
      </div>
    );
  }

  const firstStep = review?.answer.steps[0];
  const aiFirst = firstStep?.placeIds[0];
  const aiPlace = review?.places.find((p) => p.id === aiFirst);
  const same = !aiFirst || aiFirst === programFirstId;
  const toItem = (p: Place) => {
    const m = distanceM(pos, p);
    return { place: p, meters: Math.round(m), walkMin: walkMinutes(m), direction: directionJa(bearingDeg(pos, p)) };
  };

  return (
    <div className="card" style={{ borderStyle: "dashed" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>AI の見直し</strong>
          <div className="muted" style={{ fontSize: "0.8rem" }}>
            現在地とプログラムの推定を AI に送っています（保存はしません）
          </div>
        </div>
        <button
          onClick={() => {
            saveJson(ENABLED_KEY, false);
            setEnabled(false);
            setReview(null);
          }}
        >
          オフにする
        </button>
      </div>
      {state === "busy" && <div className="muted">見直しています…（そのあいだも、上の候補へ向かえます）</div>}
      {state === "error" && <div className="muted">見直しができませんでした。上の候補を使ってください。</div>}
      {review && (
        <>
          <div className="muted">{(review.ms / 1000).toFixed(0)}秒で届きました</div>
          <p style={{ fontWeight: 700, margin: "6px 0" }}>{review.answer.summary}</p>
          {!same && aiPlace && (
            <>
              <div>別の候補：{firstStep?.text}</div>
              <Item item={toItem(aiPlace)} />
            </>
          )}
          {review.answer.steps.slice(1).map((s, i) => (
            <div key={i} style={{ marginTop: 6 }}>
              <div>{s.text}</div>
              {s.placeIds
                .map((id) => review.places.find((p) => p.id === id))
                .filter((p): p is Place => !!p)
                .map((p) => (
                  <Item key={p.id} item={toItem(p)} />
                ))}
            </div>
          ))}
          {review.answer.notes.map((n, i) => (
            <p key={i} className="muted" style={{ margin: "4px 0" }}>
              ※ {n}
            </p>
          ))}
        </>
      )}
    </div>
  );
}
