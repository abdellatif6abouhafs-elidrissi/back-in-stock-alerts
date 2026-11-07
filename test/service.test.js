'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startMock, startApp, post, webhook, waitFor, sleep } = require('./helpers');

const evt = (id, sku = 'SKU1', quantity = 5) => ({ event_id: id, type: 'stock.updated', sku, quantity, occurred_at: new Date().toISOString() });
const status = (app, id) => app.db.prepare('SELECT status FROM requests WHERE id = ?').get(id).status;

async function setup(t) {
  const mock = await startMock();
  const app = await startApp(mock);
  t.after(async () => {
    await app.close();
    await mock.close();
  });
  return { mock, app };
}

test('1. two identical webhooks sent concurrently -> exactly one email', async (t) => {
  const { mock, app } = await setup(t);
  mock.stock.SKU1 = { name: 'Blue Shirt', quantity: 5, in_stock: true };
  const r = await post(`${app.base}/api/requests`, { email: 'a@example.com', sku: 'sku1' });
  assert.equal(r.status, 201);

  const [w1, w2] = await Promise.all([webhook(app.base, evt('evt-1')), webhook(app.base, evt('evt-1'))]);
  assert.equal(w1.status, 200);
  assert.equal(w2.status, 200);
  const bodies = await Promise.all([w1.json(), w2.json()]);
  assert.equal(bodies.filter((b) => b.duplicate).length, 1);

  await waitFor(() => status(app, 1) === 'notified');
  await sleep(150);
  assert.equal(mock.emails.length, 1, 'provider was called exactly once');
  assert.equal(mock.emails[0].key, 'request-1');
  assert.equal(mock.emails[0].body.to, 'a@example.com');
  assert.match(mock.emails[0].body.subject, /Blue Shirt/);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM webhook_events').get().n, 1);
});

test('2. phantom webhook -> zero emails; later real restock -> one email', async (t) => {
  const { mock, app } = await setup(t);
  mock.stock.SKU1 = { name: 'Blue Shirt', quantity: 0, in_stock: false };
  await post(`${app.base}/api/requests`, { email: 'a@example.com', sku: 'SKU1' });

  const w = await webhook(app.base, evt('evt-phantom', 'SKU1', 99)); // claims 99, stock API says 0
  assert.equal(w.status, 200);
  await waitFor(() => app.db.prepare('SELECT result FROM webhook_events WHERE event_id = ?').get('evt-phantom').result === 'phantom');
  assert.equal(mock.emails.length, 0);
  assert.equal(status(app, 1), 'open');

  mock.stock.SKU1 = { name: 'Blue Shirt', quantity: 10, in_stock: true };
  await webhook(app.base, evt('evt-real', 'SKU1', 10));
  await waitFor(() => status(app, 1) === 'notified');
  await sleep(100);
  assert.equal(mock.emails.length, 1);
});

test('3. email send fails with 500 once -> stays open -> next poll sends, one email, same Idempotency-Key', async (t) => {
  const { mock, app } = await setup(t);
  mock.stock.SKU1 = { quantity: 3, in_stock: true };
  mock.failNext = 1;
  await post(`${app.base}/api/requests`, { email: 'a@example.com', sku: 'SKU1' });

  await webhook(app.base, evt('evt-1'));
  await waitFor(() => mock.emails.length === 1);
  await waitFor(() => app.db.prepare('SELECT attempts FROM requests WHERE id = 1').get().attempts === 1);
  const row = app.db.prepare('SELECT * FROM requests WHERE id = 1').get();
  assert.equal(row.status, 'open', 'failed send goes back to open');
  assert.match(row.last_error, /500/);

  await app.processor.pollOnce();
  assert.equal(status(app, 1), 'notified');
  assert.equal(mock.emails.length, 2, 'two attempts reached the provider...');
  assert.equal(mock.emails[0].key, mock.emails[1].key, '...with the same Idempotency-Key');
  assert.equal(mock.delivered.size, 1, '...so exactly one email was actually delivered');

  await app.processor.pollOnce();
  assert.equal(mock.emails.length, 2, 'nothing further is sent');
});

test('4. duplicate POST /api/requests -> one row', async (t) => {
  const { app } = await setup(t);
  const a = await post(`${app.base}/api/requests`, { email: 'A@Example.com ', sku: ' sku1 ' });
  const b = await post(`${app.base}/api/requests`, { email: 'a@example.com', sku: 'SKU1' });
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  assert.deepEqual(await b.json(), { ok: true, duplicate: true });
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM requests').get().n, 1);
  assert.throws(() => app.db.prepare(`INSERT INTO requests (email, sku, status, created_at) VALUES ('a@example.com','SKU1','open','x')`).run(), /UNIQUE/);

  for (const bad of [{}, { email: 'nope', sku: 'X' }, { email: 'a@b.co', sku: '  ' }, { email: 'a@b.co' }]) {
    const r = await post(`${app.base}/api/requests`, bad);
    assert.equal(r.status, 400);
    assert.ok((await r.json()).error);
  }
});

test('5. wrong webhook secret -> 401, no side effects', async (t) => {
  const { mock, app } = await setup(t);
  mock.stock.SKU1 = { quantity: 5, in_stock: true };
  await post(`${app.base}/api/requests`, { email: 'a@example.com', sku: 'SKU1' });

  for (const secret of ['wrong', null, '']) {
    const r = await webhook(app.base, evt('evt-x'), secret);
    assert.equal(r.status, 401);
  }
  await sleep(150);
  assert.equal(mock.emails.length, 0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM webhook_events').get().n, 0);
  assert.equal(status(app, 1), 'open');
});

test('bonus: requests stuck in "sending" are recovered and sent exactly once', async (t) => {
  const { mock, app } = await setup(t);
  mock.stock.SKU1 = { quantity: 5, in_stock: true };
  await post(`${app.base}/api/requests`, { email: 'a@example.com', sku: 'SKU1' });
  const old = new Date(Date.now() - 5 * 60_000).toISOString();
  app.db.prepare(`UPDATE requests SET status = 'sending', sending_at = ? WHERE id = 1`).run(old); // simulated crash mid-send

  await app.processor.pollOnce();
  assert.equal(status(app, 1), 'notified');
  assert.equal(mock.emails.length, 1);
});

test('admin requires auth and embed allows framing', async (t) => {
  const { app } = await setup(t);
  assert.equal((await fetch(`${app.base}/admin`)).status, 401);
  const ok = await fetch(`${app.base}/admin`, { headers: { authorization: `Basic ${Buffer.from('x:admin').toString('base64')}` } });
  assert.equal(ok.status, 200);
  const embed = await fetch(`${app.base}/embed?sku=abc`);
  assert.equal(embed.headers.get('content-security-policy'), 'frame-ancestors *');
  assert.equal(embed.headers.get('x-frame-options'), null);
  assert.match(await embed.text(), /value="ABC" readonly/);
  assert.deepEqual(await (await fetch(`${app.base}/healthz`)).json(), { ok: true });
});
