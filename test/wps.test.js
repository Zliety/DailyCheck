"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, privateDecrypt, createDecipheriv, constants } = require("node:crypto");
const { runWps, WpsClient, WpsError, configure, encryptSign, signDate, requestJson } = require("../src/wps");
const { main } = require("../src/main");

const COOKIE = "uid=123456; wps_sid=private-session; act_csrf_token=private-csrf";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PUBLIC_KEY = Buffer.from(publicKey.export({ type: "spki", format: "pem" })).toString("base64");
const noWait = async () => {};
const tasksOff = Object.fromEntries(["centerSign", "centerLottery", "freeMember", "memberTrial", "dailyLottery", "reward"].map(key => [key, false]));
const ok = data => ({ result: "ok", data });

function backend(override = () => {}) {
  const calls = [];
  const state = { signed: false, joined: false, received: false, points: 100, centerDraws: 0, dailyDraws: 0 };
  const item = (type, number, extra) => ({ type, number, component_node_id: `node-${number}`, ...extra });
  const page = center => center ? [
    item(36, "points", { task_center_user_info: { integral: state.points, advent_integral: 10 } }),
    item(45, "center", { lottery_v2: { lottery_list: [{ session_status: "IN_PROGRESS", stock_status: "IN_STOCK", times: 3 - state.centerDraws, session_id: "center-session" }] } }),
  ] : [
    item(42, "member", { server_time: 1792684800, fragment_collect: { sign_series_id: state.received ? "" : "series", sign_records: [
      ...Array.from({ length: 6 }, (_, index) => ({ sign_date: `2026-10-${17 + index}`, sign_status: "signed" })),
      { sign_date: "2026-10-23", sign_status: state.signed ? "signed" : "unsigned" },
    ] } }),
    item(32, "trial", { divide_prize: { remain_times: 1, join_reach_limit: false, divide_prize_details: [
      { title: "会员试用", cycle_id: "cycle", session_id: "trial-session", stock: 5, has_join: state.joined },
    ] } }),
    item(45, "daily", { lottery_v2: { lottery_list: [{ session_status: "IN_PROGRESS", stock_status: "IN_STOCK", times: 7 - state.dailyDraws, session_id: "daily-session" }] } }),
  ];
  const request = async (url, config, body, headers) => {
    const parsed = new URL(url);
    const call = { url, path: parsed.pathname, config, body, headers };
    calls.push(call);
    const response = await override(call, state);
    if (response !== undefined) return response;
    if (call.path.endsWith("/encrypt/key")) return ok(PUBLIC_KEY);
    if (call.path.endsWith("/sign_in")) { state.points += 5; return ok({ rewards: [{ reward_name: "5积分" }] }); }
    if (call.path.endsWith("/market/activity")) return ok({ entries: [{ title: "福利中心", link: "https://personal-act.wps.cn/rubik2/portal/HDtest/YMtest?position=pc_nvc_activity_fuli&mk_key=test" }] });
    if (call.path.endsWith("/page_info")) return ok(page(parsed.searchParams.get("activity_number") !== "HDtest"));
    if (call.path.endsWith("/component_action")) {
      assert.equal(headers["x-act-csrf-token"], "private-csrf");
      const key = body.component_action.split(".")[0];
      if (body.component_action === "fragment_collect.sign_in") state.signed = true;
      if (body.component_action === "fragment_collect.receive") state.received = true;
      if (body.component_action === "divide_prize.sign_up") state.joined = true;
      if (key === "lottery_v2") {
        if (body.lottery_v2.session_id === "center-session") state.centerDraws++;
        else state.dailyDraws++;
      }
      return ok({ [key]: { success: true, reward_name: key === "lottery_v2" ? "抽奖奖品" : "会员奖励" } });
    }
    assert.fail(`unexpected route ${call.path}`);
  };
  return { calls, state, request, wait: noWait };
}

