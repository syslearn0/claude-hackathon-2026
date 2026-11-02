# トイレ外出サポート（Built with Claude: Japan 2026）

急なトイレの不安がある人（クローン病・潰瘍性大腸炎・過敏性腸症候群など）の外出を、確かめた事実の情報で支える Web アプリ。開発中。

- 計画：[docs/plan.md](docs/plan.md)
- 今あるページ
  - `/tools/survey`：現地確認の記録（駅のトイレ、コンビニ・ドラッグストアの品ぞろえ）
  - `/tools/gps-log`：電車移動中のブラウザ位置情報の記録

## 動かし方

```bash
npm install
npm run dev
```

記録は端末の localStorage にだけ保存し、書き出しで共有する。サーバーには送らない。
