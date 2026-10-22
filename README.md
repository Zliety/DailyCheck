# DailyCheck

天翼云盘个人签到和 B 站每日任务脚本，支持多账号，在同一个 GitHub Actions 工作流中执行，并将结果合并推送。

## 通用说明

### GitHub Actions 运行

工作流默认每天北京时间 **10:35**（UTC 02:35）运行。GitHub 的定时任务可能延迟启动，也可以在 Actions 页面手动运行。

1. 打开仓库 **Settings → Secrets and variables → Actions**，按需在 **Repository secrets** 中添加下列配置，具体格式见对应的平台章节。
2. 如需通知，在同一页面添加通知渠道的凭据。
3. 打开仓库 **Actions** 页面，选择“每日签到（天翼云盘和B站）”，点击 **Run workflow** 手动执行一次。

| 平台 | Repository Secret | 配置说明 |
| --- | --- | --- |
| 天翼云盘 | `TY_ACCOUNTS` | [天翼云盘配置](#天翼云盘) |
| B 站 | `BILI_ACCOUNTS` | [B 站配置](#b-站) |

两个平台可以同时启用，也可以只配置其中一个。每个平台的全部账号放在对应 Secret 的一个 JSON 数组中；单账号也使用数组。将 JSON 直接填入 Secret，不要附加变量名、等号、代码框或外层单引号。请勿把真实账号密码、Cookie 或令牌写入仓库文件。

各平台独立执行，一个平台失败后会继续另一个平台。执行结束后统一推送结果；有任务或通知失败时，最终工作流会显示失败状态。

### 统一推送

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

通知中包含各账号的签到状态、获得容量，以及 B 站的等级、经验进度、硬币余额和任务结果，不包含账号名、密码、Cookie 或会话令牌。B 站会在任务结束后刷新账号信息；刷新失败时显示任务前快照并明确标注，满级账号会标注“已满级”。已配置渠道推送失败时，工作流会显示失败状态；未配置的渠道会跳过。


两个平台共用上表的通知配置，按平台和账号分组、逐行展示结果。已有的 `SENDKEY` 等凭据可以继续使用。

### 本地运行

需要 Node.js 20 或更新版本。先在项目目录安装依赖：

```sh
npm ci
```

按照下方各平台的“本地配置”设置所需环境变量，再执行：

```sh
npm start
```

只运行一个平台时，仅设置该平台的账号变量；同时运行时，在同一终端设置两个平台的变量，再运行一次 `npm start`。如需推送，同样通过进程环境变量设置上表中的通知凭据。

GitHub Secrets 不会自动同步到本地，脚本不会自动读取 `.env` 文件。`npm start` 每次执行一轮任务后退出；本地定时执行需要自行配置系统定时任务，GitHub Actions 的定时设置只在 GitHub 上生效。

## 天翼云盘

### 账号配置

使用 `cloud189-sdk` 执行个人签到。添加 Repository Secret **`TY_ACCOUNTS`**，值为账号 JSON 数组：

```json
[
  {"userName": "账号1", "password": "账号1的密码"},
  {"userName": "账号2", "password": "账号2的密码"}
]
```

`userName` 为天翼账号，`password` 为对应密码。程序会将 Secret 作为运行时环境变量读取，并逐个账号执行签到。

天翼登录会话保存在 `.token/`，GitHub Actions 会缓存该目录以减少重复密码登录。该目录已加入 Git 忽略规则，请勿分享或提交；请只允许可信的工作流访问会话缓存。

### 本地配置

Linux / macOS（Bash、Zsh）：

```sh
export TY_ACCOUNTS='[{"userName":"你的天翼账号","password":"你的天翼密码"}]'
```

Windows PowerShell：

```powershell
$env:TY_ACCOUNTS = '[{"userName":"你的天翼账号","password":"你的天翼密码"}]'
```

设置完成后，按前面的本地运行说明执行 `npm start`。

## B 站

### 账号和任务配置

B 站任务流程参考 [dangks/bilibili_checkin](https://github.com/dangks/bilibili_checkin)，使用 Node.js 实现。

在 **Repository secrets** 页面添加 **`BILI_ACCOUNTS`**。所有 B 站账号和各自的任务、投币设置都放在这一个 JSON 数组中。每个账号只需在 `cookie` 中粘贴完整 Cookie，程序会自动识别 `bili_jct`、`SESSDATA`、`DedeUserID`，其他 Cookie 字段也会保留发送；无需为这些字段或投币设置分别添加环境变量。

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

完整 Cookie 通常类似 `buvid3=...; SESSDATA=...; bili_jct=...; DedeUserID=...; ...`，字段顺序不限，无需手动拆分。必须包含 `SESSDATA`、`bili_jct`、`DedeUserID`，缺少时程序会指出字段名。Cookie 字符串不要换行。程序优先按标准 JSON 解析，并兼容直接粘贴的 Cookie 中未转义的双引号，无需逐个手动处理；已经正确转义的写法也可继续使用。数组、对象、字段之间的逗号及其他配置仍须符合 JSON 格式；反斜杠仍按 JSON 规则转义。无法明确识别 Cookie 边界时会报错，不会猜测投币设置。

Cookie 失效后，在同一个 `BILI_ACCOUNTS` Secret 中更新对应账号的完整 Cookie。

分享、投币还可能校验浏览器设备信息。请保留完整 Cookie 中已有的 `buvid3`、`buvid4`、`b_nut`、`_uuid` 等字段，程序会自动读取，无需新增 Secret，也不会生成或替换这些设备字段。登录成功仍可能遇到分享、投币被安全策略拒绝；程序会显示缺失字段名或运行节点检查提示，且不会自动重试投币请求。

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


### 本地配置

Linux / macOS（Bash、Zsh）：

```sh
export BILI_ACCOUNTS='[{"cookie":"账号1的完整Cookie","coinCount":1},{"cookie":"账号2的完整Cookie","coinCount":2}]'
```

Windows PowerShell：

```powershell
$env:BILI_ACCOUNTS = '[{"cookie":"账号1的完整Cookie","coinCount":1},{"cookie":"账号2的完整Cookie","coinCount":2}]'
```

将占位文字替换为各账号的完整 Cookie。配置格式与 `BILI_ACCOUNTS` Secret 一致，其他投币设置和任务开关也可写在同一 JSON 中。设置完成后，按前面的本地运行说明执行 `npm start`。
