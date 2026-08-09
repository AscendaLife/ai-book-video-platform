#!/usr/bin/env node
/* BookReel AI Platform Router.
 *
 * Current stage:
 *   Codex Demo Engine generates the production package locally.
 *
 * Live stage:
 *   AI Platform owns the model routing for image, digital-human,
 *   deep scene video, and assembly nodes. No external provider key is
 *   required by this app when AI_PLATFORM_API_KEY is configured.
 *
 * Usage:
 *   node tools/ai-platform-router.js tools/sample-render-job.json --demo
 *   AI_PLATFORM_API_KEY=... AI_PLATFORM_BASE_URL=https://api.example.com node tools/ai-platform-router.js tools/sample-render-job.json --execute
 *   AI_PLATFORM_API_KEY=... AI_PLATFORM_BASE_URL=https://api.example.com node tools/ai-platform-router.js tools/sample-render-job.json --execute --nodes
 */

const fs = require('fs/promises');
const path = require('path');

const args = process.argv.slice(2);
const jobPath = args.find(a => !a.startsWith('--'));
const execute = args.includes('--execute');
const nodeMode = args.includes('--nodes') || process.env.AI_PLATFORM_NODE_MODE === '1';

if (!jobPath) {
  console.error('Usage: node tools/ai-platform-router.js ./render-job.json --demo|--execute');
  process.exit(1);
}

const OUT_DIR = path.resolve(process.cwd(), 'ai-platform-output');
const AI_PLATFORM_CREATE_PATH = process.env.AI_PLATFORM_CREATE_PATH || '/v1/render-jobs';
const AI_PLATFORM_ROUTE = process.env.AI_PLATFORM_ROUTE || 'bookreel-short-video';
const AI_PLATFORM_API_STYLE = process.env.AI_PLATFORM_API_STYLE || 'router-job';
const AI_PLATFORM_MODEL = process.env.AI_PLATFORM_MODEL || 'auto';
const AI_PLATFORM_POLL_MS = Number(process.env.AI_PLATFORM_POLL_MS || 5000);
const AI_PLATFORM_MAX_POLLS = Number(process.env.AI_PLATFORM_MAX_POLLS || 60);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function joinUrl(base, routePath) {
  return `${base.replace(/\/+$/, '')}/${routePath.replace(/^\/+/, '')}`;
}

async function requestJson(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    throw new Error(`AI Platform request failed before response: ${err.message}. Check AI_PLATFORM_BASE_URL, network access, and route path.`);
  }
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch (_) { body = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`${res.status} ${res.statusText}: ${text.slice(0, 800)}`);
    err.response = body;
    throw err;
  }
  return body;
}

