# Multica（SCS Fork）

本仓库是 [Multica](https://github.com/multica-ai/multica) 的内部 fork，用于住友 / SCS 场景的差异化改造。

**基础能力请直接看上游文档，本仓库 README 不重复介绍。**

- 上游仓库：https://github.com/multica-ai/multica  
- 官方文档：https://multica.ai/docs  
- 自部署说明：见上游 `SELF_HOSTING.md`  
- 当前同步基线：见仓库根目录 `UPSTREAM_BASE`（现为 `v0.5.0`）

---

## 本 Fork 改了什么

以下仅列出相对上游的差异项（SCS-268 及后续迭代）。

### 1. 侧边栏固定区

- **选中态**：打开某个已固定的 Issue 时，固定行高亮（灰底），不再误亮下方「任务」导航。
- **运行中**：该票有 agent 任务在跑时，行右侧显示品牌色转圈。
- **未读语义（本会话）**：打开系统 / 固定项首次出现时视为已读；有新评论（典型是 agent 回完）即亮圆点 + 数量——**即便当前正开着这张票**也会显示，避免人在页面顶部却错过收尾消息。  
  清零方式：点进固定行，或在详情里滑动 / 点击一下。  
  **不再使用收件箱未读数**（避免数字粘住、点进去也不清）。
- **相对时间**：固定行在运行中 / 未读等状态旁显示紧凑相对时间（如 `3分钟`、`1小时`），取自票的最近活动时间（`last_activity_at`，否则 `updated_at`）。颜色按新旧分级：1 小时内偏实色强调，当天内用常规 muted，超过 1 天再淡化——久未动的票不抢视线。

### 2. Issue 打开速度与滚动位置

- 开过的票用 Query 缓存秒开：票号 URL 可从已有 UUID 缓存命中，避免整页骨架空等。
- 去掉「每次进详情强制 `getIssue`」；reactions 复用详情数据，少一次重复请求。
- 悬停 / 焦点预热详情 + 时间线；固定栏对可见固定票预热双 key（UUID / 票号）。
- 滚动位置按票恢复（含 sessionStorage），同 tab 内 A↔B↔C 切换尽量回到上次位置。

### 3. Help 菜单版本信息

- Help 中展示：**本服版本**、**官方同步基线**（`UPSTREAM_BASE`）、以及可对照的上游信息，方便确认当前跑的是哪一版 fork 构建。

### 4. 任务完成 / 失败推送（设置 → 集成 → 消息渠道）

人不在电脑前时，只关心「哪张票跑完了」。在 **设置 → 集成 → 消息渠道 → 任务结束推送** 里配置，可分别启用：

| 渠道 | 用户配置 | 代码写死 |
|---|---|---|
| **微信服务号 URL** | 启用开关 + 推送 URL（wxsend 风格 GET） | — |
| **微信 ClawBot** | 启用开关 + PushPlus `token` | 接口 `https://www.pushplus.plus/send`，`channel=clawbot` |

- **会推**：issue 上 agent 的 `task:completed` / 终端 `task:failed`
- **不推**：普通评论、进度类中间态、自动重试中的失败、纯聊天 session
- 两种渠道可同时开；未启用或缺少 URL/token 则跳过该渠道
- 兼容：部署机仍可设 `MULTICA_TASK_NOTIFY_URL` 作为微信 URL 渠道的旧 fallback（建议迁到设置里）
- 深链可选：`MULTICA_TASK_NOTIFY_APP_URL` / `MULTICA_PUBLIC_URL`；推送正文末尾附带 issue 链接，并尽量锚到本次回复的 `#comment-{id}`，点开即可滚到该条消息
- 实现：`server/internal/notify` + `task_notify_listener`；前端 `task-notify-tab`

### 6. Issue 对外对话分享

工作区成员可在 Issue 详情点「对外对话」（分享图标）：

- **免密** 或 **简单密码**
- 公网地址：`{当前站点 origin}/p/i/{code}`
- 访客只看到 **开启分享之后** 的对话；提问写入本票（前缀 `【外部访客】`），智能体仍带整张票上下文回答；开启后内网/外网发言一并同步到公网
- 关闭分享后链接失效

实现：`server/migrations/500_public_conversation_share`、`server/internal/issueshare`、`/api/public/issue-shares/*`、公网页 `apps/web/app/p/i/[code]`。

Chat 会话级分享表已预留（`chat_session_public_share`），入口与页面下一迭代对齐同一模型。

| 项 | 约定 |
|---|---|
| 前端端口 | **3005**（`0.0.0.0`，勿绑死 127.0.0.1） |
| 后端端口 | **8088**（同上） |
| 端口默认 | `scripts/fork-ports.env` |
| 快速发布 | `./scripts/redeploy-fork-fast.sh frontend\|backend\|all` |

说明：

- 日常 UI 热修用 `frontend`（只编前端、不下整栈）；API 用 `backend`。
- 脚本默认强制 FE=3005 / BE=8088；误端口会拒绝退出（除非显式 `MULTICA_ALLOW_ALT_PORTS=1`）。
- 绑定网卡以**部署目录** compose / `.env` 为准；SRC 仓库脚本只负责出镜像，不要覆盖已调好的 `0.0.0.0` 映射。

---

## 同步上游时注意

1. 先更新 `UPSTREAM_BASE`，再合并官方 `main`，冲突优先保留本 fork 差异文件（固定栏、notify、redeploy-fork-*、本 README 等）。  
2. 上游若覆盖 `README.md`，以「只写 fork 差异」的中文版为准重新合入。  
3. 推送 URL、密钥等**永远只放部署 `.env`**，不要进 Git。

---

## 仓库

- Fork：https://github.com/shuyingegit/multica  
- 上游：https://github.com/multica-ai/multica  
