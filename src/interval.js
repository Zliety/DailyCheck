"use strict";

const { randomInt } = require("node:crypto");
const { setTimeout: sleep } = require("node:timers/promises");

async function waitRandom(label, { min = 5, max = 15, wait = sleep } = {}) {
  const seconds = randomInt(min, max + 1);
  console.log(`${label}：随机等待 ${seconds} 秒。`);
  await wait(seconds * 1000);
}

module.exports = { waitRandom };