function stripMarkdownFence(text) {
  return String(text || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function parseMaybeJson(text) {
  const cleaned = stripMarkdownFence(text);
  try { return { parsed: JSON.parse(cleaned), cleaned }; } catch (_) { return { parsed: null, cleaned }; }
}

function compact(value, max = 18000) {
  const text = JSON.stringify(value, null, 2);
  return text.length > max ? `${text.slice(0, max)}\n...TRUNCATED_FOR_CONTEXT...` : text;
}

function firstScript(job) {
  if (!job.scripts || !job.scripts.length) throw new Error('Job has no scripts');
  return job.scripts[0];
}

function safeList(items, fallback) {
  return Array.isArray(items) && items.length ? items : fallback;
}

function routeJob(job) {
  const script = firstScript(job);
  const sceneCount = safeList(script.scenePlan, []).length || 3;
  const hasDialogue = Array.isArray(script.dialogue) && script.dialogue.length > 1;
  const hasSensitiveScene = safeList(job.sceneTemplates, [])
    .some(scene => /敏感|中|高|war|hospital|bath|泳|戰|战/i.test(`${scene.risk} ${scene.name} ${scene.prompt}`));

  return {
    version: 'bookreel.ai_platform_router.v1',
    mode: 'codex-demo-first',
    createdAt: new Date().toISOString(),
    project: job.project,
    target: job.target,
    decision: {
      currentEngine: execute ? 'ai-platform-live' : 'codex-demo-engine',
      reason: execute
        ? 'Live mode sends the route job to AI Platform, which routes internally to image, avatar, deep-video, and assembly capabilities.'
        : 'Customer-facing MVP can produce a complete production package locally before using live platform capacity.',
      readyForCustomers: true,
      requiresApiKeys: execute,
      canUpgradeToRealGeneration: true
    },
    policy: {
      aiDisclosure: true,
      noBrowserSecrets: true,
      sensitiveSceneGuardrails: hasSensitiveScene,
      humanLikenessRequiresAuthorization: true
    },
    route: [
      {
        node: 'router.intake',
        engine: execute ? 'ai-platform-live' : 'codex-demo-engine',
        output: 'Normalize book data, target platform, duration, style, risk level.'
      },
      {
        node: 'director.script',
        engine: execute ? 'ai-platform-director' : 'codex-demo-engine',
        output: 'Generate 60-second dialogue script with interruption rhythm and scene beats.'
      },
      {
        node: 'avatar.design',
        engine: execute ? 'ai-platform-avatar' : 'codex-demo-engine',
        output: hasDialogue ? 'Route to AI Platform digital-human/avatar capability for two speakers and voice plan.' : 'Route to AI Platform digital-human/avatar capability for host avatar.'
      },
      {
        node: 'image.keyframes',
        engine: execute ? 'ai-platform-image' : 'codex-demo-engine',
        output: 'Route to AI Platform image capability for character, book cover, scene keyframes, and Q-style variants.'
      },
      {
        node: 'video.scene_broll',
        engine: execute ? 'ai-platform-deep-video' : 'codex-demo-engine',
        output: `Route to AI Platform deep-video capability for ${sceneCount} vertical cinematic scene clips.`
      },
      {
        node: 'assembly.short_video',
        engine: execute ? 'ai-platform-assembly' : 'codex-demo-engine',
        output: 'Route to AI Platform assembly capability for 9:16 subtitles, CTA, AI label, and final edit plan.'
      }
    ],
    package: buildProductionPackage(job, script)
  };
}

function aiPlatformPayload(job, plan) {
  if (AI_PLATFORM_API_STYLE === 'openai-chat') return aiPlatformChatPayload(job, plan);

  return {
    route: AI_PLATFORM_ROUTE,
    version: 'bookreel.ai_platform_request.v1',
    requestId: `bookreel_${Date.now()}`,
    mode: 'live-generation',
    job,
    routerPlan: plan,
    requestedOutputs: [
      'avatar_video',
      'scene_broll',
      'key_images',
      'captions',
      'douyin_9x16_video',
      'production_package'
    ],
    constraints: {
      ratio: job.target?.ratio || '9:16',
      durationSeconds: job.target?.durationSeconds || 60,
      aiDisclosure: true,
      browserSecretsAllowed: false
    }
  };
}

function aiPlatformChatPayload(job, plan) {
  return {
    model: AI_PLATFORM_MODEL,
    messages: [
      {
        role: 'system',
        content: [
          'You are BookReel AI Platform, an intelligent multimodal router for book marketing short videos.',
          'Assume AI Platform has internal capabilities for image generation, digital-human/avatar generation, deep scene video, voice, captions, and final assembly.',
          'Do not route to or require Runway, HeyGen, OpenAI Images, GPT image, or other external provider names.',
          'Return a detailed Traditional Chinese production package for a real customer-facing 9:16 short video.',
          'The output must include internal route decisions, avatar design, two-person dialogue, scene plan, image generation requirements, deep-video generation requirements, captions, edit timeline, Douyin title, hashtags, and compliance notes.',
          'If no actual media URL is returned by AI Platform, mark media outputs as planned_assets rather than completed_assets.',
          'Use JSON format only.'
        ].join(' ')
      },
      {
        role: 'user',
        content: JSON.stringify({
          route: AI_PLATFORM_ROUTE,
          request: 'Use AI Platform internal capabilities to generate a routed production package for this AI digital-human book short video. Do not depend on external Runway, HeyGen, or GPT image APIs.',
          job,
          routerPlan: plan
        })
      }
    ],
    temperature: 0.7
  };
}

function aiPlatformNodeChatPayload(node, job, plan, context) {
  return {
    model: AI_PLATFORM_MODEL,
    messages: [
      {
        role: 'system',
        content: [
          'You are BookReel AI Platform node runner.',
          'AI Platform has internal image, avatar, deep-video, voice, caption, and assembly capabilities.',
          'Do not require external generation provider names.',
          'Return strict JSON only. No markdown fences.',
          'If media is planned but no URL is actually returned, put it under planned_assets. Only put real URLs under completed_assets.'
        ].join(' ')
      },
      {
        role: 'user',
        content: JSON.stringify({
          route: AI_PLATFORM_ROUTE,
          node: node.id,
          nodeName: node.name,
          expectedJsonShape: node.shape,
          instruction: node.prompt,
          job,
          routerPlan: plan,
          previousNodeOutputs: context
        })
      }
    ],
    temperature: node.temperature ?? 0.35
  };
}

function extractChatContent(response) {
  return response.choices?.[0]?.message?.content || response.output_text || response.content || null;
}

function getStatusUrl(baseUrl, createResponse) {
  if (createResponse.status_url) return createResponse.status_url;
  if (createResponse.statusUrl) return createResponse.statusUrl;
  if (createResponse.links?.status) return createResponse.links.status;

  const taskId = createResponse.id || createResponse.job_id || createResponse.task_id || createResponse.data?.id;
  const template = process.env.AI_PLATFORM_STATUS_PATH_TEMPLATE;
  if (!taskId || !template) return null;
  return joinUrl(baseUrl, template.replace('{id}', encodeURIComponent(taskId)));
}

function isDoneStatus(status) {
  return ['succeeded', 'completed', 'complete', 'done', 'failed', 'error', 'canceled', 'cancelled']
    .includes(String(status || '').toLowerCase());
}

async function executeAiPlatform(job, plan) {
  const baseUrl = process.env.AI_PLATFORM_BASE_URL;
  const apiKey = process.env.AI_PLATFORM_API_KEY;
  if (!baseUrl) throw new Error('Missing AI_PLATFORM_BASE_URL');
  if (!apiKey) throw new Error('Missing AI_PLATFORM_API_KEY');

  const payload = aiPlatformPayload(job, plan);
  await fs.writeFile(path.join(OUT_DIR, 'ai-platform-request.json'), JSON.stringify({
    ...payload,
    note: 'API key is sent only in the Authorization header and is never written to this file.'
  }, null, 2));

  const created = await requestJson(joinUrl(baseUrl, AI_PLATFORM_CREATE_PATH), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-BookReel-Route': AI_PLATFORM_ROUTE
    },
    body: JSON.stringify(payload)
  });

  await fs.writeFile(path.join(OUT_DIR, 'ai-platform-create-response.json'), JSON.stringify(created, null, 2));

  if (AI_PLATFORM_API_STYLE === 'openai-chat') {
    const content = extractChatContent(created);
    if (content) {
      await fs.writeFile(path.join(OUT_DIR, 'ai-platform-live-package.md'), content);
    }
    return { created, final: null, statusUrl: null };
  }

  const statusUrl = getStatusUrl(baseUrl, created);
  if (!statusUrl) return { created, final: null, statusUrl: null };

  let final = null;
  for (let i = 0; i < AI_PLATFORM_MAX_POLLS; i++) {
    const current = await requestJson(statusUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-BookReel-Route': AI_PLATFORM_ROUTE
      }
    });
    final = current;
    const status = current.status || current.state || current.data?.status;
    if (isDoneStatus(status)) break;
    await sleep(AI_PLATFORM_POLL_MS);
  }

  await fs.writeFile(path.join(OUT_DIR, 'ai-platform-final-response.json'), JSON.stringify(final, null, 2));
  return { created, final, statusUrl };
}

