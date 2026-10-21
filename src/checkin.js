"use strict";

process.umask(0o077);

const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const {
  CloudClient,
  FileTokenStore,
  logger: sdkLogger,
} = require("cloud189-sdk");
const { sendNotifications } = require("./notifications");

sdkLogger.configure({ isDebugEnabled: false, consoleOutput: false });

async function main() {
  const rawAccounts = process.env.TY_ACCOUNTS;

  if (!rawAccounts) {
    console.error("缺少 TY_ACCOUNTS，请将天翼云盘账号配置为 JSON 数组。");
    process.exitCode = 2;
    return;
  }

  let accounts;
  try {
    accounts = JSON.parse(rawAccounts);
  } catch {
    console.error("TY_ACCOUNTS 不是有效的 JSON 数组。");
    process.exitCode = 2;
    return;
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
    console.error("TY_ACCOUNTS 必须是包含 userName 和 password 的非空 JSON 数组。");
    process.exitCode = 2;
    return;
  }

  const tokenDirectory = path.resolve(__dirname, "..", ".token");
  await fs.mkdir(tokenDirectory, { recursive: true, mode: 0o700 });

  let failed = false;
  const outcomes = [];
  for (const [index, account] of accounts.entries()) {
    const userName = account.userName.trim();
    const accountId = createHash("sha256").update(userName).digest("hex");
    const tokenPath = path.join(tokenDirectory, `${accountId}.json`);

    try {
      try {
        await fs.chmod(tokenPath, 0o600);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }

      const client = new CloudClient({
        username: userName,
        password: account.password,
        token: new FileTokenStore(tokenPath),
      });

      const result = await client.userSign();
      if (!result || typeof result.isSign !== "boolean") {
        throw new Error("invalid sign-in response");
      }

      if (result.isSign) {
        const message = `第 ${index + 1} 个账号：今天已经签到过。`;
        outcomes.push(message);
        console.log(message);
      } else {
        const bonus = Number.isFinite(result.netdiskBonus)
          ? `，获得 ${result.netdiskBonus} MB 空间`
          : "";
        const message = `第 ${index + 1} 个账号：签到成功${bonus}。`;
        outcomes.push(message);
        console.log(message);
      }
    } catch (error) {
      failed = true;
      outcomes.push(`第 ${index + 1} 个账号：签到失败。`);
      const failure = error && typeof error === "object" ? error : {};
      const details = [];
      if (Number.isInteger(failure.response?.statusCode)) {
        details.push(`HTTP ${failure.response.statusCode}`);
      }
      if (typeof failure.code === "string" && /^[A-Z0-9_]+$/.test(failure.code)) {
        details.push(failure.code);
      }
      const suffix = details.length ? `（${details.join("，")}）` : "";
      console.error(`第 ${index + 1} 个账号签到失败${suffix}。请检查账号、安全验证状态和网络后重试。`);
    }
  }

  const notificationFailed = await sendNotifications(
    "天翼云盘签到结果",
    outcomes.join("\n"),
  );
  if (failed || notificationFailed) process.exitCode = 1;
}

main().catch((error) => {
  const failure = error && typeof error === "object" ? error : {};
  const details = [];
  if (Number.isInteger(failure.response?.statusCode)) {
    details.push(`HTTP ${failure.response.statusCode}`);
  }
  if (typeof failure.code === "string" && /^[A-Z0-9_]+$/.test(failure.code)) {
    details.push(failure.code);
  }
  const suffix = details.length ? `（${details.join("，")}）` : "";
  console.error(`天翼云盘签到失败${suffix}。请检查账号、安全验证状态和网络后重试。`);
  process.exitCode = 1;
});
