"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { runTieba, configure, signed, requestJson } = require("../src/tieba");
const { main } = require("../src/main");
const COOKIE = "BDUSS=private-bduss==; STOKEN=private-stoken; BAIDUID=browser-id";
const noWait = async () => {};

function backend(override = () => {}) {
  const calls = [];
  const waits = [];
  const request = async (url, config, form) => {
    const path = new URL(url).pathname;
    const call = { url, path, config, form };
    calls.push(call);
    const custom = await override(call);
    if (custom !== undefined) return custom;
    if (path === "/dc/common/tbs") return { is_login: 1, tbs: "private-tbs" };
    if (path === "/api/loginInfo") return { userName: "贴吧昵称" };
    if (path === "/c/f/forum/like") return { error_code: "0", has_more: "0", forum_list: {
      "non-gconforum": [{ id: "101", name: "测试吧一" }, { id: "102", name: "测试吧二" }],
      gconforum: { id: "103", name: "测试吧三" },
    } };
    if (path === "/c/c/forum/sign") {
      if (form.fid === "101") return { error_code: "0", user_info: { user_sign_rank: "12" } };
      if (form.fid === "102") return { error_code: 160002 };
      if (form.fid === "103") return { error_code: "340006" };
      return { error_code: 0 };
    }
    assert.fail(`unexpected path ${path}`);
  };
  return { request, wait: async ms => { waits.push(ms); }, calls, waits };
}

test("贴吧移动端 MD5 签名与独立协议样例一致", () => {
  assert.equal(signed({ kw: "测试吧", tbs: "tbs", fid: "123", BDUSS: "test" }).sign, "1819CB27380496F11FAB0B13309ACE75");
});

test("贴吧昵称、三种正常结果、摘要和移动端请求字段正确且不泄露凭据", async () => {
  const b = backend();
  const result = await runTieba(JSON.stringify([{ cookie: COOKIE }]), b);
  assert.equal(result.failed, false);
  assert.equal(result.outcomes[0], "账号：1 个｜无异常：1 个｜异常：0 个");
  const text = result.outcomes[1];
  assert.match(text, /账号 1（贴吧昵称）/);
  assert.match(text, /贴吧：3 个｜成功：1 个｜已签到：1 个｜屏蔽：1 个｜失败：0 个/);
  assert.match(text, /✅ 测试吧一：签到成功，第 12 个签到/);
  assert.match(text, /✅ 测试吧二：今天已经签到过/);
  assert.match(text, /⏭️ 测试吧三：跳过（贴吧已被屏蔽）/);
  assert.equal(b.waits.length, 2);
  assert.ok(b.waits.every(ms => ms >= 1000 && ms <= 3000));
  for (const call of b.calls.filter(call => call.form)) {
    assert.equal(call.form.BDUSS, "private-bduss==");
    assert.equal(call.form._client_type, "2");
    assert.equal(call.form._client_version, "9.7.8.0");
    assert.match(call.form.sign, /^[0-9A-F]{32}$/);
    if (call.path.endsWith("/sign")) assert.equal(call.form.tbs, "private-tbs");
    assert.ok(call.url.startsWith("https://"));
  }
  for (const secret of ["private-bduss", "private-stoken", "private-tbs"]) assert.ok(!text.includes(secret));
});

test("关注列表分页和两类贴吧对象/数组合并去重，全部读取后才签到", async () => {
  const b = backend(call => {
    if (call.path.endsWith("/like")) return call.form.page_no === "1"
      ? { error_code: "0", has_more: 1, forum_list: { "non-gconforum": [{ id: "101", name: "测试吧一" }] } }
      : { error_code: 0, has_more: "0", forum_list: { "non-gconforum": { id: "101", name: "测试吧一" }, gconforum: [{ id: 104, name: "第四吧" }] } };
  });
  const result = await runTieba(JSON.stringify([{ bduss: "private-bduss==" }]), b);
  assert.equal(result.failed, false);
  assert.match(result.outcomes[1], /贴吧：2 个｜成功：2 个/);
  assert.equal(b.calls.filter(call => call.path.endsWith("/sign")).length, 2);
  const paths = b.calls.map(call => call.path);
  assert.ok(paths.lastIndexOf("/c/f/forum/like") < paths.indexOf("/c/c/forum/sign"));
});

