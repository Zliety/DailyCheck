"use strict";

const https = require("node:https");

class BiliError extends Error {
  constructor(message, { code, status, duplicate = false, unavailable = false } = {}) {
    super(message);
    Object.assign(this, { code, status, duplicate, unavailable });
  }
}

function describe(error) {
  if (error instanceof BiliError) return error.message;
  const code = error?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code)
    ? `网络请求失败（${code}）` : "请求失败，未输出原始响应以保护凭据";
}

function requestJson(url, cookie, form, context = {}) {
  return new Promise((resolve, reject) => {
    const body = form ? new URLSearchParams(form).toString() : undefined;
    const hostname = new URL(url).hostname;
    const referer = context.referer || (hostname === "manga.bilibili.com" ? "https://manga.bilibili.com/" :
      hostname === "api.live.bilibili.com" ? "https://live.bilibili.com/" : "https://www.bilibili.com/");
    const request = https.request(url, {
      method: body === undefined ? "GET" : "POST",
      family: 4,
      signal: AbortSignal.timeout(20000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        Referer: referer,
        Origin: new URL(referer).origin,
        Cookie: cookie,
        Accept: "application/json",
        ...(body === undefined ? {} : {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        }),
      },
    }, (response) => {
      const status = response.statusCode;
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new BiliError(`接口返回 HTTP ${status}`, { status, unavailable: status === 404 || status === 410 }));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          response.destroy(new BiliError("接口响应过大"));
        } else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new BiliError("接口返回了非 JSON 内容，可能需要安全验证")); }
      });
    });
    request.on("error", (error) => {
      if (error.code === "ABORT_ERR") reject(new BiliError("网络请求超时（ETIMEDOUT）"));
      else reject(error);
    });
    // Never retry mutation requests, especially coin donations.
    request.end(body);
  });
}

function parseAccounts(raw) {
  let accounts;
  try { accounts = JSON.parse(raw); }
  catch {
    // A pasted browser Cookie may contain literal quotes. Repair only cookie
    // values at supported account-field boundaries; never evaluate config text.
    try {
      const fields = "coinCount|reserveCoins|coinSource|videoIds|likeOnCoin|tasks";
      const pattern = new RegExp(`"cookie"\\s*:\\s*"([\\s\\S]*?)"(?=\\s*(?:,\\s*"(?:${fields})"\\s*:|}\\s*(?:,|\\])))`, "g");
      let repairedFields = 0;
      const repaired = raw.replace(pattern, (match, value) => {
        // Don't swallow a malformed adjacent field into the Cookie and silently
        // change task or coin settings. Ambiguous input must fail closed.
        if (/"(?:cookie|coinCount|reserveCoins|coinSource|videoIds|likeOnCoin|tasks)"\s*:/.test(value)) {
          throw new Error("ambiguous cookie boundary");
        }
        let escaped = "";
        for (let index = 0; index < value.length; index++) {
          if (value[index] === "\\") {
            escaped += value[index];
            if (index + 1 < value.length) escaped += value[++index];
          } else escaped += value[index] === '"' ? '\\"' : value[index];
        }
        const decoded = JSON.parse(`"${escaped}"`);
        repairedFields++;
        return `"cookie":${JSON.stringify(decoded)}`;
      });
      if (!repairedFields) throw new Error("no cookie field to repair");
      accounts = JSON.parse(repaired);
    } catch {
      throw new Error("BILI_ACCOUNTS 格式错误：请检查数组、对象和字段间逗号；仅 cookie 内未转义的双引号可自动识别。");
    }
  }
  if (!Array.isArray(accounts) || !accounts.length) throw new Error("BILI_ACCOUNTS 必须是非空 JSON 数组。");
  return accounts;
}

