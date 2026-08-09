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

这个测试会直接提交 `task:"avatar"` 与 `task:"lipsync"`，检查平台是否已经支持数字人对嘴并回传 `avatar_video_url`。

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
