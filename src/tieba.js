"use strict";

// Protocol: LuoSue/TiebaSignIn-1; multi-account/nickname flow: Sitoi/dailycheckin.
// Both are MIT licensed. See THIRD_PARTY_NOTICES.md.
const https = require("node:https");
const { createHash } = require("node:crypto");
const { parseAccounts } = require("./bilibili");
const { waitRandom } = require("./interval");

const BASE = "https://tieba.baidu.com";
const CLIENT = "https://c.tieba.baidu.com";
const CLIENT_FIELDS = { _client_type: "2", _client_version: "9.7.8.0", _phone_imei: "000000000000000", model: "MI+5", net_type: "1" };

class TiebaError extends Error {
  constructor(message, options = {}) { super(message); Object.assign(this, options); }
}
function describe(error) {
  if (error instanceof TiebaError) return error.message;
  if (error?.code === "ABORT_ERR") return "网络请求超时（ETIMEDOUT）";
  return /^[A-Z0-9_]{1,40}$/.test(error?.code || "") ? `网络请求失败（${error.code}）` : "请求异常，未输出原始响应以保护凭据";
}
function signed(data) {
  const value = Object.keys(data).sort().map(key => `${key}=${data[key]}`).join("");
  return { ...data, sign: createHash("md5").update(`${value}tiebaclient!!!`).digest("hex").toUpperCase() };
}
function requestJson(url, config, form) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== "https:" || !["tieba.baidu.com", "c.tieba.baidu.com", "zhidao.baidu.com"].includes(target.hostname)) {
      reject(new TiebaError("拒绝访问非百度接口")); return;
    }
    const body = form === undefined ? undefined : new URLSearchParams(form).toString();
    const request = https.request(target, {
      method: body === undefined ? "GET" : "POST", family: 4, signal: AbortSignal.timeout(20000),
      headers: { Cookie: config.cookie, Referer: `${BASE}/`, Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        ...(body === undefined ? {} : { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) }) },
    }, response => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume(); reject(new TiebaError(`接口返回 HTTP ${response.statusCode}`)); return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", chunk => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) response.destroy(new TiebaError("接口响应过大"));
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new TiebaError("接口返回非 JSON 内容，可能需要安全验证")); }
      });
    });
    request.on("error", reject);
    request.end(body); // Never retry an uncertain sign-in submission.
  });
}

function configure(account) {
  if (!account || typeof account !== "object") throw new TiebaError("账号必须是包含 cookie 或 bduss 的对象");
  if (typeof account.bduss === "string" && /[\r\n]/.test(account.bduss)) throw new TiebaError("bduss 不能包含换行符");
  let cookie = account.cookie;
  if (cookie === undefined && typeof account.bduss === "string") cookie = `BDUSS=${account.bduss.trim()}`;
  if (typeof cookie !== "string" || !cookie.trim() || /[\r\n]/.test(cookie)) throw new TiebaError("cookie 或 bduss 必须是没有换行符的字符串");
  const cookies = new Map(cookie.split(";").flatMap(part => {
    const index = part.indexOf("=");
    return index < 1 ? [] : [[part.slice(0, index).trim(), part.slice(index + 1).trim()]];
  }));
  const bduss = cookies.get("BDUSS");
  if (!bduss || /\s/.test(bduss)) throw new TiebaError("Cookie 缺少有效 BDUSS");
  if (account.bduss !== undefined && (typeof account.bduss !== "string" || account.bduss.trim() !== bduss)) {
    throw new TiebaError("bduss 与 Cookie 中的 BDUSS 不一致");
  }
  const name = typeof account.name === "string" ? account.name : "";
  return { cookie, bduss, name, secrets: [...cookies.values()] };
}

class TiebaClient {
  constructor(config, { request = requestJson, wait } = {}) { this.config = config; this.request = request; this.wait = wait; }

  text(value) {
    if (typeof value !== "string") return "";
    let text = value;
    for (const secret of this.config.secrets) if (secret.length >= 4) text = text.split(secret).join("[已隐藏]");
    return text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").trim().slice(0, 120);
  }

  checkError(result) {
    const message = [result?.error_msg, result?.errmsg].filter(value => typeof value === "string").join(" ");
    if (/未登录|请.*登录|BDUSS.*(?:失效|过期)|user not login/i.test(message)) {
      throw new TiebaError("登录已失效，请更新 Cookie 或 BDUSS", { auth: true });
    }
    if (result?.error_code !== undefined && String(result.error_code) !== "0") {
      const code = /^-?\d{1,12}$/.test(String(result.error_code)) ? `（代码 ${result.error_code}）` : "";
      throw new TiebaError(`接口拒绝请求${code}`);
    }
  }

  async login() {
    const result = await this.request(`${BASE}/dc/common/tbs`, this.config);
    if (![1, "1"].includes(result?.is_login)) throw new TiebaError("登录未成功，Cookie 或 BDUSS 可能已失效", { auth: true });
    if (typeof result.tbs !== "string" || !result.tbs.trim() || /\s/.test(result.tbs)) throw new TiebaError("未获取到有效 TBS，已停止签到");
    this.config.secrets.push(result.tbs);
    return result.tbs;
  }

  async nickname() {
    try {
      const result = await this.request("https://zhidao.baidu.com/api/loginInfo", this.config);
      return this.text(result?.userName) || this.text(this.config.name);
    } catch { return this.text(this.config.name); }
  }

