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

当前版本加入后台智能路由，可先跑 Codex Demo，也可接 AI Platform Key 跑真实生成：

- Router：判断任务走 Codex Demo、图像、数字人、深层场景或合成节点
- Codex Demo Engine：现在生成角色设定、双人对谈、镜头表、Runway 式提示词、抖音文案
- AI Platform Live：用一个后台 Key 跑真实图像、数字人、深层视频或合成路由
- Future Adapters：也可再接 OpenAI Images、HeyGen Avatar V、Runway Gen-4.5
- Assembly Layer：后续用于字幕、书封、金句、CTA 与抖音 9:16 成片合成

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
AI_PLATFORM_BASE_URL=https://your-ai-platform.example.com \
AI_PLATFORM_CREATE_PATH=/v1/render-jobs \
AI_PLATFORM_ROUTE=bookreel-short-video \
node tools/ai-platform-router.js tools/sample-render-job.json --execute
```

如果你的 AI Platform 支持任务轮询，也可以加：

```bash
AI_PLATFORM_STATUS_PATH_TEMPLATE=/v1/render-jobs/{id}
```

输出：

- `ai-platform-output/route-plan.json`
- `ai-platform-output/production-package.md`
- `ai-platform-output/ai-platform-request.json`
- `ai-platform-output/ai-platform-create-response.json`
- `ai-platform-output/ai-platform-final-response.json`

如果未来要直接调用第三方 API，也可保留同一份 route job，再切换对应 adapter：

```bash
OPENAI_API_KEY=... \
HEYGEN_API_KEY=... \
HEYGEN_AVATAR_ID=... \
HEYGEN_VOICE_ID=... \
RUNWAYML_API_SECRET=... \
node tools/third-party-render.js ./render-job.json --execute
```

注意：AI Platform Key 和第三方 API Key 都不能放在浏览器前端，必须放在服务端环境变量。
