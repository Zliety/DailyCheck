"use strict";

// WPS protocol adapted from Cat-zaizai/ZaiZaiCat-Checkin (MIT).
// See THIRD_PARTY_NOTICES.md for attribution and license.
const https = require("node:https");
const { randomBytes, createCipheriv, publicEncrypt, constants } = require("node:crypto");
const { setTimeout: sleep } = require("node:timers/promises");
const { parseAccounts } = require("./bilibili");

const ACT = "https://personal-act.wps.cn";
const BUS = "https://personal-bus.wps.cn/sign_in/v1";
const PAGE = `${ACT}/activity-rubik/activity/page_info`;
const ACTION = `${ACT}/activity-rubik/activity/component_action`;
const CENTER = {
  activity_number: "HD2025031821201822", page_number: "YM2025041617143388",
  filter_params: { cs_from: "", mk_key: "JkVKsOtv4aCLMdNdAKwUGoz9tfKeFZVKyjEe", position: "mac_grzx_sign" },
};
const TASKS = { centerSign: true, freeMember: true, memberTrial: true, centerLottery: true, dailyLottery: true, reward: true };
const LABELS = { centerSign: "任务中心签到", freeMember: "打卡领会员", memberTrial: "会员免费试用",
  centerLottery: "任务中心抽奖", dailyLottery: "天天抽奖", reward: "七天奖励" };

class WpsError extends Error {
  constructor(message, options = {}) { super(message); Object.assign(this, options); }
}

function describe(error) {
  if (error instanceof WpsError) return error.message;
  if (error?.code === "ABORT_ERR") return "网络请求超时（ETIMEDOUT）";
  return /^[A-Z0-9_]{1,40}$/.test(error?.code || "") ? `网络请求失败（${error.code}）` : "请求异常，未输出原始响应以保护凭据";
}

function requestJson(url, config, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (!["personal-act.wps.cn", "personal-bus.wps.cn", "tiance.wps.cn"].includes(target.hostname) || target.protocol !== "https:") {
      reject(new WpsError("拒绝访问非 WPS 接口")); return;
    }
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = https.request(target, {
      method: payload === undefined ? "GET" : "POST", family: 4, signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": config.userAgent, Cookie: config.cookie, Origin: ACT, Referer: `${ACT}/`,
        Accept: "application/json", ...extraHeaders,
        ...(payload === undefined ? {} : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }) },
    }, response => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new WpsError(`接口返回 HTTP ${response.statusCode}`, { unavailable: [404, 410].includes(response.statusCode) })); return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", chunk => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) response.destroy(new WpsError("接口响应过大"));
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new WpsError("接口返回非 JSON 内容，可能需要重新登录或安全验证")); }
      });
    });
    request.on("error", reject);
    request.end(payload); // No mutation retries, including lotteries and trial applications.
  });
}

function configure(account) {
  if (!account || typeof account.cookie !== "string" || !account.cookie.trim() || /[\r\n]/.test(account.cookie)) {
    throw new WpsError("cookie 必须是没有换行符的完整 Cookie 字符串");
  }
  const cookies = new Map(account.cookie.split(";").flatMap(part => {
    const index = part.indexOf("=");
    return index < 1 ? [] : [[part.slice(0, index).trim(), part.slice(index + 1).trim()]];
  }));
  if (!cookies.get("wps_sid")) throw new WpsError("cookie 缺少 wps_sid");
  const userId = String(account.userId ?? cookies.get("uid") ?? "");
  if (!/^\d+$/.test(userId) || !Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) {
    throw new WpsError("Cookie 缺少有效 uid，请填写 userId 或复制包含 uid 的完整 Cookie");
  }
  if (account.userId !== undefined && cookies.has("uid") && String(account.userId) !== cookies.get("uid")) {
    throw new WpsError("userId 与 Cookie 中的 uid 不一致");
  }
  const tasks = { ...TASKS };
  if (account.tasks !== undefined && (!account.tasks || typeof account.tasks !== "object" || Array.isArray(account.tasks))) {
    throw new WpsError("tasks 必须是任务开关对象");
  }
  for (const [key, value] of Object.entries(account.tasks || {})) {
    if (!Object.hasOwn(tasks, key) || typeof value !== "boolean") throw new WpsError("tasks 包含未知任务或非布尔开关");
    tasks[key] = value;
  }
  const maxLottery = account.maxLottery ?? 2;
  const maxTrials = account.maxTrials ?? 1;
  for (const [key, value] of Object.entries({ maxLottery, maxTrials })) {
    if (!Number.isInteger(value) || value < 0 || value > 10) throw new WpsError(`${key} 必须是 0～10 的整数`);
  }
  const userAgent = account.userAgent ?? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";
  if (typeof userAgent !== "string" || !userAgent.trim() || /[\r\n]/.test(userAgent)) throw new WpsError("userAgent 必须是没有换行符的字符串");
  const name = typeof account.name === "string" ? account.name.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").trim().slice(0, 64) : "";
  return { cookie: account.cookie, userId: Number(userId), csrf: cookies.get("act_csrf_token") || cookies.get("csrf"),
    tasks, maxLottery, maxTrials, name, userAgent };
}

