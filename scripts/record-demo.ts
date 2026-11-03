// デモ動画用に、スマホの大きさの画面を GPS を動かしながら録画する。同時に画面の状態を確かめる（end-to-end の簡易チェック）。
// 使い方：npx tsx scripts/record-demo.ts <train|shinjuku-enter|after|plan|all> [--base http://localhost:3000] [--headed]
// 先に dev サーバー（npm run dev）を起動しておく。ブラウザは入れず、入っている Edge（なければ Chrome）を使う。
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { loadStations } from "../src/lib/data";
import { distanceM, type LatLon } from "../src/lib/geo";
import { INDOOR_STATIONS } from "../src/lib/indoor";

// 録画には ffmpeg が要る。Playwright 専用のものをダウンロードせず、PC に入っている ffmpeg を demo/.pw に置いて使わせる
const PW_DIR = path.join(process.cwd(), "demo", ".pw");
async function prepareFfmpeg() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = PW_DIR;
  const dest = path.join(PW_DIR, "ffmpeg-1013", "ffmpeg-win64.exe"); // Playwright 1.64 が探す場所
  if (await stat(dest).then(() => true, () => false)) return;
  const found = execFileSync(process.platform === "win32" ? "where" : "which", ["ffmpeg"]).toString().split(/\r?\n/)[0].trim();
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(found.endsWith(".exe") || process.platform !== "win32" ? found : `${found}.exe`, dest);
}

const OUT = path.join(process.cwd(), "demo", "recordings");
const VIEWPORT = { width: 390, height: 844 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- GPS ----------

// 折れ線を時速 kmh で進みながら、1 秒ごとに位置を差し替える（アプリは受け取った時刻で速さを出すので実時間で動かす）
class Mover {
  private stopped = false;
  private done: Promise<void> = Promise.resolve();
  private cum: number[] = [0];
  constructor(private ctx: BrowserContext, private pts: LatLon[], private kmh: number, private acc = 10) {
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + distanceM(pts[i - 1], pts[i]));
  }
  at(d: number): LatLon {
    const total = this.cum.at(-1)!;
    if (d >= total) return this.pts.at(-1)!;
    const i = this.cum.findIndex((c) => c > d) - 1;
    const t = (d - this.cum[i]) / (this.cum[i + 1] - this.cum[i]);
    const a = this.pts[i];
    const b = this.pts[i + 1];
    return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
  }
  async set(p: LatLon) {
    await this.ctx.setGeolocation({ latitude: p.lat, longitude: p.lon, accuracy: this.acc });
  }
  start() {
    const t0 = Date.now();
    this.done = (async () => {
      for (let k = 0; !this.stopped; k++) {
        await this.set(this.at(((Date.now() - t0) / 1000) * (this.kmh / 3.6)));
        await sleep(Math.max(0, t0 + (k + 1) * 1000 - Date.now()));
      }
    })();
  }
  async stop() {
    this.stopped = true;
    await this.done;
  }
}

// 駅の位置はアプリと同じ読み方（同じ名前の駅は最初のもの）
async function stationPos(...names: string[]): Promise<LatLon[]> {
  const all = await loadStations();
  return names.map((n) => {
    const s = all.find((x) => x.name === n);
    if (!s) throw new Error(`駅のデータがありません：${n}`);
    return { lat: s.lat, lon: s.lon };
  });
}

// a から b へ向かう途中（0〜1）の点
const between = (a: LatLon, b: LatLon, t: number): LatLon => ({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t });
const metersNorth = (p: LatLon, m: number): LatLon => ({ lat: p.lat + m / 110_540, lon: p.lon });

// ---------- 画面の操作 ----------