  async forums() {
    const forums = new Map();
    for (let page = 1; page <= 100; page++) {
      if (page > 1) await waitRandom("贴吧列表翻页间隔", { min: 1, max: 3, wait: this.wait });
      const data = signed({ ...CLIENT_FIELDS, BDUSS: this.config.bduss, _client_id: "wappc_1534235498291_488",
        from: "1008621y", page_no: String(page), page_size: "200", timestamp: String(Math.floor(Date.now() / 1000)), vcode_tag: "11" });
      const result = await this.request(`${CLIENT}/c/f/forum/like`, this.config, data);
      this.checkError(result);
      if (!result?.forum_list || typeof result.forum_list !== "object" || Array.isArray(result.forum_list)) {
        throw new TiebaError("关注列表返回格式异常，未执行签到");
      }
      if (Object.keys(result.forum_list).length &&
          !Object.hasOwn(result.forum_list, "non-gconforum") && !Object.hasOwn(result.forum_list, "gconforum")) {
        throw new TiebaError("关注列表类型无法识别，未执行签到");
      }
      const previous = forums.size;
      for (const key of ["non-gconforum", "gconforum"]) {
        const group = result.forum_list[key];
        if (group === undefined || group === null) continue;
        const items = Array.isArray(group) ? group : [group];
        for (const item of items) {
          if (!item || !/^\d+$/.test(String(item.id ?? "")) || Number(item.id) <= 0 || typeof item.name !== "string" || !item.name.trim()) {
            throw new TiebaError("关注列表包含无效贴吧信息，未执行签到");
          }
          forums.set(String(item.id), { id: String(item.id), name: item.name });
        }
      }
      if ([0, "0", false].includes(result.has_more)) return [...forums.values()];
      if (![1, "1", true].includes(result.has_more)) throw new TiebaError("关注列表分页状态缺失，未执行签到");
      if (forums.size === previous) throw new TiebaError("关注列表分页重复，未执行签到");
    }
    throw new TiebaError("关注列表超过分页上限，未执行签到");
  }

  async sign(forum, tbs) {
    const result = await this.request(`${CLIENT}/c/c/forum/sign`, this.config, signed({ ...CLIENT_FIELDS,
      BDUSS: this.config.bduss, fid: forum.id, kw: forum.name, tbs, timestamp: String(Math.floor(Date.now() / 1000)) }));
    const code = String(result?.error_code);
    if (code === "0") {
      const rank = result.user_info?.user_sign_rank;
      const ranking = /^\d+$/.test(String(rank)) && Number(rank) > 0 ? `，第 ${rank} 个签到` : "";
      return { status: "success", message: `签到成功${ranking}` };
    }
    if (code === "160002") return { status: "exist", message: "今天已经签到过" };
    if (code === "340006") return { status: "shield", message: "跳过（贴吧已被屏蔽）" };
    this.checkError(result);
    throw new TiebaError("签到响应缺少有效结果");
  }

  async run() {
    const tbs = await this.login();
    const nickname = await this.nickname();
    let forums;
    try { forums = await this.forums(); }
    catch (error) { return { failed: true, nickname, lines: [`✅ 登录：成功`, `❌ 关注列表：失败（${describe(error)}）`] }; }
    const stats = { success: 0, exist: 0, shield: 0, error: 0 };
    const lines = ["✅ 登录：成功"];
    let expired = false;
    for (const [index, forum] of forums.entries()) {
      const label = this.text(forum.name) || "未命名贴吧";
      if (expired) { stats.error++; lines.push(`❌ ${label}：跳过（登录已失效）`); continue; }
      if (index) await waitRandom("贴吧签到间隔", { min: 1, max: 3, wait: this.wait });
      if (index && index % 10 === 0) await waitRandom("贴吧批次间隔", { min: 5, max: 10, wait: this.wait });
      try {
        const result = await this.sign(forum, tbs);
        stats[result.status]++;
        lines.push(`${result.status === "shield" ? "⏭️" : "✅"} ${label}：${result.message}`);
      } catch (error) {
        stats.error++;
        expired ||= Boolean(error.auth);
        lines.push(`❌ ${label}：失败（${describe(error)}）`);
      }
    }
    lines.splice(1, 0, `贴吧：${forums.length} 个｜成功：${stats.success} 个｜已签到：${stats.exist} 个｜屏蔽：${stats.shield} 个｜失败：${stats.error} 个`);
    if (!forums.length) lines.push("⏭️ 签到：跳过（未关注任何贴吧）");
    return { failed: stats.error > 0, nickname, lines };
  }
}

async function runTieba(raw, options = {}) {
  let accounts;
  try { accounts = parseAccounts(raw, { extraFields: ["bduss"] }); }
  catch (error) { throw new Error(error.message.replaceAll("BILI_ACCOUNTS", "TIEBA_ACCOUNTS").replace(',"coinCount":0', "")); }
  const outcomes = [];
  let failedAccounts = 0;
  for (const [index, account] of accounts.entries()) {
    if (index) await waitRandom("百度贴吧账号间隔", { wait: options.wait });
    let name = "";
    let result;
    try {
      const config = configure(account);
      const client = new TiebaClient(config, options);
      name = client.text(config.name);
      result = await client.run();
      name = result.nickname || name;
    } catch (error) { result = { failed: true, lines: [`❌ 执行：失败（${describe(error)}）`] }; }
    if (result.failed) failedAccounts++;
    outcomes.push(`\n账号 ${index + 1}${name ? `（${name}）` : ""}${result.failed ? "｜⚠️ 有失败任务" : ""}\n${result.lines.join("\n")}`);
    for (const line of result.lines) console.log(`百度贴吧 第 ${index + 1} 个账号 ${line}`);
  }
  outcomes.unshift(`账号：${accounts.length} 个｜无异常：${accounts.length - failedAccounts} 个｜异常：${failedAccounts} 个`);
  return { failed: failedAccounts > 0, outcomes };
}

module.exports = { runTieba, TiebaClient, TiebaError, configure, signed, requestJson };
