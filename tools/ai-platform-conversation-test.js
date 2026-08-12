#!/usr/bin/env node
/* Test BookReel two-person interview generation through AI Platform.
 *
 * Usage:
 *   set -a && source .env.local && set +a
 *   node tools/ai-platform-conversation-test.js
 */

const baseUrl = (process.env.AI_PLATFORM_BASE_URL || '').replace(/\/+$/, '');
const apiKey = process.env.AI_PLATFORM_API_KEY;
const taskPath = process.env.AI_PLATFORM_TASK_PATH || '/v1/tasks';
const statusTemplate = process.env.AI_PLATFORM_STATUS_PATH_TEMPLATE || '/v1/tasks/{id}';
const pollMs = Number(process.env.AI_PLATFORM_AVATAR_POLL_MS || 5000);
const maxPolls = Number(process.env.AI_PLATFORM_CONVERSATION_MAX_POLLS || 72);

if (!baseUrl) throw new Error('Missing AI_PLATFORM_BASE_URL');
if (!apiKey) throw new Error('Missing AI_PLATFORM_API_KEY');

function joinUrl(path) {
  return `${baseUrl}/${path.replace(/^\/+/, '')}`;
}

async function requestJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch (_) { body = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`${res.status} ${res.statusText}: ${text.slice(0, 1000)}`);
    err.response = body;
    throw err;
  }
  return body;
}

function resultOf(body) {
  return body && (body.result || body.data || body.task || body);
}

function idOf(body) {
  const r = resultOf(body) || {};
  return r.id || r.task_id || r.taskId || r.job_id || body?.id || body?.task_id || body?.taskId;
}

function statusOf(body) {
  const r = resultOf(body) || {};
  return String(r.status || body?.status || '').toLowerCase();
}

function videoUrlOf(body) {
  const r = resultOf(body) || {};
  const a = r.completed_assets || r.completedAssets || r.assets || r.output || body?.completed_assets || {};
  return a.final_video_url || a.conversation_video_url || a.avatar_video_url || a.video_url ||
    r.final_video_url || r.conversation_video_url || r.avatar_video_url || r.video_url || r.url;
}

function statusUrl(id) {
  return joinUrl(statusTemplate.replace('{id}', encodeURIComponent(id)));
}

async function main() {
  const payload = {
    task: 'conversation_video',
    quality: 'fast',
    ratio: '9:16',
    duration_seconds: 30,
    callback_id: `bookreel_conversation_test_${Date.now()}`,
    scene: 'professional_interview_room',
    title: 'BookReel 双人访谈测试',
    speakers: [
      {
        id: 'host',
        role: 'host',
        name: '主持人',
        avatar_id: process.env.AI_PLATFORM_HOST_AVATAR_ID || process.env.HEYGEN_AVATAR_ID || 'auto',
        voice_id: process.env.AI_PLATFORM_HOST_VOICE_ID || process.env.HEYGEN_VOICE_ID || 'auto'
      },
      {
        id: 'guest',
        role: 'guest',
        name: '来宾',
        avatar_id: process.env.AI_PLATFORM_GUEST_AVATAR_ID || 'auto',
        voice_id: process.env.AI_PLATFORM_GUEST_VOICE_ID || 'auto'
      }
    ],
    dialogue: [
      { speaker: 'host', text: '今天我们用一分钟聊一本新书。你觉得它最值得先讲的是什么？' },
      { speaker: 'guest', text: '它不是叫你更忙，而是提醒你把力气放在真正有杠杆的地方。' },
      { speaker: 'host', text: '等一下，这句话听起来很漂亮。普通人要怎么判断什么叫杠杆？' },
      { speaker: 'guest', text: '看这件事做完之后，是只消耗你，还是会持续带来结果。' }
    ],
    output: {
      format: 'mp4',
      store: true,
      completed_assets: ['final_video_url', 'conversation_video_url']
    }
  };

  const created = await requestJson(joinUrl(taskPath), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });
  console.log(JSON.stringify({ created }, null, 2));

  const immediateUrl = videoUrlOf(created);
  if (immediateUrl) {
    console.log(JSON.stringify({ ok: true, final_video_url: immediateUrl }, null, 2));
    return;
  }

  const id = idOf(created);
  if (!id) throw new Error('AI Platform did not return result.id / task_id');

  for (let i = 0; i < maxPolls; i++) {
    await new Promise(resolve => setTimeout(resolve, pollMs));
    const status = await requestJson(statusUrl(id), {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const state = statusOf(status);
    const url = videoUrlOf(status);
    console.log(JSON.stringify({ poll: i + 1, status: state || '(none)', url: !!url }, null, 2));
    if (url) {
      console.log(JSON.stringify({ ok: true, final_video_url: url, raw: status }, null, 2));
      return;
    }
    if (['failed', 'error', 'canceled', 'cancelled'].includes(state)) {
      throw new Error(`AI Platform task failed: ${JSON.stringify(status)}`);
    }
  }
  throw new Error(`Timed out waiting for conversation_video after ${maxPolls} polls`);
}

main().catch(err => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
