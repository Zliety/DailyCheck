"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runBilibili, configure, BilibiliClient } = require("../src/bilibili");
const { main } = require("../src/main");

const COOKIE = "SESSDATA=test-secret; bili_jct=test-csrf; DedeUserID=123";
const VIDEOS = ["BV1GJ411x7h7", "BV1xx411c7mD", "BV1000000000"];

function backend(override) {
  const calls = [];
  const donated = new Set();
  let exp = 0;
  const request = async (url, cookie, form) => {
    const path = new URL(url).pathname;
    calls.push({ path, url, cookie, form });
    const custom = await override?.({ path, url, cookie, form });
    if (custom !== undefined) return custom;
    let data = null;
    if (path.endsWith("/nav")) data = { isLogin: true, money: 10 };
    else if (path.endsWith("/today/exp")) data = exp;
    else if (path.endsWith("/archive/coins")) data = { multiply: donated.has(new URL(url).searchParams.get("bvid")) ? 1 : 0 };
    else if (path.endsWith("/coin/add")) { donated.add(form.bvid); exp += 10; }
    else if (path.endsWith("/feed/all")) data = { items: [] };
    else if (path.endsWith("/ranking/v2")) data = { list: VIDEOS.map((bvid) => ({ bvid })) };
    return { code: 0, data };
  };
  return { calls, request, donated };
}

test("五项任务执行，投币设置生效，重跑不重复扣币", async () => {
  const b = backend(({ path }) => path.endsWith("/DoSign") ? { code: 1011040, message: "已签到" } : undefined);
  const client = new BilibiliClient(configure({ cookie: COOKIE, coinCount: 2, reserveCoins: 8, videoIds: VIDEOS }), b.request);
  const first = await client.run();
  assert.equal(first.failed, false);
  assert.equal(first.outcomes.length, 6);
  assert.match(first.outcomes.join("\n"), /今天已经签到过/);
  assert.equal(b.donated.size, 2);
  const mutations = b.calls.filter((call) => call.path.endsWith("/coin/add"));
  assert.equal(mutations.length, 2);
  assert.ok(mutations.every(({ form }) => form.multiply === "1" && form.select_like === "0" && form.csrf === "test-csrf"));
  const second = await client.run();
  assert.match(second.outcomes.join("\n"), /今日已达到配置的投币目标/);
  assert.equal(b.calls.filter((call) => call.path.endsWith("/coin/add")).length, 2);
});

test("单项失败不阻止其他任务，已下线接口明确跳过", async () => {
  const b = backend(({ path }) => {
    if (path.endsWith("/heartbeat")) return { code: -403, message: "secret-cookie-should-not-be-logged" };
    if (path.endsWith("/DoSign")) return { code: 1, message: "活动已结束" };
  });
  const result = await new BilibiliClient(configure({ cookie: COOKIE, videoIds: VIDEOS }), b.request).run();
  assert.equal(result.failed, true);
  const message = result.outcomes.join("\n");
  assert.match(message, /观看视频：失败/);
  assert.match(message, /直播签到：跳过/);
  assert.match(message, /漫画签到：成功/);
  assert.ok(!message.includes("secret-cookie"));
  assert.equal(b.donated.size, 1);
});

test("投币请求超时后不重试，并保留部分成功数", async () => {
  let coinCalls = 0;
  const b = backend(({ path }) => {
    if (path.endsWith("/coin/add") && ++coinCalls === 2) {
      throw Object.assign(new Error(`timeout ${COOKIE}`), { code: "ETIMEDOUT" });
    }
  });
  const result = await new BilibiliClient(configure({ cookie: COOKIE, coinCount: 3, videoIds: VIDEOS }), b.request).run();
  assert.equal(result.failed, true);
  assert.equal(coinCalls, 2);
  assert.match(result.outcomes.join("\n"), /已成功投 1 枚.*ETIMEDOUT.*不自动重试/);
  assert.ok(!result.outcomes.join("\n").includes("test-secret"));
  assert.match(result.outcomes.join("\n"), /漫画签到：成功/);
});

