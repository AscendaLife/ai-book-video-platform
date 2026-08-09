#!/usr/bin/env node
/* End-to-end AI Platform probe: avatar -> tts -> lipsync.
 *
 * Usage:
 *   set -a && source .env.local && set +a
 *   node tools/ai-platform-lipsync-chain-test.js
 */

const fs = require('fs/promises');
const path = require('path');

const baseUrl = (process.env.AI_PLATFORM_BASE_URL || '').replace(/\/+$/, '');
const apiKey = process.env.AI_PLATFORM_API_KEY;
const taskPath = process.env.AI_PLATFORM_TASK_PATH || '/v1/tasks';
const avatarStatusTemplate = process.env.AI_PLATFORM_AVATAR_STATUS_PATH_TEMPLATE || process.env.AI_PLATFORM_STATUS_PATH_TEMPLATE || '/v1/tasks/{id}';
const ttsStatusTemplate = process.env.AI_PLATFORM_TTS_STATUS_PATH_TEMPLATE || process.env.AI_PLATFORM_STATUS_PATH_TEMPLATE || '/v1/tasks/{id}';
const lipsyncStatusTemplate = process.env.AI_PLATFORM_LIPSYNC_STATUS_PATH_TEMPLATE || process.env.AI_PLATFORM_STATUS_PATH_TEMPLATE || '/v1/tasks/{id}';
const pollMs = Number(process.env.AI_PLATFORM_AVATAR_POLL_MS || 5000);
const maxPolls = Number(process.env.AI_PLATFORM_CHAIN_MAX_POLLS || 72);
const OUT_DIR = path.resolve(process.cwd(), 'ai-platform-output', 'lipsync-chain');

if (!baseUrl) throw new Error('Missing AI_PLATFORM_BASE_URL');
if (!apiKey) throw new Error('Missing AI_PLATFORM_API_KEY');