// 文字が出るのを待つ。出たら true
async function seen(page: Page, text: string | RegExp, timeout = 30_000): Promise<boolean> {
  try {
    await page.getByText(text).first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

// ゆっくりスクロールして、読む時間を作る
async function scrollBy(page: Page, total: number, pxPerStep = 8, stepMs = 16) {
  for (let done = 0; done < Math.abs(total); done += pxPerStep) {
    await page.evaluate((d) => window.scrollBy(0, d), Math.sign(total) * pxPerStep);
    await sleep(stepMs);
  }
}
async function scrollThrough(page: Page, pauseMs = 1200) {
  for (let i = 0; i < 40; i++) {
    const atEnd = await page.evaluate(() => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4);
    if (atEnd) break;
    await scrollBy(page, 320);
    await sleep(pauseMs);
  }
}

async function tap(page: Page, locator: ReturnType<Page["getByRole"]>) {
  await locator.scrollIntoViewIfNeeded();
  await sleep(500);
  await locator.click();
}

// タップした場所に丸を出す（動画で押したところが分かるように）
const TAP_MARK = `addEventListener("DOMContentLoaded",()=>{const s=document.createElement("style");s.textContent="@keyframes tapmark{from{opacity:.55;transform:translate(-50%,-50%) scale(.4)}to{opacity:0;transform:translate(-50%,-50%) scale(1.6)}}";document.head.append(s);
addEventListener("pointerdown",e=>{const d=document.createElement("div");d.style.cssText="position:fixed;z-index:99999;pointer-events:none;width:44px;height:44px;border-radius:50%;background:#888;left:"+e.clientX+"px;top:"+e.clientY+"px;animation:tapmark .5s ease-out forwards";document.body.append(d);setTimeout(()=>d.remove(),600)},true)});`;

// ---------- シーン ----------

type Check = Record<string, boolean>;
type Ctx = { ctx: BrowserContext; page: Page; base: string };
type Scene = { init?: (c: BrowserContext) => Promise<void>; run: (c: Ctx) => Promise<Check> };

// 今日の計画をあらかじめ入れる（createdAt は画面側の「今日」で作る）
const seedPlan = (route: { station: string; line?: string }[], summary: string) =>
  `if(!localStorage.getItem("plan.today.v1"))localStorage.setItem("plan.today.v1",JSON.stringify({createdAt:new Date().toISOString(),note:"",conditions:[],answer:{summary:${JSON.stringify(summary)},steps:[],notes:[],route:${JSON.stringify(route)}},places:[]}));`;
const seedProfile = `if(!localStorage.getItem("profile.v1"))localStorage.setItem("profile.v1",JSON.stringify({toiletSide:"any"}));`;

const scenes: Record<string, Scene> = {};

// 1. 京阪の電車の中：七条〜祇園四条を北へ時速50km。「次の駅（推定）」と AI の見直しが出る
scenes.train = {
  async init(c) {
    const route = [
      { station: "丹波橋", line: "京阪本線" },
      { station: "七条", line: "京阪本線" },
      { station: "祇園四条", line: "京阪本線" },
      { station: "三条", line: "京阪本線" },
      { station: "出町柳" },
    ];
    await c.addInitScript(seedProfile + seedPlan(route, "丹波橋から京阪で出町柳へ（通学）"));
  },
  async run({ ctx, page, base }) {
    const [shichijo, gion, sanjo, demachi] = await stationPos("七条", "祇園四条", "三条", "出町柳");
    const start = between(shichijo, gion, 0.4);
    const mover = new Mover(ctx, [start, gion, sanjo, demachi], 50);
    await mover.set(start);
    mover.start();
    const t0 = Date.now();
    await page.goto(`${base}/now`);
    const check: Check = {};
    check["電車で移動中と推定しました"] = await seen(page, "電車で移動中と推定しました", 60_000);
    check["次の駅（推定）が祇園四条"] = await seen(page, /次の駅（推定）祇園四条駅/, 5_000);
    await sleep(3000);
    // 約40秒は動き続ける
    await sleep(Math.max(0, 40_000 - (Date.now() - t0)));
    await mover.stop();
    check["AI の見直しが届いた"] = await seen(page, /秒で届きました/, 60_000);
    await sleep(1500);
    await page.evaluate(() => document.querySelector("section.card")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    await sleep(2500);
    await scrollBy(page, 420);
    await sleep(3000);
    return check;
  },
};

scenes["shinjuku-enter"] = {
  async init(c) {
    await c.addInitScript(seedProfile);
  },
  async run({ ctx, page, base }) {
    const [s, w, n, e] = INDOOR_STATIONS["新宿"].bbox;
    // 範囲の少し南から、駅の中心へ北上。アプリの範囲に入るまで OUTSIDE_M だけ歩く（既定 120m、時速5km で約1分半）
    const outsideM = Number(process.env.OUTSIDE_M ?? 120);
    const lon = (w + e) / 2;
    const start = metersNorth({ lat: s, lon }, -outsideM);
    const mover = new Mover(ctx, [start, { lat: (s + n) / 2, lon }], 5);
    await mover.set(start);
    mover.start();
    await page.goto(`${base}/now`);
    const check: Check = {};
    await sleep(3000);
    check["新宿駅の範囲に入りました"] = await seen(page, "新宿駅の範囲に入りました", (outsideM / (5 / 3.6)) * 1000 + 40_000);
    await sleep(2500);
    await tap(page, page.getByRole("button", { name: "駅の中の地図を開く" }));
    check["駅の中の地図が出た"] = await seen(page, /駅の中の地図（試作）/, 10_000) && (await page.locator(".leaflet-container").first().isVisible());
    await sleep(3500);
    for (const label of ["B1", "2F"]) {
      const b = page.getByRole("button", { name: label, exact: true });
      const ok = (await b.count()) > 0;
      check[`階ボタン ${label}`] = ok;
      if (ok) {
        await tap(page, b);
        await sleep(3000);
      }
    }
    await mover.stop();
    await sleep(500);
    return check;
  },
};

scenes.after = {
  async init(c) {
    await c.addInitScript(seedProfile);
  },
  async run({ ctx, page, base }) {
    const [shinjuku] = await stationPos("新宿");
    const mover = new Mover(ctx, [shinjuku], 0);
    await mover.set(shinjuku);
    await page.goto(`${base}/now`);
    const check: Check = {};
    check["最初の候補が出た"] = await seen(page, /トイレ/, 30_000);
    await sleep(3000); // 見直しは通す（位置は動かないので 1 件）
    await tap(page, page.getByRole("button", { name: "トイレに入った（次どうする？）" }));
    await sleep(1500);
    await tap(page, page.getByRole("button", { name: "下着を汚した" }));
    await sleep(1200);
    await tap(page, page.getByRole("button", { name: "次の手順を出す" }));
    check["AI の手順が届いた"] = await seen(page, "AI が作った手順", 60_000);
    check["（簡易版にはならなかった）"] = (await page.getByText("AI を使わない簡易版").count()) === 0;
    await sleep(2500);
    await scrollThrough(page, 1800);
    await sleep(2000);
    return check;
  },
};

scenes.plan = {
  async init(c) {
    await c.addInitScript(seedProfile);
  },
  async run({ page, base }) {
    const note =
      "明日、京都から新宿に初めて行きます。\n京都 8:30発 → 東京 10:45着（東海道新幹線 のぞみ）\n東京 10:55発 → 新宿 11:10着（JR中央線快速）\n昼すぎに新宿駅の南口の近くで用事があります。";
    await page.goto(`${base}/plan`);
    const check: Check = {};
    const area = page.locator("textarea");
    await area.click();
    await area.pressSequentially(note, { delay: 12 });
    await sleep(1200);
    await tap(page, page.getByRole("button", { name: "今日は調子が悪い" }));
    await sleep(700);
    await tap(page, page.getByRole("button", { name: "替えを持っていない" }));
    await sleep(1200);
    await tap(page, page.getByRole("button", { name: "計画を作る" }));
    check["経路と車内の設備"] = await seen(page, "経路と車内の設備", 90_000);
    await sleep(2500);
    await page.evaluate(() => [...document.querySelectorAll("h2")].find((h) => h.textContent === "経路と車内の設備")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    await sleep(3500);
    await scrollThrough(page, 1800);
    await sleep(2000);
    return check;
  },
};

// ---------- 実行 ----------

async function launch(headed: boolean): Promise<Browser> {
  await prepareFfmpeg();
  const { chromium } = await import("playwright");
  try {
    return await chromium.launch({ channel: "msedge", headless: !headed });
  } catch (e) {
    console.warn(`Edge を起動できませんでした（${(e as Error).message.split("\n")[0]}）。Chrome を試します`);
    return await chromium.launch({ channel: "chrome", headless: !headed });
  }
}

async function record(browser: Browser, name: string, base: string): Promise<{ ok: boolean; file?: string }> {
  const scene = scenes[name];
  const dir = path.join(OUT, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    permissions: ["geolocation"],
    recordVideo: { dir, size: VIEWPORT },
  });
  await ctx.addInitScript(TAP_MARK);
  await scene.init?.(ctx);
  const page = await ctx.newPage();
  const video = page.video();
  let check: Check = {};
  let error = "";
  try {
    check = await scene.run({ ctx, page, base });
  } catch (e) {
    error = (e as Error).message.split("\n")[0];
  }
  await ctx.close();
  const file = path.join(OUT, `${name}.webm`);
  if (video) {
    await rename(await video.path(), file).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
  const ok = !error && Object.values(check).every(Boolean);
  console.log(`\n[${name}] ${ok ? "OK" : "NG"}`);
  for (const [k, v] of Object.entries(check)) console.log(`  ${v ? "o" : "x"} ${k}`);
  if (error) console.log(`  ! エラー：${error}`);
  const size = await stat(file).then((s) => `${(s.size / 1024 / 1024).toFixed(1)} MB`).catch(() => "（動画なし）");
  console.log(`  動画：${path.relative(process.cwd(), file)} ${size}`);
  return { ok, file };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const base = (opt("--base") ?? "http://localhost:3000").replace(/\/$/, "");
  const target = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--base");
  const order = ["train", "shinjuku-enter", "after", "plan"];
  const names = target === "all" ? order : target && scenes[target] ? [target] : [];
  if (!names.length) {
    console.error(`使い方：npx tsx scripts/record-demo.ts <${order.join("|")}|all> [--base URL] [--headed]`);
    process.exit(2);
  }
  const browser = await launch(args.includes("--headed"));
  let failed = 0;
  try {
    for (const n of names) if (!(await record(browser, n, base)).ok) failed++;
  } finally {
    await browser.close();
  }
  console.log(failed ? `\n${failed} 件のシーンで、期待した状態になりませんでした` : "\nすべてのシーンで期待した状態になりました");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