test("不确定当天投币量时不扣币，保留余额和任务关闭生效", async () => {
  const bad = backend(({ path }) => path.endsWith("/today/exp") ? { code: 0, data: "unknown" } : undefined);
  const first = await new BilibiliClient(configure({ cookie: COOKIE, videoIds: VIDEOS }), bad.request).run();
  assert.equal(first.failed, true);
  assert.equal(bad.donated.size, 0);
  const b = backend();
  const c = configure({ cookie: COOKIE, coinCount: 5, reserveCoins: 10, tasks: { share: false, watch: false, live: false, manga: false } });
  const second = await new BilibiliClient(c, b.request).run();
  assert.equal(second.failed, false);
  assert.equal(b.donated.size, 0);
  assert.match(second.outcomes.join("\n"), /保留余额/);
  assert.ok(!b.calls.some((call) => call.form));
});

test("同一 JSON 多账号独立执行，坏账号不影响后续账号", async () => {
  const b = backend();
  const result = await runBilibili(JSON.stringify([{ cookie: COOKIE, coinCount: 6 }, { cookie: COOKIE, coinCount: 0 }]), { request: b.request });
  assert.equal(result.failed, true);
  assert.match(result.outcomes[0], /账号：2 个｜无异常：1 个｜异常：1 个/);
  assert.match(result.outcomes[1], /账号 1｜❌ 执行失败/);
  assert.match(result.outcomes[1], /coinCount/);
  assert.match(result.outcomes[2], /账号 2｜✅ 无异常/);
  assert.match(result.outcomes[2], /✅ 漫画签到：成功/);
  assert.match(result.outcomes[2], /⚪ 未启用：视频投币/);
  assert.ok(!result.outcomes[2].includes("第 2 个账号"));
  assert.equal(b.donated.size, 0);
  await assert.rejects(runBilibili("not json"), /BILI_ACCOUNTS/);
  assert.throws(() => configure({ cookie: `${COOKIE}\r\nInjected: value` }));
  assert.throws(() => configure({ cookie: COOKIE, tasks: { typo: true } }));
});

test("动态无视频回退排行榜，指定视频不调用选片接口", async () => {
  const b = backend();
  const client = new BilibiliClient(configure({ cookie: COOKIE }), b.request);
  assert.deepEqual(await client.videos(), VIDEOS);
  assert.equal(b.calls.length, 2);
  const selected = new BilibiliClient(configure({ cookie: COOKIE, videoIds: [VIDEOS[0]] }), b.request);
  assert.deepEqual(await selected.videos(), [VIDEOS[0]]);
  assert.equal(b.calls.length, 2);
});

test("两个平台独立执行，只统一推送一次；单平台配置也可用", async () => {
  let notified = 0;
  let ranBili = false;
  const code = await main({
    env: { TY_ACCOUNTS: "bad json", BILI_ACCOUNTS: "[]" },
    tianyi: async () => { throw new Error("TY_ACCOUNTS 不是有效的 JSON 数组。"); },
    bilibili: async () => { ranBili = true; return { failed: false, outcomes: ["第 1 个账号 视频投币：成功投 1 枚"] }; },
    notify: async (title, content) => {
      notified++;
      assert.equal(title, "每日签到结果");
      assert.match(content, /【天翼云盘】/);
      assert.match(content, /【B站】/);
      return false;
    },
  });
  assert.equal(code, 1);
  assert.equal(ranBili, true);
  assert.equal(notified, 1);
  assert.equal(await main({ env: {}, notify: async () => assert.fail() }), 2);
  assert.equal(await main({ env: { BILI_ACCOUNTS: "[]" },
    tianyi: async () => assert.fail(), bilibili: async () => ({ failed: false, outcomes: ["成功"] }),
    notify: async () => false }), 0);
});