function configure(account) {
  if (!account || typeof account.cookie !== "string" || /[\r\n]/.test(account.cookie)) {
    throw new BiliError("cookie 必须是没有换行符的字符串");
  }
  const cookies = new Map(account.cookie.split(";").map((part) => {
    const index = part.indexOf("=");
    return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }));
  for (const field of ["SESSDATA", "bili_jct", "DedeUserID"]) {
    if (!cookies.get(field)) throw new BiliError(`cookie 缺少 ${field}`);
  }
  const coinCount = account.coinCount ?? 1;
  const reserveCoins = account.reserveCoins ?? 0;
  if (!Number.isInteger(coinCount) || coinCount < 0 || coinCount > 5) throw new BiliError("coinCount 必须是 0～5 的整数");
  if (!Number.isInteger(reserveCoins) || reserveCoins < 0) throw new BiliError("reserveCoins 必须是非负整数");
  const coinSource = account.coinSource ?? "dynamic";
  if (!["dynamic", "ranking"].includes(coinSource)) throw new BiliError("coinSource 只能是 dynamic 或 ranking");
  const videoIds = account.videoIds ?? [];
  if (!Array.isArray(videoIds) || videoIds.some((id) => typeof id !== "string" || !/^BV[0-9A-Za-z]{10}$/.test(id))) {
    throw new BiliError("videoIds 必须是 BV 号数组");
  }
  const tasks = { share: true, watch: true, coin: true, live: true, manga: true };
  if (account.tasks !== undefined && (!account.tasks || typeof account.tasks !== "object" || Array.isArray(account.tasks))) {
    throw new BiliError("tasks 必须是任务开关对象");
  }
  for (const [key, value] of Object.entries(account.tasks || {})) {
    if (!Object.hasOwn(tasks, key) || typeof value !== "boolean") throw new BiliError("tasks 只能包含 share、watch、coin、live、manga 布尔开关");
    tasks[key] = value;
  }
  if (account.likeOnCoin !== undefined && typeof account.likeOnCoin !== "boolean") throw new BiliError("likeOnCoin 必须是布尔值");
  return { cookie: account.cookie, csrf: cookies.get("bili_jct"), coinCount, reserveCoins, coinSource,
    videoIds: [...new Set(videoIds)], likeOnCoin: account.likeOnCoin ?? false, tasks,
    missingDeviceCookies: ["buvid3", "buvid4", "b_nut", "_uuid"].filter((field) => !cookies.get(field)) };
}

class BilibiliClient {
  constructor(config, request = requestJson) {
    this.config = config;
    this.request = request;
    this.videoCache = new Map();
  }

  async api(url, form, context) {
    const result = await this.request(url, this.config.cookie, form, context);
    if (!result || !["number", "string"].includes(typeof result.code)) throw new BiliError("接口返回格式异常");
    if (result.code !== 0) {
      const message = String(result.message || result.msg || "");
      const duplicate = result.code === 1011040 || /已签到|已经签到|重复签到|already.*(sign|check)|clockin.*duplicate/i.test(message);
      const unavailable = /已下线|活动.*结束|停止服务|not found/i.test(message);
      const reason = duplicate ? "今天已经签到过" : unavailable ? "接口或活动已下线" :
        /验证|captcha|risk/i.test(message) ? "需要安全验证" :
        result.code === -101 ? "登录凭据已失效" : result.code === -111 ? "CSRF 校验失败" :
        [-401, -403].includes(result.code) ? "请求被安全策略拒绝" : "接口拒绝请求";
      const code = /^-?[0-9A-Za-z_]{1,40}$/.test(String(result.code)) ? `，代码 ${result.code}` : "";
      const missing = this.config.missingDeviceCookies || [];
      const hint = [-401, -403].includes(result.code)
        ? missing.length ? `；请更新完整浏览器 Cookie，当前缺少设备字段 ${missing.join("、")}`
          : "；请在浏览器确认账号验证状态，若浏览器可操作则检查运行节点的出口网络"
        : "";
      throw new BiliError(`${reason}${code}${hint}`, { code: result.code, duplicate, unavailable });
    }
    return result.data;
  }

  async videos() {
    if (this.config.videoIds.length) return this.config.videoIds;
    let ids = [];
    if (this.config.coinSource === "dynamic") {
      const data = await this.api("https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all?type=video");
      ids = (data?.items || []).map((item) => item.modules?.module_dynamic?.major?.archive?.bvid).filter(Boolean);
    }
    if (!ids.length) {
      const data = await this.api("https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all");
      ids = (data?.list || []).map((video) => video.bvid);
    }
    return [...new Set(ids.filter((id) => typeof id === "string" && /^BV[0-9A-Za-z]{10}$/.test(id)))].slice(0, 20);
  }

