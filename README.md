# 书影 BookReel · AI 新书短视频营销平台（演示原型）

> 一本书 · 一座内容库

一本书上传进来，自动变成几十支可发布的多平台短视频。

**在线预览**：打开本仓库的 GitHub Pages 地址即可，无需安装任何东西。

## 三分钟看完
1. 左侧点「生产流水线」，右上角点「一键跑完整流程」
2. 约 15 秒看完八个步骤：上传资料 → AI 读完整本书 → 定营销策略 → 批量写稿 → 套用人格 → 数字人合成 → 自动包装 → 多平台输出
3. 去「内容资产库」看产出的 30 支视频、14 篇脚本、20 个标题、20 个 Hook
4. 去「数据分析」看播放趋势与转化漏斗

## 说明
- 这是**演示原型**：界面、流程与数据结构是真实设计，视频与数据为模拟生成，未接入真实 AI 模型与渲染。
- 演示中的书名与作者均为虚构，不指向任何真实出版物。
- 本公开版本已隐藏预算、成本等商业信息。

## AI Platform 智能路由

当前版本加入后台智能路由，可先跑 Codex Demo，也可接 AI Platform Key 跑真实生成。正式路线是由 AI Platform 内部模型统一路由，不需要本应用再接 Runway、HeyGen 或 GPT 图像 API：

- Intelligent Router：判断任务进入书籍理解、角色、图像、数字人、深层视频或合成节点
- Image Node：生成书封视觉、场景首帧、Q 版/动物/书中主角概念图
- Avatar Node：生成主持人、作者、主角等数字人设定、声线与对谈节奏
- Deep Video Node：生成火星、海上、车内、街头等深层场景视频需求
- Assembly Node：字幕、书封、金句、CTA 与抖音 9:16 成片合成规格

前端路径：

1. 打开「创意分镜」
2. 选择 30 种场景模板或输入自定义场景
3. 下载「AI 路由任务 JSON」
4. 交给后台 router 生成完整制作包

后台智能路由，Demo 模式不需要 API Key：

```bash
node tools/ai-platform-router.js tools/sample-render-job.json --demo
```

真实 AI Platform 模式：

```bash
AI_PLATFORM_API_KEY=... \
AI_PLATFORM_BASE_URL=https://aiplatform-wine.vercel.app \
AI_PLATFORM_CREATE_PATH=/v1/chat/completions \
AI_PLATFORM_TASK_PATH=/v1/tasks \
AI_PLATFORM_API_STYLE=openai-chat \
AI_PLATFORM_MODEL=auto \
AI_PLATFORM_ROUTE=bookreel-short-video \
node tools/ai-platform-router.js tools/sample-render-job.json --execute
```

推荐的 8 节点稳定生成模式：

```bash
set -a
source .env.local
set +a
node tools/ai-platform-router.js tools/sample-render-job.json --execute --nodes
```

媒体能力测试：

```bash
set -a
source .env.local
set +a
node tools/ai-platform-capability-test.js
```

这个测试会检查图像、深层视频、avatar/lipsync 是否真的回传可访问的 `image_url`、`deep_video_url`、`avatar_video_url` 或 `final_video_url`。
媒体测试走正式统一入口 `POST /v1/tasks`，请求格式为 `{ task, prompt, quality }`。

Avatar / lipsync 最小合约测试：

```bash
set -a
source .env.local
set +a
node tools/ai-platform-avatar-test.js
```

这个测试会直接提交 `task:"avatar"` 与 `task:"lipsync"`，检查平台是否已经支持数字人对嘴并回传 `avatar_video_url` 或 `lipsync_video_url`。
若 avatar 是异步任务，测试会用 `AI_PLATFORM_AVATAR_STATUS_PATH_TEMPLATE=/api/playground/avatar/{id}` 轮询，直到拿到 `completed_assets.avatar_video_url` 或进入终态。
若 lipsync 需要独立轮询路径，可设置 `AI_PLATFORM_LIPSYNC_STATUS_PATH_TEMPLATE=/api/playground/lipsync/{id}`。
为了避免误烧真实额度，lipsync 测试必须先填可公开访问的素材 URL：

```bash
AI_PLATFORM_LIPSYNC_VIDEO_URL=https://.../source-video.mp4
AI_PLATFORM_LIPSYNC_AUDIO_URL=https://.../new-voice.mp3
```

目标 lipsync 回传格式：

```json
{
  "id": "task_xxx",
  "task": "lipsync",
  "status": "completed",
  "completed_assets": {
    "lipsync_video_url": "https://media.example.com/lipsync/task_xxx.mp4"
  },
  "source_assets": {
    "provider": "heygen",
    "stored": true,
    "provider_video_url_expires": false
  }
}
```

完整链路测试：

```bash
set -a
source .env.local
set +a
node tools/ai-platform-lipsync-chain-test.js
```

这个测试会自动跑：

1. `task:"avatar"` 生成一支数字人原始影片
2. `task:"tts"` 生成一段新配音
3. `task:"lipsync"` 用前两步的 URL 合成最终对嘴影片

输出目录：