// Decode PKCS#1 padding manually because newer Node versions disable private
// PKCS#1 decryption. This checks the actual RSA/AES wire format with no server.
function decryptSign(body, token) {
  const padded = privateDecrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, Buffer.from(token, "base64"));
  assert.equal(padded[0], 0); assert.equal(padded[1], 2);
  const key = padded.subarray(padded.indexOf(0, 2) + 1);
  assert.equal(key.length, 32);
  const cipher = createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(body.extra, "base64")), cipher.final()]));
}

test("WPS 签到加密符合 RSA PKCS1 + AES256 CBC 协议，携带正确用户与平台", () => {
  const value = encryptSign(PUBLIC_KEY, 123456);
  assert.deepEqual(decryptSign(value, value.token), { user_id: 123456, platform: 64 });
  assert.notEqual(encryptSign(PUBLIC_KEY, 123456).extra, value.extra);
});

test("WPS 六项任务、积分查询与请求上下文，抽奖和申请严格遵守上限", async () => {
  const b = backend();
  const result = await runWps(JSON.stringify([{ name: "我的WPS", cookie: COOKIE, maxLottery: 1 }]), b);
  assert.equal(result.failed, false);
  assert.equal(result.outcomes[0], "账号：1 个｜无异常：1 个｜异常：0 个");
  assert.match(result.outcomes[1], /账号 1（我的WPS）/);
  for (const label of ["任务中心签到", "任务中心抽奖", "打卡领会员", "会员免费试用", "天天抽奖", "七天奖励", "账号积分"]) {
    assert.match(result.outcomes[1], new RegExp(`✅ ${label}：`));
  }
  assert.match(result.outcomes[1], /积分 105｜即将过期 10/);
  assert.equal(b.state.centerDraws, 1); assert.equal(b.state.dailyDraws, 1);
  assert.equal(b.state.joined, true); assert.equal(b.state.signed, true); assert.equal(b.state.received, true);
  const sign = b.calls.find(call => call.path.endsWith("/sign_in"));
  assert.equal(sign.body.encrypt, true);
  assert.deepEqual(decryptSign(sign.body, sign.headers.token), { user_id: 123456, platform: 64 });
  assert.equal(sign.body.pay_origin, "pc_ucs_rwzx_sign");
  const mutations = b.calls.filter(call => call.path.endsWith("/component_action"));
  assert.ok(mutations.findIndex(call => call.body.component_action === "fragment_collect.receive") >
    mutations.findIndex(call => call.body.lottery_v2?.session_id === "daily-session"));
  for (const call of mutations) {
    assert.match(call.headers.Referer, /^https:\/\/personal-act.wps.cn\/rubik2\/portal\//);
    assert.ok(call.body.component_uniq_number.component_node_id);
    assert.equal(call.body.component_type, { fragment_collect: 42, divide_prize: 32, lottery_v2: 45 }[call.body.component_action.split(".")[0]]);
  }
  assert.deepEqual(mutations.find(call => call.body.divide_prize).body.component_uniq_number.filter_params, {});
  const market = b.calls.filter(call => call.path.endsWith("/market/activity"));
  assert.equal(market[0].body.channel_code, "AUTOPCHYZXYYHD3737");
  assert.ok(!result.outcomes.join("\n").includes("private-session"));
  assert.ok(!result.outcomes.join("\n").includes("private-csrf"));
});

test("已签到、已申请、无次数及任务关闭不重复提交", async () => {
  const b = backend((call, state) => {
    state.signed = true; state.received = true; state.joined = true; state.centerDraws = 3; state.dailyDraws = 7;
    if (call.path.endsWith("/sign_in")) return { result: "error", msg: "has sign" };
  });
  const result = await runWps(JSON.stringify([{ cookie: COOKIE }]), b);
  assert.equal(result.failed, false);
  assert.match(result.outcomes[1], /任务中心签到：今天已经签到过/);
  assert.match(result.outcomes[1], /打卡领会员：今天已经签到过/);
  assert.ok(!b.calls.some(call => call.path.endsWith("/component_action")));
  const disabled = backend();
  const output = await runWps(JSON.stringify([{ cookie: COOKIE, tasks: tasksOff }]), disabled);
  assert.equal(output.failed, false);
  assert.match(output.outcomes[1], /⚪ 未启用：/);
  assert.ok(disabled.calls.every(call => call.path.endsWith("/page_info")));
});

test("投递超时不重试，保留部分成功数并继续其他 WPS 任务", async () => {
  let draws = 0;
  const b = backend(call => {
    if (call.body?.lottery_v2?.session_id === "center-session" && ++draws === 2) {
      throw Object.assign(new Error(COOKIE), { code: "ETIMEDOUT" });
    }
  });
  const result = await runWps(JSON.stringify([{ cookie: COOKIE, maxLottery: 3 }]), b);
  assert.equal(result.failed, true);
  assert.equal(draws, 2);
  assert.match(result.outcomes[1], /已成功抽奖 1 次.*ETIMEDOUT.*不自动重试/);
  assert.match(result.outcomes[1], /✅ 打卡领会员：成功/);
  assert.ok(!result.outcomes.join("\n").includes("private-session"));
});

test("签到或试用超时均只提交一次，其他任务照常执行", async () => {
  for (const type of ["sign_in", "divide_prize.sign_up"]) {
    const b = backend(call => {
      if ((type === "sign_in" && call.path.endsWith("/sign_in")) || call.body?.component_action === type) {
        throw Object.assign(new Error(COOKIE), { code: "ETIMEDOUT" });
      }
    });
    const result = await runWps(JSON.stringify([{ cookie: COOKIE }]), b);
    assert.equal(result.failed, true);
    assert.equal(b.calls.filter(call => type === "sign_in" ? call.path.endsWith("/sign_in") : call.body?.component_action === type).length, 1);
    assert.match(result.outcomes[1], /✅ 天天抽奖：/);
  }
});

test("登录失效停止该账号后续请求，后续账号独立运行", async () => {
  const b = backend(call => call.config.userId === 111111 ? { result: "error", code: 2000000, ext_msg: "userNotLogin", msg: COOKIE } : undefined);
  const result = await runWps(JSON.stringify([
    { cookie: COOKIE.replace("123456", "111111") }, { cookie: COOKIE, maxLottery: 0, maxTrials: 0 },
  ]), b);
  assert.equal(result.failed, true);
  assert.equal(result.outcomes[0], "账号：2 个｜无异常：1 个｜异常：1 个");
  assert.equal(b.calls.filter(call => call.config.userId === 111111).length, 1);
  assert.match(result.outcomes[1], /登录已失效/);
  assert.match(result.outcomes[2], /任务中心签到：成功/);
  assert.ok(!result.outcomes.join("\n").includes("private-session"));
});

test("配置错误在请求前阻止执行，可自动从完整 Cookie 提取 uid", async () => {
  assert.equal(configure({ cookie: COOKIE }).userId, 123456);
  assert.equal(configure({ cookie: COOKIE.replace("uid=123456; ", ""), userId: 123456 }).userId, 123456);
  for (const account of [{ cookie: "uid=123456" }, { cookie: COOKIE, userId: 999999 }, { cookie: COOKIE, maxLottery: -1 },
    { cookie: COOKIE, maxTrials: 20 }, { cookie: COOKIE, tasks: { unknown: true } }, { cookie: COOKIE, tasks: { reward: "false" } },
    { cookie: COOKIE + "\r\n" }, { cookie: COOKIE, userAgent: "foo\nbar" }]) {
    assert.throws(() => configure(account));
  }
  const b = backend();
  const result = await runWps(JSON.stringify([{ cookie: COOKIE, maxLottery: "2" }, { cookie: COOKIE, tasks: tasksOff }]), b);
  assert.equal(result.failed, true);
  assert.equal(b.calls.length, 1);
  await assert.rejects(runWps("oops", b), /WPS_ACCOUNTS/);
  await assert.rejects(runWps('[{"cookie":"' + COOKIE + '; extra="raw"" "maxLottery":0}]', b), /WPS_ACCOUNTS/);
  const raw = '[{"cookie":"' + COOKIE + '; prefs={"name":"browser","setting":"value"}","maxLottery":0,"tasks":' + JSON.stringify(tasksOff) + '}]';
  assert.equal((await runWps(raw, backend())).failed, false);
});

test("福利入口跨渠道回退，拒绝非官方链接；缺少活动正常跳过", async () => {
  const b = backend(call => {
    if (call.path.endsWith("/market/activity")) return ok({ link: "https://evil.example/rubik2/portal/HDx/YMx?position=pc_nvc_activity_fuli" });
  });
  const result = await runWps(JSON.stringify([{ cookie: COOKIE }]), b);
  assert.equal(result.failed, false);
  assert.match(result.outcomes[1], /⏭️ 打卡领会员：未找到福利中心活动入口/);
  assert.ok(!b.calls.some(call => call.url.includes("evil.example")));
  const fallback = backend(call => {
    if (call.body?.channel_code === "AUTOPCHYZXYYHD3737") throw Object.assign(new Error("down"), { code: "ETIMEDOUT" });
  });
  const output = await runWps(JSON.stringify([{ cookie: COOKIE }]), fallback);
  assert.equal(output.failed, false);
  assert.match(output.outcomes[1], /✅ 打卡领会员：成功/);
});

test("服务端时间按北京时间计算；仅明确旧周期失效才重新开始", async () => {
  assert.equal(signDate({ server_time: Date.UTC(2026, 9, 22, 17) / 1000 }), "2026-10-23");
  assert.equal(signDate({ server_time: Date.UTC(2026, 9, 22, 17) }), "2026-10-23");
  let signs = 0;
  const b = backend(call => {
    if (call.body?.component_action === "fragment_collect.sign_in" && ++signs === 1) {
      return ok({ fragment_collect: { success: false, reason: "not in series records" } });
    }
  });
  const result = await runWps(JSON.stringify([{ cookie: COOKIE }]), b);
  assert.equal(result.failed, false); assert.equal(signs, 2);
  const requests = b.calls.filter(call => call.body?.component_action === "fragment_collect.sign_in");
  assert.equal(requests[1].body.fragment_collect.is_new_sign_series, true);
  assert.equal(requests[1].body.fragment_collect.sign_date, "");
});

test("CSRF 缺失不发起活动提交，仍保留任务中心签到和积分结果", async () => {
  const b = backend();
  const result = await runWps(JSON.stringify([{ cookie: "uid=123456; wps_sid=private-session" }]), b);
  assert.equal(result.failed, true);
  assert.ok(!b.calls.some(call => call.path.endsWith("/component_action")));
  assert.match(result.outcomes[1], /任务中心签到：成功/);
  assert.match(result.outcomes[1], /Cookie 缺少 act_csrf_token 或 csrf/);
});

test("WPS 和现有两个平台合并推送一次，失败独立且支持只配置 WPS", async () => {
  let sent = 0;
  const result = await main({ wait: async () => {}, env: { TY_ACCOUNTS: "ty", BILI_ACCOUNTS: "bili", WPS_ACCOUNTS: "wps" },
    tianyi: async () => { throw new Error("TY_ACCOUNTS 格式错误"); },
    bilibili: async () => ({ failed: false, outcomes: ["B站结果"] }),
    wps: async () => ({ failed: false, outcomes: ["WPS结果"] }),
    notify: async (title, body) => { sent++; assert.equal(title, "每日签到结果"); assert.match(body, /【天翼云盘】.*\n.*TY_ACCOUNTS/); assert.match(body, /【B站】\nB站结果/); assert.match(body, /【WPS】\nWPS结果/); return false; },
  });
  assert.equal(result, 1); assert.equal(sent, 1);
  assert.equal(await main({ wait: async () => {}, env: { WPS_ACCOUNTS: "wps" }, wps: async () => ({ failed: false, outcomes: ["成功"] }),
    tianyi: async () => assert.fail(), bilibili: async () => assert.fail(), notify: async () => false }), 0);
});

test("原生 WPS 请求保留完整 Cookie、JSON 请求体及 CSRF，禁用重定向", async t => {
  const https = require("node:https");
  const { EventEmitter } = require("node:events");
  const { Readable } = require("node:stream");
  const calls = [];
  t.mock.method(https, "request", (url, options, callback) => {
    const request = new EventEmitter();
    request.end = body => {
      calls.push({ url, options, body });
      process.nextTick(() => {
        const response = Readable.from([Buffer.from('{"result":"ok","data":{}}')]);
        response.statusCode = 200; callback(response);
      });
    };
    return request;
  });
  const config = configure({ cookie: COOKIE });
  await requestJson("https://personal-act.wps.cn/activity-rubik/activity/component_action", config, { test: "值" }, { "x-act-csrf-token": config.csrf });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.family, 4);
  assert.equal(calls[0].options.headers.Cookie, COOKIE);
  assert.equal(calls[0].options.headers.Origin, "https://personal-act.wps.cn");
  assert.equal(calls[0].options.headers["x-act-csrf-token"], "private-csrf");
  assert.deepEqual(JSON.parse(calls[0].body), { test: "值" });
  await assert.rejects(requestJson("https://example.com", config), /非 WPS/);
  assert.equal(calls.length, 1);
});