  videoInfo(bvid) {
    if (!this.videoCache.has(bvid)) {
      this.videoCache.set(bvid, (async () => {
        const data = await this.api(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`);
        if (!Number.isSafeInteger(data?.aid) || data.aid <= 0 || (data.bvid && data.bvid !== bvid)) {
          throw new BiliError("视频详情缺少有效或匹配的 aid，已停止该视频操作");
        }
        return { aid: data.aid, bvid, cid: data.cid };
      })());
    }
    return this.videoCache.get(bvid);
  }

  videoContext(bvid) { return { referer: `https://www.bilibili.com/video/${bvid}/` }; }

  async coins(user, getVideos) {
    const c = this.config;
    if (!c.coinCount) return "已关闭（coinCount=0）";
    const exp = await this.api("https://api.bilibili.com/x/web-interface/coin/today/exp");
    if (!Number.isFinite(exp) || exp < 0) throw new BiliError("无法确认今日投币经验，已停止投币");
    const remaining = Math.max(0, c.coinCount - Math.floor(exp / 10));
    if (!remaining) return "今日已达到配置的投币目标";
    if (!Number.isFinite(user.money)) throw new BiliError("无法确认硬币余额，已停止投币");
    const target = Math.min(remaining, Math.max(0, Math.floor(user.money) - c.reserveCoins));
    if (!target) return "跳过（余额不足或已达到保留余额）";
    let donated = 0;
    for (const bvid of await getVideos()) {
      if (donated >= target) break;
      let stage = "获取视频详情";
      try {
        const video = await this.videoInfo(bvid);
        const context = this.videoContext(bvid);
        stage = "查询视频投币状态";
        const status = await this.api(`https://api.bilibili.com/x/web-interface/archive/coins?aid=${video.aid}&bvid=${encodeURIComponent(bvid)}`, undefined, context);
        if (!Number.isFinite(status?.multiply)) throw new BiliError("无法确认视频投币状态");
        if (status.multiply > 0) continue;
        stage = "提交投币";
        await this.api("https://api.bilibili.com/x/web-interface/coin/add", {
          aid: String(video.aid), bvid, multiply: "1", select_like: c.likeOnCoin ? "1" : "0", csrf: c.csrf,
          cross_domain: "true", source: "web_normal",
        }, context);
        donated++;
      } catch (error) {
        throw new BiliError(`已成功投 ${donated} 枚；${stage}失败：${describe(error)}；停止投币，不自动重试`);
      }
    }
    if (donated < target) throw new BiliError(`已成功投 ${donated} 枚，目标 ${target} 枚，可用视频不足`);
    return `成功投 ${donated} 枚（每日目标 ${c.coinCount} 枚）`;
  }

  async run() {
    const user = await this.api("https://api.bilibili.com/x/web-interface/nav");
    if (!user?.isLogin) throw new BiliError("登录凭据已失效或登录状态异常");
    let videoPromise;
    const getVideos = () => (videoPromise ||= this.videos());
    const firstVideo = async () => {
      const ids = await getVideos();
      if (!ids.length) throw new BiliError("没有可用的视频");
      return ids[0];
    };
    const c = this.config;
    const tasks = [
      ["share", "分享视频", async () => {
        const bvid = await firstVideo();
        const video = await this.videoInfo(bvid);
        await this.api("https://api.bilibili.com/x/web-interface/share/add", {
          aid: String(video.aid), bvid, csrf: c.csrf, source: "web_normal",
        }, this.videoContext(bvid));
        return "成功";
      }],
      ["watch", "观看视频", async () => { await this.api("https://api.bilibili.com/x/click-interface/web/heartbeat", { bvid: await firstVideo(), played_time: "30", csrf: c.csrf }); return "心跳上报成功"; }],
      ["coin", "视频投币", () => this.coins(user, getVideos)],
      ["live", "直播签到", async () => { await this.api("https://api.live.bilibili.com/xlive/web-ucenter/v1/sign/DoSign"); return "成功"; }],
      ["manga", "漫画签到", async () => { await this.api("https://manga.bilibili.com/twirp/activity.v1.Activity/ClockIn", { platform: "ios" }); return "成功"; }],
    ];
    const outcomes = ["登录：成功"];
    let failed = false;
    for (const [key, label, execute] of tasks) {
      if (!c.tasks[key]) { outcomes.push(`${label}：已关闭`); continue; }
      try { outcomes.push(`${label}：${await execute()}`); }
      catch (error) {
        if (["live", "manga"].includes(key) && error instanceof BiliError && (error.duplicate || error.unavailable)) {
          outcomes.push(`${label}：${error.duplicate ? "今天已经签到过" : "跳过（接口暂不可用或活动已下线）"}`);
        } else { failed = true; outcomes.push(`${label}：失败（${describe(error)}）`); }
      }
    }
    let snapshot = user;
    let refreshed = false;
    try {
      const latest = await this.api("https://api.bilibili.com/x/web-interface/nav");
      if (latest?.isLogin) { snapshot = latest; refreshed = true; }
    } catch {
      // Reporting failure must not discard task results or pretend stale data is current.
    }
    return { failed, outcomes, accountInfo: formatAccountInfo(snapshot, refreshed) };
  }
}

function formatAccountInfo(user, refreshed) {
  const info = user.level_info || {};
  const level = Number.isInteger(info.current_level) && info.current_level >= 0 ? info.current_level : undefined;
  const current = Number.isFinite(info.current_exp) && info.current_exp >= 0 ? info.current_exp : undefined;
  const next = Number.isFinite(info.next_exp) && info.next_exp > 0 ? info.next_exp : undefined;
  const experience = current === undefined ? "未获取" : level === 6 ? `${current}（已满级）` :
    next === undefined ? `${current}` : `${current}/${next}`;
  const coins = Number.isFinite(user.money) && user.money >= 0 ? user.money : "未获取";
  return `等级 ${level === undefined ? "未获取" : `Lv.${level}`}｜经验 ${experience}｜硬币 ${coins}${refreshed ? "" : "（任务前快照，刷新失败）"}`;
}

function formatAccount(index, lines, failed, fatal, accountInfo) {
  const status = fatal ? "❌ 执行失败" : failed ? "⚠️ 有失败任务" : "";
  const output = [`账号 ${index + 1}${status ? `｜${status}` : ""}`];
  if (accountInfo) output.push(accountInfo);
  const disabled = [];
  for (const line of lines) {
    const closed = line.match(/^(.+?)：已关闭/);
    if (closed) { disabled.push(closed[1]); continue; }
    const icon = /：失败/.test(line) ? "❌" : /：跳过/.test(line) ? "⏭️" : "✅";
    output.push(`${icon} ${line}`);
  }
  if (disabled.length) output.push(`⚪ 未启用：${disabled.join("、")}`);
  return output.join("\n");
}

async function runBilibili(raw, { request = requestJson } = {}) {
  const accounts = parseAccounts(raw);
  const outcomes = [];
  let failedAccounts = 0;
  for (const [index, account] of accounts.entries()) {
    let lines;
    let failed = false;
    let fatal = false;
    let accountInfo;
    try {
      const result = await new BilibiliClient(configure(account), request).run();
      failed = result.failed;
      lines = result.outcomes;
      accountInfo = result.accountInfo;
    } catch (error) { failed = true; fatal = true; lines = [`执行：失败（${describe(error)}）`]; }
    if (failed) failedAccounts++;
    outcomes.push(`\n${formatAccount(index, lines, failed, fatal, accountInfo)}`);
    if (accountInfo) console.log(`B站 第 ${index + 1} 个账号 ${accountInfo}`);
    for (const line of lines) console.log(`B站 第 ${index + 1} 个账号 ${line}`);
  }
  outcomes.unshift(`账号：${accounts.length} 个${failedAccounts ? `｜异常：${failedAccounts} 个` : ""}`);
  return { failed: failedAccounts > 0, outcomes };
}

module.exports = { runBilibili, BilibiliClient, BiliError, configure, requestJson, parseAccounts };
