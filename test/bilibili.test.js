"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runBilibili, configure, BilibiliClient, requestJson, parseAccounts } = require("../src/bilibili");
const { main } = require("../src/main");

const COOKIE = "SESSDATA=test-secret; bili_jct=test-csrf; DedeUserID=123";
const VIDEOS = ["BV1GJ411x7h7", "BV1xx411c7mD", "BV1000000000"];

test("Cookie 原始双引号自动识别，多账号的投币设置保持不变", () => {
  const raw = `[
    {"cookie":"${COOKIE}; device="browser one"; extra="a=b;c"","coinCount":2,"reserveCoins":5,"tasks":{"coin":true}},
    {"coinCount":0,"cookie":"${COOKIE}; device="browser two""}
  ]`;
  const accounts = parseAccounts(raw);
  assert.equal(accounts.length, 2);
  assert.equal(accounts[0].cookie, `${COOKIE}; device="browser one"; extra="a=b;c"`);
  assert.equal(accounts[0].coinCount, 2);
  assert.equal(accounts[0].reserveCoins, 5);
  assert.deepEqual(accounts[0].tasks, { coin: true });
  assert.equal(accounts[1].cookie, `${COOKIE}; device="browser two"`);
  assert.equal(configure(accounts[1]).coinCount, 0);
});

test("标准转义 Cookie 与原始双引号 Cookie 可同时使用", () => {
  const first = { cookie: `${COOKIE}; device="quoted"; path=one\\two`, coinCount: 3 };
  const raw = `[${JSON.stringify(first)},{"cookie":"${COOKIE}; device="raw"","coinCount":1}]`;
  const accounts = parseAccounts(raw);
  assert.deepEqual(accounts[0], first);
  assert.equal(accounts[1].cookie, `${COOKIE}; device="raw"`);
  assert.deepEqual(parseAccounts(JSON.stringify([first])), [first]);
});

test("其他格式错误及模糊 Cookie 边界仍报错，不吞掉投币配置", () => {
  for (const raw of [
    `[{"cookie":"${COOKIE}; device="raw"" "coinCount":"5"}]`,
    `[{"cookie":"${COOKIE}; device="raw"","coinCount":eval("5")}]`,
    `[{"cookie":"${COOKIE}; device="raw"\n"}]`,
  ]) assert.throws(() => parseAccounts(raw), /BILI_ACCOUNTS/);
});

test("粘贴 Cookie 兼容额外字段、原始反斜杠和各层末尾逗号", () => {
  const raw = '[{"cookie":"' + COOKIE + '; device="browser"; path=abc' + String.fromCharCode(92) + 'q","name":"账号一","coinCount":0,"tasks":{"coin":false,},},{"cookie":"' + COOKIE + '; device="two"",},]';
  const accounts = parseAccounts(raw);
  assert.equal(accounts.length, 2);
  assert.equal(accounts[0].cookie, COOKIE + '; device="browser"; path=abc' + String.fromCharCode(92) + 'q');
  assert.equal(configure(accounts[0]).coinCount, 0);
  assert.equal(configure(accounts[0]).tasks.coin, false);
  assert.equal(accounts[1].cookie, COOKIE + '; device="two"');
  assert.deepEqual(parseAccounts('\uFEFF```json\n' + raw + '\n```'), accounts);
});

test("格式错误只输出位置和建议，不泄露 Secret 内容", () => {
  const secret = "PRIVATE-COOKIE-VALUE";
  assert.throws(() => parseAccounts('[{"cookie":"' + secret + '","coinCount":oops}]'), error => {
    assert.match(error.message, /BILI_ACCOUNTS 格式错误/);
    assert.ok(!error.message.includes(secret));
    return true;
  });
});

