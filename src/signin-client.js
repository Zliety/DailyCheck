"use strict";

const { CloudClient } = require("cloud189-sdk");

const CLOUD_HOSTS = new Set(["cloud.189.cn", "open.e.189.cn", "api.cloud.189.cn"]);
const NETWORK_OPTIONS = {
  dnsLookupIpVersion: "ipv4",
  timeout: { lookup: 10000, connect: 15000, secureConnect: 15000, response: 20000, request: 45000 },
  retry: { limit: 1 },
};

// The SDK catches password login errors in getSession(), then throws a generic
// error. Keep the cause while retaining its cached-token and refresh behavior.
class SignInClient extends CloudClient {
  constructor(options) {
    super(options);
    // Extend both clients so authentication and sign-in use the same settings.
    // Existing SDK headers, signing hooks and retry method restrictions remain.
    this.authClient.authRequest = this.authClient.authRequest.extend(NETWORK_OPTIONS);
    this.request = this.request.extend(NETWORK_OPTIONS);
    const loginByPassword = this.authClient.loginByPassword.bind(this.authClient);
    this.authClient.loginByPassword = async (...args) => {
      try {
        return await loginByPassword(...args);
      } catch (error) {
        this.passwordLoginError = error;
        throw error;
      }
    };
  }

  async getSession() {
    this.passwordLoginError = undefined;
    try {
      return await super.getSession();
    } catch (error) {
      throw this.passwordLoginError || error;
    }
  }
}

function describeFailure(error, accounts = []) {
  const failure = error && typeof error === "object" ? error : {};
  const details = [];
  if (Number.isInteger(failure.response?.statusCode)) {
    details.push(`HTTP ${failure.response.statusCode}`);
  }
  if (typeof failure.code === "string" && /^[A-Z0-9_]{1,60}$/.test(failure.code)) {
    details.push(failure.code);
  }
  try {
    const hostname = new URL(failure.options?.url || failure.request?.requestUrl).hostname;
    if (CLOUD_HOSTS.has(hostname)) details.push(`目标 ${hostname}`);
  } catch {
    // Errors without a request URL have no endpoint to report.
  }
  const stages = {
    lookup: "DNS 解析", connect: "TCP 连接", secureConnect: "TLS 握手",
    response: "等待响应", request: "整个请求", socket: "套接字", send: "发送请求",
  };
  if (Object.hasOwn(stages, failure.event)) details.push(`${stages[failure.event]}超时`);

  // Only authentication API errors contain a server-provided reason. Other SDK
  // errors may embed request URLs, headers or sessions, so never print them raw.
  if (failure.name === "AuthApiError" || failure.constructor?.name === "AuthApiError") {
    let reason = String(failure.message || "");
    for (const account of accounts) {
      for (const value of [account.userName, account.userName?.trim(), account.password]) {
        if (value) {
          for (const secret of [value, encodeURIComponent(value)]) {
            reason = reason.split(secret).join("[已隐藏]");
          }
        }
      }
    }
    reason = reason
      .replace(/https?:\/\/[^\s<>"']+/gi, "[链接已隐藏]")
      .replace(/(?:password|token|cookie|session\w*|authorization)\s*[:=]\s*[^\s,;]+/gi, "[凭据已隐藏]")
      .replace(/[A-Z0-9_+/=-]{24,}/gi, "[内容已隐藏]")
      .replace(/[\r\n\t\x00-\x1f\x7f]/g, " ")
      .slice(0, 200);
    details.push(`天翼认证接口：${reason || "拒绝登录"}`);
  } else if (failure instanceof TypeError && /\bnull\b|\bundefined\b/.test(failure.message)) {
    details.push("登录页面或接口返回格式不符合 SDK 预期，可能是页面变更或安全验证");
  } else if (failure.message === "invalid sign-in response") {
    details.push("签到接口返回格式异常");
  } else if (!details.length) {
    details.push("未获取到具体原因，请检查账号、安全验证状态和网络");
  }
  return details.join("，");
}

module.exports = { SignInClient, describeFailure };
