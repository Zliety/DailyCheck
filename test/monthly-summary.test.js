"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { monthlySummary, monthRange } = require("../scripts/monthly-summary");

async function fixture(t, listWorkflowRuns) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dailycheck-monthly-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const outputs = {};
  const summary = { addHeading() { return this; }, addRaw() { return this; }, async write() {} };
  return {
    github: { rest: { actions: { listWorkflowRuns } } },
    context: { repo: { owner: "example", repo: "dailycheck" }, payload: { repository: { default_branch: "main" } } },
    core: { setOutput(key, value) { outputs[key] = value; }, info() {}, summary },
    now: new Date("2026-11-01T00:17:00Z"),
    logPath: path.join(dir, "logs", "checkin-monthly.log"),
    outputs,
  };
}

function run(id, conclusion, created_at = "2026-10-15T04:00:00Z") {
  return { id, conclusion, created_at, status: "completed" };
}

test("北京时间月份边界、跨年和闰年，以及补记月份校验", () => {
  const range = monthRange(new Date("2026-12-31T16:17:00Z"));
  assert.equal(range.month, "2026-12");
  assert.equal(new Date(range.start).toISOString(), "2026-11-30T16:00:00.000Z");
  assert.equal(new Date(range.end).toISOString(), "2026-12-31T16:00:00.000Z");
  const leap = monthRange(new Date("2028-02-29T16:17:00Z"));
  assert.equal(leap.month, "2028-02");
  assert.equal((leap.end - leap.start) / 86400000, 29);
  for (const invalid of ["2026-13", "2026-11", "2027-01", "2026-10;exit 1"]) {
    assert.throws(() => monthRange(new Date("2026-11-01T00:17:00Z"), invalid));
  }
});

test("仅统计月内签到记录，按运行去重，并保留已有日志", async (t) => {
  const rows = [
    run(1, "success", "2026-09-30T16:00:00Z"),
    run(1, "success", "2026-09-30T16:00:00Z"),
    run(2, "failure"), run(3, "timed_out"), run(4, "cancelled"), run(5, "skipped"),
    run(6, "success", "2026-10-31T15:59:59Z"),
    run(7, "success", "2026-10-31T16:00:00Z"),
    run(8, "failure", "2026-09-30T15:59:59Z"),
  ];
  const f = await fixture(t, async (params) => {
    assert.equal(params.workflow_id, "checkin.yml");
    assert.equal(params.branch, "main");
    assert.equal(params.created, "2026-09-30T16:00:00Z..2026-10-31T15:59:59Z");
    return { data: { total_count: rows.length, workflow_runs: rows } };
  });
  await fs.mkdir(path.dirname(f.logPath), { recursive: true });
  await fs.writeFile(f.logPath, "# 已有日志\n2026-09 | 成功 1 次\n");
  await monthlySummary(f);
  assert.equal(await fs.readFile(f.logPath, "utf8"), "# 已有日志\n2026-09 | 成功 1 次\n2026-10 | 成功 2 次 | 失败 2 次 | 其他 2 次 | 总计 6 次\n");
  assert.equal(f.outputs.updated, "true");
  assert.equal(f.outputs.month, "2026-10");
});

test("读取超过一页的完整记录", async (t) => {
  const pages = [];
  const f = await fixture(t, async ({ page }) => {
    pages.push(page);
    return { data: { total_count: 101, workflow_runs: page === 1
      ? Array.from({ length: 100 }, (_, i) => run(i, "success"))
      : [run(100, "failure")] } };
  });
  await monthlySummary(f);
  assert.deepEqual(pages, [1, 2]);
  assert.match(await fs.readFile(f.logPath, "utf8"), /成功 100 次 \| 失败 1 次 \| 其他 0 次 \| 总计 101 次/);
});

test("月份已记录时不再查询 API 或重复追加", async (t) => {
  const f = await fixture(t, async () => assert.fail("不应重复查询"));
  await fs.mkdir(path.dirname(f.logPath), { recursive: true });
  const existing = "2026-10 | 成功 20 次 | 失败 0 次 | 其他 0 次 | 总计 20 次\n";
  await fs.writeFile(f.logPath, existing);
  await monthlySummary(f);
  assert.equal(await fs.readFile(f.logPath, "utf8"), existing);
  assert.equal(f.outputs.updated, "false");
});

test("无记录月份如实记零，并支持手动补记", async (t) => {
  const f = await fixture(t, async () => ({ data: { total_count: 0, workflow_runs: [] } }));
  await monthlySummary({ ...f, requestedMonth: "2026-09" });
  assert.equal(await fs.readFile(f.logPath, "utf8"), "2026-09 | 成功 0 次 | 失败 0 次 | 其他 0 次 | 总计 0 次\n");
});

test("未结束的运行、API 错误或查询上限不会产生不完整月报", async (t) => {
  const cases = [
    async () => ({ data: { total_count: 1, workflow_runs: [{ ...run(1, null), status: "in_progress" }] } }),
    async () => { throw new Error("HTTP 403"); },
    async () => ({ data: { total_count: 1001, workflow_runs: [] } }),
    async () => ({ data: { total_count: 2, workflow_runs: [run(1, "success")] } }),
  ];
  for (const list of cases) {
    const f = await fixture(t, list);
    await assert.rejects(monthlySummary(f));
    await assert.rejects(fs.readFile(f.logPath), { code: "ENOENT" });
    assert.equal(f.outputs.updated, "false");
  }
});
