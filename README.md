# DailyCheck

天翼云盘个人签到和 B 站每日任务脚本，支持多账号，在同一个 GitHub Actions 工作流中执行，并将两个平台的结果合并推送。

签到使用参考项目采用的 `cloud189-sdk`，并在本地 `.token/` 保存各账号的 SDK 会话。令牌目录已加入 Git 忽略规则；不要把账号密码或令牌提交到仓库。

## 每日自动签到

GitHub Actions 工作流默认每天北京时间 10:35（UTC 02:35）运行，也可以在 Actions 页面手动触发。

1. 如需天翼云盘签到，打开仓库的 **Settings → Secrets and variables → Actions**，在 **Repository secrets** 中添加 `TY_ACCOUNTS`，值为 JSON 数组：

   ```json
   [{"userName":"账号 1","password":"密码 1"},{"userName":"账号 2","password":"密码 2"}]
   ```

   单个账号也使用数组格式，只保留一个对象即可。请直接在 GitHub 的 Secret 表单中填写真实值，不要把真实账号密码写进文件或提交到仓库。工作流会将这个 Secret 暴露为运行时环境变量 `TY_ACCOUNTS`。
2. 如需通知，在同一页面添加相应的 Repository secrets 或 Repository variables。
3. 打开仓库的 **Actions** 页面，手动运行“每日签到（天翼云盘和B站）”一次；之后查看运行记录。

### B 站多账号配置

B 站任务流程参考 [dangks/bilibili_checkin](https://github.com/dangks/bilibili_checkin)，使用 Node.js 实现，与天翼云盘共用每日工作流和通知渠道。

在同一个 **Repository secrets** 页面添加 **`BILI_ACCOUNTS`**。所有 B 站账号和各自的任务、投币设置都放在这一个 JSON 数组中，无需再添加单独的投币环境变量：

```json
[
  {
    "cookie": "SESSDATA=账号1的值; bili_jct=账号1的值; DedeUserID=账号1的值",
    "coinCount": 1,
    "reserveCoins": 10,
    "coinSource": "dynamic",
    "videoIds": [],
    "likeOnCoin": false,
    "tasks": {
      "share": true,
      "watch": true,
      "coin": true,
      "live": true,
      "manga": true
    }
  },
  {
    "cookie": "SESSDATA=账号2的值; bili_jct=账号2的值; DedeUserID=账号2的值",
    "coinCount": 2,
    "reserveCoins": 5,
    "coinSource": "ranking"
  }
]
```

在浏览器登录 B 站后，通过开发者工具的 Cookies 或 Network 获取完整 Cookie，至少包含 `SESSDATA`、`bili_jct`、`DedeUserID`，建议保留完整 Cookie。直接将 JSON 数组填入 Secret，不要加 `BILI_ACCOUNTS=`、代码框或外层单引号。Cookie 失效后更新同一个 Secret。

| JSON 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `cookie` | 必填 | 当前账号的完整登录 Cookie |
| `coinCount` | `1` | 每日投币目标，整数 `0`～`5`；`0` 为关闭，消耗账号的硬币余额 |
| `reserveCoins` | `0` | 最低保留硬币数，达到余额下限时跳过投币 |
| `coinSource` | `"dynamic"` | 优先选关注动态视频；`"ranking"` 为排行榜。动态没有可用视频时回退排行榜 |
| `videoIds` | `[]` | 指定 BV 号数组；非空时只使用这些视频，不再选择动态或排行榜视频 |
| `likeOnCoin` | `false` | 投币时是否同时点赞 |
| `tasks` | 五项均为 `true` | `share` 分享、`watch` 观看、`coin` 投币、`live` 直播签到、`manga` 漫画签到；可单独关闭 |

每个账号先检查登录状态，再分别执行任务。一项任务或一个账号失败后，会继续执行其他任务和账号。直播、漫画接口明确返回已经签到时视为完成；明确下线、活动结束或 HTTP 404/410 时会标记跳过，不能保证已下线活动恢复或仍有奖励。其他任务失败会使最终工作流失败。

观看任务使用参考项目的心跳上报方式，接口接受请求不代表一定获得经验。投币前会检查当天投币经验、余额和目标视频已投币状态，基于查询结果只尝试补足当天配置的目标；投币请求发生异常时停止本账号投币，不自动重试，以避免结果不确定时重复扣币。

`TY_ACCOUNTS` 和 `BILI_ACCOUNTS` 可以同时配置，也可只配置其中一个。两个平台执行后统一调用现有推送程序，按平台、账号和任务换行展示；原有 `SENDKEY` 等通知配置可以继续使用。

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

通知中只包含各账号的签到状态、获得容量和 B 站任务结果，不包含账号名、密码、Cookie 或会话令牌。已配置渠道推送失败时，工作流会显示失败状态；未配置的渠道会跳过。

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