const endpoint = `${baseUrl}/${taskPath.replace(/^\/+/, '')}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const avatarPrompt = process.env.AI_PLATFORM_CHAIN_AVATAR_PROMPT
  || '一位專業女主持人面對鏡頭自然說：這本書不是叫你更忙，而是讓你做對更少的事。';
const ttsPrompt = process.env.AI_PLATFORM_CHAIN_TTS_PROMPT
  || '請用自然、有情緒、有停頓的台灣華語女生聲音朗讀：等等，這句話很關鍵。這本書不是叫你更忙，而是讓你做對更少的事。';
const ttsQuality = process.env.AI_PLATFORM_CHAIN_TTS_QUALITY || 'premium';
const providedAvatarVideoUrl = process.env.AI_PLATFORM_CHAIN_AVATAR_VIDEO_URL;
const providedTtsAudioUrl = process.env.AI_PLATFORM_CHAIN_TTS_AUDIO_URL;

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

function collectDataUrls(value, pathName = '', out = []) {
  if (typeof value === 'string' && value.startsWith('data:')) {
    out.push({ path: pathName, mediaType: value.slice(5, value.indexOf(';')), bytesApprox: Math.floor(value.length * 0.75) });
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => collectDataUrls(item, `${pathName}[${index}]`, out));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => collectDataUrls(item, pathName ? `${pathName}.${key}` : key, out));
  }
  return out;
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

function firstStringForKeys(value, keys) {
  return findKeyPaths(value, keys).find(item => typeof item.value === 'string') || null;
}

function taskStatus(value) {
  if (!value || typeof value !== 'object') return '';
  return value.status || value.state || value.data?.status || value.result?.status || '';
}

function firstTaskId(value) {
  return firstStringForKeys(value, ['id', 'taskId', 'task_id', 'jobId', 'job_id', 'callback_id'])?.value || '';
}

function isTerminalStatus(status) {
  return ['completed', 'complete', 'succeeded', 'success', 'failed', 'error', 'canceled', 'cancelled']
    .includes(String(status || '').toLowerCase());
}

function statusUrl(id, template) {
  return `${baseUrl}/${template.replace(/^\/+/, '').replace('{id}', encodeURIComponent(id))}`;
}

async function requestJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch (_) { body = { raw: text.slice(0, 4000) }; }
  return { httpStatus: res.status, ok: res.ok, body };
}

async function submitTask(stepId, body) {
  return requestJson(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-BookReel-Test': stepId
    },
    body: JSON.stringify(body)
  });
}

async function pollTask(stepId, id, template, expectedKeys) {
  const checks = [];
  for (let i = 0; i < maxPolls; i++) {
    const result = await requestJson(statusUrl(id, template), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-BookReel-Test': `${stepId}_poll`
      }
    });
    const status = taskStatus(result.body);
    checks.push({ poll: i + 1, httpStatus: result.httpStatus, status, body: result.body });
    const hasExpected = expectedKeys.some(key => firstStringForKeys(result.body, [key]));
    if (hasExpected || isTerminalStatus(status)) break;
    await sleep(pollMs);
  }
  return checks;
}

async function checkUrl(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return { url, ok: res.ok, status: res.status, contentType: res.headers.get('content-type') };
  } catch (err) {
    return { url, ok: false, status: 0, error: err.message };
  }
}

async function runStep(stepId, body, statusTemplate, expectedKeys) {
  const submit = await submitTask(stepId, body);
  const taskId = firstTaskId(submit.body);
  const immediateMedia = expectedKeys.map(key => firstStringForKeys(submit.body, [key])).find(Boolean);
  const polls = taskId && !immediateMedia ? await pollTask(stepId, taskId, statusTemplate, expectedKeys) : [];
  const finalBody = polls.length ? polls[polls.length - 1].body : submit.body;
  const mediaField = expectedKeys.map(key => firstStringForKeys(finalBody, [key])).find(Boolean);
  const mediaUrl = mediaField?.value || '';
  const urlChecks = mediaUrl ? [await checkUrl(mediaUrl)] : [];
  const dataUrls = collectDataUrls(finalBody);

  return {
    stepId,
    requestBody: body,
    httpStatus: submit.httpStatus,
    taskId,
    taskIdField: firstStringForKeys(submit.body, ['id', 'taskId', 'task_id', 'jobId', 'job_id', 'callback_id']),
    callbackIdField: firstStringForKeys(submit.body, ['callback_id', 'callbackId']),
    webhookEventField: firstStringForKeys(submit.body, ['webhook_event', 'webhookEvent', 'event', 'event_type', 'eventType']),
    finalStatus: taskStatus(finalBody),
    pollCount: polls.length,
    mediaField,
    mediaUrl,
    urlChecks,
    dataUrls,
    storedField: firstStringForKeys(finalBody, ['stored']),
    providerExpiryField: firstStringForKeys(finalBody, ['provider_video_url_expires']),
    submitBody: submit.body,
    finalBody,
    polls
  };
}

async function writeStep(name, result) {
  await fs.writeFile(path.join(OUT_DIR, `${name}.json`), JSON.stringify(result, null, 2));
}

async function providedMediaStep(stepId, mediaUrl, key) {
  const urlChecks = [await checkUrl(mediaUrl)];
  return {
    stepId,
    provided: true,
    taskId: '',
    finalStatus: 'provided',
    mediaField: { key, path: `env.${key}`, value: mediaUrl },
    mediaUrl,
    urlChecks,
    dataUrls: [],
    submitBody: null,
    finalBody: null,
    polls: []
  };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const avatar = providedAvatarVideoUrl
    ? await providedMediaStep('chain_avatar_source', providedAvatarVideoUrl, 'avatar_video_url')
    : await runStep('chain_avatar_source', {
    task: 'avatar',
    quality: 'fast',
    prompt: avatarPrompt,
    voice: 'female_young_fast',
    ratio: '9:16',
    engine: 'avatar_iii',
    avatar: {
      type: 'digital_human',
      style: 'professional_host',
      source: 'stock_avatar'
    }
  }, avatarStatusTemplate, ['avatar_video_url', 'video_url']);
  await writeStep('01-avatar', avatar);

  const failures = [];
  if (!avatar.mediaUrl) failures.push('avatar did not return avatar_video_url/video_url');

  let tts = null;
  let lipsync = null;

  if (!failures.length) {
    tts = providedTtsAudioUrl
      ? await providedMediaStep('chain_tts_audio', providedTtsAudioUrl, 'audio_url')
      : await runStep('chain_tts_audio', {
    task: 'tts',
    quality: ttsQuality,
    prompt: ttsPrompt,
    voice: 'female_young_fast'
    }, ttsStatusTemplate, ['audio_url']);
    await writeStep('02-tts', tts);
    if (!tts.mediaUrl) {
      failures.push(tts.dataUrls.length
        ? 'tts returned data URL only; lipsync needs a public audio_url'
        : 'tts did not return audio_url');
    }
  }

  if (!failures.length) {
    lipsync = await runStep('chain_lipsync_final', {
      task: 'lipsync',
      quality: 'fast',
      video_url: avatar.mediaUrl,
      audio_url: tts.mediaUrl,
      ratio: '9:16'
    }, lipsyncStatusTemplate, ['lipsync_video_url', 'avatar_video_url', 'video_url']);
    await writeStep('03-lipsync', lipsync);
    if (!lipsync.mediaUrl) failures.push('lipsync did not return lipsync_video_url/avatar_video_url/video_url');
  }

  const summary = {
    createdAt: new Date().toISOString(),
    endpoint,
    steps: {
      avatar: {
        taskId: avatar.taskId,
        finalStatus: avatar.finalStatus,
        mediaUrl: avatar.mediaUrl,
        reachable: avatar.urlChecks[0]?.ok || false,
        mediaField: avatar.mediaField ? { key: avatar.mediaField.key, path: avatar.mediaField.path } : null
      },
      tts: {
        taskId: tts?.taskId || '',
        finalStatus: tts?.finalStatus || '',
        mediaUrl: tts?.mediaUrl || '',
        reachable: tts?.urlChecks?.[0]?.ok || false,
        dataUrlCount: tts?.dataUrls?.length || 0,
        mediaField: tts?.mediaField ? { key: tts.mediaField.key, path: tts.mediaField.path } : null
      },
      lipsync: lipsync ? {
        taskId: lipsync.taskId,
        finalStatus: lipsync.finalStatus,
        mediaUrl: lipsync.mediaUrl,
        reachable: lipsync.urlChecks[0]?.ok || false,
        mediaField: lipsync.mediaField ? { key: lipsync.mediaField.key, path: lipsync.mediaField.path } : null,
        callbackIdField: lipsync.callbackIdField ? { key: lipsync.callbackIdField.key, path: lipsync.callbackIdField.path } : null,
        webhookEventField: lipsync.webhookEventField ? { key: lipsync.webhookEventField.key, path: lipsync.webhookEventField.path, value: lipsync.webhookEventField.value } : null
      } : null
    },
    pass: failures.length === 0 && !!lipsync?.mediaUrl,
    failures
  };

  await fs.writeFile(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.pass) process.exitCode = 1;
}

main().catch(err => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