test("分页失败、异常响应或重复页均报告失败，不签到或伪报零贴吧成功", async () => {
  for (const response of [
    { error_code: "4", error_msg: COOKIE },
    { error_code: "0" },
    { error_code: "0", has_more: "0", forum_list: { gconforum: [{ id: "", name: "invalid" }] } },
    { error_code: "0", has_more: "1", forum_list: { gconforum: [{ id: "101", name: "重复吧" }] } },
    { error_code: "0", forum_list: {} },
  ]) {
    const b = backend(call => call.path.endsWith("/like") ? response : undefined);
    const result = await runTieba(JSON.stringify([{ cookie: COOKIE }]), b);
    assert.equal(result.failed, true);
    assert.match(result.outcomes[1], /❌ 关注列表：失败/);
    assert.ok(!b.calls.some(call => call.path.endsWith("/sign")));
    assert.ok(!result.outcomes.join("\n").includes("private-bduss"));
  }
  const b = backend(call => {
    if (call.path.endsWith("/like") && call.form.page_no === "1") return { error_code: "0", has_more: "1", forum_list: { gconforum: { id: "101", name: "第一页吧" } } };
    if (call.path.endsWith("/like")) throw Object.assign(new Error(COOKIE), { code: "ETIMEDOUT" });
  });
  assert.equal((await runTieba(JSON.stringify([{ cookie: COOKIE }]), b)).failed, true);
  assert.ok(!b.calls.some(call => call.path.endsWith("/sign")));
});

test("没有关注贴吧明确跳过，昵称获取失败使用备注且不影响签到", async () => {
  const b = backend(call => {
    if (call.path === "/api/loginInfo") throw new Error(COOKIE);
    if (call.path.endsWith("/like")) return { error_code: "0", has_more: "0", forum_list: {} };
  });
  const result = await runTieba(JSON.stringify([{ cookie: COOKIE, name: "备用账号" }]), b);
  assert.equal(result.failed, false);
  assert.match(result.outcomes[1], /账号 1（备用账号）/);
  assert.match(result.outcomes[1], /未关注任何贴吧/);
  assert.ok(!b.calls.some(call => call.path.endsWith("/sign")));
});

test("登录失败不读取列表或签到，多账号独立执行并保留随机账号间隔", async () => {
  const b = backend(call => call.config.bduss === "expired" ? { is_login: 0 } : undefined);
  const result = await runTieba(JSON.stringify([{ bduss: "expired" }, { cookie: COOKIE }]), b);
  assert.equal(result.failed, true);
  assert.equal(result.outcomes[0], "账号：2 个｜无异常：1 个｜异常：1 个");
  assert.equal(b.calls.filter(call => call.config.bduss === "expired").length, 1);
  assert.match(result.outcomes[2], /账号 2（贴吧昵称）/);
  assert.ok(b.waits.some(ms => ms >= 5000 && ms <= 15000));
});

test("签到超时不重复提交，其他贴吧继续签到；原始异常与服务端内容不泄露", async () => {
  for (const failure of ["timeout", "server"]) {
    const b = backend(call => {
      if (call.path.endsWith("/sign") && call.form.fid === "101") {
        if (failure === "timeout") throw Object.assign(new Error(COOKIE), { code: "ETIMEDOUT" });
        return { error_code: "9999", error_msg: COOKIE };
      }
    });
    const result = await runTieba(JSON.stringify([{ cookie: COOKIE }]), b);
    assert.equal(result.failed, true);
    assert.match(result.outcomes[1], /失败：1 个/);
    assert.equal(b.calls.filter(call => call.path.endsWith("/sign") && call.form.fid === "101").length, 1);
    assert.equal(b.calls.filter(call => call.path.endsWith("/sign")).length, 3);
    assert.ok(!result.outcomes.join("\n").includes("private-bduss"));
  }
});

test("签到接口明确登录失效时停止本账号剩余提交并统计未完成数量", async () => {
  const b = backend(call => call.path.endsWith("/sign") ? { error_code: "4", error_msg: "请重新登录" } : undefined);
  const result = await runTieba(JSON.stringify([{ cookie: COOKIE }]), b);
  assert.equal(result.failed, true);
  assert.match(result.outcomes[1], /失败：3 个/);
  assert.equal(b.calls.filter(call => call.path.endsWith("/sign")).length, 1);
});

