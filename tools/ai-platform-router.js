#!/usr/bin/env node
/* BookReel AI Platform Router.
 *
 * Current stage:
 *   Codex Demo Engine generates the production package locally.
 *
 * Future stage:
 *   Keep this router contract, then replace selected nodes with OpenAI,
 *   HeyGen, Runway, Remotion, storage, or queue workers.
 *
 * Usage:
 *   node tools/ai-platform-router.js tools/sample-render-job.json --demo
 *   AI_PLATFORM_API_KEY=... AI_PLATFORM_BASE_URL=https://api.example.com node tools/ai-platform-router.js tools/sample-render-job.json --execute
 */

const fs = require('fs/promises');
const path = require('path');

const args = process.argv.slice(2);
const jobPath = args.find(a => !a.startsWith('--'));
const execute = args.includes('--execute');

if (!jobPath) {
  console.error('Usage: node tools/ai-platform-router.js ./render-job.json --demo|--execute');
  process.exit(1);
}

const OUT_DIR = path.resolve(process.cwd(), 'ai-platform-output');
const AI_PLATFORM_CREATE_PATH = process.env.AI_PLATFORM_CREATE_PATH || '/v1/render-jobs';
const AI_PLATFORM_ROUTE = process.env.AI_PLATFORM_ROUTE || 'bookreel-short-video';
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
        ? 'Live mode sends the route job to the configured AI Platform backend.'
        : 'Customer-facing MVP should produce a complete production package without spending third-party API cost.',
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
        engine: 'codex-demo-engine',
        output: 'Generate 60-second dialogue script with interruption rhythm and scene beats.'
      },
      {
        node: 'avatar.design',
        engine: 'codex-demo-engine',
        futureProvider: 'heygen-avatar-v',
        output: hasDialogue ? 'Two-avatar speaking plan with different voices.' : 'Single-avatar host plan.'
      },
      {
        node: 'image.keyframes',
        engine: 'codex-demo-engine',
        futureProvider: 'openai-images',
        output: 'Prompt pack for character, book cover, scene keyframes, Q-style variants.'
      },
      {
        node: 'video.scene_broll',
        engine: 'codex-demo-engine',
        futureProvider: 'runway-gen-4.5',
        output: `${sceneCount} vertical scene-video prompts for cinematic B-roll.`
      },
      {
        node: 'assembly.short_video',
        engine: 'codex-demo-engine',
        futureProvider: 'remotion-or-ffmpeg',
        output: '9:16 edit decision list with subtitles, CTA, AI label, scene timing.'
      }
    ],
    package: buildProductionPackage(job, script)
  };
}

function aiPlatformPayload(job, plan) {
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
      runwayStylePrompt: [
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
    ...plan.route.map(step => `- ${step.node}: ${step.engine}${step.futureProvider ? ` -> future ${step.futureProvider}` : ''}`),
    '',
    '## Avatar Plan',
    ...pkg.avatarPlan.map(role => `- ${role.role}: ${role.voice}`),
    '',
    '## Scene Prompts',
    ...pkg.scenePrompts.map(scene => `- ${scene.name}: ${scene.runwayStylePrompt}`),
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
    const result = await executeAiPlatform(job, plan);
    console.log(JSON.stringify({
      mode: 'ai-platform-live',
      output: OUT_DIR,
      createPath: AI_PLATFORM_CREATE_PATH,
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
      'AI_PLATFORM_ROUTE',
      'AI_PLATFORM_STATUS_PATH_TEMPLATE'
    ],
    futureEnv: [
      'OPENAI_API_KEY',
      'HEYGEN_API_KEY',
      'HEYGEN_AVATAR_ID',
      'HEYGEN_VOICE_ID',
      'RUNWAYML_API_SECRET'
    ]
  }, null, 2));
}

main().catch(err => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