test("七天奖励按去重的实际签到记录判断，与抽奖剩余次数无关", async () => {
  for (const [signedDays, times, expectedClaims] of [[1, 7, 0], [6, 7, 0], [7, 0, 1], [7, 2, 1]]) {
    const b = backend(call => {
      if (call.path.endsWith("/page_info") && new URL(call.url).searchParams.get("activity_number") === "HDtest") {
        return ok([
          { type: 42, number: "member", component_node_id: "node", fragment_collect: { sign_series_id: "series", sign_records:
            Array.from({ length: signedDays }, (_, i) => ({ sign_date: `2026-10-${17 + i}`, sign_status: "signed" })) } },
          { type: 45, lottery_v2: { lottery_list: [{ session_status: "IN_PROGRESS", times }] } },
        ]);
      }
    });
    const result = await runWps(JSON.stringify([{ cookie: COOKIE, tasks: { ...tasksOff, reward: true } }]), b);
    assert.equal(result.failed, false);
    assert.equal(b.calls.filter(call => call.body?.component_action === "fragment_collect.receive").length, expectedClaims);
  }
});

test("旧周期奖励先领取，随后开启新打卡；同一轮只领取一次", async () => {
  const b = backend(call => {
    if (call.path.endsWith("/page_info") && new URL(call.url).searchParams.get("activity_number") === "HDtest") {
      return ok([{ type: 42, number: "member", component_node_id: "node", server_time: 1792684800,
        fragment_collect: { sign_series_id: b.state.received ? "" : "old-series", sign_records: b.state.received ? [] :
          Array.from({ length: 7 }, (_, i) => ({ sign_date: `2026-10-${16 + i}`, sign_status: "signed" })) } }]);
    }
  });
  const result = await runWps(JSON.stringify([{ cookie: COOKIE, tasks: { ...tasksOff, freeMember: true, reward: true } }]), b);
  assert.equal(result.failed, false);
  const actions = b.calls.filter(call => call.body?.component_action).map(call => call.body.component_action);
  assert.deepEqual(actions, ["fragment_collect.receive", "fragment_collect.sign_in"]);
  assert.equal((result.outcomes[1].match(/七天奖励：/g) || []).length, 1);
});

