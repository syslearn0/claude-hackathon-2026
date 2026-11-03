"use client";

import Link from "next/link";
import { useState } from "react";
import { StationRoute } from "@/components/station-route/StationRoute";
import { INDOOR_STATIONS } from "@/lib/indoor";
import { carEnds } from "@/lib/platform";

// 試作：駅の中の道順を 3D で見る（中身は /now と同じ StationRoute）。ここでは駅を選べる
// ?station=大門&goal=<トイレの id> で開ける
const query = () => new URLSearchParams(typeof location === "undefined" ? "" : location.search);

export default function Station3D() {
  const [fromUrl] = useState(() => (INDOOR_STATIONS[query().get("station") ?? ""] ? query().get("station")! : undefined));
  const [station, setStation] = useState(fromUrl ?? "大門");
  const [pickStation, setPickStation] = useState(!fromUrl);
  const [goal] = useState(() => query().get("goal"));
  const line = carEnds(station) ? "都営大江戸線" : undefined;
  return (
    <main style={{ maxWidth: 900 }}>
      <p className="muted">
        <Link href={fromUrl ? "/now" : "/"}>← もどる</Link>（試作）
      </p>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={{ margin: 0 }}>
          {station}駅{line ? `（${line}）` : ""}
        </h1>
        <button onClick={() => setPickStation(!pickStation)}>駅を変える</button>
      </div>
      {pickStation && (
        <div className="chips" style={{ marginTop: 6 }}>
          {Object.keys(INDOOR_STATIONS).map((s) => (
            <button
              key={s}
              aria-pressed={station === s}
              onClick={() => {
                setStation(s);
                setPickStation(false);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <StationRoute key={station} station={station} goalId={station === fromUrl ? goal : null} />
    </main>
  );
}
