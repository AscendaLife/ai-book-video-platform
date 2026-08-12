#!/usr/bin/env node
/* Inspect HeyGen Studio templates without exposing the API key.
 *
 * Usage:
 *   HEYGEN_API_KEY=... node tools/heygen-template-inspect.js
 *   HEYGEN_API_KEY=... node tools/heygen-template-inspect.js TEMPLATE_ID
 *
 * If the first command returns an empty list, create a template in HeyGen
 * Studio first. If it returns 403/404, the account or plan may not have
 * Templates API access enabled.
 */

const apiKey = process.env.HEYGEN_API_KEY || process.env.HEYGEN_KEY;
const templateId = process.argv[2];
const baseUrl = (process.env.HEYGEN_API_BASE_URL || 'https://api.heygen.com').replace(/\/+$/, '');

if (!apiKey) {
  console.error('Missing HEYGEN_API_KEY or HEYGEN_KEY.');
  console.error('Example: HEYGEN_API_KEY=... node tools/heygen-template-inspect.js');
  process.exit(1);
}

async function requestJson(path) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'x-api-key': apiKey }
  });
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

function summarizeTemplates(body) {
  const list = body.templates || body.data?.templates || body.data || body.items || [];
  if (!Array.isArray(list)) return body;
  return {
    count: list.length,
    templates: list.map(t => ({
      id: t.id || t.template_id || t.templateId,
      name: t.name || t.title,
      status: t.status,
      variables: t.variables || t.variable_names || t.template_variables,
      rawKeys: Object.keys(t).sort()
    }))
  };
}

async function main() {
  if (templateId) {
    const body = await requestJson(`/v3/templates/${encodeURIComponent(templateId)}`);
    console.log(JSON.stringify(body, null, 2));
    return;
  }
  const body = await requestJson('/v3/templates?limit=100');
  console.log(JSON.stringify(summarizeTemplates(body), null, 2));
}

main().catch(err => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
