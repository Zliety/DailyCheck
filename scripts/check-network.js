"use strict";

const https = require("node:https");

// Probe only public homepages, without account data, cookies or redirects.
function probe(hostname, family) {
  return new Promise((resolve) => {
    let stage = "DNS 解析";
    const request = https.request({ hostname, family, method: "HEAD", path: "/", agent: false });
    const timer = setTimeout(() => {
      const error = new Error("probe timeout");
      error.code = "ETIMEDOUT";
      request.destroy(error);
    }, 12000);
    const finish = (result) => {
      clearTimeout(timer);
      resolve(`${hostname} IPv${family}：${result}`);
    };
    request.on("socket", (socket) => {
      socket.on("lookup", (error) => { if (!error) stage = "TCP 连接"; });
      socket.on("connect", () => { stage = "TLS 握手"; });
      socket.on("secureConnect", () => { stage = "等待响应"; });
    });
    request.on("response", (response) => {
      finish(`HTTP ${response.statusCode}（HTTPS 可达）`);
      response.destroy();
    });
    request.on("error", (error) => {
      const code = /^[A-Z0-9_]+$/.test(error.code || "") ? error.code : "连接失败";
      finish(`${code}（${stage}阶段）`);
    });
    request.end();
  });
}

async function main() {
  console.log("天翼云盘、B 站和 WPS 网络诊断：分别测试 IPv4 / IPv6，不使用账号凭据。签到请求已设置使用 IPv4。");
  const results = await Promise.all(
    ["cloud.189.cn", "open.e.189.cn", "api.cloud.189.cn",
      "api.bilibili.com", "api.live.bilibili.com", "manga.bilibili.com",
      "personal-act.wps.cn", "personal-bus.wps.cn", "tiance.wps.cn"].flatMap(
      (hostname) => [4, 6].map((family) => probe(hostname, family)),
    ),
  );
  for (const result of results) console.log(result);
  console.log("主页可达不代表登录接口一定可用；IPv6 失败不影响已使用 IPv4 的签到请求。");
}

if (require.main === module) main().catch(() => { console.error("网络诊断未完成。"); process.exitCode = 1; });

module.exports = { probe };
