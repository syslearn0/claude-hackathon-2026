"use client";

import { useEffect, useState } from "react";
import type { Answer } from "@/lib/agent/answer";
import { bearingDeg, directionJa, distanceM, walkMinutes, type LatLon } from "@/lib/geo";
import { loadJson, saveJson } from "@/lib/local";
import type { Place } from "@/lib/places";
import { Item } from "./PlaceInfo";

// ② 緊急時の見直し：画面の一番の候補はプログラムがすぐに出し、AI は並行して状況を判断し直す。
// AI の答えで一番の候補を黙って差し替えない。違うときだけ、理由つきで別の候補として出す。

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
  const [enabled, setEnabled] = useState(() => loadJson<boolean>(ENABLED_KEY, false));
  const [review, setReview] = useState<Review | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  // 位置が決まったら（または有効にしたら）1回だけ聞く。プログラムの表示はその間もそのまま
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const started = Date.now();
    const run = async () => {
      setState("busy");
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "emergency", message: situationText, position: pos }),
          signal: AbortSignal.timeout(45000),
        });
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        if (res.ok && json.answer) {
          setReview({ answer: json.answer, places: json.places ?? [], ms: Date.now() - started });
          setState("idle");
        } else setState("error");
      } catch {
        if (alive) setState("error");
      }
    };
    run();
    return () => {
      alive = false;
    };
    // 位置が変わったときだけ聞き直す（推定の文が少し変わるたびには聞かない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pos.lat, pos.lon]);

  if (!enabled) {
    return (
      <div className="card">
        <button
          onClick={() => {
            saveJson(ENABLED_KEY, true);
            setEnabled(true);
          }}
        >
          AI にも見直してもらう
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
        <strong>AI の見直し</strong>
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