function buildNodePipeline(job, plan) {
  return [
    {
      id: '01_book_intake',
      name: '書籍理解',
      shape: {
        book_core: { audience: [], promise: '', themes: [], conflict: '', transformation: '' },
        content_angles: []
      },
      prompt: '分析書籍定位、目標讀者、核心承諾、主題、讀者痛點與短視頻可講的內容角度。'
    },
    {
      id: '02_avatar_cast',
      name: '數字人與角色設計',
      shape: {
        avatars: [{ id: '', role: '', visualStyle: '', voice: '', personality: '', speakingRules: [] }],
        bookCharacters: []
      },
      prompt: '設計主持人、作者/主角、可選 Q 版或動物角色。每個角色要有聲線、語速、插話規則、表情與出鏡比例。'
    },
    {
      id: '03_scene_worlds',
      name: '30 種場景與環境',
      batches: [
        { id: '03a_scene_worlds_real', range: '1-10', focus: '真實場景、訪談室、車內、街頭、海灘、咖啡廳、圖書館、辦公室、運動、旅途' },
        { id: '03b_scene_worlds_wonder', range: '11-20', focus: '奇觀場景、火星、太空、水下、沙漠、未來城市、數據空間、魔法書屋、過山車、海上' },
        { id: '03c_scene_worlds_character', range: '21-30', focus: 'Q 版、動物、書中男主角/女主角、未來的我、戰地新聞合規、醫院合規、泳池合規、舞台、古代、遊戲世界' }
      ],
      shape: {
        scenes: [{ id: '', name: '', category: '', risk: '', environment: '', avatarStyle: '', camera: '', whyItWorks: '', safeNotes: '' }]
      },
      prompt: '生成可供客戶選擇的數字人短視頻場景。每個場景欄位要短，整體必須是可解析 JSON。'
    },
    {
      id: '04_dialogue_script',
      name: '60 秒雙人對談',
      shape: {
        dialogue: [{ start: 0, end: 0, speaker: '', voice: '', cue: '', text: '', overlap: false }],
        rhythmNotes: []
      },
      prompt: '寫 60 秒雙人數字人對談。必須有插嘴、接話、停頓、反問、語速差和情緒變化，不要變成旁白。'
    },
    {
      id: '05_shot_timeline',
      name: '鏡頭表與剪輯節奏',
      shape: {
        timeline: [{ start: 0, end: 0, shotType: '', scene: '', camera: '', visual: '', audio: '', caption: '' }]
      },
      prompt: '把對談和場景拆成 9:16 的 60 秒鏡頭表，每 3-6 秒有畫面變化，包含場地大景、雙人中景、書封、金句、圖卡和 CTA。'
    },
    {
      id: '06_image_assets',
      name: '圖像生成需求',
      shape: {
        image_assets: [{ id: '', type: '', prompt: '', negativePrompt: '', size: '9:16', usage: '' }],
        planned_assets: []
      },
      prompt: '產生平台內部 image node 所需的圖像生成需求：書封視覺、角色設定圖、場景首幀、Q 版角色、金句圖卡。'
    },
    {
      id: '07_deep_video_assets',
      name: '深層視頻與數字人生成需求',
      shape: {
        avatar_video_assets: [{ id: '', avatarId: '', dialogueRange: '', voiceDirection: '', background: '', expectedUrlField: 'avatar_video_url' }],
        deep_video_assets: [{ id: '', scene: '', prompt: '', motion: '', duration: 0, expectedUrlField: 'deep_video_url' }],
        planned_assets: []
      },
      prompt: '產生平台內部 avatar node 與 deep-video node 的生成需求。要描述數字人口型/聲線/背景，以及深層場景視頻運鏡。'
    },
    {
      id: '08_compliance_and_assembly',
      name: '合規檢查與最終合併',
      shape: {
        compliance: { aiDisclosure: true, likenessAuthorization: '', sensitiveSceneRules: [], publishWarnings: [] },
        finalPackage: { title: '', description: '', hashtags: [], editChecklist: [], completed_assets: [], planned_assets: [] }
      },
      prompt: '合併前面所有節點，做合規檢查，輸出最終抖音上架包。若沒有真實媒體 URL，只能放 planned_assets，不能放 completed_assets。'
    }
  ];
}

