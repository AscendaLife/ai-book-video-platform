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
const avatarStatusTemplate = process.env.AI_PLATFORM_AVATAR_STATUS_PATH_TEMPLATE || process.env.AI_PLATFORM_STATUS_PATH_TEMPLATE || '/v1/tasks/{id}';
const lipsyncStatusTemplate = process.env.AI_PLATFORM_LIPSYNC_STATUS_PATH_TEMPLATE || avatarStatusTemplate;
const pollMs = Number(process.env.AI_PLATFORM_AVATAR_POLL_MS || 5000);
const maxPolls = Number(process.env.AI_PLATFORM_AVATAR_MAX_POLLS || 24);
const lipsyncVideoUrl = process.env.AI_PLATFORM_LIPSYNC_VIDEO_URL;
const lipsyncAudioUrl = process.env.AI_PLATFORM_LIPSYNC_AUDIO_URL;
const OUT_DIR = path.resolve(process.cwd(), 'ai-platform-output', 'avatar-tests');

if (!baseUrl) throw new Error('Missing AI_PLATFORM_BASE_URL');
if (!apiKey) throw new Error('Missing AI_PLATFORM_API_KEY');

const endpoint = `${baseUrl}/${taskPath.replace(/^\/+/, '')}`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const cases = [
  {
    id: 'avatar_minimal',
    statusTemplate: avatarStatusTemplate,
    expectedUrlKeys: ['avatar_video_url'],
    body: {
      task: 'avatar',
      quality: 'fast',
      prompt: '一位專業女主持人用自然語氣說：這本書不是叫你更忙，而是讓你做對更少的事。',
      voice: 'female_young_fast',
      ratio: '9:16',
      engine: 'avatar_iii',
      avatar: {
        type: 'digital_human',
        style: 'professional_host',
        source: 'stock_avatar'
      }
    }
  },
  {
    id: 'lipsync_video_audio_contract',
    statusTemplate: lipsyncStatusTemplate,
    expectedUrlKeys: ['lipsync_video_url', 'avatar_video_url'],
    skipReason: !lipsyncVideoUrl || !lipsyncAudioUrl
      ? 'Missing AI_PLATFORM_LIPSYNC_VIDEO_URL or AI_PLATFORM_LIPSYNC_AUDIO_URL'
      : '',
    body: {
      task: 'lipsync',
      quality: 'fast',
      video_url: lipsyncVideoUrl,
      audio_url: lipsyncAudioUrl,
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

function findKeyPaths(value, keys, pathName = '', out = []) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    value.forEach((item, index) => findKeyPaths(item, keys, `${pathName}[${index}]`, out));
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = pathName ? `${pathName}.${key}` : key;
    if (keys.includes(key)) out.push({ key, path: childPath, value: child });
    findKeyPaths(child, keys, childPath, out);
  }
  return out;
}

function firstStringKeyPath(value, keys) {
  const matches = findKeyPaths(value, keys);
  return matches.find(item => typeof item.value === 'string') || matches[0] || null;
}

function firstTaskId(value) {
  const match = firstStringKeyPath(value, ['id', 'taskId', 'task_id', 'jobId', 'job_id', 'callback_id']);
  return match?.value || '';
}

function taskStatus(value) {
  if (!value || typeof value !== 'object') return '';
  return value.status || value.state || value.data?.status || value.result?.status || '';
}

function isTerminalStatus(status) {
  return ['completed', 'complete', 'succeeded', 'success', 'failed', 'error', 'canceled', 'cancelled']
    .includes(String(status || '').toLowerCase());
}

function statusUrl(id, template) {
  return `${baseUrl}/${template.replace(/^\/+/, '').replace('{id}', encodeURIComponent(id))}`;
}

async function pollTask(id, template) {
  const checks = [];
  for (let i = 0; i < maxPolls; i++) {
    const res = await fetch(statusUrl(id, template), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-BookReel-Test': 'avatar_poll'
      }
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch (_) { body = { raw: text.slice(0, 1200) }; }
    const status = taskStatus(body);
    checks.push({ poll: i + 1, httpStatus: res.status, status, body });
    if (isTerminalStatus(status)) break;
    await sleep(pollMs);
  }
  return checks;
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
  if (test.skipReason) {
    return {
      id: test.id,
      skipped: true,
      skipReason: test.skipReason,
      expectedUrlKeys: test.expectedUrlKeys
    };
  }

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
  const taskIdField = firstStringKeyPath(body, ['id', 'taskId', 'task_id', 'jobId', 'job_id', 'callback_id']);
  const callbackIdField = firstStringKeyPath(body, ['callback_id', 'callbackId']);
  const webhookEventField = firstStringKeyPath(body, ['webhook_event', 'webhookEvent', 'event', 'event_type', 'eventType']);
  const id = firstTaskId(body);
  const expectedUrlKeys = test.expectedUrlKeys || ['avatar_video_url'];
  const pollChecks = id && !hasAnyKey(body, expectedUrlKeys) ? await pollTask(id, test.statusTemplate) : [];
  const finalBody = pollChecks.length ? pollChecks[pollChecks.length - 1].body : body;
  const finalUrls = collectUrls(finalBody);
  const finalUrlChecks = await Promise.all(finalUrls.map(item => checkUrl(item.url)));
  const expectedUrlFields = findKeyPaths(finalBody, expectedUrlKeys).filter(item => typeof item.value === 'string');
  const contractWarnings = [];
  if (!id) contractWarnings.push(`No task id found. Tried id, taskId, task_id, jobId, job_id, callback_id.`);
  if (!expectedUrlFields.length && isTerminalStatus(taskStatus(finalBody))) {
    contractWarnings.push(`Terminal response did not include expected media URL fields: ${expectedUrlKeys.join(', ')}.`);
  }
  if (test.id.includes('lipsync') && !callbackIdField) {
    contractWarnings.push('No callback_id/callbackId observed in submit response; webhook correlation support is still unconfirmed.');
  }
  if (test.id.includes('lipsync') && !webhookEventField) {
    contractWarnings.push('No webhook event name observed in client-visible response; confirm from AI Platform server logs or diagnostic fields.');
  }

  return {
    id: test.id,
    httpStatus: res.status,
    taskId: id,
    taskIdField: taskIdField ? { key: taskIdField.key, path: taskIdField.path } : null,
    callbackIdField: callbackIdField ? { key: callbackIdField.key, path: callbackIdField.path } : null,
    webhookEventField: webhookEventField ? { key: webhookEventField.key, path: webhookEventField.path, value: webhookEventField.value } : null,
    expectedUrlFields: expectedUrlFields.map(item => ({ key: item.key, path: item.path, url: item.value })),
    contractWarnings,
    hasTaskId: !!id || hasAnyKey(body, ['id', 'taskId', 'task_id', 'jobId', 'job_id', 'callback_id']),
    hasAvatarVideoUrl: hasAnyKey(finalBody, ['avatar_video_url']),
    hasLipsyncVideoUrl: hasAnyKey(finalBody, ['lipsync_video_url']),
    hasCompletedAssets: hasAnyKey(finalBody, ['completed_assets']),
    hasStoredFlag: hasAnyKey(finalBody, ['stored']),
    hasProviderExpiryFlag: hasAnyKey(finalBody, ['provider_video_url_expires']),
    hasStatus: hasAnyKey(finalBody, ['status']),
    finalStatus: taskStatus(finalBody),
    pollCount: pollChecks.length,
    reachableUrlCount: finalUrlChecks.filter(item => item.ok).length || urlChecks.filter(item => item.ok).length,
    urls,
    urlChecks,
    finalUrls,
    finalUrlChecks,
    pollChecks,
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
      skipped: item.skipped,
      skipReason: item.skipReason,
      httpStatus: item.httpStatus,
      taskId: item.taskId,
      taskIdField: item.taskIdField,
      callbackIdField: item.callbackIdField,
      webhookEventField: item.webhookEventField,
      expectedUrlFields: item.expectedUrlFields,
      contractWarnings: item.contractWarnings,
      hasTaskId: item.hasTaskId,
      hasAvatarVideoUrl: item.hasAvatarVideoUrl,
      hasLipsyncVideoUrl: item.hasLipsyncVideoUrl,
      hasCompletedAssets: item.hasCompletedAssets,
      hasStoredFlag: item.hasStoredFlag,
      hasProviderExpiryFlag: item.hasProviderExpiryFlag,
      hasStatus: item.hasStatus,
      finalStatus: item.finalStatus,
      pollCount: item.pollCount,
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
