#!/usr/bin/env node
/* Minimal Stripe Checkout backend for BookReel.
 *
 * Usage:
 *   set -a && source .env.local && set +a
 *   node tools/payment-server.js
 *
 * Endpoints:
 *   GET  /health
 *   POST /api/payments/checkout
 *   POST /api/payments/webhook
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const PORT = Number(process.env.PAYMENT_PORT || 8788);
const OUT_DIR = path.resolve(process.cwd(), 'payment-output');

const plans = {
  starter: {
    id: 'starter',
    name: 'Starter',
    quota: 60,
    priceEnv: 'STRIPE_PRICE_STARTER'
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    quota: 240,
    priceEnv: 'STRIPE_PRICE_PRO'
  },
  studio: {
    id: 'studio',
    name: 'Studio',
    quota: 1000,
    priceEnv: 'STRIPE_PRICE_STUDIO'
  }
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.PAYMENT_ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Stripe-Signature');
}

function send(res, status, body) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function appUrl() {
  return (process.env.PUBLIC_APP_URL || 'http://127.0.0.1:8081').replace(/\/+$/, '');
}

async function createCheckoutSession(payload) {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Missing STRIPE_SECRET_KEY');
  const plan = plans[payload.planId];
  if (!plan) throw new Error('Unknown planId');
  const priceId = process.env[plan.priceEnv];
  if (!priceId) throw new Error(`Missing ${plan.priceEnv}`);

  const params = new URLSearchParams();
  params.set('mode', 'subscription');
  params.set('line_items[0][price]', priceId);
  params.set('line_items[0][quantity]', '1');
  params.set('success_url', `${appUrl()}/?payment=success&session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${appUrl()}/?payment=cancel`);
  params.set('allow_promotion_codes', 'true');
  params.set('client_reference_id', payload.projectId || payload.customerEmail || plan.id);
  params.set('metadata[planId]', plan.id);
  params.set('metadata[quota]', String(plan.quota));
  params.set('metadata[projectId]', payload.projectId || '');
  params.set('metadata[customerName]', payload.customerName || '');
  if (payload.customerEmail) params.set('customer_email', payload.customerEmail);

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message || `Stripe HTTP ${res.status}`);

  await appendEvent({
    type: 'checkout.session.created',
    createdAt: new Date().toISOString(),
    planId: plan.id,
    sessionId: body.id,
    url: body.url
  });

  return {
    id: body.id,
    url: body.url,
    planId: plan.id
  };
}

function verifyStripeSignature(rawBody, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: 'Missing STRIPE_WEBHOOK_SECRET' };
  if (!signature) return { ok: false, reason: 'Missing Stripe-Signature' };

  const parts = Object.fromEntries(signature.split(',').map(part => {
    const [key, value] = part.split('=');
    return [key, value];
  }));
  const timestamp = parts.t;
  const expected = parts.v1;
  if (!timestamp || !expected) return { ok: false, reason: 'Malformed Stripe-Signature' };

  const payload = `${timestamp}.${rawBody.toString('utf8')}`;
  const digest = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const ok = crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(expected));
  return { ok, reason: ok ? '' : 'Invalid Stripe signature' };
}

async function appendEvent(event) {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.appendFile(path.join(OUT_DIR, 'payment-events.jsonl'), JSON.stringify(event) + '\n');
}

async function handleWebhook(req, res) {
  const raw = await readBody(req);
  const check = verifyStripeSignature(raw, req.headers['stripe-signature']);
  if (!check.ok) return send(res, 400, { error: check.reason });

  let event;
  try { event = JSON.parse(raw.toString('utf8')); } catch (_) { return send(res, 400, { error: 'Invalid JSON' }); }

  const session = event.data && event.data.object;
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    await appendEvent({
      type: event.type,
      receivedAt: new Date().toISOString(),
      sessionId: session.id,
      customer: session.customer,
      customerEmail: session.customer_details?.email || session.customer_email || '',
      planId: session.metadata?.planId,
      quota: Number(session.metadata?.quota || 0),
      subscription: session.subscription || '',
      paymentStatus: session.payment_status
    });
  } else {
    await appendEvent({
      type: event.type,
      receivedAt: new Date().toISOString(),
      id: event.id
    });
  }

  return send(res, 200, { received: true });
}

const server = http.createServer(async (req, res) => {
  try {
    cors(res);
    if (req.method === 'OPTIONS') return res.end();
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, {
        ok: true,
        stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
        webhookConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
        plans: Object.values(plans).map(plan => ({
          id: plan.id,
          name: plan.name,
          quota: plan.quota,
          priceConfigured: !!process.env[plan.priceEnv]
        }))
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/payments/checkout') {
      const raw = await readBody(req);
      const payload = raw.length ? JSON.parse(raw.toString('utf8')) : {};
      const session = await createCheckoutSession(payload);
      return send(res, 200, session);
    }

    if (req.method === 'POST' && url.pathname === '/api/payments/webhook') {
      return handleWebhook(req, res);
    }

    return send(res, 404, { error: 'Not found' });
  } catch (err) {
    return send(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(JSON.stringify({
    ok: true,
    service: 'bookreel-payment-server',
    port: PORT,
    checkout: `http://localhost:${PORT}/api/payments/checkout`,
    webhook: `http://localhost:${PORT}/api/payments/webhook`
  }, null, 2));
});