test("Cookie 自动提取 BDUSS，支持等号；无效配置在网络请求前拒绝", async () => {
  assert.equal(configure({ cookie: COOKIE }).bduss, "private-bduss==");
  assert.equal(configure({ bduss: "private-bduss==" }).cookie, "BDUSS=private-bduss==");
  for (const account of [null, { cookie: "foo=bar" }, { bduss: "" }, { bduss: "foo\r\n" },
    { cookie: COOKIE + "\n" }, { cookie: COOKIE, bduss: "other" }]) assert.throws(() => configure(account));
  await assert.rejects(runTieba("not json"), /TIEBA_ACCOUNTS/);
  await assert.rejects(runTieba("[]"), /TIEBA_ACCOUNTS/);
  const b = backend();
  const raw = '[{"cookie":"' + COOKIE + '; prefs={"name":"browser","setting":"value"}"}]';
  assert.equal((await runTieba(raw, b)).failed, false);
});

test("贴吧昵称和贴吧名称中的凭据及换行经过过滤", async () => {
  const b = backend(call => {
    if (call.path === "/api/loginInfo") return { userName: "昵称\nprivate-bduss==" };
    if (call.path.endsWith("/like")) return { error_code: 0, has_more: 0, forum_list: { gconforum: { id: "101", name: "贴吧\nprivate-tbs" } } };
  });
  const result = await runTieba(JSON.stringify([{ cookie: COOKIE }]), b);
  assert.match(result.outcomes[1], /账号 1（昵称 \[已隐藏\]）/);
  assert.match(result.outcomes[1], /✅ 贴吧 \[已隐藏\]：/);
  assert.ok(!result.outcomes[1].includes("private-bduss"));
});

test("四个平台合并推送一次，贴吧错误独立处理，未配置时不调用", async () => {
  const sections = [];
  const runner = name => async () => { sections.push(name); return { failed: false, outcomes: [name] }; };
  let notifications = 0;
  const code = await main({ env: { TY_ACCOUNTS: "ty", BILI_ACCOUNTS: "bili", WPS_ACCOUNTS: "wps", TIEBA_ACCOUNTS: "tieba" },
    wait: noWait, tianyi: runner("天翼云盘"), bilibili: runner("B站"), wps: runner("WPS"),
    tieba: async () => { sections.push("百度贴吧"); throw new Error("TIEBA_ACCOUNTS 格式错误"); },
    notify: async (title, body) => { notifications++; assert.equal(title, "每日签到结果"); assert.match(body, /【百度贴吧】\nTIEBA_ACCOUNTS 格式错误/); return false; },
  });
  assert.equal(code, 1); assert.equal(notifications, 1);
  assert.deepEqual(sections, ["天翼云盘", "B站", "WPS", "百度贴吧"]);
  assert.equal(await main({ env: { TIEBA_ACCOUNTS: "tieba" }, wait: noWait, tieba: runner("贴吧"), notify: async () => false }), 0);
  assert.equal(await main({ env: { WPS_ACCOUNTS: "wps" }, wait: noWait, wps: runner("WPS"), tieba: async () => assert.fail(), notify: async () => false }), 0);
});

test("原生请求仅使用百度 HTTPS，完整 Cookie 与表单编码正确，拒绝重定向", async t => {
  const https = require("node:https");
  const { EventEmitter } = require("node:events");
  const { Readable } = require("node:stream");
  const calls = [];
  let status = 200;
  t.mock.method(https, "request", (url, options, callback) => {
    const request = new EventEmitter();
    request.end = body => {
      calls.push({ url, options, body });
      process.nextTick(() => {
        const response = Readable.from([Buffer.from('{"error_code":"0"}')]);
        response.statusCode = status; callback(response);
      });
    };
    return request;
  });
  const config = configure({ cookie: COOKIE });
  await requestJson("https://c.tieba.baidu.com/c/c/forum/sign", config, { kw: "测试吧", BDUSS: config.bduss });
  assert.equal(calls[0].options.headers.Cookie, COOKIE);
  assert.equal(calls[0].options.family, 4);
  assert.equal(new URLSearchParams(calls[0].body).get("BDUSS"), "private-bduss==");
  assert.equal(new URLSearchParams(calls[0].body).get("kw"), "测试吧");
  await assert.rejects(requestJson("http://tieba.baidu.com", config), /非百度接口/);
  await assert.rejects(requestJson("https://example.com", config), /非百度接口/);
  status = 302;
  await assert.rejects(requestJson("https://tieba.baidu.com/dc/common/tbs", config), /HTTP 302/);
  assert.equal(calls.length, 2);
});