test("七天奖励领取超时后不重复提交，仍保留失败状态", async () => {
  const b = backend(call => {
    if (call.body?.component_action === "fragment_collect.receive") throw Object.assign(new Error(COOKIE), { code: "ETIMEDOUT" });
  });
  b.state.signed = true;
  const result = await runWps(JSON.stringify([{ cookie: COOKIE }]), b);
  assert.equal(result.failed, true);
  assert.equal(b.calls.filter(call => call.body?.component_action === "fragment_collect.receive").length, 1);
  assert.match(result.outcomes[1], /七天奖励：失败.*ETIMEDOUT/);
  assert.match(result.outcomes[1], /保留当前打卡周期/);
  assert.ok(!b.calls.some(call => call.body?.component_action === "fragment_collect.sign_in"));
});

test("次数与库存的数字字符串正常处理，null 上限拒绝执行", async () => {
  const b = backend();
  const request = b.request;
  b.request = async (...args) => {
    const response = await request(...args);
    if (Array.isArray(response.data)) for (const item of response.data) {
      if (item.divide_prize) {
        item.divide_prize.remain_times = "1";
        for (const detail of item.divide_prize.divide_prize_details) detail.stock = "5";
      }
      if (item.lottery_v2) for (const session of item.lottery_v2.lottery_list) session.times = String(session.times);
    }
    return response;
  };
  const result = await runWps(JSON.stringify([{ cookie: COOKIE, maxLottery: 1 }]), b);
  assert.equal(result.failed, false);
  assert.equal(b.state.centerDraws, 1); assert.equal(b.state.dailyDraws, 1); assert.equal(b.state.joined, true);
  assert.throws(() => configure({ cookie: COOKIE, maxLottery: null }), /maxLottery/);
  assert.throws(() => configure({ cookie: COOKIE, maxTrials: null }), /maxTrials/);
});

