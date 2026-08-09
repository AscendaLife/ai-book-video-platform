#!/usr/bin/env node
/* Probe AI Platform avatar/lipsync contract.
 *
 * Usage:
 *   set -a && source .env.local && set +a
 *   node tools/ai-platform-avatar-test.js
 */

const fs = require('fs/promises');
const path = require('path');

const baseUrl = (process.env.AI_PLATFORM_BASE_URL || '').replace(/\/+$/, '');
const apiKey = process.env.AI_PLATFORM_API_KEY;
const taskPath = process.env.AI_PLATFORM_TASK_PATH || '/v1/tasks';
const OUT_DIR = path.resolve(process.cwd(), 'ai-platform-output', 'avatar-tests');

if (!baseUrl) throw new Error('Missing AI_PLATFORM_BASE_URL');
if (!apiKey) throw new Error('Missing AI_PLATFORM_API_KEY');

const endpoint = `${baseUrl}/${taskPath.replace(/^\/+/, '')}`;

const cases = [
  {
    id: 'avatar_minimal',
    body: {
      task: 'avatar',
      quality: 'fast',
      prompt: '一位專業女主持人用自然語氣說：這本書不是叫你更忙，而是讓你做對更少的事。',
      voice: 'female_young_fast',
      ratio: '9:16',
      avatar: {
        type: 'digital_human',
        style: 'professional_host'
      }
    }
  },
  {
    id: 'lipsync_minimal_contract',
    body: {
      task: 'lipsync',
      quality: 'fast',
      avatar_image_url: 'https://example.com/avatar.png',
      audio_url: 'https://example.com/audio.mp3',
      ratio: '9:16'
    }
  }
];

function collectUrls(value, pathName = '', out = []) {
  if (typeof value === 'string') {
    const urls = value.match(/https?:\/\/[^\s"'<>]+/g) || [];
    urls.forEach(url => out.push({ path: pathName, url }));
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => collectUrls(item, `${pathName}[${index}]`, out));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => collectUrls(item, pathName ? `${pathName}.${key}` : key, out));
  }
  return out;
}

function hasAnyKey(value, keys) {
  let found = false;
  function walk(item) {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) return item.forEach(walk);
    for (const [key, child] of Object.entries(item)) {
      if (keys.includes(key)) found = true;
      walk(child);
    }
  }
  walk(value);
  return found;
}

async function checkUrl(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return {
      url,
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get('content-type')
    };
  } catch (err) {
    return { url, ok: false, status: 0, error: err.message };
  }
}

async function runCase(test) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-BookReel-Test': test.id
    },
    body: JSON.stringify(test.body)
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch (_) { body = { raw: text }; }
  const urls = collectUrls(body);
  const urlChecks = await Promise.all(urls.map(item => checkUrl(item.url)));

  return {
    id: test.id,
    httpStatus: res.status,
    hasTaskId: hasAnyKey(body, ['id', 'taskId', 'task_id', 'jobId', 'job_id']),
    hasAvatarVideoUrl: hasAnyKey(body, ['avatar_video_url']),
    hasCompletedAssets: hasAnyKey(body, ['completed_assets']),
    hasStatus: hasAnyKey(body, ['status']),
    reachableUrlCount: urlChecks.filter(item => item.ok).length,
    urls,
    urlChecks,
    body
  };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const results = [];
  for (const test of cases) {
    const result = await runCase(test);
    results.push(result);
    await fs.writeFile(path.join(OUT_DIR, `${test.id}.json`), JSON.stringify(result, null, 2));
  }

  const summary = {
    createdAt: new Date().toISOString(),
    endpoint,
    results: results.map(item => ({
      id: item.id,
      httpStatus: item.httpStatus,
      hasTaskId: item.hasTaskId,
      hasAvatarVideoUrl: item.hasAvatarVideoUrl,
      hasCompletedAssets: item.hasCompletedAssets,
      hasStatus: item.hasStatus,
      reachableUrlCount: item.reachableUrlCount
    }))
  };
  await fs.writeFile(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(err => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
