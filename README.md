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

在同一个 **Repository secrets** 页面添加 **`BILI_ACCOUNTS`**。所有 B 站账号和各自的任务、投币设置都放在这一个 JSON 数组中。每个账号只需在 `cookie` 中粘贴完整 Cookie，程序会自动识别 `bili_jct`、`SESSDATA`、`DedeUserID`，其他 Cookie 字段也会保留发送；无需为这些字段或投币设置分别添加环境变量。

最简多账号配置如下，将占位文字替换为各账号的完整 Cookie：

```json
[
  {"cookie": "账号1的完整Cookie", "coinCount": 1},
  {"cookie": "账号2的完整Cookie", "coinCount": 2}
]
```

如需设置保留余额、视频来源或任务开关，可以使用完整配置：

```json
[
  {
    "cookie": "账号1的完整Cookie",
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
    "cookie": "账号2的完整Cookie",
    "coinCount": 2,
    "reserveCoins": 5,
    "coinSource": "ranking"
  }
]
```

获取完整 Cookie：在浏览器登录 B 站，按 `F12` 打开开发者工具，切换到 **Network（网络）** 并刷新页面。选中发往 B 站的已登录请求，在 **Request Headers（请求标头）** 中找到 **Cookie**，复制它的整段值，粘贴到对应账号的 `cookie` 字符串中。只复制值，不要带 `Cookie:` 标头名称，也不要复制响应中的 `Set-Cookie`。

完整 Cookie 通常类似 `buvid3=...; SESSDATA=...; bili_jct=...; DedeUserID=...; ...`，字段顺序不限，无需手动拆分。必须包含 `SESSDATA`、`bili_jct`、`DedeUserID`，缺少时程序会指出字段名。Cookie 字符串不要换行；其中的双引号和反斜杠须按 JSON 规则分别写为 `\"` 和 `\\`。

直接将 JSON 数组填入 Secret，不要加 `BILI_ACCOUNTS=`、代码框或外层单引号。Cookie 失效后更新同一个 Secret。

| JSON 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `cookie` | 必填 | 粘贴当前账号的完整登录 Cookie，程序自动识别所需字段 |
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

## 本地运行

需要 Node.js 20 或更新版本。先在项目目录安装依赖：

```sh
npm ci
```

**Linux / macOS（Bash、Zsh）**：设置环境变量后执行，下面示例同时运行天翼云盘和两个 B 站账号：

```sh
export TY_ACCOUNTS='[{"userName":"你的天翼账号","password":"你的天翼密码"}]'
export BILI_ACCOUNTS='[{"cookie":"账号1的完整Cookie","coinCount":1},{"cookie":"账号2的完整Cookie","coinCount":2}]'
npm start
```

**Windows PowerShell**：

```powershell
$env:TY_ACCOUNTS = '[{"userName":"你的天翼账号","password":"你的天翼密码"}]'
$env:BILI_ACCOUNTS = '[{"cookie":"账号1的完整Cookie","coinCount":1},{"cookie":"账号2的完整Cookie","coinCount":2}]'
npm start
```

请将示例中的账号、密码和 Cookie 替换为真实值。B 站的 `cookie` 直接填写完整 Cookie，配置格式与上方 `BILI_ACCOUNTS` Secret 一致，其他投币设置和任务开关也可写在同一 JSON 中。只运行一个平台时，只需设置对应的 `TY_ACCOUNTS` 或 `BILI_ACCOUNTS`。

如需本地推送，同样通过进程环境变量设置上表中的 `SENDKEY` 等通知凭据；两个平台的结果会合并发送。GitHub 中的 Secrets 不会自动同步到本地，脚本也不会自动读取 `.env` 文件。

`npm start` 每次执行一轮任务后退出。本地定时执行需要自行配置系统定时任务；GitHub Actions 的每日定时只在 GitHub 上生效。本地 `.token` 目录保存天翼云盘账号的登录会话，请勿分享或提交该目录。
