"use strict";

const DEFAULT_BARK_SERVER = "https://api.day.app";
const REQUEST_TIMEOUT_MS = 15_000;

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const error = new Error("Notification request failed.");
    error.statusCode = response.status;
    throw error;
  }
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  return { ok: true, statusCode: response.status, body };
}

function postJson(url, body) {
  return request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function configured(value) {
  return typeof value === "string" && value.length > 0;
}

function barkUrl(server, key, title, content) {
  const parsed = new URL(server || DEFAULT_BARK_SERVER);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("invalid Bark server URL");
  }
  const basePath = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${basePath}/${encodeURIComponent(key)}/${encodeURIComponent(title)}/${encodeURIComponent(content)}`;
}

function createChannels(env) {
  const channels = [];
  const incomplete = [];
  const add = (name, send) => channels.push({ name, send });

  if (configured(env.SENDKEY)) {
    add("Server 酱", async (title, content) => {
      const url = `https://sctapi.ftqq.com/${encodeURIComponent(env.SENDKEY)}.send`;
      const form = new URLSearchParams({ title, desp: content });
      const result = await request(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form,
      });
      return result.ok && result.body?.code === 0;
    });
  }

  if (configured(env.TELEGRAM_BOT_TOKEN) || configured(env.TELEGRAM_CHAT_ID)) {
    if (configured(env.TELEGRAM_BOT_TOKEN) && configured(env.TELEGRAM_CHAT_ID)) {
      add("Telegram", async (title, content) => {
        const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
        const result = await postJson(url, {
          chat_id: env.TELEGRAM_CHAT_ID,
          text: `${title}\n\n${content}`,
        });
        return result.ok && result.body?.ok === true;
      });
    } else {
      incomplete.push("Telegram");
    }
  }

  if (configured(env.WECOM_BOT_KEY) || configured(env.WECOM_BOT_TELPHONE)) {
    if (configured(env.WECOM_BOT_KEY)) {
      add("企业微信机器人", async (title, content) => {
        const url = new URL("https://qyapi.weixin.qq.com/cgi-bin/webhook/send");
        url.searchParams.set("key", env.WECOM_BOT_KEY);
        const mention = configured(env.WECOM_BOT_TELPHONE)
          ? [env.WECOM_BOT_TELPHONE]
          : [];
        const result = await postJson(url, {
          msgtype: "text",
          text: {
            content: `${title}\n\n${content}`,
            mentioned_mobile_list: mention,
          },
        });
        return result.ok && result.body?.errcode === 0;
      });
    } else {
      incomplete.push("企业微信机器人");
    }
  }

  if (configured(env.WX_PUSHER_APP_TOKEN) || configured(env.WX_PUSHER_UID)) {
    if (configured(env.WX_PUSHER_APP_TOKEN) && configured(env.WX_PUSHER_UID)) {
      add("WxPusher", async (title, content) => {
        const result = await postJson("https://wxpusher.zjiecode.com/api/send/message", {
          appToken: env.WX_PUSHER_APP_TOKEN,
          contentType: 1,
          summary: title,
          content,
          uids: [env.WX_PUSHER_UID],
        });
        return result.ok && result.body?.code === 1000;
      });
    } else {
      incomplete.push("WxPusher");
    }
  }

  if (configured(env.PUSH_PLUS_TOKEN)) {
    add("PushPlus", async (title, content) => {
      const result = await postJson("https://www.pushplus.plus/send", {
        token: env.PUSH_PLUS_TOKEN,
        title,
        content,
      });
      return result.ok && result.body?.code === 200;
    });
  }

  if (
    configured(env.WPUSH_APIKEY) ||
    configured(env.WPUSH_CHANNEL) ||
    configured(env.WPUSH_TOPIC_CODE)
  ) {
    if (configured(env.WPUSH_APIKEY)) {
      add("WPUSH", async (title, content) => {
        const body = {
          apikey: env.WPUSH_APIKEY,
          title,
          content,
        };
        if (configured(env.WPUSH_CHANNEL)) body.channel = env.WPUSH_CHANNEL;
        if (configured(env.WPUSH_TOPIC_CODE)) body.topic_code = env.WPUSH_TOPIC_CODE;
        const result = await postJson("https://api.wpush.cn/api/v1/send", body);
        return result.ok && result.body?.code === 0;
      });
    } else {
      incomplete.push("WPUSH");
    }
  }

  if (configured(env.SHOWDOC_KEY)) {
    add("ShowDoc", async (title, content) => {
      const url = new URL(
        `https://push.showdoc.com.cn/server/api/push/${encodeURIComponent(env.SHOWDOC_KEY)}`,
      );
      url.searchParams.set("title", title);
      url.searchParams.set("content", content);
      const result = await request(url);
      const success =
        result.body == null ||
        !Object.hasOwn(result.body, "error_code") ||
        result.body.error_code === 0;
      return result.ok && success;
    });
  }

  if (configured(env.BARK_KEY) || configured(env.BARK_SERVER)) {
    if (configured(env.BARK_KEY)) {
      add("Bark", async (title, content) => {
        const url = barkUrl(env.BARK_SERVER, env.BARK_KEY, title, content);
        const result = await request(url);
        return result.ok;
      });
    } else {
      incomplete.push("Bark");
    }
  }

  return { channels, incomplete };
}

async function sendNotifications(title, content) {
  const { channels, incomplete } = createChannels(process.env);
  let failed = incomplete.length > 0;

  for (const name of incomplete) {
    console.error(`推送配置不完整：${name}。`);
  }

  await Promise.all(
    channels.map(async ({ name, send }) => {
      try {
        const delivered = await send(title, content);
        if (!delivered) {
          failed = true;
          console.error(`推送失败：${name}。`);
          return;
        }
        console.log(`推送成功：${name}。`);
      } catch (error) {
        failed = true;
        const status = Number.isInteger(error?.statusCode)
          ? `（HTTP ${error.statusCode}）`
          : "";
        console.error(`推送失败：${name}${status}。`);
      }
    }),
  );

  return failed;
}

module.exports = { sendNotifications };
