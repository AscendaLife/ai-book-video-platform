#!/usr/bin/env node
/* Probe AI Platform media capabilities without printing secrets.
 *
 * Usage:
 *   set -a && source .env.local && set +a
 *   node tools/ai-platform-capability-test.js
 */

const fs = require('fs/promises');
const path = require('path');

const OUT_DIR = path.resolve(process.cwd(), 'ai-platform-output', 'capability-tests');
const baseUrl = (process.env.AI_PLATFORM_BASE_URL || '').replace(/\/+$/, '');
const apiKey = process.env.AI_PLATFORM_API_KEY;
const createPath = process.env.AI_PLATFORM_CREATE_PATH || '/v1/chat/completions';

if (!baseUrl) throw new Error('Missing AI_PLATFORM_BASE_URL');
if (!apiKey) throw new Error('Missing AI_PLATFORM_API_KEY');

const tests = [
  {
    id: 'image_gpt_image_2',
    kind: 'image',
    model: 'gpt-image-2',
    expected: ['image_url', 'asset_urls'],
    prompt: 'Generate one real 9:16 book marketing key visual for a digital-human short video. Return strict JSON only. Put a real generated image URL in completed_assets.image_url only if the platform actually generated and hosted the image. If no real URL is available, return completed_assets:{} and planned_assets with the prompt.'
  },
  {
    id: 'image_imagen_4',
    kind: 'image',
    model: 'imagen-4',
    expected: ['image_url', 'asset_urls'],
    prompt: 'Generate one real 9:16 cinematic image for a new-book launch, with book cover, digital-human host, and visible environment. Return strict JSON only. Use completed_assets.image_url only for a real platform-hosted image URL.'
  },
  {
    id: 'video_runway_gen_4_5',
    kind: 'deep_video',
    model: 'runway-gen-4-5',
    expected: ['deep_video_url', 'asset_urls'],
    prompt: 'Generate one real 5 second vertical 9:16 deep scene video: Mars base, digital-human book discussion mood, cinematic camera push-in. Return strict JSON only. Use completed_assets.deep_video_url only for a real generated video URL.'
  },
  {
    id: 'video_veo_3_1',
    kind: 'deep_video',
    model: 'veo-3-1',
    expected: ['deep_video_url', 'asset_urls'],
    prompt: 'Generate one real 5 second vertical 9:16 deep scene video: professional interview room with book cover, subtle camera pan. Return strict JSON only. Use completed_assets.deep_video_url only for a real generated video URL.'
  },
  {
    id: 'video_sora_2',
    kind: 'deep_video',
    model: 'sora-2',
    expected: ['deep_video_url', 'asset_urls'],
    prompt: 'Generate one real 5 second vertical 9:16 cinematic video for a book short-video opening. Return strict JSON only. Use completed_assets.deep_video_url only for a real generated video URL.'
  },
  {
    id: 'avatar_lipsync_auto',
    kind: 'avatar_lipsync',
    model: 'auto',
    expected: ['avatar_video_url', 'asset_urls'],
    prompt: 'Use AI Platform internal avatar/lipsync capability to generate a real 6 second talking digital-human avatar video. Two speakers are not needed; create one host saying: 這本書不是叫你更忙，而是讓你做對更少的事。 Return strict JSON only. Use completed_assets.avatar_video_url only for a real lipsynced avatar video URL.'
  }
];

function endpoint() {
  return `${baseUrl}/${createPath.replace(/^\/+/, '')}`;
}

function stripFence(text) {
  return String(text || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function parseContent(text) {
  const cleaned = stripFence(text);
  try { return { parsed: JSON.parse(cleaned), cleaned }; } catch (_) { return { parsed: null, cleaned }; }
}

function extractContent(response) {
  return response.choices?.[0]?.message?.content || response.output_text || response.content || JSON.stringify(response);
}

function findUrls(value, pathName = '', hits = []) {
  if (typeof value === 'string') {
    const urls = value.match(/https?:\/\/[^\s"'<>]+/g) || [];
    urls.forEach(url => hits.push({ path: pathName, url }));
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => findUrls(item, `${pathName}[${index}]`, hits));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => findUrls(item, pathName ? `${pathName}.${key}` : key, hits));
  }
  return hits;
}

function hasExpectedField(value, fields) {
  let found = false;
  function walk(item) {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) return item.forEach(walk);
    for (const [key, val] of Object.entries(item)) {
      if (fields.includes(key)) found = true;
      walk(val);
    }
  }
  walk(value);
  return found;
}

async function checkUrl(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return { url, ok: res.ok, status: res.status, contentType: res.headers.get('content-type') };
  } catch (err) {
    return { url, ok: false, status: 0, error: err.message };
  }
}

async function runTest(test) {
  const payload = {
    model: test.model,
    messages: [
      {
        role: 'system',
        content: [
          'You are an AI Platform media capability probe.',
          'Do not invent URLs.',
          'Only use completed_assets when the platform returns actual hosted media.',
          'Otherwise put requirements under planned_assets.',
          'Return JSON only with keys: capability, model, completed_assets, planned_assets, notes.'
        ].join(' ')
      },
      { role: 'user', content: test.prompt }
    ],
    temperature: 0.1
  };

  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-BookReel-Test': test.id
    },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let response;
  try { response = JSON.parse(text); } catch (_) { response = { raw: text }; }
  const content = extractContent(response);
  const parsed = parseContent(content);
  const target = parsed.parsed || response;
  const urls = findUrls(target);
  const urlChecks = await Promise.all(urls.map(item => checkUrl(item.url)));

  return {
    id: test.id,
    kind: test.kind,
    requestedModel: test.model,
    httpStatus: res.status,
    responseModel: response.model,
    finishReason: response.choices?.[0]?.finish_reason,
    usage: response.usage,
    jsonParsed: !!parsed.parsed,
    hasExpectedField: hasExpectedField(target, test.expected),
    urlCount: urls.length,
    reachableUrlCount: urlChecks.filter(item => item.ok).length,
    urls,
    urlChecks,
    verdict: urlChecks.some(item => item.ok) ? 'media_url_present' : 'no_reachable_media_url',
    contentPreview: content.slice(0, 500)
  };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const results = [];
  for (const test of tests) {
    const result = await runTest(test);
    results.push(result);
    await fs.writeFile(path.join(OUT_DIR, `${test.id}.json`), JSON.stringify(result, null, 2));
  }
  const summary = {
    createdAt: new Date().toISOString(),
    endpoint: endpoint(),
    results: results.map(item => ({
      id: item.id,
      kind: item.kind,
      requestedModel: item.requestedModel,
      responseModel: item.responseModel,
      httpStatus: item.httpStatus,
      jsonParsed: item.jsonParsed,
      hasExpectedField: item.hasExpectedField,
      urlCount: item.urlCount,
      reachableUrlCount: item.reachableUrlCount,
      verdict: item.verdict
    }))
  };
  await fs.writeFile(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(err => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
