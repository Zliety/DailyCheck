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

## 每月运行日志

“签到月度统计”工作流在每月 1 号北京时间 **08:17** 自动统计上个月的签到运行记录，并向 [logs/checkin-monthly.log](logs/checkin-monthly.log) 追加一行，再提交到默认分支，形成每月一次的仓库更新。使用自带的 `GITHUB_TOKEN`，无需新增 Secret。

统计包含默认分支的定时和手动签到运行，按北京时间的运行创建时间归属月份；同一条运行记录的重跑只计一次，以统计时的最终状态为准。成功、失败按整个签到工作流统计，不按账号数统计；账号签到失败或通知失败导致工作流失败时，也会计入失败。超时计入失败，取消、跳过等状态单独计入“其他”。没有运行记录的月份会记录为 0 次，不能据此认为当月签到正常。

同一个月份只写入一次；如果定时任务漏触发，可以在 Actions 中手动运行“签到月度统计”，月份留空统计上个月，也可填写已经结束的月份（如 `2026-10`）补记。若仍有未结束的运行或无法完整读取记录，工作流会报错并停止写入。历史统计依赖 GitHub 保留的运行记录，应在记录被清理前生成。

月报工作流仅申请读取 Actions 记录和提交日志所需的权限。若默认分支有禁止直接推送的保护规则，需要允许该工作流提交。GitHub 定时触发可能延迟或漏触发；已经因长期无活动被禁用的工作流仍需在 Actions 页面重新启用。

## 本地运行

需要 Node.js 20 或更新版本。

```sh
npm ci
TY_ACCOUNTS='[{"userName":"你的账号","password":"你的密码"}]' npm start
```

Windows PowerShell 可先将 JSON 字符串赋给 `$env:TY_ACCOUNTS`，再运行 `npm start`。本地 `.token` 目录保存各账号的登录会话，请勿分享或提交该目录。