async function executeNodePipeline(job, plan) {
  const baseUrl = process.env.AI_PLATFORM_BASE_URL;
  const apiKey = process.env.AI_PLATFORM_API_KEY;
  if (!baseUrl) throw new Error('Missing AI_PLATFORM_BASE_URL');
  if (!apiKey) throw new Error('Missing AI_PLATFORM_API_KEY');
  if (AI_PLATFORM_API_STYLE !== 'openai-chat') {
    throw new Error('--nodes currently requires AI_PLATFORM_API_STYLE=openai-chat');
  }

  const nodesDir = path.join(OUT_DIR, 'nodes');
  await fs.mkdir(nodesDir, { recursive: true });

  const nodeResults = {};
  const nodeSummaries = [];
  for (const node of buildNodePipeline(job, plan)) {
    if (node.batches) {
      const batchResults = [];
      for (const batch of node.batches) {
        const batchNode = {
          ...node,
          id: batch.id,
          name: `${node.name} ${batch.range}`,
          prompt: `${node.prompt} 這次只生成第 ${batch.range} 種，共 10 種；聚焦：${batch.focus}。id 必須連續使用 s${batch.range.split('-')[0].padStart(2, '0')} 到 s${batch.range.split('-')[1].padStart(2, '0')}。只輸出 {"scenes":[...]}。`,
          batches: null
        };
        batchResults.push(await runPipelineNode(batchNode, job, plan, nodeResults, nodesDir));
      }

      const scenes = batchResults.flatMap(item => {
        const parsed = item.parsed;
        return Array.isArray(parsed?.scenes) ? parsed.scenes : [];
      });
      const result = {
        node: node.id,
        name: node.name,
        model: batchResults.map(item => item.model).filter(Boolean).join(', '),
        finishReason: batchResults.map(item => item.finishReason).filter(Boolean).join(', '),
        usage: {
          total_tokens: batchResults.reduce((sum, item) => sum + Number(item.usage?.total_tokens || 0), 0)
        },
        jsonParsed: scenes.length >= 30,
        parsed: { scenes },
        cleaned: JSON.stringify({ scenes }, null, 2),
        batches: batchResults.map(item => ({
          node: item.node,
          jsonParsed: item.jsonParsed,
          sceneCount: Array.isArray(item.parsed?.scenes) ? item.parsed.scenes.length : 0
        }))
      };
      nodeResults[node.id] = result;
      nodeSummaries.push({
        node: node.id,
        name: node.name,
        model: result.model,
        finishReason: result.finishReason,
        usage: result.usage,
        jsonParsed: result.jsonParsed,
        sceneCount: scenes.length
      });
      await fs.writeFile(path.join(nodesDir, `${node.id}-output.json`), JSON.stringify(result, null, 2));
      continue;
    }

    const result = await runPipelineNode(node, job, plan, nodeResults, nodesDir);
    nodeResults[node.id] = result;
    nodeSummaries.push({
      node: node.id,
      name: node.name,
      model: result.model,
      finishReason: result.finishReason,
      usage: result.usage,
      jsonParsed: result.jsonParsed
    });
  }

  const finalPackage = {
    version: 'bookreel.ai_platform_node_pipeline.v1',
    createdAt: new Date().toISOString(),
    route: AI_PLATFORM_ROUTE,
    project: job.project,
    target: job.target,
    nodes: nodeSummaries,
    outputs: Object.fromEntries(Object.entries(nodeResults).map(([key, value]) => [key, value.parsed || value.cleaned]))
  };

  await fs.writeFile(path.join(OUT_DIR, 'node-pipeline-summary.json'), JSON.stringify(nodeSummaries, null, 2));
  await fs.writeFile(path.join(OUT_DIR, 'node-production-package.json'), JSON.stringify(finalPackage, null, 2));
  await fs.writeFile(path.join(OUT_DIR, 'node-production-package.md'), nodePackageMarkdown(finalPackage));

  return { nodesDir, nodeSummaries };
}

