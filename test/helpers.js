'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');

const SECRET = 'test-secret';
const silent = { log() {}, error() {}, warn() {} };

/** Tiny in-process mock of the stock API and the Resend API. */
async function startMock() {
  const state = {
    stock: {}, // sku -> { quantity, in_stock, name }
    emails: [], // every POST /emails received: { key, to, body }
    delivered: new Map(), // idempotency key -> provider id (what the provider actually sent)
    failNext: 0, // respond 500 to this many email POSTs
  };
  const server = http.createServer((req, res) => {
    const json = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'GET' && req.url.startsWith('/stock/')) {
      if (req.headers.authorization !== 'Bearer stock-key') return json(401, { error: 'unauthorized' });
      const sku = decodeURIComponent(req.url.slice('/stock/'.length));
      const item = state.stock[sku];
      return item ? json(200, { sku, ...item }) : json(404, { error: 'not found' });
    }
    if (req.method === 'POST' && req.url === '/emails') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const key = req.headers['idempotency-key'];
        state.emails.push({ key, to: JSON.parse(raw).to, auth: req.headers.authorization, body: JSON.parse(raw) });
        if (state.failNext > 0) {
          state.failNext -= 1;
          return json(500, { error: 'boom' });
        }
        if (!state.delivered.has(key)) state.delivered.set(key, `email_${state.delivered.size + 1}`);
        return json(200, { id: state.delivered.get(key) });
      });
      return;
    }
    json(404, { error: 'no route' });
  });
  await new Promise((r) => server.listen(0, r));
  state.url = `http://127.0.0.1:${server.address().port}`;
  state.close = () => new Promise((r) => (server.closeAllConnections?.(), server.close(r)));
  return state;
}

/** Start the real app against a fresh temp DB, pointed at the mock. */
async function startApp(mock, overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bis-'));
  const cfg = {
    ...loadConfig({
      PORT: '0',
      DATA_DIR: dataDir,
      STOCK_API_URL: `${mock.url}/stock`,
      STOCK_API_KEY: 'stock-key',
      RESEND_API_KEY: 'resend-key',
      RESEND_BASE_URL: mock.url,
      WEBHOOK_SECRET: SECRET,
      POLL_INTERVAL_SECONDS: '3600', // tests trigger polls explicitly
    }),
    ...overrides,
  };
  const service = createApp(cfg, { log: silent });
  const port = await service.start();
  const base = `http://127.0.0.1:${port}`;
  return {
    ...service,
    base,
    close: async () => {
      await service.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

const post = (url, body, headers = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

const webhook = (base, body, secret = SECRET) =>
  post(`${base}/webhooks/stock`, body, secret === null ? {} : { 'x-webhook-secret': secret });

async function waitFor(fn, { timeout = 5000, interval = 20 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error('waitFor timed out');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { startMock, startApp, post, webhook, waitFor, sleep, SECRET };
