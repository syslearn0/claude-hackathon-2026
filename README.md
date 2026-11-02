# トイレ外出サポート（Built with Claude: Japan 2026）

急なトイレの不安がある人（クローン病・潰瘍性大腸炎・過敏性腸症候群など）の外出を、確かめた事実の情報で支える Web アプリ。開発中。

- 計画：[docs/plan.md](docs/plan.md)
- 今あるページ
  - `/now`：今すぐトイレ（近いトイレ・着替えられる多機能トイレ・替えを買える店・お願いカード）
  - `/tools/survey`：現地確認の記録（駅のトイレ、コンビニ・ドラッグストアの品ぞろえ）
  - `/tools/gps-log`：電車移動中のブラウザ位置情報の記録

## 動かし方

```bash
npm install
npm run dev
```

場所データの取り込み：`npm run fetch:osm`（`data/places/osm-*.json`、© OpenStreetMap contributors, ODbL 1.0）
テスト：`npm test`

記録は端末の localStorage にだけ保存し、書き出しで共有する。サーバーには送らない。