async function runPipelineNode(node, job, plan, nodeResults, nodesDir) {
    const baseUrl = process.env.AI_PLATFORM_BASE_URL;
    const apiKey = process.env.AI_PLATFORM_API_KEY;
    const context = Object.fromEntries(Object.entries(nodeResults).map(([key, value]) => [key, value.parsed || value.cleaned]));
    const payload = aiPlatformNodeChatPayload(node, job, plan, context);
    await fs.writeFile(path.join(nodesDir, `${node.id}-request.json`), JSON.stringify({
      ...payload,
      note: 'API key is sent only in the Authorization header and is never written to this file.'
    }, null, 2));

    const response = await requestJson(joinUrl(baseUrl, AI_PLATFORM_CREATE_PATH), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-BookReel-Route': AI_PLATFORM_ROUTE,
        'X-BookReel-Node': node.id
      },
      body: JSON.stringify(payload)
    });

    const content = extractChatContent(response) || JSON.stringify(response);
    const { parsed, cleaned } = parseMaybeJson(content);
    const result = {
      node: node.id,
      name: node.name,
      model: response.model,
      finishReason: response.choices?.[0]?.finish_reason,
      usage: response.usage,
      jsonParsed: !!parsed,
      parsed,
      cleaned
    };
    nodeResults[node.id] = result;
    await fs.writeFile(path.join(nodesDir, `${node.id}-response.json`), JSON.stringify(response, null, 2));
    await fs.writeFile(path.join(nodesDir, `${node.id}-output.json`), JSON.stringify(result, null, 2));
    return result;
}