test("积分查询和核心签到接口不存在时报告失败，不作为活动下线跳过", async () => {
  for (const route of ["/encrypt/key", "/page_info"]) {
    const b = backend(call => {
      if (call.path.endsWith(route)) throw new WpsError("接口返回 HTTP 404", { unavailable: true });
    });
    const result = await runWps(JSON.stringify([{ cookie: COOKIE, tasks: { ...tasksOff, centerSign: true } }]), b);
    assert.equal(result.failed, true);
    assert.match(result.outcomes[1], route === "/page_info" ? /❌ 账号积分：失败/ : /❌ 任务中心签到：失败/);
  }
});

test("未知字母错误码不会泄露凭据，领奖接口兼容 lottery_v2 结果", async () => {
  const client = new WpsClient(configure({ cookie: COOKIE }), { wait: noWait,
    request: async () => ({ result: "error", code: "private-session", msg: COOKIE }) });
  await assert.rejects(client.sign(), error => !error.message.includes("private-session"));
  const b = backend(call => call.body?.component_action === "fragment_collect.receive"
    ? ok({ lottery_v2: { success: true, reward_name: "七天会员" } }) : undefined);
  const result = await runWps(JSON.stringify([{ cookie: COOKIE }]), b);
  assert.equal(result.failed, false);
  assert.match(result.outcomes[1], /七天奖励：领取成功：七天会员/);
});


test("部分入口查询失败且未找到活动时报告失败，不能假定活动不存在", async () => {
  const b = backend(call => {
    if (call.body?.channel_code === "AUTOPCHYZXYYHD3737") return ok({});
    if (call.body?.channel_code === "HYGW5004,GWHD5002") throw Object.assign(new Error(COOKIE), { code: "ETIMEDOUT" });
  });
  const result = await runWps(JSON.stringify([{ cookie: COOKIE, tasks: { ...tasksOff, freeMember: true } }]), b);
  assert.equal(result.failed, true);
  assert.match(result.outcomes[1], /❌ 打卡领会员：失败.*ETIMEDOUT/);
});