- `ai-platform-output/lipsync-chain/01-avatar.json`
- `ai-platform-output/lipsync-chain/02-tts.json`
- `ai-platform-output/lipsync-chain/03-lipsync.json`
- `ai-platform-output/lipsync-chain/summary.json`

如果 TTS 只回 `data:` 音讯而没有公开 `audio_url`，测试会停止并明确报错，因为 lipsync 需要可公开下载的音讯 URL。
链路测试默认 `AI_PLATFORM_CHAIN_TTS_QUALITY=premium`，避免 `fast` 模式走到没有额度的 OpenAI TTS。若平台已给 OpenAI TTS 充值，可改回 `fast`。
如果已经有可公开访问的素材，可用 `AI_PLATFORM_CHAIN_AVATAR_VIDEO_URL` 与 `AI_PLATFORM_CHAIN_TTS_AUDIO_URL` 跳过前两步，直接测 lipsync。

测试脚本只断言 AI Platform 对 BookReel 公开的合约，不探测 HeyGen 内部实现：

```json
{
  "result": {
    "id": "task_xxx",
    "status": "completed",
    "completed_assets": {
      "lipsync_video_url": "https://..."
    }
  }
}
```

BookReel 不需要知道 `callback_id` 或 webhook event 名称；那是 AI Platform 与 HeyGen 的内部配对细节。测试输出里的 `contractWarnings` 只会针对公开合约缺失，例如缺少 `result.id`、`result.status`，或完成后缺少 `result.completed_assets.lipsync_video_url`。

AI Platform avatar 目标流程：

```text
BookReel → POST /v1/tasks task:"avatar"
AI Platform → HeyGen v3 batch API
HeyGen webhook → AI Platform 验证 token
AI Platform 用 callback_id 配对工作、扣款、转存 MP4
BookReel 轮询 /v1/tasks/{id}
BookReel 拿 completed_assets.avatar_video_url
```

### R2 永久影片储存

HeyGen 的原始影片 URL 会过期。正式上线时，AI Platform 后台应在 webhook 完成后立刻下载 HeyGen MP4，上传到 Cloudflare R2，再把永久 URL 写回任务结果。

需要放在 AI Platform 后台的 5 个 R2 环境变量：

```bash
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=bookreel-media
R2_PUBLIC_BASE_URL=https://media.example.com
```

R2 目标回传格式：

```json
{
  "status": "completed",
  "stored": true,
  "provider_video_url_expires": true,
  "completed_assets": {
    "avatar_video_url": "https://media.example.com/avatar/task_xxx.mp4"
  },
  "source_assets": {
    "provider": "heygen",
    "provider_video_url": "https://..."
  }
}
```

AI Platform 后台上传逻辑：

1. HeyGen webhook 收到完成事件
2. 用 `callback_id` 找到 BookReel 任务
3. 下载 HeyGen MP4 临时 URL
4. 上传到 R2 object key，例如 `avatar/{taskId}.mp4`
5. 写入 `completed_assets.avatar_video_url`
6. 回传 `stored:true`

BookReel 端不用直接接 R2，也不要把 R2 key 放到浏览器前端。

8 个节点：

1. 书籍理解
2. 数字人与角色设计
3. 30 种场景与环境
4. 60 秒双人对谈
5. 镜头表与剪辑节奏
6. 图像生成需求
7. 深层视频与数字人生成需求
8. 合规检查与最终合并

如果你的 AI Platform 是任务型 API，才需要任务轮询：

```bash
AI_PLATFORM_STATUS_PATH_TEMPLATE=/v1/render-jobs/{id}
```

输出：

- `ai-platform-output/route-plan.json`
- `ai-platform-output/production-package.md`
- `ai-platform-output/ai-platform-request.json`
- `ai-platform-output/ai-platform-create-response.json`
- `ai-platform-output/ai-platform-live-package.md`
- `ai-platform-output/nodes/*-output.json`
- `ai-platform-output/node-pipeline-summary.json`
- `ai-platform-output/node-production-package.json`
- `ai-platform-output/node-production-package.md`
- `ai-platform-output/media-url-check.json`

注意：AI Platform Key 不能放在浏览器前端，必须放在服务端环境变量。若 AI Platform 没有回传实际媒体 URL，系统应标示为 planned_assets，而不是宣称已经产出真实影片。

## 支付系统

当前版本加入 Stripe Checkout 支付后端范例。GitHub Pages 前端不会保存任何金流 Key；付款必须走后端。

环境变量：

```bash
PAYMENT_PORT=8788
PAYMENT_ALLOWED_ORIGIN=http://127.0.0.1:8081
PUBLIC_APP_URL=http://127.0.0.1:8081
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_STUDIO=price_...
```

启动本机支付后端：

```bash
set -a
source .env.local
set +a
node tools/payment-server.js
```

前端路径：

1. 打开「支付与方案」
2. 支付 API Base URL 填 `http://localhost:8788`
3. 点方案的「前往付款」

后端接口：

- `GET /health`
- `POST /api/payments/checkout`
- `POST /api/payments/webhook`

Webhook 收到 `checkout.session.completed` 后，会把订单与方案写入 `payment-output/payment-events.jsonl`。正式上线时应改为写入数据库，并开通客户的 AI Platform 生成额度。
