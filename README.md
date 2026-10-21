# DailyCheck

天翼云盘个人签到脚本。它只执行个人签到，并可将结果推送到一个或多个通知渠道；不处理家庭空间或文件操作。

签到使用参考项目采用的 `cloud189-sdk`，并在本地 `.token/` 保存各账号的 SDK 会话。令牌目录已加入 Git 忽略规则；不要把账号密码或令牌提交到仓库。

## 每日自动签到

GitHub Actions 工作流默认每天北京时间 10:35（UTC 02:35）运行，也可以在 Actions 页面手动触发。

1. 打开仓库的 **Settings → Secrets and variables → Actions**，在 **Repository secrets** 中添加 `TY_ACCOUNTS`，值为 JSON 数组：

   ```json
   [{"userName":"账号 1","password":"密码 1"},{"userName":"账号 2","password":"密码 2"}]
   ```

   单个账号也使用数组格式，只保留一个对象即可。请直接在 GitHub 的 Secret 表单中填写真实值，不要把真实账号密码写进文件或提交到仓库。工作流会将这个 Secret 暴露为运行时环境变量 `TY_ACCOUNTS`。
2. 如需通知，在同一页面添加相应的 Repository secrets 或 Repository variables。
3. 打开仓库的 **Actions** 页面，手动运行“天翼云盘每日签到”一次；之后查看运行记录。

### 可选通知渠道

不配置通知渠道时，签到照常运行。要启用通知，请在仓库 **Settings → Secrets and variables → Actions** 中按所选渠道添加凭据，可以同时配置多个渠道。可选的 WPUSH、Bark 参数放在 **Repository variables** 中：

| 渠道 | Repository secrets | Repository variables（可选） |
| --- | --- | --- |
| Server 酱 | `SENDKEY` | — |
| Telegram | `TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID` | — |
| 企业微信机器人 | `WECOM_BOT_KEY`、`WECOM_BOT_TELPHONE`（可选，被 @ 的手机号） | — |
| WxPusher | `WX_PUSHER_APP_TOKEN`、`WX_PUSHER_UID` | — |
| PushPlus | `PUSH_PLUS_TOKEN` | — |
| WPUSH | `WPUSH_APIKEY` | `WPUSH_CHANNEL`、`WPUSH_TOPIC_CODE`（可选） |
| ShowDoc | `SHOWDOC_KEY` | — |
| Bark | `BARK_KEY` | `BARK_SERVER`（可选，默认 `https://api.day.app`） |

通知中只包含各账号的签到状态和获得容量，不包含账号名、密码或会话令牌。已配置渠道推送失败时，工作流会显示失败状态；未配置的渠道会跳过。

工作流会缓存 SDK 会话以减少重复密码登录。请只允许可信的仓库工作流运行，并避免添加能读取 Actions 缓存的不可信工作流。GitHub 的定时工作流可能延迟启动。

### 签到失败排查

出现“第 N 个账号登录失败”表示账号 JSON 已读取成功，但尚未取得登录会话；“第 N 个账号签到失败”表示登录后调用签到接口失败。请查看 Actions 中 **Sign in** 步骤括号里的原因：

- 天翼认证接口提示账号、密码错误：检查对应账号对象，确认密码中的特殊字符与原密码一致。
- 提示验证码、安全验证或操作频繁：先在天翼官方网页或客户端完成验证，稍后重试；脚本不处理验证码。
- `HTTP 403`、`ETIMEDOUT`、`ENOTFOUND` 等：检查运行环境到天翼接口的连接，不能仅凭这些错误判断密码是否正确。
- 提示登录页面或接口返回格式不符合 SDK 预期：可能是接口变更或安全验证页面，需要结合后续日志排查。

日志保留认证接口的错误原因并过滤已配置的账号和密码，不输出完整请求、响应或会话令牌。排查时只分享错误提示，不要分享 `TY_ACCOUNTS` 或 `.token` 文件。

## 本地运行

需要 Node.js 20 或更新版本。

```sh
npm ci
TY_ACCOUNTS='[{"userName":"你的账号","password":"你的密码"}]' npm start
```

Windows PowerShell 可先将 JSON 字符串赋给 `$env:TY_ACCOUNTS`，再运行 `npm start`。本地 `.token` 目录保存各账号的登录会话，请勿分享或提交该目录。