function nodePackageMarkdown(pkg) {
  return [
    `# ${pkg.project?.title || 'BookReel'} AI Platform 8 節點製作包`,
    '',
    `Route: ${pkg.route}`,
    `Created: ${pkg.createdAt}`,
    '',
    '## Nodes',
    ...pkg.nodes.map(node => `- ${node.node} ${node.name}: ${node.jsonParsed ? 'JSON OK' : 'JSON NEEDS REVIEW'}${node.model ? ` (${node.model})` : ''}`),
    '',
    '## Final Output',
    '完整 JSON 請看 ai-platform-output/node-production-package.json。'
  ].join('\n');
}

function buildProductionPackage(job, script) {
  const project = job.project || {};
  const quotes = safeList(project.quotes, ['把一本書變成一支能被理解、被記住、被分享的短視頻。']);
  const themes = safeList(project.themes, ['新書介紹', '讀者痛點', '行動轉變']);
  const scenes = safeList(script.scenePlan, [
    { name: '可見場地大景', visual: 'Clear location establishing shot with book cover object in frame.', role: 'Open with context.' },
    { name: '雙人對談中景', visual: 'Two digital avatars talking naturally, with overlapping reactions.', role: 'Explain the core idea.' },
    { name: '書摘圖卡特寫', visual: 'Book quote card, chapter markers, highlighted text.', role: 'Make the content concrete.' }
  ]);
  const dialogue = safeList(script.dialogue, [
    { speaker: '主持人', text: `等一下，${project.title || '這本書'}到底跟普通讀者有什麼關係？` },
    { speaker: '作者數字人', text: `它不是叫你多努力，而是讓你看懂自己卡在哪裡。` }
  ]);

  return {
    title: `${project.title || '新書'} 60 秒 AI 短視頻製作包`,
    avatarPlan: [
      {
        role: '主持人數字人',
        voice: '快一點、會插話、代表觀眾提出質疑',
        look: 'Professional but approachable, clear facial expression, not stiff.'
      },
      {
        role: '作者/主角數字人',
        voice: '穩定、有停頓、能接住主持人的追問',
        look: 'Book-author presence, calm eye contact, natural hand movement.'
      }
    ],
    scenePrompts: scenes.map((scene, index) => ({
      id: `scene-${index + 1}`,
      name: scene.name,
      deepVideoPrompt: [
        'Vertical 9:16 cinematic short-video scene.',
        `Book: ${project.title || 'new book'}.`,
        `Scene: ${scene.name}.`,
        `Visual: ${scene.visual || scene.role || 'clear environment with strong depth and movement'}.`,
        'Visible location, camera movement, depth, atmosphere, no text overlays, brand-safe.'
      ].join(' ')
    })),
    imagePrompts: [
      `Vertical key visual for ${project.title || 'new book'}, two digital-human presenters, readable book cover, premium social-video composition.`,
      `Q-style character sheet for the host, author, and book-world protagonist, expressive but brand-safe.`,
      `Book content card pack: ${themes.slice(0, 3).join(', ')}, clean typography, 9:16 safe margins.`
    ],
    dialogue,
    editDecisionList: scenes.map((scene, index) => ({
      time: `${index * 8}-${Math.min(index * 8 + 8, 60)}s`,
      shot: scene.name,
      camera: index === 0 ? 'environment wide shot' : index % 2 ? 'two-shot dialogue' : 'book/content insert',
      sound: index % 2 ? 'two voices with natural interruption' : 'music beat with page turn sound'
    })),
    captions: dialogue.map(line => `${line.speaker}: ${line.text}`),
    douyinPackage: {
      title: `60 秒看懂《${project.title || '這本書'}》`,
      description: `${project.summary || '一本書，一支能看懂重點的 AI 短視頻。'}\nAI 生成示意，正式人物肖像與聲音需授權。`,
      hashtags: ['#新書推薦', '#AI短視頻', '#數字人', '#讀書', '#BookReel']
    },
    quoteCards: quotes.slice(0, 5).map((quote, index) => ({
      id: `quote-${index + 1}`,
      text: quote,
      visual: 'Book page close-up, highlighted line, subtle motion background.'
    }))
  };
}

