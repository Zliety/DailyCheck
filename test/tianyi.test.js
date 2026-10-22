"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { runTianyi } = require("../src/checkin");

async function tokenDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dailycheck-tianyi-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test("天翼推送按账号分组，准确汇总成功、已签到和失败，不泄露凭据", async (t) => {
  const raw = JSON.stringify(["new-user", "signed-user", "failed-user"].map((userName) => ({ userName, password: "secret-password" })));
  const result = await runTianyi(raw, {
    tokenDirectory: await tokenDir(t),
    createClient: ({ username }) => ({
      async getSessionKey() {
        if (username === "failed-user") throw Object.assign(new Error("secret-password failed-user"), { code: "ETIMEDOUT" });
      },
      async userSign() { return { isSign: username === "signed-user", netdiskBonus: 65 }; },
    }),
  });
  assert.equal(result.failed, true);
  assert.equal(result.outcomes[0], "账号：3 个｜无异常：2 个｜异常：1 个");
  assert.match(result.outcomes[1], /账号 1｜✅ 无异常\n✅ 签到：成功，获得 65 MB 空间/);
  assert.match(result.outcomes[2], /账号 2｜✅ 无异常\n✅ 签到：今天已经签到过/);
  assert.ok(!result.outcomes[2].includes("65 MB"));
  assert.match(result.outcomes[3], /账号 3｜❌ 执行失败\n❌ 登录：失败（ETIMEDOUT）/);
  for (const secret of ["new-user", "signed-user", "failed-user", "secret-password"]) {
    assert.ok(!result.outcomes.join("\n").includes(secret));
  }
});

test("签到响应异常显示签到阶段，后续账号照常执行，未知容量不显示数值", async (t) => {
  const result = await runTianyi(JSON.stringify([
    { userName: "invalid", password: "secret" }, { userName: "valid", password: "secret" },
  ]), {
    tokenDirectory: await tokenDir(t),
    createClient: ({ username }) => ({
      async getSessionKey() {},
      async userSign() { return username === "invalid" ? {} : { isSign: false }; },
    }),
  });
  assert.match(result.outcomes[0], /无异常：1 个｜异常：1 个/);
  assert.match(result.outcomes[1], /❌ 签到：失败/);
  assert.match(result.outcomes[2], /✅ 签到：成功/);
  assert.ok(!result.outcomes[2].includes("MB"));
});
