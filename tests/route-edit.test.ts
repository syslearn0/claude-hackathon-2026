import assert from "node:assert/strict";
import { test } from "node:test";
import { addMinutes, cleanRoute, routeProblems, shiftUpcoming } from "../src/lib/route-edit";

test("時刻を足す（日をまたいでも HH:MM のまま）", () => {
  assert.equal(addMinutes("08:55", 10), "09:05");
  assert.equal(addMinutes("23:58", 5), "00:03");
  assert.equal(addMinutes("00:02", -5), "23:57");
});

test("これからの時刻だけをずらす（もう過ぎた発着はそのまま）", () => {
  const r = [
    { station: "京都", dep: "08:03" },
    { station: "東京", arr: "10:15", dep: "10:24" },
    { station: "新宿", arr: "10:38" },
  ];
  assert.deepEqual(shiftUpcoming(r, 15, "10:00"), [
    { station: "京都", dep: "08:03" },
    { station: "東京", arr: "10:30", dep: "10:39" },
    { station: "新宿", arr: "10:53" },
  ]);
});

test("保存の前に整える：「駅」と空白を外し、空の駅と時刻でないものを捨てる", () => {
  assert.deepEqual(cleanRoute([{ station: " 丹波橋駅 ", line: " 京阪本線 ", dep: "08:10" }, { station: "" }, { station: "出町柳", arr: "8時" }]), [
    { station: "丹波橋", line: "京阪本線", dep: "08:10" },
    { station: "出町柳" },
  ]);
});

test("時刻の順がおかしいところを知らせる", () => {
  assert.deepEqual(routeProblems([{ station: "丹波橋", dep: "08:10" }, { station: "出町柳", arr: "08:30" }]), []);
  assert.equal(routeProblems([{ station: "丹波橋", dep: "08:30" }, { station: "出町柳", arr: "08:10" }]).length, 1);
  // 日をまたぐ（23:50 発 → 00:10 着）は、おかしくない
  assert.deepEqual(routeProblems([{ station: "A", dep: "23:50" }, { station: "B", arr: "00:10" }]), []);
});
