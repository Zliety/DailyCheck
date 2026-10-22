"use strict";

const { runTianyi } = require("./checkin");
const { runBilibili } = require("./bilibili");
const { sendNotifications } = require("./notifications");

async function main({ env = process.env, tianyi = runTianyi, bilibili = runBilibili, notify = sendNotifications } = {}) {
  const platforms = [
    ["天翼云盘", env.TY_ACCOUNTS, tianyi],
    ["B站", env.BILI_ACCOUNTS, bilibili],
  ].filter(([, config]) => config);
  if (!platforms.length) {
    console.error("请至少配置 TY_ACCOUNTS 或 BILI_ACCOUNTS 中的一项。");
    return 2;
  }
  let failed = false;
  const sections = [];
  for (const [name, config, run] of platforms) {
    console.log(`开始执行：${name}`);
    try {
      const result = await run(config);
      failed ||= result.failed;
      sections.push(`【${name}】\n${result.outcomes.join("\n")}`);
    } catch (error) {
      failed = true;
      // Never print arbitrary SDK errors, which may contain account credentials.
      const message = /^(TY_ACCOUNTS|BILI_ACCOUNTS)/.test(error.message || "")
        ? error.message : "执行异常，请查看对应平台日志。";
      console.error(`${name}：${message}`);
      sections.push(`【${name}】\n${message}`);
    }
  }
  const notificationFailed = await notify("每日签到结果", sections.join("\n\n"));
  return failed || notificationFailed ? 1 : 0;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch(() => {
    console.error("每日签到任务异常结束。");
    process.exitCode = 1;
  });
}

module.exports = { main };