test("Cookie 内嵌多层 JSON 和字符串数组不会被截断，多账号设置保持独立", () => {
  const embedded = 'bmg_af_sc={"none":{"on":1,"def":"i1.hdslb.com"},"sgp":{"on":1,"def":"i1-sgp.hdslb.com"}}; extra={"a":"x","b":"y"}; list=["a","b"]; tail=ok';
  const cookie = COOKIE + '; ' + embedded;
  const mixed = parseAccounts('[' + JSON.stringify({ cookie, coinCount: 3 }) + ',{"cookie":"' + cookie + '","coinCount":0}]');
  assert.equal(mixed[0].cookie, cookie);
  assert.equal(mixed[0].coinCount, 3);
  for (const suffix of ['', ',"coinCount":0,"tasks":{"coin":false}', ',"name":"备注","coinCount":2']) {
    const accounts = parseAccounts('[{"cookie":"' + cookie + '"' + suffix + '},{"cookie":"' + cookie + '","coinCount":0}]');
    assert.equal(accounts.length, 2);
    assert.equal(accounts[0].cookie, cookie);
    assert.equal(accounts[1].cookie, cookie);
    assert.equal(accounts[1].coinCount, 0);
    assert.equal(accounts[0].coinCount, suffix.includes('coinCount":2') ? 2 : suffix ? 0 : undefined);
  }
});

