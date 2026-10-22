"use strict";

process.umask(0o077);

const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const {
  FileTokenStore,
  logger: sdkLogger,
} = require("cloud189-sdk");
const { SignInClient, describeFailure } = require("./signin-client");

sdkLogger.configure({ isDebugEnabled: false, consoleOutput: false });

async function runTianyi(rawAccounts = process.env.TY_ACCOUNTS, {
  createClient = (options) => new SignInClient(options),
  tokenDirectory = path.resolve(__dirname, "..", ".token"),
} = {}) {
  if (!rawAccounts) {
    throw new Error("缺少 TY_ACCOUNTS，请将天翼云盘账号配置为 JSON 数组。");
  }

  let accounts;
  try {
    accounts = JSON.parse(rawAccounts);
  } catch {
    throw new Error("TY_ACCOUNTS 不是有效的 JSON 数组。");
  }

  if (
    !Array.isArray(accounts) ||
    accounts.length === 0 ||
    accounts.some(
      (account) =>
        !account ||
        typeof account.userName !== "string" ||
        !account.userName.trim() ||
        typeof account.password !== "string" ||
        account.password.length === 0,
    )
  ) {
    throw new Error("TY_ACCOUNTS 必须是包含 userName 和 password 的非空 JSON 数组。");
  }

  await fs.mkdir(tokenDirectory, { recursive: true, mode: 0o700 });

  let failedAccounts = 0;
  const outcomes = [];
  for (const [index, account] of accounts.entries()) {
    const userName = account.userName.trim();
    const accountId = createHash("sha256").update(userName).digest("hex");
    const tokenPath = path.join(tokenDirectory, `${accountId}.json`);
    let phase = "登录";

    try {
      try {
        await fs.chmod(tokenPath, 0o600);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }

      const client = createClient({
        username: userName,
        password: account.password,
        token: new FileTokenStore(tokenPath),
      });

      await client.getSessionKey();
      phase = "签到";
      const result = await client.userSign();
      if (!result || typeof result.isSign !== "boolean") {
        throw new Error("invalid sign-in response");
      }

      if (result.isSign) {
        const message = `第 ${index + 1} 个账号：今天已经签到过。`;
        outcomes.push(`\n账号 ${index + 1}｜无异常\n✅ 签到：今天已经签到过`);
        console.log(message);
      } else {
        const bonus = Number.isFinite(result.netdiskBonus)
          ? `，获得 ${result.netdiskBonus} MB 空间`
          : "";
        const message = `第 ${index + 1} 个账号：签到成功${bonus}。`;
        outcomes.push(`\n账号 ${index + 1}｜无异常\n✅ 签到：成功${bonus}`);
        console.log(message);
      }
    } catch (error) {
      failedAccounts++;
      const reason = describeFailure(error, accounts);
      outcomes.push(`\n账号 ${index + 1}｜❌ 执行失败\n❌ ${phase}：失败（${reason}）`);
      console.error(`第 ${index + 1} 个账号${phase}失败（${reason}）。`);
    }
  }

  outcomes.unshift(`账号：${accounts.length} 个｜无异常：${accounts.length - failedAccounts} 个｜异常：${failedAccounts} 个`);
  return { failed: failedAccounts > 0, outcomes };
}

module.exports = { runTianyi };
