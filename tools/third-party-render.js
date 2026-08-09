#!/usr/bin/env node
/* BookReel third-party render bridge.
 *
 * Usage:
 *   node tools/third-party-render.js ./render-job.json --dry-run
 *   OPENAI_API_KEY=... HEYGEN_API_KEY=... RUNWAYML_API_SECRET=... node tools/third-party-render.js ./render-job.json --execute
 *
 * The browser must never call these APIs directly because it would expose API keys.
 */

const fs = require('fs/promises');
const path = require('path');

const args = process.argv.slice(2);
const jobPath = args.find(a => !a.startsWith('--'));
const execute = args.includes('--execute');
const dryRun = args.includes('--dry-run') || !execute;

if (!jobPath) {
  console.error('Usage: node tools/third-party-render.js ./render-job.json --dry-run|--execute');
  process.exit(1);
}

const OUT_DIR = path.resolve(process.cwd(), 'third-party-output');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function requestJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch (_) { body = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
    err.response = body;
    throw err;
  }
  return body;
}

function firstScript(job) {
  if (!job.scripts || !job.scripts.length) throw new Error('Job has no scripts');
  return job.scripts[0];
}

function openAiImagePayload(job) {
  const script = firstScript(job);
  const firstScene = (script.scenePlan && script.scenePlan[0]) || {};
  return {
    model: 'gpt-image-1',
    size: '1024x1536',
    quality: 'high',
    prompt: [
      `Vertical 9:16 cinematic key visual for the new book "${job.project.title}".`,
      `Scene: ${firstScene.name || 'dramatic book launch scene'}.`,
      `Environment details: ${firstScene.visual || 'strong environment, visible location, book cover presence'}.`,
      'Two digital-human presenters, book cover readable, premium social-video thumbnail composition.',
      'No gore, no nudity, no hate symbols, no real public figure likeness unless explicitly authorized.'
    ].join(' ')
  };
}

function heyGenPayload(job) {
  const script = firstScript(job);
  const dialogue = (script.dialogue || [])
    .map(line => `${line.speaker}: ${line.text}`)
    .join('\n');
  return {
    type: 'avatar',
    avatar_id: process.env.HEYGEN_AVATAR_ID || 'YOUR_HEYGEN_AVATAR_ID',
    voice_id: process.env.HEYGEN_VOICE_ID || 'YOUR_HEYGEN_VOICE_ID',
    title: `${job.project.title} - ${script.title}`,
    script: dialogue,
    resolution: '1080p',
    aspect_ratio: '9:16',
    output_format: 'mp4',
    caption: { file_format: 'srt' },
    engine: { type: 'avatar_v' },
    background: { value: 'transparent' }
  };
}

function runwayTextToVideoPayload(job, sceneIndex = 0) {
  const script = firstScript(job);
  const scene = (script.scenePlan && script.scenePlan[sceneIndex]) || (script.scenePlan || [])[0] || {};
  return {
    model: 'gen4.5',
    ratio: '720:1280',
    duration: 10,
    promptText: [
      `Vertical cinematic B-roll for a book marketing video.`,
      `Scene: ${scene.name || 'book world environment'}.`,
      `Details: ${scene.visual || 'clear environment, visible location, premium camera movement'}.`,
      `Mood: ${scene.role || 'dramatic but brand-safe'}.`,
      'No text overlays, no gore, no nudity, no graphic violence.'
    ].join(' ')
  };
}

async function createOpenAiImage(job) {
  if (!process.env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');
  const body = await requestJson('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(openAiImagePayload(job))
  });
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, 'openai-image-response.json'), JSON.stringify(body, null, 2));
  return body;
}

async function createHeyGenVideo(job) {
  if (!process.env.HEYGEN_API_KEY) throw new Error('Missing HEYGEN_API_KEY');
  const body = await requestJson('https://api.heygen.com/v3/videos', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.HEYGEN_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(heyGenPayload(job))
  });
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, 'heygen-create-response.json'), JSON.stringify(body, null, 2));
  return body;
}

async function createRunwayScene(job, sceneIndex = 0) {
  if (!process.env.RUNWAYML_API_SECRET) throw new Error('Missing RUNWAYML_API_SECRET');
  const body = await requestJson('https://api.dev.runwayml.com/v1/text_to_video', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RUNWAYML_API_SECRET}`,
      'X-Runway-Version': '2024-11-06',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(runwayTextToVideoPayload(job, sceneIndex))
  });
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, `runway-scene-${sceneIndex + 1}-response.json`), JSON.stringify(body, null, 2));
  return body;
}

async function pollRunwayTask(taskId) {
  if (!process.env.RUNWAYML_API_SECRET) throw new Error('Missing RUNWAYML_API_SECRET');
  for (let i = 0; i < 60; i++) {
    const task = await requestJson(`https://api.dev.runwayml.com/v1/tasks/${taskId}`, {
      headers: {
        Authorization: `Bearer ${process.env.RUNWAYML_API_SECRET}`,
        'X-Runway-Version': '2024-11-06'
      }
    });
    if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(task.status)) return task;
    await sleep(5000 + Math.floor(Math.random() * 1000));
  }
  throw new Error(`Runway task timed out: ${taskId}`);
}

async function main() {
  const job = JSON.parse(await fs.readFile(path.resolve(jobPath), 'utf8'));
  const payloads = {
    openaiImage: openAiImagePayload(job),
    heygenAvatarVideo: heyGenPayload(job),
    runwaySceneVideo: [0, 1, 2].map(i => runwayTextToVideoPayload(job, i))
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, 'payloads.json'), JSON.stringify(payloads, null, 2));

  if (dryRun) {
    console.log(JSON.stringify({
      mode: 'dry-run',
      output: path.join(OUT_DIR, 'payloads.json'),
      requiredEnv: ['OPENAI_API_KEY', 'HEYGEN_API_KEY', 'HEYGEN_AVATAR_ID', 'HEYGEN_VOICE_ID', 'RUNWAYML_API_SECRET']
    }, null, 2));
    return;
  }

  const openai = await createOpenAiImage(job);
  const heygen = await createHeyGenVideo(job);
  const runway = [];
  for (let i = 0; i < 3; i++) {
    const created = await createRunwayScene(job, i);
    const taskId = created.id || created.data?.id;
    runway.push(taskId ? await pollRunwayTask(taskId) : created);
  }

  await fs.writeFile(path.join(OUT_DIR, 'render-summary.json'), JSON.stringify({ openai, heygen, runway }, null, 2));
  console.log(JSON.stringify({ mode: 'execute', output: OUT_DIR }, null, 2));
}

main().catch(err => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