function encryptSign(publicKeyBase64, userId) {
  const pem = Buffer.from(publicKeyBase64, "base64").toString("utf8");
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const prefix = [...randomBytes(22)].map(value => alphabet[value % alphabet.length]).join("");
  const key = Buffer.from(prefix + Math.floor(Date.now() / 1000));
  const cipher = createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  const extra = Buffer.concat([cipher.update(JSON.stringify({ user_id: userId, platform: 64 })), cipher.final()]).toString("base64");
  const token = publicEncrypt({ key: pem, padding: constants.RSA_PKCS1_PADDING }, key).toString("base64");
  return { token, extra };
}

function portalLink(portal) {
  return `${ACT}/rubik2/portal/${portal.activity_number}/${portal.page_number}?${new URLSearchParams(portal.filter_params)}`;
}
function count(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
function dateInChina(value = Date.now()) { return new Date(value + 8 * 3600000).toISOString().slice(0, 10); }
function signDate(item) {
  const time = Number(item.server_time);
  return dateInChina(Number.isFinite(time) && time > 0 ? time > 1e12 ? time : time * 1000 : Date.now());
}

class WpsClient {
  constructor(config, { request = requestJson, wait = sleep } = {}) {
    this.config = config; this.request = request; this.wait = wait;
  }

  async api(url, body, headers) {
    const result = await this.request(url, this.config, body, headers);
    if (result?.result === "ok") return result.data;
    const text = [result?.msg, result?.message, result?.ext_msg, result?.error].filter(value => typeof value === "string").join(" ");
    if (/ErrNotLogin|userNotLogin|未登录|请.*登录|Token.*过期/i.test(text)) throw new WpsError("登录已失效，请更新完整 Cookie", { auth: true });
    if (/^has sign$|已经签到|已签到|重复签到/i.test(text.trim())) throw new WpsError("今天已经签到过", { duplicate: true });
    if (/活动.*(?:结束|下线)|停止服务/.test(text)) throw new WpsError("活动已结束或下线", { unavailable: true });
    const code = /^[\w-]{1,32}$/.test(String(result?.code ?? "")) ? `（代码 ${result.code}）` : "";
    throw new WpsError(`接口拒绝请求${code}`);
  }

  async page(portal) {
    const query = new URLSearchParams({ activity_number: portal.activity_number, page_number: portal.page_number,
      filter_params: JSON.stringify(portal.filter_params) });
    const data = await this.api(`${PAGE}?${query}`, undefined, { Referer: portalLink(portal) });
    if (!Array.isArray(data)) throw new WpsError("活动页面返回格式异常");
    return data.filter(item => item && typeof item === "object");
  }

  async sign() {
    const key = await this.api(`${BUS}/encrypt/key`);
    if (typeof key !== "string" || !key) throw new WpsError("签到公钥返回格式异常");
    const { token, extra } = encryptSign(key, this.config.userId);
    const data = await this.api(`${BUS}/sign_in`, { encrypt: true, extra, pay_origin: "pc_ucs_rwzx_sign" }, { token });
    const rewards = Array.isArray(data?.rewards) ? data.rewards.map(item => this.safeText(item.reward_name)).filter(Boolean) : [];
    return `成功${rewards.length ? `，${rewards.join("、")}` : ""}`;
  }

  safeText(value) {
    if (typeof value !== "string") return "";
    let text = value;
    // Redact configured cookie values even if an upstream reward echoes them.
    for (const part of this.config.cookie.split(";")) {
      const index = part.indexOf("=");
      const secret = index < 0 ? "" : part.slice(index + 1).trim();
      if (secret.length >= 4) text = text.split(secret).join("[已隐藏]");
    }
    return text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").slice(0, 120);
  }

  async action(portal, item, type, action, data, { emptyFilter = false } = {}) {
    if (!this.config.csrf) throw new WpsError("Cookie 缺少 act_csrf_token 或 csrf");
    if (typeof item?.number !== "string" || !item.number || typeof item.component_node_id !== "string" || !item.component_node_id) {
      throw new WpsError("活动组件信息不完整，已停止提交");
    }
    const result = await this.api(ACTION, {
      component_uniq_number: { activity_number: portal.activity_number, page_number: portal.page_number,
        component_number: item.number, component_node_id: item.component_node_id, filter_params: emptyFilter ? {} : portal.filter_params },
      component_type: type, component_action: action, [action.split(".")[0]]: data,
    }, { Referer: portalLink(portal), "x-act-csrf-token": this.config.csrf });
    const payload = result?.[action.split(".")[0]];
    if (payload?.success !== true) {
      const reason = [payload?.reason, payload?.send_msg].filter(value => typeof value === "string").join(" ");
      if (/未登录|userNotLogin|Token.*过期/i.test(reason)) throw new WpsError("登录已失效，请更新完整 Cookie", { auth: true });
      if (/not in series records/i.test(reason)) throw new WpsError("原签到周期已失效", { brokenSeries: true });
      if (/已经签到|已签到|重复签到|已领取|已申请/.test(reason)) throw new WpsError("已经完成，无需重复提交", { duplicate: true });
      throw new WpsError("活动提交未成功；不自动重试");
    }
    return payload;
  }

  async discoverPortal() {
    const candidates = [];
    const collect = (node, depth = 0) => {
      if (!node || typeof node !== "object" || depth > 30) return;
      if (typeof node.link === "string") {
        try {
          const link = new URL(node.link);
          const match = /^\/rubik2\/portal\/([A-Za-z0-9]+)\/([A-Za-z0-9]+)\/?$/.exec(link.pathname);
          if (link.origin === ACT && match) candidates.push({ activity_number: match[1], page_number: match[2],
            filter_params: Object.fromEntries(link.searchParams), title: node.title });
        } catch { /* Ignore non-portal links; never follow arbitrary URLs. */ }
      }
      for (const value of Object.values(node)) collect(value, depth + 1);
    };
    const channels = [
      { channel_code: "AUTOPCHYZXYYHD3737", platform: 8, version: "0.0.0.0" },
      { channel_code: "HYGW5004,GWHD5002", platform: 8, version: "", device: 1, hdid: "", filter_info: {} },
    ];
    let lastError;
    let successful = 0;
    for (const channel of channels) {
      try {
        collect(await this.api("https://tiance.wps.cn/dce/exec/api/market/activity", channel));
        successful++;
      } catch (error) { if (error.auth) throw error; lastError = error; }
    }
    const portal = candidates.find(item => item.filter_params.position === "pc_nvc_activity_fuli") ||
      candidates.find(item => /fuli/.test(item.filter_params.position || "")) ||
      candidates.find(item => ["福利中心", "天天领福利"].includes(item.title));
    if (!portal) {
      if (!successful && lastError) throw lastError;
      throw new WpsError("未找到福利中心活动入口", { unavailable: true });
    }
    return portal;
  }

  fragment(page) {
    return page.find(item => item.type === 42 && Array.isArray(item.fragment_collect?.sign_records) && item.fragment_collect.sign_records.length);
  }

  async freeMember(portal) {
    const item = this.fragment(await this.page(portal));
    if (!item) return "跳过（未找到打卡活动）";
    const fragment = item.fragment_collect;
    const today = signDate(item);
    if (fragment.sign_records.some(record => record.sign_date === today && record.sign_status === "signed")) return "今天已经签到过";
    try {
      await this.action(portal, item, 42, "fragment_collect.sign_in", {
        sign_date: today, series_id: fragment.sign_series_id || "", is_new_sign_series: !fragment.sign_series_id,
      });
    } catch (error) {
      // Only an explicit server rejection of an expired series permits starting
      // a new one. Never repeat a timed-out/ambiguous submission.
      if (!error.brokenSeries) throw error;
      await this.action(portal, item, 42, "fragment_collect.sign_in", {
        sign_date: "", series_id: fragment.sign_series_id || "", is_new_sign_series: true,
      });
      return "成功（旧周期已失效，已重新开始打卡）";
    }
    return "成功";
  }

  async trials(portal) {
    if (!this.config.maxTrials) return "已关闭（maxTrials=0）";
    const page = await this.page(portal);
    const item = page.find(item => item.type === 32 && item.divide_prize?.divide_prize_details?.some(detail => /会员/.test(detail.title || "")));
    if (!item) return "跳过（未找到会员试用活动）";
    const data = item.divide_prize;
    const details = data.divide_prize_details.filter(detail => !detail.has_join && count(detail.stock) > 0);
    const limit = Math.min(count(data.remain_times), this.config.maxTrials, details.length);
    if (data.join_reach_limit || !limit) return "跳过（已申请、无库存或没有剩余申请次数）";
    const results = [];
    for (const detail of details.slice(0, limit)) {
      if (results.length) await this.wait(1000);
      if (!detail.cycle_id || !detail.session_id) throw new WpsError("试用场次信息不完整，已停止提交");
      try {
        await this.action(portal, item, 32, "divide_prize.sign_up", { cycle_id: detail.cycle_id, session_id: detail.session_id }, { emptyFilter: true });
      } catch (error) { throw new WpsError(`已申请成功 ${results.length} 项；${describe(error)}；停止申请，不自动重试`, { auth: error.auth }); }
      results.push(this.safeText(detail.title) || "会员试用");
    }
    return `申请成功 ${results.length} 项：${results.join("、")}`;
  }

  async lottery(portal) {
    if (!this.config.maxLottery) return "已关闭（maxLottery=0）";
    const page = await this.page(portal);
    const item = page.find(item => item.type === 45 && item.lottery_v2?.lottery_list?.some(session => session.session_status === "IN_PROGRESS"));
    if (!item) return "跳过（没有进行中的抽奖活动）";
    const sessions = item.lottery_v2.lottery_list.filter(session => session.session_status === "IN_PROGRESS");
    const session = sessions.find(session => !session.stock_status || session.stock_status === "IN_STOCK") || sessions[0];
    if (session.stock_status && session.stock_status !== "IN_STOCK") return "跳过（奖品暂无库存）";
    const limit = Math.min(count(session.times), this.config.maxLottery);
    if (!limit) return "跳过（没有剩余抽奖次数）";
    if (session.session_id === undefined || session.session_id === null) throw new WpsError("抽奖场次信息缺失，已停止提交");
    const prizes = [];
    for (let index = 0; index < limit; index++) {
      if (index) await this.wait(1000);
      try {
        const data = await this.action(portal, item, 45, "lottery_v2.exec", { session_id: session.session_id });
        prizes.push(this.safeText(data.reward_name) || "已完成（未返回奖品名称）");
      } catch (error) { throw new WpsError(`已成功抽奖 ${prizes.length} 次；${describe(error)}；停止抽奖，不自动重试`, { auth: error.auth }); }
    }
    return `完成 ${prizes.length} 次：${prizes.join("、")}`;
  }

  async reward(portal) {
    const page = await this.page(portal);
    const item = this.fragment(page);
    if (!item) return "跳过（未找到打卡活动）";
    const data = item.fragment_collect;
    const isSeventhDay = page.some(item => item.type === 45 && item.lottery_v2?.lottery_list?.some(session => session.session_status === "IN_PROGRESS" && session.times === 7));
    if (!isSeventhDay || !data.sign_series_id) return "跳过（未到七天奖励领取条件）";
    const result = await this.action(portal, item, 42, "fragment_collect.receive", { series_id: data.sign_series_id });
    return `领取成功${result.reward_name ? `：${this.safeText(result.reward_name)}` : ""}`;
  }

  async points() {
    const page = await this.page(CENTER);
    const data = page.find(item => item.type === 36)?.task_center_user_info;
    if (!data || !Number.isFinite(data.integral) || data.integral < 0) throw new WpsError("未获取到有效积分信息");
    return `积分 ${data.integral}｜即将过期 ${Number.isFinite(data.advent_integral) && data.advent_integral >= 0 ? data.advent_integral : "未获取"}`;
  }

  async run() {
    const lines = [];
    let failed = false;
    let expired = false;
    const execute = async (label, work) => {
      if (expired) { lines.push(`⏭️ ${label}：跳过（登录已失效）`); return; }
      try {
        const message = await work();
        const icon = message.startsWith("跳过") ? "⏭️" : message.startsWith("已关闭") ? "⚪" : "✅";
        lines.push(`${icon} ${label}：${message}`);
      } catch (error) {
        if (error.duplicate || error.unavailable) lines.push(`${error.duplicate ? "✅" : "⏭️"} ${label}：${describe(error)}`);
        else { failed = true; expired ||= Boolean(error.auth); lines.push(`❌ ${label}：失败（${describe(error)}）`); }
      }
    };
    let portalPromise;
    const portal = () => (portalPromise ||= this.discoverPortal());
    const work = {
      centerSign: () => this.sign(),
      centerLottery: () => this.lottery(CENTER),
      freeMember: async () => this.freeMember(await portal()),
      memberTrial: async () => this.trials(await portal()),
      dailyLottery: async () => this.lottery(await portal()),
      reward: async () => this.reward(await portal()),
    };
    const disabled = [];
    for (const key of ["centerSign", "centerLottery", "freeMember", "memberTrial", "reward", "dailyLottery"]) {
      if (!this.config.tasks[key]) disabled.push(LABELS[key]);
      else await execute(LABELS[key], work[key]);
    }
    await execute("账号积分", () => this.points());
    if (disabled.length) lines.push(`⚪ 未启用：${disabled.join("、")}`);
    return { failed, lines };
  }
}

async function runWps(raw, options = {}) {
  let accounts;
  try { accounts = parseAccounts(raw, { extraFields: ["maxLottery", "maxTrials", "userId", "userAgent"] }); }
  catch (error) { throw new Error(error.message.replaceAll("BILI_ACCOUNTS", "WPS_ACCOUNTS").replace('"coinCount":0', '"maxLottery":0')); }
  const outcomes = [];
  let failedAccounts = 0;
  for (const [index, account] of accounts.entries()) {
    let name = "";
    let result;
    try {
      const config = configure(account);
      name = config.name;
      result = await new WpsClient(config, options).run();
    } catch (error) { result = { failed: true, lines: [`❌ 执行：失败（${describe(error)}）`] }; }
    if (result.failed) failedAccounts++;
    outcomes.push(`\n账号 ${index + 1}${name ? `（${name}）` : ""}${result.failed ? "｜⚠️ 有失败任务" : ""}\n${result.lines.join("\n")}`);
    for (const line of result.lines) console.log(`WPS 第 ${index + 1} 个账号 ${line}`);
    if (index < accounts.length - 1) await (options.wait || sleep)(5000);
  }
  outcomes.unshift(`账号：${accounts.length} 个｜无异常：${accounts.length - failedAccounts} 个｜异常：${failedAccounts} 个`);
  return { failed: failedAccounts > 0, outcomes };
}

module.exports = { runWps, WpsClient, WpsError, configure, encryptSign, requestJson, signDate };
