"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { exportFile, loadJson, saveJson, stamp } from "@/lib/local";
import { FieldDef, STOCK_STATES, SurveyKind, fieldsFor } from "@/lib/survey-fields";

type Values = Record<string, unknown>;

type SurveyRecord = {
  id: string;
  kind: SurveyKind;
  surveyor: string;
  checkedAt: string; // ISO
  values: Values;
};

const RECORDS_KEY = "survey.records.v1";
const SURVEYOR_KEY = "survey.surveyor";

function newId(kind: SurveyKind): string {
  return `${kind}-${Date.now()}`;
}

export default function SurveyPage() {
  const [records, setRecords] = useState<SurveyRecord[]>(() => loadJson<SurveyRecord[]>(RECORDS_KEY, []));
  const [surveyor, setSurveyor] = useState(() => loadJson<string>(SURVEYOR_KEY, ""));
  const [kind, setKind] = useState<SurveyKind>("toilet");
  const [values, setValues] = useState<Values>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const persist = (next: SurveyRecord[]) => {
    setRecords(next);
    if (!saveJson(RECORDS_KEY, next)) {
      setMessage("この端末に保存できませんでした。こまめに書き出してください。");
    }
  };

  const fields = fieldsFor(kind);
  const missing = fields.filter(
    (f) => "required" in f && f.required && !String(values[f.key] ?? "").trim(),
  );

  const save = () => {
    if (missing.length > 0) {
      setMessage(`未入力：${missing.map((f) => f.label).join("、")}`);
      return;
    }
    const rec: SurveyRecord = {
      id: editingId ?? newId(kind),
      kind,
      surveyor,
      checkedAt: new Date().toISOString(),
      values,
    };
    const next = editingId
      ? records.map((r) => (r.id === editingId ? { ...rec, checkedAt: r.checkedAt } : r))
      : [...records, rec];
    persist(next);
    setValues({});
    setEditingId(null);
    setMessage("保存しました");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const edit = (r: SurveyRecord) => {
    setKind(r.kind);
    setValues(r.values);
    setEditingId(r.id);
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = (r: SurveyRecord) => {
    if (confirm(`「${titleOf(r)}」を消しますか？`)) persist(records.filter((x) => x.id !== r.id));
  };

  const doExport = () => {
    const body = JSON.stringify({ exportedAt: new Date().toISOString(), records }, null, 2);
    exportFile(`survey-${stamp()}.json`, body);
  };

  return (
    <main>
      <p className="muted">
        <Link href="/">← もどる</Link>
      </p>
      <h1>現地確認の記録</h1>
      <p className="muted">
        先に<Link href="/tools/survey/rules">調査のルール</Link>を読んでください。記録はこの端末だけに保存されます。
      </p>

      <label className="field">
        <span>調査した人の呼び名</span>
        <input
          type="text"
          value={surveyor}
          onChange={(e) => {
            setSurveyor(e.target.value);
            saveJson(SURVEYOR_KEY, e.target.value);
          }}
          placeholder="例：たなか"
        />
      </label>

      <div className="chips" role="group" aria-label="記録の種類">
        <button
          aria-pressed={kind === "toilet"}
          onClick={() => {
            setKind("toilet");
            setValues({});
            setEditingId(null);
          }}
        >
          駅のトイレ
        </button>
        <button
          aria-pressed={kind === "store"}
          onClick={() => {
            setKind("store");
            setValues({});
            setEditingId(null);
          }}
        >
          コンビニ・ドラッグストア
        </button>
      </div>

      {message && <p className="card">{message}</p>}
      {editingId && <p className="muted">編集中：{editingId}</p>}

      <div>
        {fields.map((f) => (
          <Field
            key={`${kind}-${f.key}`}
            def={f}
            value={values[f.key]}
            onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
          />
        ))}
      </div>

      <button className="primary big" onClick={save}>
        {editingId ? "直して保存" : "保存"}
      </button>

      <h2>記録した場所（{records.length}件）</h2>
      <button className="big" onClick={doExport} disabled={records.length === 0}>
        書き出して送る
      </button>
      {[...records].reverse().map((r) => (
        <div className="card" key={r.id}>
          <div>
            <strong>{titleOf(r)}</strong>
          </div>
          <div className="muted">
            {r.kind === "toilet" ? "トイレ" : "店"}・{new Date(r.checkedAt).toLocaleString("ja-JP")}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={() => edit(r)}>直す</button>
            <button onClick={() => remove(r)}>消す</button>
          </div>
        </div>
      ))}
    </main>
  );
}

function titleOf(r: SurveyRecord): string {
  const v = r.values;
  if (r.kind === "toilet") return `${v.station ?? "?"}駅 ${v.gate ?? ""} ${v.nearGate ?? ""}`.trim();
  return String(v.name ?? "?");
}

function Field({ def, value, onChange }: { def: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const hint = def.hint ? <div className="muted">{def.hint}</div> : null;
  const req = "required" in def && def.required ? "（必須）" : "";

  switch (def.kind) {
    case "text":
      return (
        <label className="field">
          <span>
            {def.label}
            {req}
          </span>
          <input type="text" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
          {hint}
        </label>
      );
    case "textarea":
      return (
        <label className="field">
          <span>{def.label}</span>
          <textarea value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
          {hint}
        </label>
      );
    case "choice":
      return (
        <fieldset>
          <legend>
            {def.label}
            {req}
          </legend>
          <div className="chips">
            {def.options.map((o) => (
              <button key={o} aria-pressed={value === o} onClick={() => onChange(value === o ? undefined : o)}>
                {o}
              </button>
            ))}
          </div>
          {hint}
        </fieldset>
      );
    case "multi": {
      const set = new Set((value as string[] | undefined) ?? []);
      return (
        <fieldset>
          <legend>{def.label}</legend>
          <div className="chips">
            {def.options.map((o) => (
              <button
                key={o}
                aria-pressed={set.has(o)}
                onClick={() => {
                  const next = new Set(set);
                  if (next.has(o)) next.delete(o);
                  else next.add(o);
                  onChange([...next]);
                }}
              >
                {o}
              </button>
            ))}
          </div>
          {hint}
        </fieldset>
      );
    }
    case "stock": {
      const map = (value as Record<string, string> | undefined) ?? {};
      return (
        <fieldset>
          <legend>{def.label}</legend>
          {hint}
          {def.items.map((item) => (
            <div key={item} style={{ margin: "8px 0" }}>
              <div>{item}</div>
              <div className="chips">
                {STOCK_STATES.map((s) => (
                  <button
                    key={s}
                    aria-pressed={map[item] === s}
                    onClick={() => onChange({ ...map, [item]: map[item] === s ? undefined : s })}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </fieldset>
      );
    }
    case "stopwatch":
      return <Stopwatch label={def.label} hint={hint} seconds={value as number | undefined} onChange={onChange} />;
    case "position":
      return <PositionField label={def.label} hint={hint} value={value as Pos | undefined} onChange={onChange} />;
  }
}

function Stopwatch({
  label,
  hint,
  seconds,
  onChange,
}: {
  label: string;
  hint: React.ReactNode;
  seconds: number | undefined;
  onChange: (v: unknown) => void;
}) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const start = () => {
    const t = Date.now();
    setStartedAt(t);
    setNow(t);
    timer.current = setInterval(() => setNow(Date.now()), 250);
  };
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    if (startedAt) onChange(Math.round((Date.now() - startedAt) / 1000));
    setStartedAt(null);
  };

  const running = startedAt !== null;
  const shown = running ? Math.floor((now - startedAt) / 1000) : seconds;

  return (
    <fieldset>
      <legend>{label}</legend>
      <div className="row">
        <span style={{ fontSize: "1.3rem", minWidth: "5em" }}>{shown === undefined ? "—" : fmtSec(shown)}</span>
        {running ? (
          <button className="primary" onClick={stop}>
            止める
          </button>
        ) : (
          <button onClick={start}>{seconds === undefined ? "測り始める" : "測り直す"}</button>
        )}
        {!running && seconds !== undefined && <button onClick={() => onChange(undefined)}>消す</button>}
      </div>
      {hint}
    </fieldset>
  );
}

type Pos = { lat: number; lon: number; accuracy: number; at: string };

function PositionField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: React.ReactNode;
  value: Pos | undefined;
  onChange: (v: unknown) => void;
}) {
  const [status, setStatus] = useState("");
  const grab = () => {
    if (!("geolocation" in navigator)) {
      setStatus("この端末では位置が取れません");
      return;
    }
    setStatus("取得中…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        onChange({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracy: Math.round(p.coords.accuracy),
          at: new Date(p.timestamp).toISOString(),
        });
        setStatus("");
      },
      (e) => setStatus(`取れませんでした（${e.message}）`),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };
  return (
    <fieldset>
      <legend>{label}</legend>
      <div className="row">
        <button onClick={grab}>今の位置を記録</button>
        {value && (
          <span className="muted">
            {value.lat.toFixed(5)}, {value.lon.toFixed(5)}（誤差 約{value.accuracy}m）
          </span>
        )}
      </div>
      {status && <div className="muted">{status}</div>}
      {hint}
    </fieldset>
  );
}

function fmtSec(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}分${r}秒` : `${r}秒`;
}
