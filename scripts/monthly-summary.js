"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const OFFSET_MS = 8 * 60 * 60 * 1000;
const FAILED_CONCLUSIONS = new Set(["failure", "timed_out", "startup_failure", "action_required"]);
const LOG_PATH = "logs/checkin-monthly.log";

function monthRange(now, requestedMonth) {
  const local = new Date(now.getTime() + OFFSET_MS);
  const current = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1));
  const previous = new Date(current);
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  const month = requestedMonth || previous.toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month >= current.toISOString().slice(0, 7)) {
    throw new Error("统计月份必须是已经结束的月份，格式为 YYYY-MM。");
  }
  const first = new Date(`${month}-01T00:00:00Z`);
  const next = new Date(first);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return {
    month,
    start: first.getTime() - OFFSET_MS,
    end: next.getTime() - OFFSET_MS,
  };
}

async function monthlySummary({ github, context, core, now = new Date(), requestedMonth = "", logPath = LOG_PATH }) {
  core.setOutput("updated", "false");
  const { month, start, end } = monthRange(now, requestedMonth.trim());
  let existing = "";
  try {
    existing = await fs.readFile(logPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existing.split(/\r?\n/).some((line) => line.startsWith(`${month} |`))) {
    core.info(`${month} 的月报已记录，跳过重复提交。`);
    return;
  }

  const runs = [];
  let expectedCount;
  for (let page = 1; page <= 10; page++) {
    const { data } = await github.rest.actions.listWorkflowRuns({
      ...context.repo,
      workflow_id: "checkin.yml",
      branch: context.payload.repository.default_branch,
      created: `${new Date(start).toISOString().replace(".000Z", "Z")}..${new Date(end - 1000).toISOString().replace(".000Z", "Z")}`,
      per_page: 100,
      page,
    });
    if (data.total_count > 1000) {
      throw new Error("当月运行记录超过 GitHub 查询上限，停止写入以免统计不完整。");
    }
    if (expectedCount !== undefined && expectedCount !== data.total_count) {
      throw new Error("查询过程中运行记录数量发生变化，请重新生成月报。");
    }
    expectedCount = data.total_count;
    runs.push(...data.workflow_runs);
    if (runs.length >= expectedCount) break;
    if (data.workflow_runs.length < 100 || page === 10) {
      throw new Error("未完整获取当月运行记录，停止写入。");
    }
  }

  // A workflow run keeps its ID when rerun; count its latest conclusion once.
  const unique = new Map();
  for (const run of runs) {
    const createdAt = Date.parse(run.created_at);
    if (!Number.isFinite(createdAt)) throw new Error("运行记录缺少有效创建时间，停止写入。");
    if (createdAt >= start && createdAt < end) unique.set(run.id, run);
  }
  let success = 0;
  let failure = 0;
  let other = 0;
  for (const run of unique.values()) {
    if (run.status !== "completed" || !run.conclusion) {
      throw new Error("当月仍有未结束的运行，请等待完成后手动重新生成月报。");
    }
    if (run.conclusion === "success") success++;
    else if (FAILED_CONCLUSIONS.has(run.conclusion)) failure++;
    else other++;
  }
  const line = `${month} | 成功 ${success} 次 | 失败 ${failure} 次 | 其他 ${other} 次 | 总计 ${unique.size} 次`;
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.writeFile(logPath, `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${line}\n`);
  core.setOutput("month", month);
  core.setOutput("updated", "true");
  core.info(line);
  await core.summary.addHeading("天翼云盘签到月报").addRaw(line).write();
}

module.exports = { monthlySummary, monthRange };
