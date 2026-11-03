// Claude Code のフック（PreToolUse）：コミットの前に、公開してはいけないものが入っていないか確かめる。
// 入っていたら exit 2 でコミットを止め、理由を Claude に返す。
// 守るもの：現地調査の生の記録・GPS の記録（家の位置が分かる）・鍵・個人の携帯番号。
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));
const cmd = String(input.tool_input?.command ?? "");
if (!/\bgit\b[\s\S]*\bcommit\b/.test(cmd)) process.exit(0);

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);

// これからコミットされうるファイル：もう add 済みのもの＋同じコマンドの git add / commit -a で入るもの
const files = new Set(git("diff", "--cached", "--name-only"));
for (const m of cmd.matchAll(/\bgit\s+add\s+([^;&|]*)/g)) {
  const args = m[1].trim().split(/\s+/).map((a) => a.replace(/^["']|["']$/g, ""));
  const force = args.some((a) => a === "-f" || a === "--force");
  const paths = args.filter((a) => !a.startsWith("-"));
  const all = args.some((a) => a === "-A" || a === "--all") || paths.includes(".");
  const opts = ["ls-files", "-m", "-o", ...(force ? [] : ["--exclude-standard"])];
  for (const f of git(...opts, "--", ...(all ? [] : paths))) files.add(f);
}
if (/\bcommit\b[^;&|]*\s-(a|-all)\b/.test(cmd)) for (const f of git("ls-files", "-m")) files.add(f);

const BAD_PATH = [
  [/^data\/private\//, "現地調査の生の記録（調査した人の呼び名などを含む）"],
  [/\.gpslog\.json$/, "GPS の記録（家の位置が分かる）"],
  [/(^|\/)\.env(?!\.example$)/, "鍵の入った設定ファイル"],
  [/\.pem$/, "鍵ファイル"],
];
// 公開データ（駅・施設の公式番号を含みうる）は中身を見ない
const PUBLIC_DATA = /^data\/(places|stations|indoor|raw)\//;
const BAD_TEXT = [
  // テストの見本「090-0000-0000」は通す
  [/(?<!\d)0[789]0-?(?!0000-?0000)\d{4}-?\d{4}(?!\d)/, "携帯電話の番号"],
  [/sk-ant-[A-Za-z0-9_-]{10,}/, "Anthropic の API キー"],
];

const problems = [];
for (const f of files) {
  for (const [re, why] of BAD_PATH) if (re.test(f)) problems.push(`${f}：${why}`);
  if (PUBLIC_DATA.test(f)) continue;
  let text;
  try {
    if (statSync(f).size > 2_000_000) continue;
    text = readFileSync(f, "utf8");
  } catch {
    continue; // 消したファイルなど
  }
  for (const [re, why] of BAD_TEXT) if (re.test(text)) problems.push(`${f}：${why}らしき文字列`);
}

if (problems.length) {
  console.error(
    "コミットを止めました。公開リポジトリに入れてはいけないものがあります：\n" +
      problems.map((p) => `- ${p}`).join("\n") +
      "\nこのファイルを外してからコミットしてください（必要なら利用者に確かめる）。",
  );
  process.exit(2);
}
