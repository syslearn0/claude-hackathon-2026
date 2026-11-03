// サービスワーカー：電波がなくても「今すぐトイレ」が開けるように、画面と場所データを端末に持っておく。
// ・画面（HTML）：まず通信、2.5秒で返らなければ持っている版（地下で電波が弱いとき待たせない）
// ・場所データ：持っている版をすぐ返し、裏で新しくする（データはめったに変わらない）
// ・/_next/static：ファイル名が中身ごとに変わるので、持っていればそれを使う
// ・AI への問い合わせ（POST）や地図のタイル（別のサイト）には触らない
// 開発中（?dev=1）は通知だけ扱い、何も持たない（作り直した画面が古いまま出ないように）

const DEV = new URL(self.location.href).searchParams.has("dev");
const CACHE = "toilet-v2"; // 持つものを変えたら上げる（古い入れ物は消える）
const PAGES = ["/", "/now", "/me", "/plan", "/about"];
const DATA = ["/api/places", "/api/indoor?station=shinjuku", "/api/indoor?station=tokyo"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  if (DEV) return;
  // 1つ失敗しても残りは持っておく
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all([...PAGES, ...DATA].map((u) => c.add(u).catch(() => {})))));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

// 画面が読み込んだファイル（JS・CSS）の一覧を受け取って持っておく。初めて開いた回は、まだサービスワーカーが働いていないため
self.addEventListener("message", (e) => {
  if (DEV || e.data?.type !== "cache-urls") return;
  const urls = (e.data.urls ?? []).filter((u) => new URL(u, self.location.origin).origin === self.location.origin);
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(urls.map((u) => c.match(u).then((hit) => hit || c.add(u).catch(() => {}))))));
});

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));

async function networkFirst(req, key) {
  const c = await caches.open(CACHE);
  try {
    const res = await Promise.race([fetch(req), timeout(2500)]);
    if (res.ok) c.put(key, res.clone());
    return res;
  } catch {
    return (await c.match(key)) ?? (await c.match("/now")) ?? Response.error();
  }
}

async function staleWhileRevalidate(e, req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok) c.put(req, res.clone());
      return res;
    })
    .catch(() => undefined);
  if (hit) {
    e.waitUntil(fresh);
    return hit;
  }
  return (await fresh) ?? Response.error();
}

async function cacheFirst(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) c.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (e) => {
  if (DEV) return;
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (req.mode === "navigate") return e.respondWith(networkFirst(req, url.pathname));
  if (url.pathname === "/api/places" || url.pathname === "/api/indoor") return e.respondWith(staleWhileRevalidate(e, req));
  if (url.pathname.startsWith("/_next/static/")) return e.respondWith(cacheFirst(req));
  if (/\.(png|ico|webmanifest)$/.test(url.pathname) || url.pathname === "/manifest.webmanifest") return e.respondWith(staleWhileRevalidate(e, req));
});

// 通知を押したら：開いている画面があればそこで駅の中の地図を開き、なければ新しく開く
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url ?? "/now";
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const now = wins.find((w) => new URL(w.url).pathname === "/now");
      if (now) {
        await now.focus();
        now.postMessage({ type: "open-indoor", url });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
