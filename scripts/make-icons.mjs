// アプリのアイコン（ホーム画面用）を作る。使い方：node scripts/make-icons.mjs
import sharp from "sharp";

// 青い角丸の四角に、白い「WC」。maskable 用は、文字を中央の安全な範囲（80%）に収める
const svg = (size, maskable) => {
  const pad = maskable ? 0 : size * 0.06;
  const r = maskable ? 0 : size * 0.22;
  const font = size * (maskable ? 0.3 : 0.36);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect x="${pad}" y="${pad}" width="${size - pad * 2}" height="${size - pad * 2}" rx="${r}" fill="#1f5fbf"/>
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${font}" fill="#ffffff">WC</text>
</svg>`;
};

for (const [name, size, maskable] of [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, true],
]) {
  await sharp(Buffer.from(svg(size, maskable))).png().toFile(`public/${name}`);
  console.log(name);
}