function backend(override) {
  const calls = [];
  const donated = new Set();
  let exp = 0;
  const request = async (url, cookie, form, context) => {
    const path = new URL(url).pathname;
    calls.push({ path, url, cookie, form, context });
    const custom = await override?.({ path, url, cookie, form, context });
    if (custom !== undefined) return custom;
    let data = null;
    if (path.endsWith("/nav")) data = { isLogin: true, money: 10 };
    else if (path.endsWith("/view")) {
      const bvid = new URL(url).searchParams.get("bvid");
      data = { aid: VIDEOS.indexOf(bvid) + 100, bvid, cid: 1000 };
    }
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
  const result = await runBilibili(JSON.stringify([{ cookie: COOKIE, coinCount: 6 }, { cookie: COOKIE, coinCount: 0 }]), { request: b.request, wait: async () => {} });
  assert.equal(result.failed, true);
  assert.match(result.outcomes[0], /账号：2 个｜无异常：1 个｜异常：1 个/);
  assert.match(result.outcomes[1], /账号 1｜❌ 执行失败/);
  assert.match(result.outcomes[1], /coinCount/);
  assert.match(result.outcomes[2], /^\n账号 2\n/);
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
  const code = await main({ wait: async () => {},
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
  assert.equal(await main({ wait: async () => {}, env: {}, notify: async () => assert.fail() }), 2);
  assert.equal(await main({ wait: async () => {}, env: { BILI_ACCOUNTS: "[]" },
    tianyi: async () => assert.fail(), bilibili: async () => ({ failed: false, outcomes: ["成功"] }),
    notify: async () => false }), 0);
});

test("分享和投币携带校验后的 aid 与视频页上下文，元数据只查询一次", async () => {
  const b = backend(({ path, form, context }) => {
    if (path.endsWith("/share/add") || path.endsWith("/coin/add")) {
      if (!form.aid || context?.referer !== `https://www.bilibili.com/video/${form.bvid}/`) {
        return { code: path.endsWith("/share/add") ? -403 : -401 };
      }
    }
  });
  const result = await new BilibiliClient(configure({ cookie: COOKIE, videoIds: [VIDEOS[0]] }), b.request).run();
  assert.equal(result.failed, false);
  assert.equal(b.donated.size, 1);
  assert.equal(b.calls.filter((call) => call.path.endsWith("/view")).length, 1);
  const status = b.calls.find((call) => call.path.endsWith("/archive/coins"));
  assert.equal(new URL(status.url).searchParams.get("aid"), "100");
  assert.equal(status.context.referer, `https://www.bilibili.com/video/${VIDEOS[0]}/`);
});

test("查询投币状态被拒绝时不提交，投币被拒绝时只提交一次", async () => {
  for (const rejected of ["/archive/coins", "/coin/add"]) {
    const b = backend(({ path }) => path.endsWith(rejected) ? { code: -401, message: COOKIE } : undefined);
    const result = await new BilibiliClient(configure({ cookie: COOKIE, videoIds: VIDEOS }), b.request).run();
    assert.equal(result.failed, true);
    assert.equal(b.calls.filter((call) => call.path.endsWith("/coin/add")).length, rejected === "/coin/add" ? 1 : 0);
    const text = result.outcomes.join("\n");
    assert.match(text, rejected === "/coin/add" ? /提交投币失败/ : /查询视频投币状态失败/);
    assert.match(text, /缺少设备字段 buvid3、buvid4、b_nut、_uuid/);
    assert.ok(!text.includes("test-secret") && !text.includes("test-csrf"));
    assert.match(text, /漫画签到：成功/);
  }
});

test("视频 aid 无效或不匹配时不发出分享与投币请求", async () => {
  for (const data of [{ aid: 0 }, { aid: 100, bvid: VIDEOS[1] }]) {
    const b = backend(({ path }) => path.endsWith("/view") ? { code: 0, data } : undefined);
    const result = await new BilibiliClient(configure({ cookie: COOKIE, videoIds: [VIDEOS[0]] }), b.request).run();
    assert.equal(result.failed, true);
    assert.ok(!b.calls.some((call) => call.path.endsWith("/share/add") || call.path.endsWith("/coin/add")));
  }
});

test("原生 HTTPS 请求保留完整 Cookie 并发送匹配的 Origin 和 Referer", async (t) => {
  const https = require("node:https");
  const { EventEmitter } = require("node:events");
  const { Readable } = require("node:stream");
  const requests = [];
  t.mock.method(https, "request", (url, options, callback) => {
    const request = new EventEmitter();
    request.end = (body) => {
      requests.push({ url, options, body });
      process.nextTick(() => {
        const response = Readable.from([Buffer.from('{"code":0,"data":{}}')]);
        response.statusCode = 200;
        callback(response);
      });
    };
    return request;
  });
  const fullCookie = `${COOKIE}; buvid3=browser3; buvid4=browser4; b_nut=123; _uuid=browser-uuid`;
  const referer = `https://www.bilibili.com/video/${VIDEOS[0]}/`;
  await requestJson("https://api.bilibili.com/x/web-interface/coin/add", fullCookie,
    { aid: "100", csrf: "test-csrf", multiply: "1" }, { referer });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.headers.Cookie, fullCookie);
  assert.equal(requests[0].options.headers.Origin, "https://www.bilibili.com");
  assert.equal(requests[0].options.headers.Referer, referer);
  assert.equal(requests[0].options.family, 4);
  assert.equal(new URLSearchParams(requests[0].body).get("aid"), "100");
  assert.deepEqual(configure({ cookie: fullCookie }).missingDeviceCookies, []);
});

test("推送在账号标题下展示任务后的等级经验与硬币余额", async () => {
  let navCalls = 0;
  const b = backend(({ path }) => {
    if (path.endsWith("/nav")) {
      navCalls++;
      return { code: 0, data: { isLogin: true, money: navCalls === 1 ? 10.5 : 9.5, uname: "测试昵称",
        level_info: { current_level: 5, current_exp: navCalls === 1 ? 23000 : 23010, next_exp: 28800 } } };
    }
  });
  const result = await runBilibili(JSON.stringify([{ cookie: COOKIE, coinCount: 1, videoIds: VIDEOS }]), { request: b.request, wait: async () => {} });
  assert.equal(result.failed, false);
  assert.equal(navCalls, 2);
  assert.match(result.outcomes[1], /^\n账号 1（测试昵称）\n等级 Lv\.5｜经验 23010\/28800｜硬币 9\.5\n/);
  assert.ok(!result.outcomes[1].includes("硬币 10.5"));
  assert.ok(!result.outcomes[1].includes("test-secret"));
});

test("刷新失败保留任务结果并标注旧快照，满级不展示无效升级目标", async () => {
  let navCalls = 0;
  const b = backend(({ path }) => {
    if (path.endsWith("/nav")) {
      if (++navCalls > 1) throw new Error(`network failure ${COOKIE}`);
      return { code: 0, data: { isLogin: true, money: 12.5, uname: "备用昵称\n",
        level_info: { current_level: 6, current_exp: 30000, next_exp: "--" } } };
    }
  });
  const result = await new BilibiliClient(configure({ cookie: COOKIE, coinCount: 0, videoIds: VIDEOS }), b.request).run();
  assert.equal(result.failed, false);
  assert.equal(result.nickname, "备用昵称");
  assert.match(result.accountInfo, /等级 Lv\.6｜经验 30000（已满级）｜硬币 12\.5（任务前快照，刷新失败）/);
  assert.ok(!result.accountInfo.includes("--") && !result.accountInfo.includes("test-secret"));
  assert.match(result.outcomes.join("\n"), /漫画签到：成功/);
});
