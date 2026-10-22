"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { waitRandom } = require("../src/interval");
const { main } = require("../src/main");

test("账号和平台随机间隔在指定整数秒范围内，并等待完成", async () => {
  for (const [min, max] of [[5, 15], [10, 30]]) {
    let waited = false;
    await waitRandom("测试间隔", { min, max, wait: async milliseconds => {
      assert.equal(milliseconds % 1000, 0);
      assert.ok(milliseconds >= min * 1000 && milliseconds <= max * 1000);
      waited = true;
    } });
    assert.equal(waited, true);
  }
});

test("平台切换前等待，前一平台失败仍有间隔，首尾无额外等待", async () => {
  const events = [];
  const code = await main({
    env: { TY_ACCOUNTS: "ty", BILI_ACCOUNTS: "bili", WPS_ACCOUNTS: "wps" },
    wait: async ms => { assert.ok(ms >= 10000 && ms <= 30000); events.push("wait"); },
    tianyi: async () => { events.push("ty"); throw new Error("test"); },
    bilibili: async () => { events.push("bili"); return { failed: false, outcomes: [] }; },
    wps: async () => { events.push("wps"); return { failed: false, outcomes: [] }; },
    notify: async () => { events.push("notify"); return false; },
  });
  assert.equal(code, 1);
  assert.deepEqual(events, ["ty", "wait", "bili", "wait", "wps", "notify"]);
});