function toMarkdown(plan) {
  const pkg = plan.package;
  return [
    `# ${pkg.title}`,
    '',
    `Router: ${plan.decision.currentEngine}`,
    `API keys required now: ${plan.decision.requiresApiKeys ? 'yes' : 'no'}`,
    '',
    '## Route',
    ...plan.route.map(step => `- ${step.node}: ${step.engine}`),
    '',
    '## Avatar Plan',
    ...pkg.avatarPlan.map(role => `- ${role.role}: ${role.voice}`),
    '',
    '## Scene Prompts',
    ...pkg.scenePrompts.map(scene => `- ${scene.name}: ${scene.deepVideoPrompt}`),
    '',
    '## Dialogue',
    ...pkg.dialogue.map(line => `- ${line.speaker}: ${line.text}`),
    '',
    '## Douyin',
    `Title: ${pkg.douyinPackage.title}`,
    `Hashtags: ${pkg.douyinPackage.hashtags.join(' ')}`
  ].join('\n');
}

async function main() {
  const job = JSON.parse(await fs.readFile(path.resolve(jobPath), 'utf8'));
  const plan = routeJob(job);

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, 'route-plan.json'), JSON.stringify(plan, null, 2));
  await fs.writeFile(path.join(OUT_DIR, 'production-package.md'), toMarkdown(plan));

  if (execute) {
    if (nodeMode) {
      const result = await executeNodePipeline(job, plan);
      console.log(JSON.stringify({
        mode: 'ai-platform-node-pipeline',
        output: OUT_DIR,
        nodesDir: result.nodesDir,
        nodes: result.nodeSummaries,
        requiredEnv: ['AI_PLATFORM_API_KEY', 'AI_PLATFORM_BASE_URL']
      }, null, 2));
      return;
    }

    const result = await executeAiPlatform(job, plan);
    console.log(JSON.stringify({
      mode: 'ai-platform-live',
      output: OUT_DIR,
      createPath: AI_PLATFORM_CREATE_PATH,
      apiStyle: AI_PLATFORM_API_STYLE,
      model: AI_PLATFORM_MODEL,
      route: AI_PLATFORM_ROUTE,
      statusUrl: result.statusUrl,
      requiredEnv: ['AI_PLATFORM_API_KEY', 'AI_PLATFORM_BASE_URL']
    }, null, 2));
    return;
  }

  console.log(JSON.stringify({
    mode: 'codex-demo-router',
    output: OUT_DIR,
    requiredEnv: [],
    liveEnv: [
      'AI_PLATFORM_API_KEY',
      'AI_PLATFORM_BASE_URL',
      'AI_PLATFORM_CREATE_PATH',
      'AI_PLATFORM_API_STYLE',
      'AI_PLATFORM_MODEL',
      'AI_PLATFORM_ROUTE',
      'AI_PLATFORM_STATUS_PATH_TEMPLATE'
    ],
    futureEnv: []
  }, null, 2));
}

main().catch(err => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
