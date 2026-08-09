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

## 第三方生成工具链

当前版本已加入第三方渲染任务导出与服务端桥接脚本：

- OpenAI Images：生成角色图、场景首帧、Q 版/动物/书中主角概念图
- HeyGen Avatar V：生成真人数字人、声音与口型同步
- Runway Gen-4.5：生成火星、海上、过山车、深海、战地记者等奇观 B-roll
- Remotion/FFmpeg：后续用于字幕、书封、金句、CTA 与抖音 9:16 成片合成

前端路径：

1. 打开「创意分镜」
2. 选择 30 种场景模板或输入自定义场景
3. 下载「渲染任务 JSON」
4. 交给服务端脚本执行

服务端 dry-run：

```bash
node tools/third-party-render.js tools/sample-render-job.json --dry-run
```

正式调用第三方 API：

```bash
OPENAI_API_KEY=... \
HEYGEN_API_KEY=... \
HEYGEN_AVATAR_ID=... \
HEYGEN_VOICE_ID=... \
RUNWAYML_API_SECRET=... \
node tools/third-party-render.js ./render-job.json --execute
```

注意：API Key 不能放在浏览器前端，必须放在服务端环境变量。
