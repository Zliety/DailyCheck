# DailyCheck

天翼云盘个人签到、B 站每日任务、WPS 和百度贴吧签到脚本，支持多账号，在同一个 GitHub Actions 工作流中执行，并将结果合并推送。

## 通用说明

### GitHub Actions 运行

工作流默认每天北京时间 **10:35**（UTC 02:35）运行。GitHub 的定时任务可能延迟启动，也可以在 Actions 页面手动运行。

1. 打开仓库 **Settings → Secrets and variables → Actions**，按需在 **Repository secrets** 中添加下列配置，具体格式见对应的平台章节。
2. 如需通知，在同一页面添加通知渠道的凭据。
3. 打开仓库 **Actions** 页面，选择“每日签到（天翼云盘、B站、WPS和百度贴吧）”，点击 **Run workflow** 手动执行一次。

| 平台 | Repository Secret | 配置说明 |
| --- | --- | --- |
| 天翼云盘 | `TY_ACCOUNTS` | [天翼云盘配置](#天翼云盘) |
| B 站 | `BILI_ACCOUNTS` | [B 站配置](#b-站) |
| WPS | `WPS_ACCOUNTS` | [WPS 配置](#wps) |
| 百度贴吧 | `TIEBA_ACCOUNTS` | [百度贴吧配置](#百度贴吧) |

四个平台可以按需启用一个或多个。未配置某个平台的账号 Secret 时自动跳过，不影响其他平台。每个平台的全部账号放在对应 Secret 的一个 JSON 数组中；单账号也使用数组。将 JSON 直接填入 Secret，不要附加变量名、等号、代码框或外层单引号。请勿把真实账号密码、Cookie 或令牌写入仓库文件。

各平台独立执行，一个平台失败后会继续其他平台。执行结束后统一推送结果；有任务或通知失败时，最终工作流会显示失败状态。

运行时，各平台之间随机等待 **10～30 秒**，同一平台的账号之间随机等待 **5～15 秒**，每次切换都会重新抽取秒数，并在 Actions 日志中显示。第一个平台及每个平台的第一个账号不额外等待，无需新增环境变量。

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

### 本地运行

需要 Node.js 20 或更新版本。先在项目目录安装依赖：

```sh
npm ci
```

按照下方各平台的“本地配置”设置所需环境变量，再执行：

```sh
npm start
```

只运行一个平台时，仅设置该平台的账号变量；同时运行时，在同一终端设置所需平台的变量，再运行一次 `npm start`。如需推送，同样通过进程环境变量设置上表中的通知凭据。

GitHub Secrets 不会自动同步到本地，脚本不会自动读取 `.env` 文件。`npm start` 每次执行一轮任务后退出；本地定时执行需要自行配置系统定时任务，GitHub Actions 的定时设置只在 GitHub 上生效。

## 天翼云盘

推送中的账号标题会自动显示脱敏手机号，例如 `账号 1（138****0001）`，直接读取 `TY_ACCOUNTS` 中的 `userName`，无需新增配置；非手机号账号只显示序号。

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

推送中的账号标题自动显示 B站昵称，例如 `账号 1（昵称）`；昵称从登录接口读取，无需新增配置。未登录或未获取到昵称时只显示账号序号。

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

完整 Cookie 通常类似 `buvid3=...; SESSDATA=...; bili_jct=...; DedeUserID=...; ...`，字段顺序不限，无需手动拆分。必须包含 `SESSDATA`、`bili_jct`、`DedeUserID`，缺少时程序会指出字段名。Cookie 字符串不要换行。

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


## WPS

### 账号和任务配置

功能参考 [Cat-zaizai/ZaiZaiCat-Checkin](https://github.com/Cat-zaizai/ZaiZaiCat-Checkin/tree/main/script/wps)，使用 Node.js 实现，与天翼云盘、B 站共用工作流和通知渠道。

在 **Repository secrets** 中新增 **`WPS_ACCOUNTS`**。所有 WPS 账号、备注和任务设置都放在这一个 JSON 数组中。六个任务开关写在各账号的 `tasks` 对象内，`true` 表示启用，`false` 表示关闭。将下方完整数组复制到 Secret 的值中，再替换每个账号的 Cookie 和备注：

```json
[
  {
    "name": "我的WPS",
    "cookie": "uid=123456; wps_sid=你的登录凭据; act_csrf_token=你的CSRF值",
    "maxLottery": 2,
    "maxTrials": 1,
    "tasks": {
      "centerSign": true,
      "centerLottery": true,
      "freeMember": true,
      "memberTrial": true,
      "dailyLottery": true,
      "reward": true
    }
  },
  {
    "name": "备用账号",
    "cookie": "uid=234567; wps_sid=另一个账号的登录凭据; csrf=另一个账号的CSRF值",
    "maxLottery": 0,
    "maxTrials": 0,
    "tasks": {
      "centerSign": true,
      "centerLottery": false,
      "freeMember": true,
      "memberTrial": false,
      "dailyLottery": false,
      "reward": true
    }
  }
]
```

示例中，第一个账号启用全部任务；第二个账号关闭两项抽奖和会员试用，保留任务中心签到、打卡领会员及七天奖励。每个账号的设置独立生效。单账号时只保留数组中的一个账号对象。

#### 从接口请求获取完整 Cookie 和用户 ID

1. 打开浏览器，访问 [WPS 签到页面](https://personal-act.wps.cn/)。
2. 登录你的 WPS 账号。
3. 按 `F12` 打开开发者工具。
4. 切换到 **Network（网络）** 标签。
5. 在页面上执行一次签到操作。
6. 在网络请求列表中找到签到相关的接口请求，例如 `sign_in`、`encrypt/key`。
7. 点击该请求，查看 **Request Headers（请求头）**。
8. 复制 `Cookie` 字段的完整值，填入对应账号的 `cookie`。

**提取用户 ID：**

在复制的 Cookie 中找到 `uid=数字` 部分，例如：

```text
uid=655953169; wps_sid=V02S...; csrf=...
```

这里的用户 ID 是 `655953169`。程序会自动读取 `uid`，无需单独填写；需要手动指定时，使用本项目的 `userId` 字段。

**为什么从接口请求获取 Cookie？**

- 接口请求中的 Cookie 包含签到实际使用的认证信息，便于同时获取 `uid`、`wps_sid` 等字段。
- 从刚完成签到的请求中复制，可以减少使用过期或不完整 Cookie 的情况。
- 请复制请求头中的完整 Cookie 值，不要从地址栏复制，也不要带上 `Cookie:` 标头名称。

| JSON 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `cookie` | 必填 | 当前账号的完整 Cookie，不能换行 |
| `name` | 不显示备注 | 可选，自定义账号备注，可填写“主账号”“备用账号”等任意便于识别的名称；不是 WPS 登录名，不参与登录或签到验证，仅显示在推送的账号序号后面 |
| `userId` | 从 Cookie 的 `uid` 读取 | Cookie 没有 `uid` 时可手动填写 WPS 用户 ID；两者都有时须一致 |
| `maxLottery` | `2` | 整数 `0`～`10`，任务中心和天天抽奖各自每轮运行的抽奖上限；`0` 关闭抽奖，仅使用接口返回的可用次数 |
| `maxTrials` | `1` | 整数 `0`～`10`，每轮最多申请的会员试用项目数；`0` 关闭申请，仅处理有库存、未申请且有剩余次数的项目 |
| `userAgent` | 浏览器 UA | 可选，如需指定，可填写获取 Cookie 时使用的浏览器 UA |
| `tasks` | 六项均为 `true` | 以下任务开关，可只填写需要关闭的项目 |

`tasks` 的六个字段已包含在上方完整示例中，可以分别修改为 `true` 或 `false`。未填写的任务开关默认启用；即使抽奖开关为 `true`，`maxLottery: 0` 也会关闭抽奖，`maxTrials: 0` 会关闭试用申请。

分别对应任务中心签到、任务中心抽奖、打卡领会员、会员免费试用、天天抽奖和七天奖励领取。积分在任务结束后查询。活动入口和组件从官方页面数据读取，已签到、已申请或无剩余次数时跳过对应提交；未找到活动时会标记跳过。权益以账号资格、当期活动及接口实际结果为准。

一个账号或任务失败后继续执行其他账号和任务。登录明确失效时停止该账号的后续请求。提交超时不会自动重试；旧打卡周期被接口明确判定失效时，会按参考项目的流程重新开始一个周期。

### 本地配置

Linux / macOS（Bash、Zsh）：

```sh
export WPS_ACCOUNTS='[{"name":"我的WPS","cookie":"uid=123456; wps_sid=你的登录凭据; act_csrf_token=你的CSRF值","maxLottery":2}]'
```

Windows PowerShell：

```powershell
$env:WPS_ACCOUNTS = '[{"name":"我的WPS","cookie":"uid=123456; wps_sid=你的登录凭据; act_csrf_token=你的CSRF值","maxLottery":2}]'
```

将示例替换为对应账号的完整 Cookie，再按前面的本地运行说明执行 `npm start`。

## 百度贴吧

### 账号配置

签到接口参考 [LuoSue/TiebaSignIn-1](https://github.com/LuoSue/TiebaSignIn-1)，多账号及昵称处理参考 [Sitoi/dailycheckin](https://github.com/Sitoi/dailycheckin/tree/main/dailycheckin/tieba)，使用 Node.js 实现。自动获取账号关注的贴吧，逐个执行签到。

在 **Repository secrets** 中新增 **`TIEBA_ACCOUNTS`**，将全部账号放在同一个 JSON 数组中。可以粘贴完整 Cookie，也可以只填写 BDUSS：

```json
[
  {"cookie": "BDUSS=账号1的登录凭据; 其他Cookie字段=原有值"},
  {"bduss": "账号2的BDUSS值", "name": "备用账号"}
]
```

| JSON 字段 | 说明 |
| --- | --- |
| `cookie` | 完整 Cookie，自动识别 `BDUSS`；保留其他原有 Cookie 字段 |
| `bduss` | 只填写 BDUSS 的值，与 `cookie` 二选一；两者都填写时必须一致 |
| `name` | 可选备注；优先显示接口返回的昵称，昵称不可用时显示备注 |

获取凭据：在浏览器登录 [百度贴吧](https://tieba.baidu.com/)，按 `F12` 打开开发者工具。在 **Network（网络）** 中选中贴吧的已登录请求，复制 **Request Headers（请求标头）** 中完整的 Cookie 值；或者在 **Application → Cookies** 中复制 `BDUSS` 的值。

账号标题显示为 `账号 1（贴吧昵称）`，账号汇总沿用“账号 / 无异常 / 异常”统计。每个账号会展示关注贴吧总数、成功数、已签到数、屏蔽数和失败数，并逐行显示各贴吧的结果。屏蔽的贴吧标记跳过；已签到视为正常。没有关注贴吧时明确标记跳过，列表读取失败则报告失败。

账号间沿用 **5～15 秒** 随机间隔；每个账号内的贴吧之间随机等待 **1～3 秒**，每处理 10 个贴吧额外等待 **5～10 秒**。签到提交超时不会自动重试，一个贴吧失败后继续其他贴吧；接口明确提示登录失效时停止本账号的剩余请求。

### 本地配置

Linux / macOS（Bash、Zsh）：

```sh
export TIEBA_ACCOUNTS='[{"cookie":"BDUSS=账号1的登录凭据"},{"bduss":"账号2的BDUSS值","name":"备用账号"}]'
```

Windows PowerShell：

```powershell
$env:TIEBA_ACCOUNTS = '[{"cookie":"BDUSS=账号1的登录凭据"},{"bduss":"账号2的BDUSS值","name":"备用账号"}]'
```

替换为各账号的真实凭据，再按前面的本地运行说明执行 `npm start`。结果与其他已启用平台合并推送。

## 免责声明

本项目仅供个人学习和技术交流使用，与天翼云盘、哔哩哔哩、WPS、百度贴吧及其运营方无隶属或合作关系。

请仅使用本人拥有或已获授权的账号，并遵守相关法律法规及各平台的用户协议、活动规则。请妥善保管账号密码、Cookie 和令牌，不要将其公开或提交到仓库。

自动化操作可能受到接口变更、活动调整、网络状况及平台安全策略的影响，本项目不保证任务成功、奖励到账或账号不受限制。投币、抽奖及试用申请等操作可能消耗账号资产、次数或资格，请在使用前确认配置。

使用者应自行评估使用风险并承担相应后果。在适用法律允许的范围内，项目作者及贡献者不对使用本项目造成的账号限制、资产损失、数据泄露或其他损失承担责任。
