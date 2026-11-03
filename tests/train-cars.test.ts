import assert from "node:assert/strict";
import { test } from "node:test";
import { describeTrainCars, findTrainCars } from "../src/lib/train-cars";

test("路線名の書き方が違っても引ける", () => {
  assert.equal(findTrainCars("JR中央線快速")?.line, "中央線快速");
  assert.equal(findTrainCars("東海道新幹線")?.line, "東海道・山陽新幹線");
  assert.equal(findTrainCars("京阪本線")?.line, "京阪本線");
});

test("似た別の路線とは取り違えない", () => {
  assert.equal(findTrainCars("中央・総武線各駅停車"), undefined);
  assert.equal(findTrainCars("東北新幹線"), undefined);
  assert.equal(findTrainCars("京阪京津線"), undefined);
  assert.equal(findTrainCars(""), undefined);
});

test("画面の一文：トイレの号車・多機能・弱冷房車、未確認の印", () => {
  assert.match(describeTrainCars("東海道新幹線")!, /トイレ：1号車・3号車.*多機能トイレ：11号車/);
  assert.doesNotMatch(describeTrainCars("東海道新幹線")!, /弱冷房/); // 出典で確かめられないので出さない
  assert.match(describeTrainCars("丸ノ内線")!, /弱冷房車なし.*公式資料で未確認/);
  assert.match(describeTrainCars("JR中央線快速")!, /トイレ：4号車・6号車.*公式資料で未確認/);
  assert.match(describeTrainCars("山手線")!, /車内トイレなし/);
  assert.match(describeTrainCars("京阪本線")!, /弱冷房車：2号車/);
});
